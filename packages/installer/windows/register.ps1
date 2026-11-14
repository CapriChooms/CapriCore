param([Parameter(Mandatory=$true)][string]$InstallRoot,[switch]$DesktopShortcut,[switch]$StartMenuShortcut,[string]$VerificationRoot)
# SPDX-License-Identifier: GPL-3.0-only
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'localization.ps1')
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');
Assert-CapriNoLinks $root
$identity=Read-CapriJson (Join-Path $root '.capri-install.json')
if($identity.productId -ne 'capri.desktop' -or $identity.root -ne $root -or $identity.installId -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid managed installation.'}
$keyName='Capri.'+$identity.installId
$runtimeManifest=Read-CapriJson (Join-Path $root 'config/installer.json')
$nodeDirectory=$runtimeManifest.artifacts.node.directory
if($nodeDirectory -notmatch '^node-v[0-9.]+-win-x64$'){throw 'Invalid installed Node directory.'}
$generated=Join-Path $root '.runtime/installer/AppInfo.cs'
[IO.Directory]::CreateDirectory((Split-Path -Parent $generated))|Out-Null
[IO.File]::WriteAllText($generated,('internal static class CapriApplicationInfo {internal const string NodeDirectory="'+$nodeDirectory+'";}'))
$csc=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$localeSource=Join-Path $PSScriptRoot 'setup-localization.cs'
$shellCatalog=Join-Path $root 'config/installer-shell-text.json'
Assert-CapriNoLinks $shellCatalog
$shellMessages=Read-CapriJson $shellCatalog
$language=Get-CapriInstalledLanguage $root $shellMessages
$capriLauncherTemporary=Join-Path $root ('.runtime/installer/Capri-'+[Guid]::NewGuid().ToString('N')+'.exe')
& $csc /nologo /target:winexe /platform:x64 /optimize+ ('/win32icon:'+(Join-Path $root 'assets/default/app.ico')) ('/out:'+$capriLauncherTemporary) /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ('/resource:'+$shellCatalog+',CapriSetupTranslations') (Join-Path $PSScriptRoot 'app-launcher.cs') $localeSource $generated
if($LASTEXITCODE -ne 0){throw 'Could not create the application launcher.'}
try {
    $capriLauncherDeadline=[DateTime]::UtcNow.AddSeconds(5)
    while($true){
        try{Move-Item -LiteralPath $capriLauncherTemporary -Destination (Join-Path $root 'Capri.exe') -Force -ErrorAction Stop;break}
        catch{if([DateTime]::UtcNow -ge $capriLauncherDeadline){throw};Start-Sleep -Milliseconds 100}
    }
} finally {
    if(Test-Path -LiteralPath $capriLauncherTemporary){Remove-Item -LiteralPath $capriLauncherTemporary -Force}
}
if(Test-Path -LiteralPath (Join-Path $root 'node_modules/electron/dist/electron.exe')){
    & (Join-Path $root ('.runtime/'+$nodeDirectory+'/node.exe')) (Join-Path $root 'packages/runtime/bin/prepare-desktop.mjs')
    if($LASTEXITCODE -ne 0){throw 'Could not prepare the Capri desktop executable.'}
}
$registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$keyName
$desktop=[Environment]::GetFolderPath('DesktopDirectory');
$menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'Capri'
if($VerificationRoot){
    $check=[IO.Path]::GetFullPath($VerificationRoot)
    if(-not $check.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Verification output must stay inside the installation.'}
    $desktop=Join-Path $check 'Desktop';
    $menu=Join-Path $check 'Programs';
    $registry='HKCU:\Software\CapriInstallerTests\'+$identity.installId
}
$recovery=Join-Path $env:LOCALAPPDATA ('Capri/Uninstall/'+$identity.installId)
if($VerificationRoot){$recovery=Join-Path $VerificationRoot ('Uninstall/'+$identity.installId)}
Assert-CapriNoLinks $recovery
[IO.Directory]::CreateDirectory($recovery)|Out-Null
foreach($name in @('uninstall.ps1','uninstall-window.cs','common.ps1','shell-link.cs','localization.ps1')){
    if($VerificationRoot -and -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name))){continue}
    $destination=Join-Path $recovery $name
    Assert-CapriNoLinks $destination
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination -Force
}
Copy-Item -LiteralPath (Join-Path $root 'assets/default/app.ico') -Destination (Join-Path $recovery 'app.ico') -Force
Copy-Item -LiteralPath (Join-Path $root 'config/installer.json') -Destination (Join-Path $recovery 'installer-config.json') -Force
$uninstallCatalog=Join-Path $root 'config/uninstaller-text.json'
Assert-CapriNoLinks $uninstallCatalog
Assert-CapriNoLinks (Join-Path $recovery 'uninstaller-text.json')
Copy-Item -LiteralPath $uninstallCatalog -Destination (Join-Path $recovery 'uninstaller-text.json') -Force
$uninstallLauncher=Join-Path $root 'uninstall.exe'
$launcherSource=Join-Path $PSScriptRoot 'uninstall-launcher.cs'
$hasUninstallLauncher=Test-Path -LiteralPath $launcherSource -PathType Leaf
if(-not $hasUninstallLauncher -and -not $VerificationRoot){throw 'The Capri uninstaller source is missing.'}
$links=@();
$previousRegistration=Join-Path $root '.runtime/installer/registration.json'
if(Test-Path -LiteralPath $previousRegistration -PathType Leaf){
    $previous=Read-CapriJson $previousRegistration
    if($previous.installId -eq $identity.installId){
        foreach($existing in $previous.shortcuts){
            if([IO.Path]::IsPathRooted($existing) -and [IO.Path]::GetFileName($existing) -eq ('Capri - '+$identity.installId.Substring(0,8)+'.lnk') -and (Test-Path -LiteralPath $existing -PathType Leaf)){$links+=$existing}
        }
    }
}
if(-not ('Capri.Setup.Shortcuts' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'shell-link.cs')}
foreach($choice in @(@{enabled=$DesktopShortcut;
    folder=$desktop},@{enabled=$StartMenuShortcut;
    folder=$menu})){
    if(-not $choice.enabled){continue};
    [IO.Directory]::CreateDirectory($choice.folder)|Out-Null
    $file=Join-Path $choice.folder ('Capri - '+$identity.installId.Substring(0,8)+'.lnk')
    [Capri.Setup.Shortcuts]::Save($file,(Join-Path $root 'Capri.exe'),$root,(Get-CapriInstallerText $shellMessages $language 'shortcutDescription'));
    $links+=$file
}
New-Item -Path $registry -Force|Out-Null
$uninstall='powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File '+(Quote-CapriArgument (Join-Path $recovery 'uninstall.ps1'))+' -InstallRoot '+(Quote-CapriArgument $root)
$values=@{DisplayName='Capri';
    DisplayVersion=$identity.version;
    Publisher='Capri contributors';
    InstallLocation=$root;
    DisplayIcon=(Join-Path $root 'Capri.exe');
    UninstallString=$(if($hasUninstallLauncher){Quote-CapriArgument $uninstallLauncher}else{$uninstall});
    QuietUninstallString=$(if($hasUninstallLauncher){(Quote-CapriArgument $uninstallLauncher)+' --quiet'}else{$uninstall+' -Quiet'});
    NoModify=1;
    NoRepair=1}
