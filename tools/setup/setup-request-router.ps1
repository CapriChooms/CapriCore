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
& $capriRouterPython tools/setup/provision-request-router.py
if ($LASTEXITCODE -ne 0) { throw 'Could not provision the pinned request encoder' }
& $capriRouterPython tools/verify/verify-request-router.py
if ($LASTEXITCODE -ne 0) { throw 'The installed request classifier did not pass verification' }
