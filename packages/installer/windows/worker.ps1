param([Parameter(Mandatory=$true)][string]$RequestFile,[Parameter(Mandatory=$true)][string]$EventsFile,[Parameter(Mandatory=$true)][string]$CancelFile,[switch]$BootstrapOnly,[string]$SessionDirectory,[switch]$VerificationWorker)
# SPDX-License-Identifier: GPL-3.0-only
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'localization.ps1')
$sourceRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$request=Read-CapriJson $RequestFile
$env:CAPRI_INSTALL_PAUSE_FILE=Join-Path (Split-Path -Parent $CancelFile) 'pause'
$version=(Read-CapriJson (Join-Path $sourceRoot 'package.json')).version
$mutex=$null
$sessionGuard=$null;$workerExit=1
function Publish-CapriEvent($Event) {
    $Event.timestamp=[DateTime]::UtcNow.ToString('o')
    [IO.File]::AppendAllText($EventsFile,($Event|ConvertTo-Json -Compress -Depth 8)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
}
try {
    if($SessionDirectory){
        . (Join-Path $PSScriptRoot 'sessions.ps1')
        $SessionDirectory=[IO.Path]::GetFullPath($SessionDirectory)
        [Capri.Setup.SessionIO]::NoLinks($SessionDirectory)
        $header=Read-CapriJson (Join-Path $SessionDirectory 'session.json')
        if($header.schemaVersion -ne 1 -or $header.id -ne (Split-Path $SessionDirectory -Leaf) -or $header.id -notmatch '^[a-f0-9]{32}$'){throw 'Invalid installer worker session.'}
        foreach($pair in @(@($RequestFile,'request.json'),@($EventsFile,'events.jsonl'),@($CancelFile,'cancel'))){
            if([IO.Path]::GetFullPath($pair[0]) -ne (Join-Path $SessionDirectory $pair[1])){throw 'Installer control files must match their session.'}
        }
        Write-CapriJson (Join-Path $SessionDirectory 'worker.json') @{schemaVersion=1;pid=$PID;stamp=[Capri.Setup.SessionIO]::Stamp($PID);startedAt=[DateTime]::UtcNow.ToString('o')}
        $recoveryArguments=@('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'wizard.ps1'),'-ReconnectSession',$header.id)
        if($VerificationWorker){
            if(-not $SessionDirectory.StartsWith((Join-Path $sourceRoot '.runtime')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture worker must stay in the project cache.'}
            $recoveryArguments+=@('-VerificationDirectory',(Join-Path $SessionDirectory 'recovered-ui'),'-VerificationSessionRoot',(Split-Path (Split-Path $SessionDirectory -Parent) -Parent),'-VerificationFault','reconnect')
        }
        $recoveryUi=New-Object Diagnostics.ProcessStartInfo
        $recoveryUi.FileName=Join-Path $PSHOME 'powershell.exe'
        $recoveryUi.Arguments=($recoveryArguments | ForEach-Object{Quote-CapriArgument $_}) -join ' '
        $recoveryUi.WorkingDirectory=$sourceRoot
        $recoveryUi.UseShellExecute=$false
        $recoveryUi.CreateNoWindow=$true
        $recoveryUi.EnvironmentVariables.Remove('CAPRI_INSTALL_PAUSE_FILE')
        $sessionGuard=New-Object Capri.Setup.WorkerGuard($SessionDirectory,15000,$recoveryUi)
        if($VerificationWorker){
            Publish-CapriEvent @{type='stage-plan';stages=@('node','models','finalize')}
            Publish-CapriEvent @{type='stage';step='models'}
            while(-not(Test-Path -LiteralPath $CancelFile)){
                if(-not(Test-Path -LiteralPath $env:CAPRI_INSTALL_PAUSE_FILE)){Publish-CapriEvent @{type='download';received=256;total=1024}}
                Start-Sleep -Milliseconds 100
            }
            Publish-CapriEvent @{type='cancelled';message='Installation cancelled.'}
            $workerExit=2;exit 2
        }
    }
    Publish-CapriEvent @{type='stage';step='node'}
    Publish-CapriEvent @{type='activity';step='node';action='checkTarget'}
    if($request.acceptLicense -isnot [bool] -or $request.acceptDownloads -isnot [bool] -or -not $request.acceptLicense -or -not $request.acceptDownloads) { throw 'License acceptance and download consent are required.' }
    if(-not [Environment]::Is64BitOperatingSystem -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64') { throw 'Windows x64 is required.' }
    if($request.PSObject.Properties.Name -contains 'voicePack' -and $request.voicePack){$null=Assert-CapriVoicePack $request.voicePack}
    if($request.PSObject.Properties.Name -contains 'bundledVoicePack' -and $request.bundledVoicePack){$null=Assert-CapriVoicePack $request.bundledVoicePack}
    $target=Assert-CapriTarget $request.target $sourceRoot $version
    $hash=[Security.Cryptography.SHA256]::Create()
    try { $name=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($target.ToLowerInvariant())))).Replace('-','') } finally { $hash.Dispose() }
    $mutex=New-Object Threading.Mutex($false,('Local\CapriInstaller-'+$name))
    if(-not $mutex.WaitOne(0)) { throw 'Another installer is already working on this folder.' }
    $cache=Join-Path $target '.runtime/installer'
    Assert-CapriNoLinks $cache
    [IO.Directory]::CreateDirectory($cache) | Out-Null
    $identity=Join-Path $target '.capri-install.json'
    if(-not (Test-Path -LiteralPath $identity)) { Write-CapriJson $identity @{schemaVersion=1;
            productId='capri.desktop';
            installId=[Guid]::NewGuid().ToString();
            root=$target;
            version=$version} }
    if(Test-Path -LiteralPath $CancelFile) { throw 'Installation cancelled.' }
    $manifest=Read-CapriJson (Join-Path $sourceRoot 'config/installer.json')
    if([Environment]::OSVersion.Version.Build -lt $manifest.minimumWindowsBuild){throw 'Windows 10 22H2 or newer is required.'}
    $spec=$manifest.artifacts.node
    if($spec.url -notmatch '^https://nodejs\.org/dist/v[0-9.]+/node-v[0-9.]+-win-x64\.zip$' -or $spec.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid Node bootstrap manifest.' }
    $node=Join-Path $target ('.runtime/'+$spec.directory+'/node.exe')
    $stamp=Join-Path $cache 'node.json'
    Assert-CapriNoLinks $stamp;
    Assert-CapriNoLinks $node
    Publish-CapriEvent @{type='activity';step='node';action='checkRuntime';component='node'}
    if(-not ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $stamp) -and (Read-CapriJson $stamp).sha256 -eq $spec.sha256 -and (Read-CapriJson $stamp).executableSha256 -eq (Get-CapriHash $node) -and (Test-CapriNodeRuntime $node))) {
        $archive=Join-Path $cache ($spec.sha256+'.zip')
        Assert-CapriNoLinks $archive;
        Assert-CapriNoLinks ($archive+'.part')
        $valid=(Test-Path -LiteralPath $archive) -and (Get-CapriHash $archive) -eq $spec.sha256
        if(-not $valid) {
            Invoke-CapriDownloadRetry -Cancelled {Test-Path -LiteralPath $CancelFile} -Notify {
                param($NextAttempt,$Maximum)
                Publish-CapriEvent @{type='log';step='node';message=('Node download interrupted. Retrying '+$NextAttempt+'/'+$Maximum+'...')}
            } -Operation {
            while(Test-Path -LiteralPath $env:CAPRI_INSTALL_PAUSE_FILE){
                if(Test-Path -LiteralPath $CancelFile){throw 'Installation cancelled.'}
                Start-Sleep -Milliseconds 200
            }
            Add-Type -AssemblyName System.Net.Http
            [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
            $handler=New-Object Net.Http.HttpClientHandler;
            $handler.AllowAutoRedirect=$false
            $client=New-Object Net.Http.HttpClient($handler);
            $client.Timeout=[TimeSpan]::FromMinutes(15)
            $response=$null;
            $capriDownloadStream=$null;
            $output=$null;
            $partial=$archive+'.part'
            try {
                [long]$offset=0
                if(Test-Path -LiteralPath $partial){
                    $offset=(Get-Item -LiteralPath $partial).Length
                    if($offset -eq $spec.bytes -and (Get-CapriHash $partial) -eq $spec.sha256){Move-Item -LiteralPath $partial -Destination $archive -Force;return}
                    if($offset -ge $spec.bytes){Remove-Item -LiteralPath $partial;$offset=0}
                }
                if($offset -gt 0){$client.DefaultRequestHeaders.Range=New-Object Net.Http.Headers.RangeHeaderValue($offset,$null)}
                Publish-CapriEvent @{type='activity';step='node';action='connectRuntime';component='node'}
                $pending=$client.GetAsync($spec.url,[Net.Http.HttpCompletionOption]::ResponseHeadersRead)
                Wait-CapriDownloadTask $pending -Cancelled {Test-Path -LiteralPath $CancelFile} -TimeoutMilliseconds 900000
                $response=$pending.GetAwaiter().GetResult()
                $response.EnsureSuccessStatusCode() | Out-Null
                if([int]$response.StatusCode -eq 206){
                    $range=$response.Content.Headers.ContentRange
                    if($range.From -ne $offset -or $range.Length -ne $spec.bytes -or $range.To -ne ($spec.bytes-1)){throw 'Invalid Node download byte range.'}
                }else{$offset=0}
                $capriDownloadStream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                Publish-CapriEvent @{type='activity';step='node';action='downloadRuntime';component='node'}
                $output=[IO.File]::Open($partial,$(if($offset -gt 0){[IO.FileMode]::Append}else{[IO.FileMode]::Create}),[IO.FileAccess]::Write);
                $buffer=New-Object byte[] 1048576;
                [long]$bytes=$offset;
                $last=[DateTime]::UtcNow
                while($true) {
                    while(Test-Path -LiteralPath $env:CAPRI_INSTALL_PAUSE_FILE){
                        if(Test-Path -LiteralPath $CancelFile){throw 'Installation cancelled.'}
                        Start-Sleep -Milliseconds 200
                    }
                    $pending=$capriDownloadStream.ReadAsync($buffer,0,$buffer.Length);
                    Wait-CapriDownloadTask $pending -Cancelled {Test-Path -LiteralPath $CancelFile}
                    $count=$pending.GetAwaiter().GetResult();
                    if($count -eq 0){break}
                    if(Test-Path -LiteralPath $CancelFile) { throw 'Installation cancelled.' }
                    $bytes+=$count;
                    if($bytes -gt $spec.bytes){throw 'Bootstrap exceeds pinned size.'};
                    $output.Write($buffer,0,$count)
                    if(([DateTime]::UtcNow-$last).TotalMilliseconds -ge 250) { Publish-CapriEvent @{type='download';
                            step='node';
                            received=$bytes;
                            total=$spec.bytes};
                        $last=[DateTime]::UtcNow }
                }
                $output.Dispose();
                $output=$null
                if($bytes -ne $spec.bytes){throw (New-Object IO.EndOfStreamException('Node download ended before the expected size.'))}
                Publish-CapriEvent @{type='activity';step='node';action='verifyRuntime';component='node'}
                if((Get-CapriHash $partial) -ne $spec.sha256) { throw 'Node bootstrap checksum verification failed.' }
                Move-Item -LiteralPath $partial -Destination $archive -Force
            } finally {if($output){$output.Dispose()};
                if($capriDownloadStream){$capriDownloadStream.Dispose()};
                if($response){$response.Dispose()};
                $client.Dispose()}
            }
        }
        Publish-CapriEvent @{type='activity';step='node';action='extractRuntime';component='node'}
        Expand-CapriArchive $archive (Join-Path $target '.runtime')
        Publish-CapriEvent @{type='activity';step='node';action='verifyRuntime';component='node'}
        if(-not(Test-Path -LiteralPath $node)){throw 'Node bootstrap executable is missing.'}
        if(-not(Test-CapriNodeRuntime $node)){throw 'The Node/npm runtime is incomplete after extraction. Check file access or quarantine and retry Capri Setup.'}
        Write-CapriJson $stamp @{sha256=$spec.sha256;
            version=$spec.version;
            executableSha256=(Get-CapriHash $node)}
    }
    Publish-CapriEvent @{type='stage-complete';step='node'}
    if($BootstrapOnly){& $node --version;
        $workerExit=$LASTEXITCODE;exit $workerExit}
    & $node (Join-Path $sourceRoot 'packages/installer/bin/install.mjs') --request $RequestFile --events $EventsFile --cancel $CancelFile --pause $env:CAPRI_INSTALL_PAUSE_FILE
    $workerExit=$LASTEXITCODE;exit $workerExit
} catch {
    $failureCode=if(Test-CapriSetupNetworkError $_.Exception.Message -Exception $_.Exception){'INSTALLER_NETWORK_ERROR'}else{$_.Exception.Message}
    Publish-CapriEvent @{type='error';code=$failureCode;
        message=$_.Exception.Message}
    exit 1
} finally {
    if($sessionGuard){$sessionGuard.Dispose();Write-CapriJson (Join-Path $SessionDirectory 'worker.done.json') @{exitCode=$workerExit;endedAt=[DateTime]::UtcNow.ToString('o')}}
    if($mutex){try{$mutex.ReleaseMutex()}catch{};
        $mutex.Dispose()} }
