# SPDX-License-Identifier: GPL-3.0-only
param([switch]$DependenciesOnly)
$ErrorActionPreference='Stop'
$capriQwenRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriQwenRoot
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
$capriQwenRuntime=Get-CapriPythonRuntime -ProjectRoot $capriQwenRoot
$capriQwenPython=Ensure-CapriVirtualEnvironment -ProjectRoot $capriQwenRoot -Name 'qwen-tts-venv' -Runtime $capriQwenRuntime
foreach($capriIndexVariable in @('UV_INDEX','UV_EXTRA_INDEX_URL','UV_INDEX_URL','UV_DEFAULT_INDEX','UV_FIND_LINKS','UV_NO_INDEX','UV_INDEX_STRATEGY','UV_TORCH_BACKEND','UV_OVERRIDE','UV_CONSTRAINT','UV_BUILD_CONSTRAINT')){
    [Environment]::SetEnvironmentVariable($capriIndexVariable,$null,'Process')
}
Write-Output '{"stage":"dependencies"}'
$capriQwenSync=@('pip','sync','--python',$capriQwenPython,'config/requirements-qwen-tts.lock','--require-hashes','--torch-backend','cpu','--default-index','https://pypi.org/simple','--index-strategy','first-index','--no-config')
& $capriQwenRuntime.Python tools/setup/uv-retry.py --uv $capriQwenRuntime.Uv -- @capriQwenSync
if($LASTEXITCODE -ne 0){throw 'Qwen speech dependencies could not be installed.'}
& $capriQwenPython -c 'from qwen_tts import Qwen3TTSModel; import torch; assert not torch.version.cuda'
if($LASTEXITCODE -ne 0){throw 'Qwen speech runtime verification failed.'}
if($DependenciesOnly){return}
& $capriQwenPython -m integrations.voice_runtime.qwen_provision
if($LASTEXITCODE -ne 0){throw 'Qwen speech model download could not finish. Partial downloads are retained for retry.'}
