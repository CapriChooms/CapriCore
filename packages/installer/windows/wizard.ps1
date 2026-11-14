param([string]$VerificationDirectory,[string]$BundledVoicePack,[string]$Language,[string]$VerificationLanguages,[string]$VerificationSessionRoot,[int]$VerificationDpi,[string]$VerificationFault,[string]$UiLogPath,[ValidatePattern('^[a-f0-9]{32}$')][string]$ReconnectSession)
# SPDX-License-Identifier: GPL-3.0-only
. (Join-Path $PSScriptRoot 'common.ps1')
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$script:uiDiagnostics=$null;$script:uiLease=$null;$script:session=$null;$script:worker=$null
$script:lastDiagnosticSession=$null;$script:lastDiagnosticReport=$null
try {
    . (Join-Path $PSScriptRoot 'sessions.ps1')
    if($VerificationDirectory){
        $VerificationDirectory=[IO.Path]::GetFullPath($VerificationDirectory)
        if(-not $VerificationDirectory.StartsWith((Join-Path $sourceRoot '.runtime')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Verification output must stay in the project cache.'}
        [IO.Directory]::CreateDirectory($VerificationDirectory)|Out-Null
        if(-not $VerificationSessionRoot){$VerificationSessionRoot=Join-Path $VerificationDirectory 'session-registry'}
        $UiLogPath=Join-Path $VerificationDirectory 'ui.jsonl'
    }
    $script:sessionsRoot=Get-CapriSessionsRoot
    if(-not $UiLogPath){$UiLogPath=Join-Path $script:sessionsRoot ('logs/ui-'+[Guid]::NewGuid().ToString('N')+'.jsonl')}
    $allowedLogRoot=if($VerificationDirectory){$VerificationDirectory}else{Join-Path $script:sessionsRoot 'logs'}
    if(-not [IO.Path]::GetFullPath($UiLogPath).StartsWith($allowedLogRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid UI diagnostic log path.'}
    $dpiAware=[Capri.Setup.Display]::Enable()
    $capriBranded=[Capri.Setup.Display]::Brand()
    $script:uiDiagnostics=New-Object Capri.Setup.UiDiagnostics($UiLogPath)
    $script:uiDiagnostics.Record('dpi-context',('PerMonitorV2='+$dpiAware))
    $script:uiDiagnostics.Record('taskbar-identity',('Capri.Setup='+$capriBranded))
    if($VerificationDirectory -and $VerificationFault -eq 'initialization'){throw 'Injected installer UI initialization failure.'}
    . (Join-Path $PSScriptRoot 'wizard-ui.ps1')
}catch{
    if($script:uiDiagnostics){$script:uiDiagnostics.Record('ui-script-exception',($_|Out-String));$script:uiDiagnostics.ExitReason('ui-script-exception')}
    if($script:session -and $script:uiLease -and $script:uiLease.IsOwner()){[Capri.Setup.SessionIO]::Pause($script:session,'ui-script-exception')}
    $uiTimer=Get-Variable timer -Scope Script -ErrorAction SilentlyContinue
    if($uiTimer){$uiTimer.Value.Stop()}
    if($script:uiLease){$script:uiLease.Dispose()}
    if(-not $VerificationDirectory){
        Add-Type -AssemblyName System.Windows.Forms
        $capriFatalMessage=$_.Exception.Message
        $fatalTitle='Capri Setup'
        $fatalHeading='The setup wizard could not finish.'
        $fatalDetails='Technical details'
        $reportQuestion='Save a diagnostic ZIP to Downloads? No files will be uploaded.'
        $reportFailed='The report could not be saved. Please try again.'
        try {
            . (Join-Path $PSScriptRoot 'localization.ps1')
            $fatalMessages=Read-CapriJson (Join-Path $sourceRoot 'config/installer-text.json')
            $shellMessages=Read-CapriJson (Join-Path $sourceRoot 'config/installer-shell-text.json')
            $activeLanguage=Get-Variable installerLanguage -ValueOnly -ErrorAction SilentlyContinue
            if(-not $activeLanguage){$activeLanguage=$Language}
            if(-not $activeLanguage){$activeLanguage=[Globalization.CultureInfo]::CurrentUICulture.Name}
            $activeLanguage=Get-CapriInstallerCulture $activeLanguage (Get-CapriCatalogLanguages $fatalMessages)
            $fatalTitle=Get-CapriInstallerText $fatalMessages $activeLanguage 'title'
            $fatalHeading=Get-CapriInstallerText $fatalMessages $activeLanguage 'wizardFailed'
            $fatalDetails=Get-CapriInstallerText $fatalMessages $activeLanguage 'technicalDetails'
            $reportQuestion=Get-CapriInstallerText $shellMessages $activeLanguage 'fatalReportQuestion'
            $reportFailed=Get-CapriInstallerText $fatalMessages $activeLanguage 'diagnosticsFailed'
        } catch {} # A damaged catalog must not hide the diagnostic prompt.
        $fatalPrompt=$fatalHeading+"`r`n`r`n"+$reportQuestion+"`r`n`r`n"+$fatalDetails+":`r`n"+$capriFatalMessage
        $capriSaveAnswer=[Windows.Forms.MessageBox]::Show($fatalPrompt,$fatalTitle,'YesNo','Error')
        if($capriSaveAnswer -eq [Windows.Forms.DialogResult]::Yes){
            try {
                . (Join-Path $PSScriptRoot 'diagnostics.ps1')
                $capriSavedReport=Save-CapriSetupDiagnostics -RegistryRoot $script:sessionsRoot -SessionDirectory $script:session -UiLogPath $UiLogPath -Failure $capriFatalMessage
                Start-Process -FilePath explorer.exe -ArgumentList ('/select,"'+$capriSavedReport+'"')|Out-Null
            }catch{[Windows.Forms.MessageBox]::Show(($reportFailed+"`r`n"+$_.Exception.Message),$fatalTitle,'OK','Error')|Out-Null}
        }
    }
    throw
}finally{
    if(Get-Command Clear-CapriCompletionNotice -ErrorAction SilentlyContinue){Clear-CapriCompletionNotice}
    if($script:session -and $script:uiLease -and $script:uiLease.IsOwner() -and (Test-CapriWorker $script:session)){
        [Capri.Setup.SessionIO]::Pause($script:session,'ui-ended-with-active-worker')
    }
    if($script:uiLease){$script:uiLease.Dispose()}
    if($script:uiDiagnostics){$script:uiDiagnostics.Dispose()}
}
