param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CapriArguments)
$ErrorActionPreference = 'Stop'
$capriLauncherRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $capriLauncherRoot
$capriNodeRuntime = (Get-Content -LiteralPath (Join-Path $capriLauncherRoot 'config/installer.json') -Raw | ConvertFrom-Json).artifacts.node
$capriRequiredVersion = [version]$capriNodeRuntime.version
$capriBundledNode = Join-Path $capriLauncherRoot ('.runtime/' + $capriNodeRuntime.directory + '/node.exe')
$capriNodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$capriLauncherNode = if ($env:CAPRI_NODE_PATH) { $env:CAPRI_NODE_PATH } elseif ($capriNodeCommand) { $capriNodeCommand.Source } else { $capriBundledNode }
if (-not (Test-Path -LiteralPath $capriLauncherNode -PathType Leaf)) { throw "Install Node.js $capriRequiredVersion or later 24.x and run npm ci. See docs/installation.md." }
$capriSelectedVersion = [version](& $capriLauncherNode -p 'process.versions.node')
if ($capriSelectedVersion.Major -ne $capriRequiredVersion.Major -or $capriSelectedVersion -lt $capriRequiredVersion) {
    if ($env:CAPRI_NODE_PATH -or $capriLauncherNode -eq $capriBundledNode -or -not (Test-Path -LiteralPath $capriBundledNode -PathType Leaf)) { throw "Capri requires compatible Node.js $capriRequiredVersion or later 24.x. See docs/installation.md." }
    $capriLauncherNode = $capriBundledNode
    $capriBundledVersion = [version](& $capriLauncherNode -p 'process.versions.node')
    if ($capriBundledVersion -ne $capriRequiredVersion) { throw 'The bundled Node.js runtime differs from the installer manifest. Repair with Capri Setup.' }
}
& $capriLauncherNode (Join-Path $capriLauncherRoot 'packages/runtime/bin/capri.mjs') @CapriArguments
exit $LASTEXITCODE
