# SPDX-License-Identifier: GPL-3.0-only
function Get-CapriEstimateFile([string]$Path) {
    try {
        Assert-CapriNoLinks $Path
        $file=[IO.FileInfo]::new($Path)
        if($file.Exists -and $file.Length -gt 0){return $file}
    }catch{} # An unreadable file is budgeted as a download.
    return $null
}
function Get-CapriEstimateDirectory([string]$Target,[string]$ConfigName,[string]$Default,[string]$Property) {
    if(-not $Target){return $Default}
    $path=Join-Path $Target ('config/'+$ConfigName+'.json')
    $file=Get-CapriEstimateFile $path
    if(-not $file){return $Default}
    try {
        $settings=Read-CapriJson $path
        if($Property -eq 'vad'){$settings=$settings.vad}
        $directory=$settings.modelDir
        if($directory -match '^data[\\/](speech|models)([\\/][a-zA-Z0-9_][a-zA-Z0-9_.-]*)+$'){return $directory}
    }catch{}
    return ''
}
function Get-CapriMissingFileBytes([string]$Target,[string]$Directory,$Files,[string]$FallbackDirectory='') {
    [long]$remaining=0
    foreach($item in $Files){
        [long]$bytes=$item.bytes
        if($Target -and $Directory){
            $path=Join-Path $Target (Join-Path $Directory $item.file)
            $file=Get-CapriEstimateFile $path
            if($file -and $file.Length -eq $bytes){continue}
            if($FallbackDirectory){
                $cached=Get-CapriEstimateFile (Join-Path $Target (Join-Path $FallbackDirectory $item.file))
                if($cached -and $cached.Length -eq $bytes){continue}
            }
            $partial=Get-CapriEstimateFile ($path+'.partial')
            if($partial -and $partial.Length -lt $bytes){$bytes-=$partial.Length}
        }
        $remaining+=$bytes
    }
    return $remaining
}
function Get-CapriRegistryDownloadBytes([string]$Target,$Spec,[long]$CleanBytes) {
    if(-not $Target -or -not $Spec){return $CleanBytes}
    $files=if($Spec.PSObject.Properties['nativeModel']){
        foreach($item in @($Spec.nativeModel,$Spec.extraProjector)){@{file='sha256-'+$item.sha256;bytes=$item.bytes}}
    }else{
        foreach($layer in $Spec.layers){
            if($layer.mediaType -match '\.(model|projector|license)$'){
                @{file=$layer.digest.Replace(':','-');bytes=$layer.size}
            }
        }
    }
    return (Get-CapriMissingFileBytes $Target 'data/models/blobs' $files)
}
function Read-CapriStorageCatalog([string]$Source) {
    $config=Join-Path $Source 'config'
    $asr=Read-CapriJson (Join-Path $config 'asr-model-upstream.json')
    $vad=Read-CapriJson (Join-Path $config 'asr-vad-upstream.json')
    $router=Read-CapriJson (Join-Path $config 'request-router-upstream.json')
    $candidates=Read-CapriJson (Join-Path $config 'multilingual-candidates.json')
    $speech=Read-CapriJson (Join-Path $config 'multilingual-runtime.json')
    $qwenVoice=Read-CapriJson (Join-Path $config 'qwen-tts-upstream.json')
    $russianVoice=Read-CapriJson (Join-Path $config 'qwen-ru-voice.json')
    $englishVoice=Read-CapriJson (Join-Path $config 'voice-model-download.json')
    $voiceFiles=@(foreach($property in $englishVoice.files.PSObject.Properties){
        @{file=$property.Name;bytes=$property.Value.bytes}
    })
    return @{
        config=$config
        voiceTrainingDirectory=(Read-CapriJson (Join-Path $config 'voice-training.json')).modelDir
        packageLock=Join-Path $Source 'package-lock.json'
        models=(Read-CapriJson (Join-Path $config 'qwen-download-sizes.json')).models
        registry=Read-CapriJson (Join-Path $config 'llama-models.json')
        recognition=@($asr.files.PSObject.Properties.Value)
        vad=@($vad.files.PSObject.Properties.Value)
        multilingualRecognition=@($candidates.asr,$speech.whisper)
        router=@($router.files.PSObject.Properties.Value)
        englishVoice=$voiceFiles
        multilingualVoice=$speech.tts
        qwenVoice=$qwenVoice
        russianVoice=$russianVoice
        chinese=$speech.chinese
    }
}
function Get-CapriRuntimeDownloadBytes([string]$Target,[string]$Name,$Spec) {
    if(-not $Target){return [long]$Spec.bytes}
    $cache=Join-Path $Target '.runtime/installer'
    $archive=if($Name -eq 'node'){Join-Path $cache ($Spec.sha256+'.zip')}else{Join-Path $cache ('downloads/'+$Spec.sha256+'.zip')}
    $cached=Get-CapriEstimateFile $archive
    if($cached -and $cached.Length -eq $Spec.bytes){return 0L}
    # npm ci can replace the installed Electron bundle. Only its cached archive counts.
    if($Name -ne 'electron'){
        $exe=@{node='node.exe';llama='llama-server.exe';uv='uv.exe';git='cmd/git.exe'}[$Name]
        try{
            $stamp=Join-Path $cache ($Name+'.json')
            if(Get-CapriEstimateFile $stamp){
                $receipt=Read-CapriJson $stamp
                if($receipt.sha256 -eq $Spec.sha256 -and $receipt.executableSha256 -match '^[a-f0-9]{64}$' -and
                   (Get-CapriEstimateFile (Join-Path $Target ('.runtime/'+$Spec.directory+'/'+$exe)))){
                    if($Name -ne 'llama'){return 0L}
                    $bundle=@($receipt.files.PSObject.Properties)
                    if($bundle.Count -and -not @($bundle | Where-Object {
                        $_.Name -notmatch '^[a-z0-9][a-z0-9.-]*\.(exe|dll)$' -or $_.Value -notmatch '^[a-f0-9]{64}$' -or
                        -not (Get-CapriEstimateFile (Join-Path $Target ('.runtime/'+$Spec.directory+'/'+$_.Name)))
                    }).Count){return 0L}
                }
            }
        }catch{}
    }
    if($Name -eq 'node'){
        $partial=Get-CapriEstimateFile ($archive+'.part')
        if($partial -and $partial.Length -lt $Spec.bytes){return [long]$Spec.bytes-$partial.Length}
    }
    return [long]$Spec.bytes
}
function Test-CapriNpmCache([string]$Target,[string]$PackageLock) {
    if(-not $Target){return $false}
    $cache=Join-Path $Target '.runtime/npm-cache/_cacache/content-v2'
    if(-not [IO.Directory]::Exists($cache)){return $false}
    try {
        foreach($entry in (Read-CapriJson $PackageLock).packages.PSObject.Properties.Value){
            if(-not $entry.PSObject.Properties['integrity']){continue}
            if($entry.PSObject.Properties['os'] -and ('!win32' -in $entry.os -or ($entry.os -notlike '!*' -and 'win32' -notin $entry.os))){continue}
            if($entry.PSObject.Properties['cpu'] -and ('!x64' -in $entry.cpu -or ($entry.cpu -notlike '!*' -and 'x64' -notin $entry.cpu))){continue}
            if($entry.integrity -notmatch '^(sha512|sha1)-([A-Za-z0-9+/]+={0,2})$'){return $false}
            $algorithm=$Matches[1]
            $digest=[BitConverter]::ToString([Convert]::FromBase64String($Matches[2])).Replace('-','').ToLowerInvariant()
            $file=Join-Path $cache ($algorithm+'/'+$digest.Substring(0,2)+'/'+$digest.Substring(2,2)+'/'+$digest.Substring(4))
            if(-not (Get-CapriEstimateFile $file)){return $false}
        }
        return $true
    }catch{return $false}
}
function Test-CapriInstalledPythonPackages([string]$Target,[string]$Environment,[string]$Lock,[string]$PythonSeries) {
    if(-not $Target){return $false}
    $venv=Join-Path $Target ('.runtime/'+$Environment)
    if(-not (Get-CapriEstimateFile (Join-Path $venv 'Scripts/python.exe'))){return $false}
    $site=Join-Path $venv 'Lib/site-packages'
    try {
        $configuration=Get-CapriEstimateFile (Join-Path $venv 'pyvenv.cfg')
        if(-not $configuration -or $configuration.Length -gt 8KB -or
           [IO.File]::ReadAllText($configuration.FullName) -notmatch ('(?m)^version(?:_info)?\s*=\s*'+[regex]::Escape($PythonSeries)+'(?:\.\d+)?\s*$')){return $false}
        Assert-CapriNoLinks $site
        $packages=@{}
        foreach($path in [IO.Directory]::EnumerateDirectories($site,'*.dist-info')){
            $name=[IO.Path]::GetFileName($path)
            if($name -match '^(.+?)-([^-]+)\.dist-info$'){$packages[$Matches[1]]=@{path=$path;version=$Matches[2]}}
        }
        foreach($line in [IO.File]::ReadLines($Lock)){
            if($line -notmatch '^[a-zA-Z0-9]'){continue}
            if($line -match '^([\w.-]+)==([^\s;]+)(?:\s*;\s*python_version\s*>=\s*''([\d.]+)'')?\s*\\?\s*$'){
                $name=$Matches[1] -replace '[-_.]+','_'
                $version=$Matches[2]
                if($Matches.ContainsKey(3) -and [version]$PythonSeries -lt [version]$Matches[3]){continue}
                $package=$packages[$name]
                if(-not $package -or $package.version -ne $version){return $false}
            }elseif($line -match '^([\w.-]+)\s+@\s+(\S+)$'){
                $name=$Matches[1] -replace '[-_.]+','_'
                $url=$Matches[2]
                $package=$packages[$name]
                if(-not $package){return $false}
                $metadata=Get-CapriEstimateFile (Join-Path $package.path 'direct_url.json')
                if(-not $metadata){return $false}
                $direct=Read-CapriJson $metadata.FullName
                if($url -match '^git\+(.+)@([a-f0-9]{40})$'){
                    if($direct.url -cne $Matches[1] -or $direct.vcs_info.commit_id -cne $Matches[2]){return $false}
                }elseif([Uri]::UnescapeDataString($direct.url) -cne [Uri]::UnescapeDataString($url)){return $false}
            }else{return $false}
            if(-not (Get-CapriEstimateFile (Join-Path $package.path 'METADATA'))){return $false}
        }
        return $true
    }catch{return $false}
}
function Get-CapriStorageEstimate($Selection,$Manifest,$Catalog,[bool]$RocmVoice=$false,$Hardware=$null) {
    $storage=$Manifest.storage
    $artifacts=$Manifest.artifacts
    $target=''
    $selectedTarget=if($Selection -is [Collections.IDictionary]){$Selection['target']}elseif($Selection.PSObject.Properties['target']){$Selection.target}
    if($selectedTarget -and [IO.Path]::IsPathRooted($selectedTarget) -and -not $selectedTarget.StartsWith('\\')){
        try {
            $folder=[IO.Path]::GetFullPath($selectedTarget).TrimEnd('\','/')
            $identity=Join-Path $folder '.capri-install.json'
            if(Get-CapriEstimateFile $identity){
                $installed=Read-CapriJson $identity
                if($installed.schemaVersion -eq 1 -and $installed.productId -eq $Manifest.productId -and $installed.root -eq $folder){
                    $target=$folder
                }
            }
        }catch{}
    }
    # Keep the clean-install disk reserve. The network estimate may reuse files,
    # but Setup still needs space for repair, staging and extracted packages.
    [long]$required=$artifacts.node.bytes+$artifacts.electron.bytes+$artifacts.llama.bytes+$storage.npmDownloadMiB*1MB+$storage.embeddingBytes
    [long]$download=0
    foreach($name in @('node','electron','llama','uv')){
        $download+=Get-CapriRuntimeDownloadBytes $target $name $artifacts.$name
    }
    if(-not (Test-CapriNpmCache $target $Catalog.packageLock)){$download+=$storage.npmDownloadMiB*1MB}
    $download+=Get-CapriRegistryDownloadBytes $target $Catalog.registry.'bge-m3:latest' $storage.embeddingBytes
    [long]$extra=($storage.coreExpandedMiB+$storage.nodeExpandedMiB+$storage.reserveMiB)*1MB+$artifacts.llama.expandedBytes
    $english=$Selection.conversationLanguage -eq 'en'
    $packages=@()
    $modelSource=if($Selection -is [Collections.IDictionary]){$Selection['modelSource']}elseif($Selection.PSObject.Properties['modelSource']){$Selection.modelSource}else{'catalog'}
    $deferredHub=$modelSource -eq 'huggingface'
    $voiceMode=if($Selection -is [Collections.IDictionary]){$Selection['voiceMode']}elseif($Selection.PSObject.Properties['voiceMode']){$Selection.voiceMode}else{'off'}
    if($Selection.inferenceMode -ne 'api' -and -not $deferredHub -and $Selection.downloadModels -and $Selection.profile -notmatch '^hf-[a-f0-9]{24}$'){
        $profile=$Manifest.profiles|Where-Object{$_.id -eq $Selection.profile}|Select-Object -First 1
        $bytes=$Catalog.models.PSObject.Properties[$profile.model].Value
        $required+=$bytes
        $download+=Get-CapriRegistryDownloadBytes $target $Catalog.registry.PSObject.Properties[$profile.model].Value $bytes
    }
    $required+=$artifacts.uv.bytes+(Get-CapriMissingFileBytes '' '' $Catalog.router)
    $routerDirectory=Get-CapriEstimateDirectory $target 'request-router' 'data/models/request-router/minilm-int8' ''
    $download+=Get-CapriMissingFileBytes $target $routerDirectory $Catalog.router
    $packages+=@(
        @{size=$storage.python;ready=($target -and (Get-CapriEstimateFile (Join-Path $target '.runtime/python/cpython-3.11.17-windows-x86_64-none/python.exe')))}
        @{size=$storage.router;ready=(Test-CapriInstalledPythonPackages $target 'router-venv' (Join-Path $Catalog.config 'router-requirements.lock.txt') '3.11')}
    )
    if($Selection.recognition){
        $packages+=@{size=$storage.recognition;ready=(Test-CapriInstalledPythonPackages $target 'asr-venv' (Join-Path $Catalog.config 'asr-requirements.lock.txt') '3.11')}
        $asrDirectory=Get-CapriEstimateDirectory $target 'companion-asr' 'data/speech/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8' ''
        $vadDirectory=Get-CapriEstimateDirectory $target 'companion-asr' 'data/speech/silero-vad-v5' 'vad'
        $required+=(Get-CapriMissingFileBytes '' '' $Catalog.recognition)+(Get-CapriMissingFileBytes '' '' $Catalog.vad)
        $download+=(Get-CapriMissingFileBytes $target $asrDirectory $Catalog.recognition)+(Get-CapriMissingFileBytes $target $vadDirectory $Catalog.vad)
        if(-not $english){
            foreach($model in $Catalog.multilingualRecognition){
                $required+=Get-CapriMissingFileBytes '' '' $model.files
                $download+=Get-CapriMissingFileBytes $target $model.directory $model.files
            }
        }
    }
    if($voiceMode -in @('qwen','qwen-ru')){
        $models=if($voiceMode -eq 'qwen-ru'){@($Catalog.russianVoice,$Catalog.russianVoice.accent)}else{@($Catalog.qwenVoice)}
        foreach($model in $models){
            $required+=Get-CapriMissingFileBytes '' '' $model.files
            $download+=Get-CapriMissingFileBytes $target $model.directory $model.files
        }
        $packages+=@{size=$storage.qwenVoice;ready=(Test-CapriInstalledPythonPackages $target 'qwen-tts-venv' (Join-Path $Catalog.config 'requirements-qwen-tts.lock') '3.11')}
    }elseif($Selection.voicePack){
        $required+=$artifacts.git.bytes
        $download+=Get-CapriRuntimeDownloadBytes $target 'git' $artifacts.git
        if($english){
            $required+=$storage.englishVoiceBytes
            $download+=Get-CapriMissingFileBytes $target $Catalog.voiceTrainingDirectory $Catalog.englishVoice
        }else{
            $model=$Catalog.multilingualVoice
            $required+=Get-CapriMissingFileBytes '' '' $model.files
            $download+=Get-CapriMissingFileBytes $target $model.directory $model.files 'data/speech/candidates/chatterbox-multilingual-v2'
        }
        $gpu=if($Hardware -is [Collections.IDictionary]){$Hardware['gpu']}else{''}
        $series=if($RocmVoice){'3.12'}else{'3.11'}
        $lock=if($RocmVoice){'requirements-voice-amd.lock'}elseif($gpu -match 'Blackwell|\bRTX\s*(?:PRO\s*)?50\d{2}\b'){'requirements-voice-blackwell.lock'}else{'requirements-voice-training.lock'}
        $packages+=@{size=$(if($RocmVoice){$storage.rocmVoice}else{$storage.cudaVoice});ready=(Test-CapriInstalledPythonPackages $target 'voice-training-venv' (Join-Path $Catalog.config $lock) $series)}
        if($RocmVoice){
            $packages+=@{size=$storage.python;ready=($target -and (Get-CapriEstimateFile (Join-Path $target '.runtime/python/cpython-3.12.12-windows-x86_64-none/python.exe')))}
        }
        if($Selection.conversationLanguage -eq 'zh'){
            $model=$Catalog.chinese
            $required+=$model.archiveBytes
            $extra+=Get-CapriMissingFileBytes '' '' $model.files
            if((Get-CapriMissingFileBytes $target $model.directory $model.files) -gt 0){
                $download+=Get-CapriMissingFileBytes $target (Split-Path -Parent $model.directory) @(@{file='spacy_ontonotes.zip';bytes=$model.archiveBytes})
            }
        }
    }
    foreach($item in $packages){
        $required+=$item.size.downloadMiB*1MB
        if(-not $item.ready){$download+=$item.size.downloadMiB*1MB}
        $extra+=$item.size.expandedMiB*1MB
    }
    return @{downloadBytes=$download;requiredBytes=$required+$extra}
}
function Get-CapriAvailableDiskBytes([string]$Target) {
    try {
        $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Target))
        if($drive.IsReady){return $drive.AvailableFreeSpace}
    }catch{}
    return $null
}
