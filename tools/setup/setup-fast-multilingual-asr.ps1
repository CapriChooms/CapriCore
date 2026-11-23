# SPDX-License-Identifier: GPL-3.0-only
$ErrorActionPreference='Stop'
$capriFastAsrRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriFastAsrRoot
& (Join-Path $PSScriptRoot 'setup-streaming-asr.ps1')
if($LASTEXITCODE -ne 0){throw 'Could not install speech recognition dependencies.'}
& '.runtime/asr-venv/Scripts/python.exe' 'tools/setup/provision-multilingual-candidates.py' --component asr
if($LASTEXITCODE -ne 0){throw 'Could not install multilingual Parakeet.'}
