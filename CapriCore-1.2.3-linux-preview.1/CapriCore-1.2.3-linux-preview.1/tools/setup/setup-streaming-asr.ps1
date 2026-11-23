$ErrorActionPreference = 'Stop'
$capriAsrRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriAsrRoot
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
$capriAsrRuntime = Get-CapriPythonRuntime -ProjectRoot $capriAsrRoot
$capriAsrUv = $capriAsrRuntime.Uv
$capriAsrBase = $capriAsrRuntime.Python
$capriAsrPython = Ensure-CapriVirtualEnvironment -ProjectRoot $capriAsrRoot -Name 'asr-venv' -Runtime $capriAsrRuntime
& $capriAsrBase tools/setup/uv-retry.py --uv $capriAsrUv -- pip sync --python $capriAsrPython 'config/asr-requirements.lock.txt'
if ($LASTEXITCODE -ne 0) { throw 'Could not install speech recognition dependencies' }
& $capriAsrPython tools/setup/provision-streaming-asr.py
if ($LASTEXITCODE -ne 0) { throw 'Could not provision Parakeet and the speech detector' }
