# SPDX-License-Identifier: GPL-3.0-only
param([ValidatePattern('^(all|pt-BR|[a-z]{2,3})$')][string]$Language='all')
$ErrorActionPreference='Stop'
$capriMultilingualRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriMultilingualRoot
$capriVoiceReceipt=Join-Path $capriMultilingualRoot '.runtime/voice-runtime.json'
if(Test-Path -LiteralPath $capriVoiceReceipt){
    $capriVoiceRuntime=Get-Content -LiteralPath $capriVoiceReceipt -Raw | ConvertFrom-Json
    if($capriVoiceRuntime.profile -eq 'amd'){
        $env:ROCM_SDK_TARGET_FAMILY='custom'
        $adapter=$capriVoiceRuntime.hipVisibleDevice
        if($null -eq $env:HIP_VISIBLE_DEVICES -and $null -eq $env:CUDA_VISIBLE_DEVICES -and
           ($adapter -is [int] -or $adapter -is [long]) -and $adapter -in (0..7)){
            $env:HIP_VISIBLE_DEVICES=[string]$adapter
        }
    }
}
& '.runtime/voice-training-venv/Scripts/python.exe' 'tools/setup/provision-multilingual.py' --component tts --language $Language
if($LASTEXITCODE -ne 0){throw 'Could not install multilingual speech.'}
