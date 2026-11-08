# SPDX-License-Identifier: GPL-3.0-only
if(-not ('Capri.Setup.SessionIO' -as [type])){
    Add-Type -Path @((Join-Path $PSScriptRoot 'session.cs'),(Join-Path $PSScriptRoot 'ui-diagnostics.cs'),(Join-Path $PSScriptRoot 'display.cs')) -ReferencedAssemblies System.Web.Extensions,System.Windows.Forms,System.Drawing
}
function Get-CapriSessionsRoot {
    $directory=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Capri/Installer'
    if($VerificationDirectory -and $VerificationSessionRoot){
        $directory=[IO.Path]::GetFullPath($VerificationSessionRoot)
        $allowed=(Join-Path $sourceRoot '.runtime')+'\'
        if(-not $directory.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Verification session root must stay in the project cache.'}
    }
    [Capri.Setup.SessionIO]::NoLinks($directory)
    [IO.Directory]::CreateDirectory((Join-Path $directory 'sessions'))|Out-Null
    return $directory
}
function Get-CapriCurrentSession {
    $pointer=Join-Path $script:sessionsRoot 'active.json'
    if(-not(Test-Path -LiteralPath $pointer)){return $null}
    try{$record=Read-CapriJson $pointer}catch{if(-not(Test-Path -LiteralPath $pointer)){return $null};throw}
    if($record.schemaVersion -ne 1 -or $record.id -notmatch '^[a-f0-9]{32}$'){throw 'Invalid installation session registry.'}
    $folder=Join-Path $script:sessionsRoot ('sessions/'+$record.id)
    [Capri.Setup.SessionIO]::NoLinks($folder)
    $header=Read-CapriJson (Join-Path $folder 'session.json')
    if($header.id -ne $record.id -or $header.schemaVersion -ne 1){throw 'Installation session identity mismatch.'}
    return $folder
}
function Test-CapriWorker([string]$Folder) {
    $file=Join-Path $Folder 'worker.json'
    if(-not(Test-Path -LiteralPath $file)){return $false}
    $record=Read-CapriJson $file
    return [Capri.Setup.SessionIO]::Alive([int]$record.pid,[string]$record.stamp)
}
function Open-CapriSession([string]$Folder) {
    $script:uiLease=New-Object Capri.Setup.UiLease($Folder,$form.Handle.ToInt64())
    $script:session=$Folder
    $script:lastDiagnosticSession=$Folder
    $header=Read-CapriJson (Join-Path $Folder 'session.json')
    if($header.PSObject.Properties.Name -contains 'language' -and @($locales|Where-Object{$_.id -eq $header.language}).Count){$script:installerLanguage=$header.language}
    $request=Read-CapriJson (Join-Path $Folder 'request.json')
    foreach($property in $request.PSObject.Properties){$options[$property.Name]=$property.Value}
    $script:eventsCursor=New-Object Capri.Setup.EventCursor((Join-Path $Folder 'events.jsonl'))
    $script:worker=$null
    $script:page=6
    $script:result=$null;$script:failure='';$script:recovered=$true
    $script:uiDiagnostics.Session=$Folder
    $script:uiDiagnostics.Owner=$script:uiLease
    if(Test-CapriWorker $Folder){$script:uiDiagnostics.AttachWorker()}
    Write-CapriJson (Join-Path $Folder 'ui-log-location.json') @{uiLog=$UiLogPath;launcherLogs=(Join-Path $script:sessionsRoot 'logs')}
    [Capri.Setup.SessionIO]::Log((Join-Path $Folder 'ui-events.jsonl'),'ui-attached',('PID '+$PID))
}
function New-CapriSession {
    $gate=[Capri.Setup.SessionIO]::Gate((Join-Path $script:sessionsRoot 'registry.lock'))
    try {
        if(Get-CapriCurrentSession){throw 'INSTALLER_ALREADY_ACTIVE'}
        $id=[Guid]::NewGuid().ToString('N')
        $folder=Join-Path $script:sessionsRoot ('sessions/'+$id)
        [IO.Directory]::CreateDirectory($folder)|Out-Null
        Write-CapriJson (Join-Path $folder 'session.json') @{schemaVersion=1;id=$id;sourceRoot=$sourceRoot;releaseTag=(Read-CapriJson (Join-Path $sourceRoot 'config/release.json')).tag;language=$installerLanguage;createdAt=[DateTime]::UtcNow.ToString('o')}
        $request=$options.Clone()
        if($request.inferenceMode -eq 'api'){$request.downloadModels=$false}
        Write-CapriJson (Join-Path $folder 'request.json') $request
        [IO.File]::WriteAllText((Join-Path $folder 'events.jsonl'),'')
        Write-CapriJson (Join-Path $script:sessionsRoot 'active.json') @{schemaVersion=1;id=$id}
        return $folder
    }finally{$gate.Dispose()}
}
function Clear-CapriSession {
    if(-not $script:session){return}
    $gate=[Capri.Setup.SessionIO]::Gate((Join-Path $script:sessionsRoot 'registry.lock'))
    try {
        if((Get-CapriCurrentSession) -eq $script:session){Remove-Item -LiteralPath (Join-Path $script:sessionsRoot 'active.json')}
    }finally{$gate.Dispose()}
    if($script:uiLease){$script:uiLease.Dispose();$script:uiLease=$null}
    $script:session=$null
}
