# SPDX-License-Identifier: GPL-3.0-only
function Get-CapriDefaultTarget {
    Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs/Capri'
}
function Select-CapriInitialInstallation($Installations,[version]$SetupVersion) {
    $Installations | Where-Object{[version]$_.version -le $SetupVersion} |
        Sort-Object @{Expression={[version]$_.version};Descending=$true},path | Select-Object -First 1
}
function Initialize-CapriProgramFilesTarget([string]$Target) {
    if($Target -ine (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Capri')){return}
    if(-not (Test-Path -LiteralPath $Target -PathType Container)){
        if($env:CAPRI_SETUP_LAUNCHER){
            $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            try {
                $process=Start-Process -FilePath $env:CAPRI_SETUP_LAUNCHER -ArgumentList @('--provision-default-target',$sid) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
            } catch { throw (Text-Capri 'programFilesPermission') }
            try{if($process.ExitCode -ne 0){throw (Text-Capri 'programFilesPermission')}}
            finally{$process.Dispose()}
        } else {
            try{[IO.Directory]::CreateDirectory($Target)|Out-Null}catch{throw (Text-Capri 'programFilesPermission')}
        }
    }
    Assert-CapriNoLinks $Target
    try {
        $probe=Join-Path $Target ('.capri-write-'+[Guid]::NewGuid().ToString('N'))
        $stream=New-Object IO.FileStream($probe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::DeleteOnClose)
        $stream.Dispose()
    }catch{throw (Text-Capri 'programFilesPermission')}
}
function Get-CapriInstallations {
    param([string[]]$Candidates=@(),[switch]$NoRegistry)
    $paths=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach($candidate in $Candidates){if($candidate){$null=$paths.Add($candidate)}}
    if(-not $NoRegistry){
        foreach($key in @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue|Where-Object{$_.PSChildName -like 'Capri.*'})){
            try{$entry=Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop;if($entry.InstallLocation){$null=$paths.Add([string]$entry.InstallLocation)}}catch{}
        }
        $null=$paths.Add((Get-CapriDefaultTarget))
        $null=$paths.Add((Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Capri'))
    }
    foreach($candidate in $paths){try{
        if(-not [IO.Path]::IsPathRooted($candidate) -or $candidate.StartsWith('\\')){continue}
        $folder=[IO.Path]::GetFullPath($candidate).TrimEnd('\');Assert-CapriNoLinks $folder
        $identity=Read-CapriJson (Join-Path $folder '.capri-install.json')
        if($identity.schemaVersion -eq 1 -and $identity.productId -eq 'capri.desktop' -and $identity.root -eq $folder -and $identity.installId -match '^[a-f0-9-]{36}$' -and $identity.version -match '^\d+\.\d+\.\d+$'){
            [PSCustomObject]@{path=$folder;version=$identity.version;installId=$identity.installId}
        }
    }catch{}}
}
function Save-CapriFirstLaunchChoice([string]$Target,[bool]$PreloadModels) {
    $file=Join-Path $Target 'data/desktop/first-start.json'
    Assert-CapriNoLinks $file
    Write-CapriJson $file @{schemaVersion=1;preloadModels=$PreloadModels}
}
function Start-CapriInstalledApp {
    param([string]$Target,[int]$TimeoutSeconds=25)
    Assert-CapriNoLinks $Target
    $exe=Join-Path $Target 'Capri.exe'
    if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'The installed Capri launcher is missing. Repair the installation.'}
    $nonce=[Guid]::NewGuid().ToString('N');$receipt=Join-Path $Target ('data/run/launch-'+$nonce+'.json')
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$exe;$start.WorkingDirectory=$Target;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
    foreach($name in @($start.EnvironmentVariables.Keys|Where-Object{$_ -like 'CAPRI_*' -or $_ -in @('NODE_OPTIONS','NODE_PATH','PYTHONPATH','ELECTRON_RUN_AS_NODE','OPENCLAW_STATE_DIR','OPENCLAW_CONFIG_PATH','OPENCLAW_WORKSPACE_DIR')})){$start.EnvironmentVariables.Remove($name)}
    $start.EnvironmentVariables['CAPRI_LAUNCH_NONCE']=$nonce
    $process=[Diagnostics.Process]::Start($start)
    try{
        $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while([DateTime]::UtcNow -lt $deadline){
            if(Test-Path -LiteralPath $receipt -PathType Leaf){
                Assert-CapriNoLinks $receipt;$value=Read-CapriJson $receipt
                if($value.nonce -eq $nonce -and $value.phase -eq 'window-ready'){
                    Remove-Item -LiteralPath $receipt -Force
                    return @{pid=$value.pid;phase='window-ready'}
                }
            }
            if($process.HasExited -and $process.ExitCode -ne 0){throw ('Capri launcher exited '+$process.ExitCode)}
            [Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 100
        }
        throw 'Capri was installed, but its window did not confirm startup. Retry opening Capri or save a diagnostic report.'
    }finally{$process.Dispose()}
}
