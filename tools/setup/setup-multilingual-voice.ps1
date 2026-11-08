# SPDX-License-Identifier: GPL-3.0-only
param([ValidatePattern('^(all|[a-z]{2,3})$')][string]$Language='all')
$ErrorActionPreference='Stop'
$capriMultilingualRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriMultilingualRoot
$capriVoiceReceipt=Join-Path $capriMultilingualRoot '.runtime/voice-runtime.json'
if((Test-Path -LiteralPath $capriVoiceReceipt) -and ((Get-Content -LiteralPath $capriVoiceReceipt -Raw|ConvertFrom-Json).profile -eq 'amd')){$env:ROCM_SDK_TARGET_FAMILY='custom'}
& '.runtime/voice-training-venv/Scripts/python.exe' 'tools/setup/provision-multilingual.py' --component tts --language $Language
if($LASTEXITCODE -ne 0){throw 'Could not install multilingual speech.'}
