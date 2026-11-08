# SPDX-License-Identifier: GPL-3.0-only
function Get-CapriModelBytes($Files) {
    if($Files -isnot [array]){$Files=@($Files.PSObject.Properties.Value)}
    return [long](($Files | Measure-Object -Property bytes -Sum).Sum)
}
function Read-CapriStorageCatalog([string]$Source) {
    $config=Join-Path $Source 'config'
    $asr=Read-CapriJson (Join-Path $config 'asr-model-upstream.json')
    $vad=Read-CapriJson (Join-Path $config 'asr-vad-upstream.json')
    $router=Read-CapriJson (Join-Path $config 'request-router-upstream.json')
    $candidates=Read-CapriJson (Join-Path $config 'multilingual-candidates.json')
    $speech=Read-CapriJson (Join-Path $config 'multilingual-runtime.json')
    $qwenVoice=Read-CapriJson (Join-Path $config 'qwen-tts-upstream.json')
    return @{
        models=(Read-CapriJson (Join-Path $config 'qwen-download-sizes.json')).models
        recognition=(Get-CapriModelBytes $asr.files)+(Get-CapriModelBytes $vad.files)
        multilingualRecognition=(Get-CapriModelBytes $candidates.asr.files)+(Get-CapriModelBytes $speech.whisper.files)
        router=(Get-CapriModelBytes $router.files)
        multilingualVoice=(Get-CapriModelBytes $speech.tts.files)
        qwenVoice=(Get-CapriModelBytes $qwenVoice.files)
        chineseDownload=$speech.chinese.archiveBytes
        chineseExpanded=(Get-CapriModelBytes $speech.chinese.files)
        llmGpuSupport=(Read-CapriJson (Join-Path $Source 'packages/runtime/src/hardware/llm-gpu-support.json'))
    }
}
function Test-CapriOllamaRocm($Selection,$Support,$Hardware) {
    if($Selection.inferenceMode -eq 'api' -or -not $Hardware){return $false}
    foreach($gpu in @($Hardware.gpus)){
        $name=([string]$gpu.name -replace '\((?:TM|R)\)','' -replace '\s+',' ').Trim()
        foreach($model in $Support.windowsRocmModels){
            if($name -match ('\bRADEON\s+'+[regex]::Escape($model)+'(?:\s|$)')){return $true}
        }
    }
    return $false
}
function Get-CapriStorageEstimate($Selection,$Manifest,$Catalog,[bool]$RocmVoice=$false,$Hardware=$null) {
    $storage=$Manifest.storage
    $artifacts=$Manifest.artifacts
    [long]$download=$artifacts.node.bytes+$artifacts.electron.bytes+$artifacts.ollama.bytes+$storage.npmDownloadMiB*1MB
    [long]$extra=($storage.coreExpandedMiB+$storage.nodeExpandedMiB+$storage.reserveMiB)*1MB
    if(Test-CapriOllamaRocm $Selection $Catalog.llmGpuSupport $Hardware){
        $download+=$artifacts.ollamaRocm.bytes
        $extra+=$artifacts.ollamaRocm.expandedBytes
    }
    $english=$Selection.conversationLanguage -eq 'en'
    $packages=@()
    $modelSource=if($Selection -is [Collections.IDictionary]){$Selection['modelSource']}elseif($Selection.PSObject.Properties['modelSource']){$Selection.modelSource}else{'catalog'}
    $deferredHub=$modelSource -eq 'huggingface'
    $voiceMode=if($Selection -is [Collections.IDictionary]){$Selection['voiceMode']}elseif($Selection.PSObject.Properties['voiceMode']){$Selection.voiceMode}else{'off'}
    $download+=$storage.embeddingBytes
    if($Selection.inferenceMode -ne 'api' -and -not $deferredHub -and $Selection.downloadModels){
        $profile=$Manifest.profiles|Where-Object{$_.id -eq $Selection.profile}|Select-Object -First 1
        $download+=$Catalog.models.PSObject.Properties[$profile.model].Value
    }
    $download+=$artifacts.uv.bytes+$Catalog.router
    $packages+=@($storage.python,$storage.router)
    if($Selection.recognition){
        $packages+=@($storage.recognition)
        $download+=$Catalog.recognition
        if(-not $english){$download+=$Catalog.multilingualRecognition}
    }
    if($voiceMode -eq 'qwen'){
        $download+=$Catalog.qwenVoice
        $packages+=@($storage.qwenVoice)
    }elseif($Selection.voicePack){
        $download+=$artifacts.git.bytes+$(if($english){$storage.englishVoiceBytes}else{$Catalog.multilingualVoice})
        if($RocmVoice){$packages+=@($storage.rocmVoice,$storage.python)}
        else{$packages+=@($storage.cudaVoice)}
        if($Selection.conversationLanguage -eq 'zh'){
            $download+=$Catalog.chineseDownload
            $extra+=$Catalog.chineseExpanded
        }
    }
    foreach($item in $packages){
        $download+=$item.downloadMiB*1MB
        $extra+=$item.expandedMiB*1MB
    }
    return @{downloadBytes=$download;requiredBytes=$download+$extra}
}
function Get-CapriAvailableDiskBytes([string]$Target) {
    try {
        $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Target))
        if($drive.IsReady){return $drive.AvailableFreeSpace}
    }catch{}
    return $null
}
