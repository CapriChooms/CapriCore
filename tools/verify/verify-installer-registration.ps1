param([Parameter(Mandatory=$true)][string]$VerificationRoot)
# SPDX-License-Identifier: GPL-3.0-only
. (Join-Path $PSScriptRoot '../../packages/installer/windows/common.ps1')
$capriVerifyRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$target=[IO.Path]::GetFullPath($VerificationRoot)
if(-not $target.StartsWith((Join-Path $capriVerifyRoot '.runtime')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Registration test must stay inside the project cache.'}
[IO.Directory]::CreateDirectory((Join-Path $target 'config'))|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $target 'assets/default'))|Out-Null
Copy-Item -LiteralPath (Join-Path $capriVerifyRoot 'config/installer.json') -Destination (Join-Path $target 'config/installer.json')
Copy-Item -LiteralPath (Join-Path $capriVerifyRoot 'config/installer-shell-text.json') -Destination (Join-Path $target 'config/installer-shell-text.json')
Copy-Item -LiteralPath (Join-Path $capriVerifyRoot 'config/uninstaller-text.json') -Destination (Join-Path $target 'config/uninstaller-text.json')
Copy-Item -LiteralPath (Join-Path $capriVerifyRoot 'assets/default/app.ico') -Destination (Join-Path $target 'assets/default/app.ico')
Write-CapriJson (Join-Path $target '.runtime/installer/source-files.json') @{files=@()}
$id=[Guid]::NewGuid().ToString()
Write-CapriJson (Join-Path $target '.capri-install.json') @{schemaVersion=1;
    productId='capri.desktop';
    root=$target;
    version='0.3.0';
    installId=$id}
try{
    & (Join-Path $capriVerifyRoot 'packages/installer/windows/register.ps1') -InstallRoot $target -DesktopShortcut -StartMenuShortcut -VerificationRoot (Join-Path $target 'shell')
    $registration=Read-CapriJson (Join-Path $target '.runtime/installer/registration.json')
    $expected='HKCU:\Software\CapriInstallerTests\'+$id
    if($registration.registry -ne $expected -or (Get-ItemProperty -LiteralPath $expected).InstallLocation -ne $target){throw 'Registration data mismatch.'}
    foreach($link in $registration.shortcuts){if([Capri.Setup.Shortcuts]::Read($link).TargetPath -ne (Join-Path $target 'Capri.exe')){throw 'Shortcut target mismatch.'}}
    Write-Output 'Per-user registration, two shortcuts and the native app launcher passed.'
}finally{
    $key='HKCU:\Software\CapriInstallerTests\'+$id
    if((Test-Path -LiteralPath $key) -and (Get-ItemProperty -LiteralPath $key).InstallLocation -eq $target){Remove-Item -LiteralPath $key -Force}
}
