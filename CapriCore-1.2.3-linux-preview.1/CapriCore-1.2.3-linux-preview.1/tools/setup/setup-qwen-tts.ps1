# SPDX-License-Identifier: GPL-3.0-only
param([switch]$DependenciesOnly,[switch]$Russian,[switch]$Cuda,[switch]$Rocm)
$ErrorActionPreference='Stop'
if($Cuda -and -not $Russian){throw 'NVIDIA acceleration requires the Russian Qwen voice.'}
if($Cuda -and $Rocm){throw 'Select one acceleration package at a time.'}
$capriAcceleration=if($Rocm){'rocm'}elseif($Cuda){'cuda'}else{''}
$capriVendor=if($Rocm){'AMD ROCm'}else{'NVIDIA acceleration'}
$capriQwenRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriQwenRoot
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
Write-Output '{"stage":"python"}'
if($Rocm){
    if([Environment]::OSVersion.Version.Build -lt 22000){throw 'AMD ROCm acceleration requires Windows 11.'}
    $env:ROCM_SDK_TARGET_FAMILY='custom'
    $capriQwenRuntime=Get-CapriPythonRuntime -ProjectRoot $capriQwenRoot -Version '3.12.12'
}else{
    $capriQwenRuntime=Get-CapriPythonRuntime -ProjectRoot $capriQwenRoot
}
$capriQwenVenv=if($capriAcceleration){'qwen-tts-'+$capriAcceleration+'-venv'}else{'qwen-tts-venv'}
$capriQwenPython=Ensure-CapriVirtualEnvironment -ProjectRoot $capriQwenRoot -Name $capriQwenVenv -Runtime $capriQwenRuntime
foreach($capriIndexVariable in @('UV_INDEX','UV_EXTRA_INDEX_URL','UV_INDEX_URL','UV_DEFAULT_INDEX','UV_FIND_LINKS','UV_NO_INDEX','UV_INDEX_STRATEGY','UV_TORCH_BACKEND','UV_OVERRIDE','UV_CONSTRAINT','UV_BUILD_CONSTRAINT')){
    [Environment]::SetEnvironmentVariable($capriIndexVariable,$null,'Process')
}
$capriQwenLock='config/requirements-qwen-tts.lock'
$capriQwenBackend='cpu'
if($capriAcceleration){
    $capriQwenDirectory=Split-Path (Split-Path $capriQwenPython)
    $capriQwenPackages=Join-Path $capriQwenDirectory 'Lib/site-packages'
    if((Test-Path -LiteralPath (Join-Path $capriQwenPackages 'torch/__init__.py')) -and
       (Test-Path -LiteralPath (Join-Path $capriQwenPackages 'qwen_tts/__init__.py'))){
        Write-Output '{"stage":"verify"}'
        & $capriQwenPython -m integrations.voice_runtime.qwen_gpu_setup --backend $capriAcceleration --verify
        if($LASTEXITCODE -eq 0){Write-Output '{"stage":"ready"}';return}
        if($LASTEXITCODE -eq 2){throw 'Qwen speech runtime verification failed.'}
    }
    $capriQwenLock=Join-Path $capriQwenDirectory ('requirements-'+$capriAcceleration+'-'+[Guid]::NewGuid().ToString('N')+'.lock')
    $capriQwenBackend='cu128'
}
$capriQwenSync=@('pip','sync','--python',$capriQwenPython,$capriQwenLock,'--require-hashes','--default-index','https://pypi.org/simple','--index-strategy','first-index','--no-config')
if(-not $Rocm){$capriQwenSync+=@('--torch-backend',$capriQwenBackend)}
try {
    if($capriAcceleration){
        Write-Output ('{"stage":"'+$capriAcceleration+'-prepare"}')
        & $capriQwenRuntime.Python -m integrations.voice_runtime.qwen_gpu_setup --backend $capriAcceleration --prepare $capriQwenLock
        if($LASTEXITCODE -ne 0){throw ($capriVendor+' packages could not be downloaded or verified.')}
    }
    Write-Output '{"stage":"dependencies"}'
    & $capriQwenRuntime.Python tools/setup/uv-retry.py --uv $capriQwenRuntime.Uv -- @capriQwenSync
    if($LASTEXITCODE -ne 0){throw 'Qwen speech dependencies could not be installed.'}
} finally {
    if($capriAcceleration){Remove-Item -LiteralPath $capriQwenLock -Force -ErrorAction SilentlyContinue}
}
Write-Output '{"stage":"verify"}'
if($capriAcceleration){
    & $capriQwenPython -m integrations.voice_runtime.qwen_gpu_setup --backend $capriAcceleration --verify
    if($LASTEXITCODE -ne 0){throw 'Qwen speech runtime verification failed.'}
    Write-Output '{"stage":"ready"}'
    return
}
& $capriQwenPython -c 'from qwen_tts import Qwen3TTSModel; from ruaccent import RUAccent; import torch; assert not torch.version.cuda'
if($LASTEXITCODE -ne 0){throw 'Qwen speech runtime verification failed.'}
if($DependenciesOnly){return}
$capriQwenModelArgs=@()
if($Russian){$capriQwenModelArgs+= '--russian'}
& $capriQwenPython -m integrations.voice_runtime.qwen_provision @capriQwenModelArgs
if($LASTEXITCODE -ne 0){throw 'Qwen speech model download could not finish. Partial downloads are retained for retry.'}
