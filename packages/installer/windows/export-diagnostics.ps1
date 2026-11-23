# SPDX-License-Identifier: GPL-3.0-only
param([string]$RegistryRoot,[string]$SessionDirectory,[string]$UiLogPath,[string]$Target,[string]$Failure,[string]$OutputDirectory,[switch]$Show)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'diagnostics.ps1')
if($MyInvocation.InvocationName -ne '.') {
    try {
        $capriReport=Save-CapriSetupDiagnostics -RegistryRoot $RegistryRoot -SessionDirectory $SessionDirectory -UiLogPath $UiLogPath -Target $Target -Failure $Failure -OutputDirectory $OutputDirectory
        Write-Output $capriReport
        if($Show){Start-Process -FilePath explorer.exe -ArgumentList ('/select,"'+$capriReport+'"')|Out-Null}
    }catch{
        if($Show){
            $reportError=$_.Exception.Message
            $title='Capri Setup'
            $failed='The report could not be saved. Please try again.'
            $details='Technical details'
            try {
                . (Join-Path $PSScriptRoot 'common.ps1')
                . (Join-Path $PSScriptRoot 'localization.ps1')
                $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
                $catalog=Read-CapriJson (Join-Path $root 'config/installer-text.json')
                $language=Get-CapriInstalledLanguage $root $catalog
                $title=Get-CapriInstallerText $catalog $language 'title'
                $failed=Get-CapriInstallerText $catalog $language 'diagnosticsFailed'
                $details=Get-CapriInstallerText $catalog $language 'technicalDetails'
            } catch {} # The error dialog is still useful if the catalog is unavailable.
            Add-Type -AssemblyName System.Windows.Forms
            [Windows.Forms.MessageBox]::Show(($failed+"`r`n`r`n"+$details+":`r`n"+$reportError),$title,'OK','Error')|Out-Null
        }
        throw
    }
}
