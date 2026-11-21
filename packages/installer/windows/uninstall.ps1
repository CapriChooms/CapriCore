param([Parameter(Mandatory=$true)][string]$InstallRoot,[switch]$Quiet,[switch]$DeleteData,[switch]$DeleteModels,[switch]$DeleteSettings,[bool]$RemoveApplication=$true,[switch]$PlanOnly,[switch]$MeasureOnly,[int]$LauncherPid)
# SPDX-License-Identifier: GPL-3.0-only
. (Join-Path $PSScriptRoot 'common.ps1')
$mutex=$null
$ownsMutex=$false
$messages=$null
$rightToLeft=$false
$progressWindow=$null
$installedVersion=''
function Import-CapriUninstallWindow {
    Add-Type -AssemblyName System.Windows.Forms
    if(-not ('Capri.Setup.UninstallWindow' -as [type])){
        $sources=@((Join-Path $PSScriptRoot 'cyberpunk-theme.cs'),(Join-Path $PSScriptRoot 'uninstall-window.cs'))
        foreach($source in $sources){Assert-CapriNoLinks $source}
        Add-Type -Path $sources -ReferencedAssemblies System.Windows.Forms,System.Drawing
    }
}
function Wait-CapriUninstall {
    if($progressWindow -and -not $progressWindow.WaitForWork()){
        throw [OperationCanceledException]::new('Capri uninstall was cancelled.')
    }
}
function Get-CapriCameraCleanupHost([string]$Root) {
    $cameraDirectory=Join-Path $Root '.runtime/capri-camera'
    $active=Join-Path $cameraDirectory 'active.json'
    try {
        Assert-CapriNoLinks $active
        if([IO.File]::Exists($active)){
            Assert-CapriArchiveSingleLink $active
            $stream=[IO.File]::Open($active,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
            try {
                if($stream.Length -eq 0 -or $stream.Length -gt 256){throw 'Invalid camera receipt size.'}
                $reader=New-Object IO.StreamReader($stream,[Text.UTF8Encoding]::new($false,$true))
                try{$text=$reader.ReadToEnd()}
                finally{$reader.Dispose()}
            }finally{$stream.Dispose()}
            if(-not $text.TrimStart().StartsWith('{')){throw 'Invalid camera receipt.'}
            $receipt=$text | ConvertFrom-Json
            $keys=@($receipt.PSObject.Properties.Name)
            if($keys.Count -ne 2 -or $keys -cnotcontains 'schemaVersion' -or $keys -cnotcontains 'bundleId' -or
               $receipt.schemaVersion -isnot [int] -or $receipt.schemaVersion -ne 1 -or
               $receipt.bundleId -isnot [string] -or $receipt.bundleId -cnotmatch '\A[a-f0-9]{32}\z'){
                throw 'Invalid camera receipt.'
            }
            $cameraHost=Join-Path $cameraDirectory ('bundles/'+$receipt.bundleId+'/capri-camera-host.exe')
            Assert-CapriNoLinks $cameraHost
            if([IO.File]::Exists($cameraHost)){
                Assert-CapriArchiveSingleLink $cameraHost
                return $cameraHost
            }
        }
    }catch{
        # Uninstall can still clear legacy registration if a receipt is unusable.
    }
    $cameraHost=Join-Path $cameraDirectory 'capri-camera-host.exe'
    try {
        Assert-CapriNoLinks $cameraHost
        if([IO.File]::Exists($cameraHost)){
            Assert-CapriArchiveSingleLink $cameraHost
            return $cameraHost
        }
    }catch{
        # Do not execute a file linked outside the managed installation.
    }
}
try {
    if(-not ($Quiet -or $MeasureOnly -or $PlanOnly)){
        . (Join-Path $PSScriptRoot 'localization.ps1')
        $catalogPath=Join-Path $PSScriptRoot 'uninstaller-text.json'
        if(-not (Test-Path -LiteralPath $catalogPath)){
            $catalogPath=Join-Path $PSScriptRoot '../../../config/uninstaller-text.json'
        }
        Assert-CapriNoLinks $catalogPath
        $translations=Read-CapriJson $catalogPath
        $languages=Get-CapriCatalogLanguages $translations
        $language=Get-CapriInstallerCulture ([Globalization.CultureInfo]::CurrentUICulture.Name) $languages
        $rightToLeft=$language -in @('ar','fa','he','ur')
        $messages=New-Object 'Collections.Generic.Dictionary[string,string]'
        foreach($key in $translations.en.PSObject.Properties.Name){
            $messages[$key]=Get-CapriInstallerText $translations $language $key
        }
    }
    if($LauncherPid -gt 0){Wait-Process -Id $LauncherPid -Timeout 5 -ErrorAction SilentlyContinue}
    $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');
    Set-Location -LiteralPath $env:SystemRoot
    [Environment]::CurrentDirectory=$env:SystemRoot
    Assert-CapriNoLinks $root
    $identityPath=Join-Path $root '.capri-install.json'
    Assert-CapriNoLinks $identityPath
    $identity=Read-CapriJson $identityPath
    if($identity.productId -ne 'capri.desktop' -or $identity.root -ne $root -or $identity.installId -notmatch '^[a-f0-9-]{36}$' -or $root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\') -or $root -eq $env:USERPROFILE){throw 'Invalid managed installation.'}
    $installedVersion=if($identity.PSObject.Properties['version']){[string]$identity.version}else{''}
    $uninstallIcon=Join-Path $PSScriptRoot 'app.ico'
    if(-not (Test-Path -LiteralPath $uninstallIcon -PathType Leaf)){$uninstallIcon=Join-Path $root 'assets/default/app.ico'}
    Assert-CapriNoLinks $uninstallIcon
    if(-not ($MeasureOnly -or $PlanOnly)){
        $mutex=New-Object Threading.Mutex($false,('Local\Capri.Uninstall.'+$identity.installId))
        try{$ownsMutex=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$ownsMutex=$true}
        if(-not $ownsMutex){throw 'An uninstall window is already open for this installation.'}
    }
    if(-not ($Quiet -or $MeasureOnly -or $PlanOnly)){
        Import-CapriUninstallWindow
        $progressWindow=New-Object 'Capri.Setup.UninstallProgress' -ArgumentList $messages,$rightToLeft,$uninstallIcon
        $progressWindow.Report('progressPreparing')
    }
    if($DeleteData){$DeleteModels=$true;$DeleteSettings=$true}
    $activeLock=Join-Path $root '.runtime/installer/install.lock.json'
    function Assert-CapriInstallerIdle {
        Assert-CapriNoLinks $activeLock
        $file=Get-Item -LiteralPath $activeLock -ErrorAction SilentlyContinue
        if(-not $file){return}
        $lock=Read-CapriJson $activeLock
        if($lock.pid -isnot [int] -or $lock.pid -le 0){throw 'Finish or cancel the installation before uninstalling.'}
        $owner=Get-Process -Id $lock.pid -ErrorAction SilentlyContinue
        if(-not $owner){return}
        # A process started after the lock was written cannot be its original owner.
        try{$reused=$owner.StartTime.ToUniversalTime() -gt $file.LastWriteTimeUtc}catch{$reused=$false}
        if(-not $reused){throw 'Finish or cancel the installation before uninstalling.'}
    }
    Assert-CapriInstallerIdle
    $configPath=Join-Path $root 'config/installer.json'
    Assert-CapriNoLinks $configPath
    if(-not(Test-Path -LiteralPath $configPath)){$configPath=Join-Path $PSScriptRoot 'installer-config.json'}
    Assert-CapriNoLinks $configPath
    $nodeManifest=Read-CapriJson $configPath
    $node=Join-Path $root ('.runtime/'+$nodeManifest.artifacts.node.directory+'/node.exe')
    # Descendant links are leaf entries, including npm workspaces and model caches.
    # PowerShell identifies these two reparse tags without opening their target.
    function Test-CapriLeafLink($Item){
        $linkType=$Item.PSObject.Properties['LinkType']
        return ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -and
            $linkType -and $linkType.Value -in @('Junction','SymbolicLink')
    }
    function Get-CapriRemovalItem([string]$Path){
        Assert-CapriNoLinks (Split-Path -Parent $Path)
        try{$item=Get-Item -LiteralPath $Path -Force}
        catch [Management.Automation.ItemNotFoundException]{return}
        if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -and -not(Test-CapriLeafLink $item)){
            throw 'Uninstall will not traverse unsupported filesystem links. Linked content was not removed.'
        }
        return $item
    }
    function Test-CapriPlainPath([string]$Path){
        try{Assert-CapriNoLinks $Path;return $true}catch{return $false}
    }
    function Test-CapriPartitionDirectory([string]$Path){
        return (Test-CapriPlainPath $Path) -and (Test-Path -LiteralPath $Path -PathType Container)
    }
    function Remove-CapriLeafLink($Item,[string]$Boundary){
        $full=[IO.Path]::GetFullPath($Item.FullName)
        if(-not $full.StartsWith($Boundary+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Removal escaped the managed installation.'}
        Assert-CapriNoLinks (Split-Path -Parent $full)
        $current=Get-Item -LiteralPath $full -Force
        if(-not(Test-CapriLeafLink $current)){throw 'Uninstall will not traverse unsupported filesystem links. Linked content was not removed.'}
        # These overloads unlink only this entry. Never recurse or resolve Target,
        # even when the link is dangling or points outside the installation.
        if(($current.Attributes -band [IO.FileAttributes]::Directory) -ne 0){[IO.Directory]::Delete($full)}
        else{[IO.File]::Delete($full)}
        if($progressWindow){$progressWindow.Advance()}
    }
    # Preflight all removals before deleting any file or registration.
    function Assert-CapriTree([string]$Path,[string]$Boundary=$root) {
        $full=[IO.Path]::GetFullPath($Path)
        if(-not $full.StartsWith($Boundary+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Removal escaped the managed installation.'}
        $item=Get-CapriRemovalItem $full
        if(-not $item -or (Test-CapriLeafLink $item) -or -not $item.PSIsContainer){return}
        foreach($child in Get-ChildItem -LiteralPath $full -Force) {
            if(($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){if(Test-CapriLeafLink $child){continue};
                throw 'Uninstall will not traverse filesystem links. Linked content was not removed.'}
            if($child.PSIsContainer){Assert-CapriTree $child.FullName $Boundary}
        }
    }
    $sourceFile=Join-Path $root '.runtime/installer/source-files.json'
    Assert-CapriNoLinks $sourceFile
    if(-not(Test-Path -LiteralPath $sourceFile)){$sourceFile=Join-Path $PSScriptRoot 'source-files.json'}
    Assert-CapriNoLinks $sourceFile
    $sourceManifest=Read-CapriJson $sourceFile
    $sourceTargets=@()
    foreach($entry in $sourceManifest.files) {
        if($entry.path -match '^(data|logs|node_modules|archive|release|\.runtime)([/\\]|$)|\.local\.json$|^\.capri-install\.json$' -or $entry.path -match '(^|[/\\])\.\.([/\\]|$)' -or [IO.Path]::IsPathRooted($entry.path)){throw 'Invalid installed file manifest.'}
        $file=[IO.Path]::GetFullPath((Join-Path $root $entry.path))
        if(-not $file.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or $entry.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid installed file target.'}
        $sourceTargets+=@{file=$file;
            entry=$entry}
    }
    $applicationLauncher=Join-Path $root 'Capri.exe'
    $uninstallLauncher=Join-Path $root 'uninstall.exe'
    $appTrees=@('node_modules','.runtime')
    $modelTrees=@('data/models','data/huggingface')
    $modelFiles=@()
    $settingsTrees=@('data/desktop','data/desktop-profile','data/openclaw','data/workspace','data/applications','data/filesystem','data/perception','data/maintenance','data/config-backups','data/persona-backups','data/secrets','data/run','data/sounds','data/uninstall-backup','data/brain','data/tools','data/workflows','data/user-tool-definitions.json','logs')
    $settingsFiles=@()
    # Speech weights share a parent with private training previews and settings.
    # Partition immediate children so removing models cannot erase personal recordings.
    # A linked partition has no safe model/settings split. Only full data removal unlinks it.
    $speechRoot=Join-Path $root 'data/speech'
    if(Test-CapriPartitionDirectory $speechRoot){
        $settingsTrees+=,'data/speech/training-jobs'
        $speechPersonal=@('training-jobs','voice-training-status.json','voice-selections.json','companion-voice-token')
        foreach($item in Get-ChildItem -LiteralPath $speechRoot -Force){
            if($item.Name -in $speechPersonal){
                if(-not $item.PSIsContainer){$settingsFiles+=,$item.FullName}
            }elseif($item.PSIsContainer){$modelTrees+=,('data/speech/'+$item.Name)}
            else{$modelFiles+=,$item.FullName}
        }
        $voiceToken=Join-Path $speechRoot 'companion-voice-token'
        if($voiceToken -notin $settingsFiles){$settingsFiles+=,$voiceToken}
    }
    # Only the shipped public voice is a model artifact. Imported datasets and
    # user-trained exports include recordings/transcripts and are personal data.
    $settingsTrees+=,'data/voices/breeze-tts'
    $datasetRoot=Join-Path $root 'data/voices/capri/en'
    if((Test-CapriPartitionDirectory (Join-Path $root 'data/voices')) -and
        (Test-CapriPartitionDirectory (Join-Path $root 'data/voices/capri')) -and
        (Test-CapriPartitionDirectory $datasetRoot)){
        foreach($item in Get-ChildItem -LiteralPath $datasetRoot -Force){
            if($item.Name -eq 'exports' -and $item.PSIsContainer){
                if(-not(Test-CapriPartitionDirectory $item.FullName)){continue}
                $modelTrees+=,'data/voices/capri/en/exports/capri-en-v1'
                foreach($export in Get-ChildItem -LiteralPath $item.FullName -Force){
                    if($export.Name -eq 'capri-en-v1' -and $export.PSIsContainer){continue}
                    if($export.PSIsContainer){$settingsTrees+=,('data/voices/capri/en/exports/'+$export.Name)}
                    else{$settingsFiles+=,$export.FullName}
                }
            }elseif($item.PSIsContainer){$settingsTrees+=,('data/voices/capri/en/'+$item.Name)}
            else{$settingsFiles+=,$item.FullName}
        }
    }
    foreach($item in Get-ChildItem -LiteralPath (Join-Path $root 'config') -Filter '*.local.json' -File -Force -ErrorAction SilentlyContinue){
        $settingsFiles+=,$item.FullName
    }
    $registration=$null
    $registrationPath=Join-Path $root '.runtime/installer/registration.json'
    Assert-CapriNoLinks $registrationPath
    if(-not(Test-Path -LiteralPath $registrationPath)){$registrationPath=Join-Path $PSScriptRoot 'registration.json'}
    Assert-CapriNoLinks $registrationPath
    if(Test-Path -LiteralPath $registrationPath){
        $registration=Read-CapriJson $registrationPath
        if(-not $registration.PSObject.Properties['installId'] -or $registration.installId -ne $identity.installId -or
            ($registration.PSObject.Properties['root'] -and $registration.root -ne $root)){$registration=$null}
    }
    function Test-CapriOwnedShortcut([string]$Path){
        if($Path -notmatch '^[a-z]:[/\\]' -or -not $Path.EndsWith('.lnk',[StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-CapriPlainPath $Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)){return $false}
        try{return [Capri.Setup.Shortcuts]::Read($Path).TargetPath -eq $applicationLauncher}catch{return $false}
    }
    $links=@()
    if($registration -and $registration.PSObject.Properties['shortcuts'] -and @($registration.shortcuts).Count -gt 0){
        # Load before owned source files are removed; recovery keeps its own copy.
        if(-not ('Capri.Setup.Shortcuts' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'shell-link.cs')}
        foreach($link in $registration.shortcuts){
            if(Test-CapriOwnedShortcut $link){$links+=,$link}
        }
    }
    $expectedRegistry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Capri.'+$identity.installId
    $localCapri=Join-Path $env:LOCALAPPDATA 'Capri'
    $expectedRecovery=Join-Path $localCapri ('Uninstall/'+$identity.installId)
    $recoveryLauncher=$null
    $recoveryTargets=@()
    $sharedTargets=@()
    if($registration -and $registration.installId -eq $identity.installId -and $registration.PSObject.Properties.Name -contains 'recovery'){
        $recovery=[IO.Path]::GetFullPath($registration.recovery)
        $verifiedRecovery=$recovery -eq $expectedRecovery -or
            ($registration.registry -eq ('HKCU:\Software\CapriInstallerTests\'+$identity.installId) -and $recovery.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase))
        if($verifiedRecovery){
            $recoveryLauncher=Join-Path $recovery 'uninstall.exe'
            foreach($name in @('uninstall.ps1','uninstall-window.cs','cyberpunk-theme.cs','common.ps1','shell-link.cs','localization.ps1','uninstaller-text.json','installer-config.json','source-files.json','registration.json','app.ico','uninstall.exe')){
                $recoveryTargets+=,(Join-Path $recovery $name)
            }
        }
        if($recovery -eq $expectedRecovery -and $registration.registry -eq $expectedRegistry){
            $other=Get-ChildItem -LiteralPath (Split-Path -Parent $expectedRegistry) -ErrorAction SilentlyContinue |
                Where-Object { $_.PSChildName -like 'Capri.*' -and $_.PSChildName -ne ('Capri.'+$identity.installId) } |
                Select-Object -First 1
            $recoveryParent=Join-Path $localCapri 'Uninstall'
            # Keep shared files if a link prevents us from checking who uses them.
            $otherRecovery=if(Test-CapriPlainPath $recoveryParent){
                Get-ChildItem -LiteralPath $recoveryParent -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -match '^[a-f0-9-]{36}$' -and $_.Name -ne $identity.installId } |
                    Select-Object -First 1
            }else{$true}
            $activeSetupFile=Join-Path $localCapri 'Installer/active.json'
            $activeSetup=-not (Test-CapriPlainPath $activeSetupFile) -or (Test-Path -LiteralPath $activeSetupFile)
            if(-not ($other -or $otherRecovery -or $activeSetup)){
                $sharedTargets=@((Join-Path $localCapri 'Installer'),(Join-Path $localCapri 'Setup'))
                if($env:APPDATA){$sharedTargets+=,(Join-Path $env:APPDATA 'Capri')}
                $sharedTargets+=,(Join-Path ([IO.Path]::GetTempPath()) 'CapriSetup-last-error.txt')
                $sharedTargets=@($sharedTargets | Where-Object {
                    $path=[IO.Path]::GetFullPath($_)
                    $path -ne $root -and -not $root.StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase)
                })
            } elseif(-not $activeSetup) {
                $installer=Join-Path $localCapri 'Installer'
                $sessionRoot=Join-Path $installer 'sessions'
                $sessions=if(Test-CapriPlainPath $sessionRoot){Get-ChildItem -LiteralPath $sessionRoot -Directory -ErrorAction SilentlyContinue}
                foreach($session in $sessions){
                    if($session.Name -notmatch '^[a-f0-9]{32}$' -or ($session.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue}
                    try {
                        $request=Join-Path $session.FullName 'request.json'
                        Assert-CapriNoLinks $request
                        if((Read-CapriJson $request).target -ne $root){continue}
                    } catch {continue}
                    $sharedTargets+=,$session.FullName
                    try {
                        $locationFile=Join-Path $session.FullName 'ui-log-location.json'
                        Assert-CapriNoLinks $locationFile
                        $log=[IO.Path]::GetFullPath((Read-CapriJson $locationFile).uiLog)
                        if((Split-Path -Parent $log) -eq (Join-Path $installer 'logs') -and (Split-Path -Leaf $log) -match '^ui-[a-f0-9]{32}\.jsonl$'){
                            $sharedTargets+=,$log
                            $sharedTargets+=,(Join-Path (Split-Path -Parent $log) ((Split-Path -Leaf $log) -replace '^ui-','launcher-'))
                        }
                    } catch {continue}
                }
            }
        }
    }
    if($MeasureOnly -or (-not $Quiet -and -not $PlanOnly)){
        Import-CapriUninstallWindow
        $groups=New-Object 'string[][]' 4
        $groups[0]=[string[]](@($sourceTargets | ForEach-Object {$_.file}) + @($appTrees | ForEach-Object {Join-Path $root $_}) + $links + @($applicationLauncher))
        $groups[1]=[string[]](@($modelTrees | ForEach-Object {Join-Path $root $_}) + $modelFiles)
        $groups[2]=[string[]](@($settingsTrees | ForEach-Object {Join-Path $root $_}) + $settingsFiles)
        $groups[3]=[string[]](@((Join-Path $root 'data'),(Join-Path $root '.capri-install.json'),$uninstallLauncher) + $recoveryTargets + $sharedTargets)
        # Estimates omit linked paths. Strict validation happens after selection.
        for($index=0;$index -lt $groups.Length;$index++){
            $groups[$index]=[string[]]@($groups[$index] | Where-Object {Test-CapriPlainPath $_})
        }
        if($MeasureOnly){@{bytes=[Capri.Setup.UninstallWindow]::Measure($groups)}|ConvertTo-Json -Compress;return}
        $defaults=([int]$RemoveApplication)+2*([int][bool]$DeleteModels)+4*([int][bool]$DeleteSettings)
        $portraitPath=Join-Path $root 'assets/default/capri-uninstall-portrait.png'
        try {Assert-CapriNoLinks $portraitPath} catch {$portraitPath=$null}
        if($progressWindow){$progressWindow.Hide()}
        $selection=[Capri.Setup.UninstallWindow]::Show($root,$groups,$defaults,$uninstallIcon,$messages,$rightToLeft,$portraitPath)
        if(-not $selection){return}
        if($progressWindow){$progressWindow.EnableControls();$progressWindow.Show()}
        $RemoveApplication=[bool]($selection -band 1)
        $DeleteModels=[bool]($selection -band 2)
        $DeleteSettings=[bool]($selection -band 4)
        $DeleteData=$false
    }
    $complete=$RemoveApplication -and $DeleteModels -and $DeleteSettings
    $keepUninstaller=$registration -and -not $complete -and (
        ((Test-CapriPlainPath $uninstallLauncher) -and (Test-Path -LiteralPath $uninstallLauncher -PathType Leaf)) -or
        ($recoveryLauncher -and (Test-CapriPlainPath $recoveryLauncher) -and (Test-Path -LiteralPath $recoveryLauncher -PathType Leaf)))
    $trees=@()
    if($RemoveApplication){$trees+=$appTrees}
    if($DeleteData -or $complete){$trees+='data'}
    else {
        if($DeleteModels){$trees+=$modelTrees}
        if($DeleteSettings){$trees+=@($settingsTrees | Where-Object {$_ -ne 'logs'})}
    }
    if($DeleteSettings){$trees+='logs'}
    if($RemoveApplication){
        Assert-CapriNoLinks $applicationLauncher
        if(-not $keepUninstaller){Assert-CapriNoLinks $uninstallLauncher}
        foreach($target in $sourceTargets){Assert-CapriNoLinks $target.file}
        if(-not $DeleteSettings){
            $backupRoot=Join-Path $root 'data/uninstall-backup'
            if(-not (Test-CapriPlainPath $backupRoot)){
                foreach($target in $sourceTargets){
                    if((Test-Path -LiteralPath $target.file -PathType Leaf) -and (Get-CapriHash $target.file) -ne $target.entry.sha256){
                        Assert-CapriNoLinks $backupRoot
                    }
                }
            }
        }
    }else{$sourceTargets=@()}
    $localTargets=@()
    if($DeleteSettings){$localTargets+=$settingsFiles}
    if($DeleteModels){$localTargets+=$modelFiles}
    foreach($name in $trees){Assert-CapriTree (Join-Path $root $name)}
    foreach($file in $localTargets){$null=Get-CapriRemovalItem $file}
    function Remove-CapriTree([string]$Path,[string]$Boundary=$root) {
        Wait-CapriUninstall
        $full=[IO.Path]::GetFullPath($Path)
        if(-not $full.StartsWith($Boundary+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Removal escaped the managed installation.'}
        $item=Get-CapriRemovalItem $full
        if(-not $item){return}
        if(Test-CapriLeafLink $item){Remove-CapriLeafLink $item $Boundary;return}
        if(-not $item.PSIsContainer){
            Remove-Item -LiteralPath $full -Force
            if($progressWindow){$progressWindow.Advance()}
            return
        }
        foreach($child in Get-ChildItem -LiteralPath $full -Force) {
            Wait-CapriUninstall
            if(($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){if(Test-CapriLeafLink $child){Remove-CapriLeafLink $child $Boundary;
                    continue};
                throw 'Uninstall will not traverse filesystem links.'}
            if($child.PSIsContainer){Remove-CapriTree $child.FullName $Boundary}else{
                Remove-Item -LiteralPath $child.FullName -Force
                if($progressWindow){$progressWindow.Advance()}
            }
        }
        Wait-CapriUninstall
        Remove-Item -LiteralPath $full -Force
        if($progressWindow){$progressWindow.Advance()}
    }
    if($PlanOnly){@{removeApplication=$RemoveApplication;deleteModels=[bool]$DeleteModels;deleteSettings=[bool]$DeleteSettings;trees=$trees;localSettings=$localTargets;sourceFiles=@($sourceTargets|ForEach-Object {$_.entry.path})}|ConvertTo-Json -Depth 5;return}
    Assert-CapriInstallerIdle
    if($complete -and $sharedTargets.Count -and (Test-Path -LiteralPath (Join-Path $localCapri 'Installer/active.json'))){
        throw 'Finish or cancel the installation before removing Capri setup files.'
    }
    foreach($path in @($sharedTargets | Where-Object {$complete})+@($recoveryTargets | Where-Object {$RemoveApplication -and -not $keepUninstaller})){
        Assert-CapriNoLinks $path
        if(Test-Path -LiteralPath $path -PathType Container){Assert-CapriTree $path (Split-Path -Parent $path)}
    }
    $core=Join-Path $root 'packages/runtime/bin/core.mjs'
    Assert-CapriNoLinks $node
    Assert-CapriNoLinks $core
    Wait-CapriUninstall
    if((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $core)){
        if($progressWindow){$progressWindow.Report('progressStopping')}
        & $node $core stop
        if($LASTEXITCODE -ne 0){throw 'Could not stop Capri. No files were removed.'}
    }
    if($RemoveApplication){
        Wait-CapriUninstall
        $cameraHost=Get-CapriCameraCleanupHost $root
        if($cameraHost){& $cameraHost --cleanup | Out-Null}
    }
    if($progressWindow){$progressWindow.Report('progressRemoving')}
    $emptyParents=New-Object 'Collections.Generic.HashSet[string]'
    foreach($item in $sourceTargets) {
        Wait-CapriUninstall
        $file=$item.file
        if(Test-Path -LiteralPath $file -PathType Leaf) {
            if(-not $DeleteSettings -and (Get-CapriHash $file) -ne $item.entry.sha256) {
                $backup=Join-Path $root ('data/uninstall-backup/'+$item.entry.path)
                Assert-CapriNoLinks $backup
                [IO.Directory]::CreateDirectory((Split-Path -Parent $backup))|Out-Null
                Copy-Item -LiteralPath $file -Destination $backup -Force
            }
            Remove-Item -LiteralPath $file -Force
            if($progressWindow){$progressWindow.Advance()}
        }
        $parent=Split-Path -Parent $file
        while($parent -and $parent -ne $root){$null=$emptyParents.Add($parent);
            $parent=Split-Path -Parent $parent}
    }
    foreach($file in $localTargets){Remove-CapriTree $file}
    foreach($name in $trees){Remove-CapriTree (Join-Path $root $name)}
    if($progressWindow){$progressWindow.Report('progressCleaning')}
    if($complete){
        foreach($path in $sharedTargets){
            Wait-CapriUninstall
            if(Test-Path -LiteralPath $path -PathType Container){Remove-CapriTree $path (Split-Path -Parent $path)}
            elseif(Test-Path -LiteralPath $path -PathType Leaf){
                Assert-CapriNoLinks $path
                Remove-Item -LiteralPath $path -Force
                if($progressWindow){$progressWindow.Advance()}
            }
        }
    }
    # Keep Windows registration and the recovery launcher intact until all
    # interruptible removals are done. Retrying can then find the remaining files.
    if($progressWindow -and -not $progressWindow.BeginFinishing()){
        throw [OperationCanceledException]::new('Capri uninstall was cancelled.')
    }
    foreach($directory in @($emptyParents|Sort-Object Length -Descending)){if((Test-Path -LiteralPath $directory -PathType Container) -and @(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0){
        Remove-Item -LiteralPath $directory -Force
        if($progressWindow){$progressWindow.Advance()}
    }}
    if($RemoveApplication -and (Test-Path -LiteralPath $applicationLauncher -PathType Leaf)){
        Remove-Item -LiteralPath $applicationLauncher -Force
        if($progressWindow){$progressWindow.Advance()}
    }
    if($RemoveApplication){
        $teleportKey='HKCU:\Software\Classes\DesktopBackground\shell\Capri.Teleport'
        $teleportCommand=$teleportKey+'\command'
        if(Test-Path -LiteralPath $teleportKey){
            $owned=(Get-Item -LiteralPath $teleportKey).GetValue('CapriRoot') -eq $root
            $legacy=(Test-Path -LiteralPath $teleportCommand) -and (Get-Item -LiteralPath $teleportCommand).GetValue('') -eq ('"'+$applicationLauncher+'" --teleport')
            if($owned -or $legacy){
                Remove-Item -LiteralPath $teleportKey -Recurse -Force
                if($progressWindow){$progressWindow.Advance()}
            }
        }
    }
    if($RemoveApplication -and $registration) {
        $expectedTest='HKCU:\Software\CapriInstallerTests\'+$identity.installId
        if(($registration.registry -eq $expectedRegistry -or ($recoveryTargets.Count -gt 0 -and $registration.registry -eq $expectedTest)) -and
            (Test-Path -LiteralPath $registration.registry) -and (Get-ItemProperty -LiteralPath $registration.registry).InstallLocation -eq $root){
            Remove-Item -LiteralPath $registration.registry -Force
            if($progressWindow){$progressWindow.Advance()}
        }
        foreach($link in $links){
            if(Test-CapriOwnedShortcut $link){
                Remove-Item -LiteralPath $link -Force
                if($progressWindow){$progressWindow.Advance()}
            }
        }
        $menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'Capri'
        if($registration.registry -eq $expectedRegistry -and (Test-CapriPlainPath $menu) -and (Test-Path -LiteralPath $menu -PathType Container)){
            if(-not @(Get-ChildItem -LiteralPath $menu -Force).Count){
                [IO.Directory]::Delete($menu)
                if($progressWindow){$progressWindow.Advance()}
            }
        }
    }
    if($RemoveApplication -and -not $keepUninstaller){
        foreach($file in @($recoveryTargets)+@($uninstallLauncher,(Join-Path $root '.capri-install.json'))){
            Assert-CapriNoLinks $file
            if(Test-Path -LiteralPath $file -PathType Leaf){
                Remove-Item -LiteralPath $file -Force
                if($progressWindow){$progressWindow.Advance()}
            }
        }
        if($recoveryTargets.Count){
            $parent=Split-Path -Parent $recoveryTargets[0]
            foreach($folder in @($parent,(Split-Path -Parent $parent))){
                if((Test-Path -LiteralPath $folder -PathType Container) -and -not @(Get-ChildItem -LiteralPath $folder -Force).Count){
                    [IO.Directory]::Delete($folder)
                    if($progressWindow){$progressWindow.Advance()}
                }
            }
        }
    }
    if($complete){
        foreach($folder in @($localCapri,$root)){
            if((Test-CapriPlainPath $folder) -and (Test-Path -LiteralPath $folder -PathType Container) -and -not @(Get-ChildItem -LiteralPath $folder -Force).Count){
                [IO.Directory]::Delete($folder)
                if($progressWindow){$progressWindow.Advance()}
            }
        }
    }
    if($progressWindow){$progressWindow.Complete()}
    elseif($messages){[Capri.Setup.UninstallWindow]::Complete($messages['complete'],$rightToLeft)}
    
} catch [OperationCanceledException] {
    if($progressWindow){$progressWindow.Cancelled()}
    exit 1223
} catch {
    $failureMessage=$_.Exception.Message
    $failureCode=switch -Regex ($failureMessage) {
        'filesystem links' {'UNINSTALL_LINKED_PATH';break}
        'already open|Finish or cancel' {'UNINSTALL_BUSY';break}
        'Could not stop Capri' {'UNINSTALL_STOP_FAILED';break}
        'Invalid managed installation|Invalid installed file' {'UNINSTALL_INVALID_INSTALLATION';break}
        default {'UNINSTALL_FAILED'}
    }
    if(-not ($Quiet -or $MeasureOnly -or $PlanOnly)){
        Add-Type -AssemblyName System.Windows.Forms
        $title=if($messages){$messages['title']}else{'Uninstall Capri'}
        $heading=if($messages){$messages['failed']}else{'Could not finish uninstalling Capri.'}
        $details=if($messages){$messages['technicalDetails']}else{'Technical details'}
        $direction=if($rightToLeft){[Windows.Forms.MessageBoxOptions]::RightAlign -bor [Windows.Forms.MessageBoxOptions]::RtlReading}else{0}
        $visibleDetails=if($messages -and $failureCode -eq 'UNINSTALL_LINKED_PATH'){$messages['linkedPathHelp']+"`r`n"+$failureCode}else{$failureMessage}
        if(-not $progressWindow -and $messages){
            try {
                Import-CapriUninstallWindow
                $progressWindow=[Capri.Setup.UninstallProgress]::new($messages,$rightToLeft,'')
            } catch {}
        }
        if($progressWindow){$progressWindow.Fail($visibleDetails,$failureCode,$installedVersion)}
        else{[Windows.Forms.MessageBox]::Show($heading+"`r`n`r`n"+$details+":`r`n"+$visibleDetails,$title,'OK','Error','Button1',$direction)|Out-Null}
    }
    [Console]::Error.WriteLine($failureMessage);
    exit 1
} finally {
    if($progressWindow){$progressWindow.Dispose()}
    if($ownsMutex){$mutex.ReleaseMutex()}
    if($mutex){$mutex.Dispose()}
}
