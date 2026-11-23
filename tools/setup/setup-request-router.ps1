$ErrorActionPreference = 'Stop'
$capriRouterRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriRouterRoot
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
$capriRouterRuntime = Get-CapriPythonRuntime -ProjectRoot $capriRouterRoot
$capriRouterUv = $capriRouterRuntime.Uv
$capriRouterBase = $capriRouterRuntime.Python
$capriRouterPython = Ensure-CapriVirtualEnvironment -ProjectRoot $capriRouterRoot -Name 'router-venv' -Runtime $capriRouterRuntime
& $capriRouterBase tools/setup/uv-retry.py --uv $capriRouterUv -- pip sync --python $capriRouterPython 'config/router-requirements.lock.txt'
if ($LASTEXITCODE -ne 0) { throw 'Could not install CPU request router dependencies' }
# Windows can terminate the native import before Python can report an exception.
& $capriRouterPython -c 'import onnxruntime'
$capriRouterProbeExit = $LASTEXITCODE
if ($capriRouterProbeExit -ne 0) {
    Write-Output "CAPRI_ROUTER_NATIVE_LIBRARY_UNAVAILABLE exit=$capriRouterProbeExit"
    Write-Output 'The CPU request classifier could not load ONNX Runtime. Install the Microsoft Visual C++ x64 Redistributable and retry Setup to enable it. Chat works without the optional classifier.'
    exit 22
}
& $capriRouterPython tools/setup/provision-request-router.py
if ($LASTEXITCODE -ne 0) { throw 'Could not provision the pinned request encoder' }
& $capriRouterPython tools/verify/verify-request-router.py
if ($LASTEXITCODE -ne 0) { throw 'The installed request classifier did not pass verification' }
