param([ValidatePattern('^(all|[a-z]{2,3})$')][string]$Language='all')
$ErrorActionPreference = 'Stop'
$capriLanguagesRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriLanguagesRoot
Write-Host 'Installing local multilingual speech. A fresh install needs roughly 6 GB for models; verified cached files are reused.'
Write-Host 'English keeps the trained Capri voice. Other spoken languages use reference-conditioned Chatterbox Multilingual v3.'
& (Join-Path $PSScriptRoot 'setup-streaming-asr.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Could not install recognition dependencies' }
& '.runtime/asr-venv/Scripts/python.exe' 'tools/setup/provision-multilingual-candidates.py' --component asr
if ($LASTEXITCODE -ne 0) { throw 'Could not install multilingual Parakeet' }
& '.runtime/asr-venv/Scripts/python.exe' 'tools/setup/provision-multilingual.py' --component whisper
if ($LASTEXITCODE -ne 0) { throw 'Could not install multilingual recognition models' }
& (Join-Path $PSScriptRoot 'setup-voice-training.ps1') -DependenciesOnly
if ($LASTEXITCODE -ne 0) { throw 'Could not install voice dependencies' }
& '.runtime/voice-training-venv/Scripts/python.exe' 'tools/setup/provision-multilingual.py' --component tts --language $Language
if ($LASTEXITCODE -ne 0) { throw 'Could not install multilingual speech models' }
Write-Host 'Voice dependencies and multilingual models are installed. Open Capri > Languages to select and enable the voice. For automatic profile installation use Install and enable in Languages.'