foreach($name in $values.Keys){New-ItemProperty -LiteralPath $registry -Name $name -Value $values[$name] -PropertyType $(if($values[$name] -is [int]){'DWord'}else{'String'}) -Force|Out-Null}
$links=@($links|Select-Object -Unique)
$registration=@{registry=$registry;
    root=$root;
    shortcuts=$links;
    installId=$identity.installId;
    recovery=$recovery}
$sourceReceipt=Join-Path $root '.runtime/installer/source-files.json'
$oldVoice=Join-Path $root '.runtime/installer/bundled-voice'
$newVoice=Join-Path $root 'data/speech/bundled-voice'
Assert-CapriNoLinks $oldVoice
Assert-CapriNoLinks $newVoice
if((Test-Path -LiteralPath $oldVoice -PathType Container) -and -not (Test-Path -LiteralPath $newVoice)){
    [IO.Directory]::CreateDirectory((Split-Path -Parent $newVoice))|Out-Null
    Move-Item -LiteralPath $oldVoice -Destination $newVoice
}
$receipt=Read-CapriJson $sourceReceipt
$installedFiles=@{}
foreach($entry in $receipt.files){$installedFiles[$entry.path]=$entry}
foreach($entry in $receipt.files){
    if($entry.path -notmatch '^(?:[^/\\:]+\.cmd|README\.md|ROADMAP\.md|CONTRIBUTING\.md|SECURITY\.md|LICENSE|THIRD_PARTY_NOTICES\.md)$'){continue}
    $flat=Join-Path $root $entry.path
    Assert-CapriNoLinks $flat
    if(-not (Test-Path -LiteralPath $flat -PathType Leaf) -or (Get-CapriHash $flat) -ne $entry.sha256){continue}
    $relative='Support/'+$entry.path
    $tidy=Join-Path $root $relative
    Assert-CapriNoLinks $tidy
    [IO.Directory]::CreateDirectory((Split-Path -Parent $tidy))|Out-Null
    $temporary=$null
    try {
        $newFile=$flat
        if($entry.path.EndsWith('.md',[StringComparison]::OrdinalIgnoreCase)){
            $temporary=Join-Path $root ('.runtime/installer/support-'+[Guid]::NewGuid().ToString('N')+'.md')
            $markdown=[IO.File]::ReadAllText($flat).Replace('](docs/','](../docs/')
            [IO.File]::WriteAllText($temporary,$markdown)
            $newFile=$temporary
        }
        $installedHash=Get-CapriHash $newFile
        if((Test-Path -LiteralPath $tidy) -and (Get-CapriHash $tidy) -ne $installedHash){
            $backup=Join-Path $root ('.runtime/installer/backups/'+[Guid]::NewGuid().ToString('N')+'/'+$relative)
            Assert-CapriNoLinks $backup
            [IO.Directory]::CreateDirectory((Split-Path -Parent $backup))|Out-Null
            Copy-Item -LiteralPath $tidy -Destination $backup
        }
        Move-Item -LiteralPath $newFile -Destination $tidy -Force
        if($temporary){Remove-Item -LiteralPath $flat -Force}
        $installedFiles[$relative]=@{path=$relative;sha256=$installedHash}
        $installedFiles.Remove($entry.path)
    } finally {
        if($temporary -and (Test-Path -LiteralPath $temporary)){Remove-Item -LiteralPath $temporary -Force}
    }
}
foreach($name in @('package.json','package-lock.json','pyproject.toml','.editorconfig','.gitattributes','.gitignore','.npmrc','.node-version','.python-version','.prettierignore','.prettierrc.json','.capri-install.json')){
    $file=Join-Path $root $name
    Assert-CapriNoLinks $file
    if(Test-Path -LiteralPath $file -PathType Leaf){[IO.File]::SetAttributes($file,([IO.File]::GetAttributes($file) -bor [IO.FileAttributes]::Hidden))}
}
Write-CapriJson $sourceReceipt @{files=@($installedFiles.Values)}
Copy-Item -LiteralPath $sourceReceipt -Destination (Join-Path $recovery 'source-files.json') -Force
Write-CapriJson (Join-Path $root '.runtime/installer/registration.json') $registration
Write-CapriJson (Join-Path $recovery 'registration.json') $registration
if($hasUninstallLauncher){
    # Compile after the final receipts exist, so external recovery files have an
    # integrity anchor in the native launcher rather than trusting their own metadata.
    $bundleHashes=@{}
    foreach($name in @('uninstall.ps1','uninstall-window.cs','common.ps1','shell-link.cs','localization.ps1','uninstaller-text.json','installer-config.json','source-files.json','registration.json','app.ico')){
        $file=Join-Path $recovery $name
        Assert-CapriNoLinks $file
        $bundleHashes[$name]=Get-CapriHash $file
    }
    $hashesJson=$bundleHashes|ConvertTo-Json -Compress
    $generatedUninstall=Join-Path $root '.runtime/installer/UninstallInfo.cs'
    [IO.File]::WriteAllText($generatedUninstall,('internal static class CapriUninstallInfo {internal const string Recovery=@"'+$recovery.Replace('"','""')+'";internal const string BundleHashes=@"'+$hashesJson.Replace('"','""')+'";}'))
    $pendingUninstall=Join-Path $root ('.runtime/installer/uninstall-'+[Guid]::NewGuid().ToString('N')+'.exe')
    Assert-CapriNoLinks $uninstallLauncher
    try {
        & $csc /nologo /target:winexe /platform:x64 /optimize+ ('/win32icon:'+(Join-Path $root 'assets/default/app.ico')) ('/out:'+$pendingUninstall) /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll ('/resource:'+$uninstallCatalog+',CapriSetupTranslations') $launcherSource $localeSource (Join-Path $PSScriptRoot 'uninstall-window.cs') $generatedUninstall
        if($LASTEXITCODE -ne 0){throw 'Could not create the Capri uninstaller.'}
        Move-Item -LiteralPath $pendingUninstall -Destination $uninstallLauncher -Force
    } finally {
        if(Test-Path -LiteralPath $pendingUninstall){Remove-Item -LiteralPath $pendingUninstall -Force}
    }
}
