# SPDX-License-Identifier: GPL-3.0-only
function Initialize-CapriSetupDiagnostics {
    if(-not ('Capri.Setup.DiagnosticArchive' -as [type])) {
        Add-Type -Path (Join-Path $PSScriptRoot 'diagnostic-export.cs') -ReferencedAssemblies System.Web.Extensions,System.IO.Compression,System.IO.Compression.FileSystem,System.Management
    }
}
function Save-CapriSetupLog {
    param([string]$RegistryRoot,[string]$SessionDirectory,[string]$UiLogPath,[string]$Target,[string]$Failure)
    Initialize-CapriSetupDiagnostics
    $source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    [Capri.Setup.DiagnosticArchive]::SaveLog($source,$RegistryRoot,$SessionDirectory,$UiLogPath,$Target,$Failure)
}
function Save-CapriSetupDiagnostics {
    param([string]$RegistryRoot,[string]$SessionDirectory,[string]$UiLogPath,[string]$Target,[string]$Failure,[string]$OutputDirectory)
    Initialize-CapriSetupDiagnostics
    if(-not $RegistryRoot){$RegistryRoot=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Capri/Installer'}
    if(-not $OutputDirectory){$OutputDirectory=[Capri.Setup.DiagnosticArchive]::Downloads()}
    $capriReportSource=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    try { return [Capri.Setup.DiagnosticArchive]::Export($capriReportSource,$RegistryRoot,$SessionDirectory,$UiLogPath,$Target,$OutputDirectory,$Failure) }
    catch {
        $capriReportFallback=Join-Path $RegistryRoot 'reports'
        if([IO.Path]::GetFullPath($OutputDirectory) -eq [IO.Path]::GetFullPath($capriReportFallback)){throw}
        return [Capri.Setup.DiagnosticArchive]::Export($capriReportSource,$RegistryRoot,$SessionDirectory,$UiLogPath,$Target,$capriReportFallback,$Failure)
    }
}
