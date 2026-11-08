param([switch]$DesktopShortcut)
# SPDX-License-Identifier: GPL-3.0-only
$ErrorActionPreference='Stop'
$capriLaunchRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$manifest=Get-Content -LiteralPath (Join-Path $capriLaunchRoot 'config/installer.json') -Raw -Encoding UTF8|ConvertFrom-Json
$nodeDirectory=$manifest.artifacts.node.directory
if($nodeDirectory -notmatch '^node-v[0-9.]+-win-x64$'){throw 'Invalid Node runtime.'}
if(-not (Test-Path -LiteralPath (Join-Path $capriLaunchRoot ('.runtime/'+$nodeDirectory+'/node.exe')))){throw 'Install the private Node runtime first.'}
$generated=Join-Path $capriLaunchRoot '.runtime/installer/LocalAppInfo.cs'
[IO.Directory]::CreateDirectory((Split-Path -Parent $generated))|Out-Null
[IO.File]::WriteAllText($generated,('internal static class CapriApplicationInfo {internal const string NodeDirectory="'+$nodeDirectory+'";}'))
$csc=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$capriLauncherTemporary=Join-Path $capriLaunchRoot ('.runtime/installer/Capri-'+[Guid]::NewGuid().ToString('N')+'.exe')
& $csc /nologo /target:winexe /platform:x64 /optimize+ ('/win32icon:'+(Join-Path $capriLaunchRoot 'assets/default/app.ico')) ('/out:'+$capriLauncherTemporary) /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ('/resource:'+(Join-Path $capriLaunchRoot 'config/installer-shell-text.json')+',CapriSetupTranslations') (Join-Path $capriLaunchRoot 'packages/installer/windows/app-launcher.cs') (Join-Path $capriLaunchRoot 'packages/installer/windows/setup-localization.cs') $generated
if($LASTEXITCODE -ne 0){throw 'Could not build the local launcher.'}
try {
    $capriLauncherDeadline=[DateTime]::UtcNow.AddSeconds(5)
    while($true){
        try{Move-Item -LiteralPath $capriLauncherTemporary -Destination (Join-Path $capriLaunchRoot 'Capri.exe') -Force -ErrorAction Stop;break}
        catch{if([DateTime]::UtcNow -ge $capriLauncherDeadline){throw};Start-Sleep -Milliseconds 100}
    }
} finally {
    if(Test-Path -LiteralPath $capriLauncherTemporary){Remove-Item -LiteralPath $capriLauncherTemporary -Force}
}
if(Test-Path -LiteralPath (Join-Path $capriLaunchRoot 'node_modules/electron/dist/electron.exe')){
    & (Join-Path $capriLaunchRoot ('.runtime/'+$nodeDirectory+'/node.exe')) (Join-Path $capriLaunchRoot 'packages/runtime/bin/prepare-desktop.mjs')
    if($LASTEXITCODE -ne 0){throw 'Could not prepare the Capri desktop executable.'}
}
if($DesktopShortcut){
    $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Capri Local.lnk'))
    $shortcut.TargetPath=Join-Path $capriLaunchRoot 'Capri.exe'
    $shortcut.WorkingDirectory=$capriLaunchRoot
    $shortcut.Description='Capri local pre-alpha'
    $shortcut.IconLocation=$shortcut.TargetPath+',0'
    $shortcut.Save()
}
