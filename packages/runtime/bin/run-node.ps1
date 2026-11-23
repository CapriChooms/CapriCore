param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CapriArguments)
$ErrorActionPreference = 'Stop'
$capriLauncherRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $capriLauncherRoot
$capriNodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
$capriLauncherNode = if ($env:CAPRI_NODE_PATH) { $env:CAPRI_NODE_PATH } elseif ($capriNodeCommand) { $capriNodeCommand.Source } else { $null }
if (-not $capriLauncherNode) {
    $capriBundledNode = Get-ChildItem -LiteralPath (Join-Path $capriLauncherRoot '.runtime') -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($capriBundledNode) { $capriLauncherNode = Join-Path $capriBundledNode.FullName 'node.exe' }
}
if (-not $capriLauncherNode -or -not (Test-Path -LiteralPath $capriLauncherNode -PathType Leaf)) { throw 'Install Node.js 24 LTS and run npm ci. See docs/installation.md.' }
$capriSelectedVersion = [version](& $capriLauncherNode -p 'process.versions.node')
if ($capriSelectedVersion.Major -ne 24 -or $capriSelectedVersion -lt [version]'24.22.1') {
    $capriFallbackNode = Join-Path $capriLauncherRoot '.runtime/node-v24.22.1-win-x64/node.exe'
    if (-not $env:CAPRI_NODE_PATH -and (Test-Path -LiteralPath $capriFallbackNode)) { $capriLauncherNode = $capriFallbackNode }
    else { throw 'Capri requires compatible Node.js 24.22.1 or later 24.x. See docs/installation.md.' }
}
& $capriLauncherNode (Join-Path $capriLauncherRoot 'packages/runtime/bin/capri.mjs') @CapriArguments
exit $LASTEXITCODE
