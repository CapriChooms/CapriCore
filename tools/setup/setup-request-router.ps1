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
# Probe the native dependency before downloading or verifying the encoder.
$capriRouterProbe = @'
try:
    import onnxruntime
except ImportError as error:
    if 'dll load failed' not in str(error).lower():
        raise
    raise SystemExit(22)
except OSError as error:
    if getattr(error, 'winerror', None) not in (126, 127, 1114):
        raise
    raise SystemExit(22)
'@
& $capriRouterPython -c $capriRouterProbe
if ($LASTEXITCODE -eq 22) {
    Write-Output 'CAPRI_ROUTER_NATIVE_LIBRARY_UNAVAILABLE'
    Write-Output 'The CPU request classifier could not load ONNX Runtime. Install the Microsoft Visual C++ x64 Redistributable and retry Setup to enable it. Chat works without the optional classifier.'
    exit 22
}
if ($LASTEXITCODE -ne 0) { throw 'Could not load CPU request classifier dependencies' }
& $capriRouterPython tools/setup/provision-request-router.py
if ($LASTEXITCODE -ne 0) { throw 'Could not provision the pinned request encoder' }
& $capriRouterPython tools/verify/verify-request-router.py
if ($LASTEXITCODE -ne 0) { throw 'The installed request classifier did not pass verification' }
