# SPDX-License-Identifier: GPL-3.0-only
param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$ElectronPath,[Parameter(Mandatory=$true)][string]$OutputPath,[Parameter(Mandatory=$true)][string]$Signature)
$ErrorActionPreference='Stop'
$capriBrandRoot=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$capriOriginal=[IO.Path]::GetFullPath($ElectronPath)
if(-not $capriOriginal.StartsWith($capriBrandRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($capriOriginal) -ne 'electron.exe'){throw 'Desktop runtime must belong to this installation.'}
$capriTarget=[IO.Path]::GetFullPath($OutputPath)
if($capriTarget -ne (Join-Path ([IO.Path]::GetDirectoryName($capriOriginal)) 'Capri.exe')){throw 'Branded desktop must stay beside its private Electron runtime.'}
$capriTemporary=$capriTarget+'.'+[Guid]::NewGuid().ToString('N')+'.exe'
$capriMetadataDirectory=Join-Path $capriBrandRoot '.runtime/desktop-identity'
[IO.Directory]::CreateDirectory($capriMetadataDirectory)|Out-Null
if($Signature -notmatch '^[a-f0-9]{64}$'){throw 'Invalid desktop signature.'}
$capriIdentityLock=New-Object Threading.Mutex($false,('Local\Capri.DesktopIdentity.'+$Signature))
$capriLockHeld=$false
try {
try{$capriLockHeld=$capriIdentityLock.WaitOne(60000)}catch [Threading.AbandonedMutexException]{$capriLockHeld=$true}
if(-not $capriLockHeld){throw 'Another launch is still preparing Capri.'}
$capriReceipt=Join-Path $capriMetadataDirectory 'receipt.json'
if((Test-Path -LiteralPath $capriReceipt) -and (Test-Path -LiteralPath $capriTarget)){
    try{if((Get-Content -LiteralPath $capriReceipt -Raw -Encoding UTF8|ConvertFrom-Json).signature -eq $Signature){return}}catch{}
}
$capriMetadataSource=Join-Path $capriMetadataDirectory 'Metadata.cs'
$capriMetadataDll=Join-Path $capriMetadataDirectory 'Metadata.dll'
$capriVersion=(Get-Content -LiteralPath (Join-Path $capriBrandRoot 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json).version
if($capriVersion -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid application version.'}
[IO.File]::WriteAllText($capriMetadataSource,('[assembly:System.Reflection.AssemblyTitle("Capri")][assembly:System.Reflection.AssemblyProduct("Capri")][assembly:System.Reflection.AssemblyCompany("Overyx and Capri contributors")][assembly:System.Reflection.AssemblyVersion("'+$capriVersion+'.0")][assembly:System.Reflection.AssemblyFileVersion("'+$capriVersion+'.0")] public static class CapriDesktopMetadata {}'))
$capriCompiler=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $capriCompiler /nologo /target:library ('/out:'+$capriMetadataDll) $capriMetadataSource
if($LASTEXITCODE -ne 0){throw 'Could not create desktop metadata.'}
if(-not ('Capri.Setup.DesktopBranding' -as [type])){Add-Type -Path (Join-Path $capriBrandRoot 'packages/installer/windows/desktop-branding.cs')}
try {
    [IO.File]::Copy($capriOriginal,$capriTemporary)
    [Capri.Setup.DesktopBranding]::Apply($capriTemporary,$capriMetadataDll,(Join-Path $capriBrandRoot 'assets/default/app.ico'))
    Move-Item -LiteralPath $capriTemporary -Destination $capriTarget -Force
    $capriWer=Join-Path ([IO.Path]::GetDirectoryName($capriOriginal)) 'electron_wer.dll'
    if(Test-Path -LiteralPath $capriWer){[IO.File]::Copy($capriWer,(Join-Path ([IO.Path]::GetDirectoryName($capriTarget)) 'Capri_wer.dll'),$true)}
    [IO.File]::WriteAllText($capriReceipt,('{"schemaVersion":1,"signature":"'+$Signature+'"}'))
} finally {
    if(Test-Path -LiteralPath $capriTemporary){Remove-Item -LiteralPath $capriTemporary -Force}
}
} finally {
    if($capriLockHeld){$capriIdentityLock.ReleaseMutex()}
    $capriIdentityLock.Dispose()
}
