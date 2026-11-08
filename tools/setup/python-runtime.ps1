# SPDX-License-Identifier: GPL-3.0-only
function Get-CapriPythonRuntime {
    param([Parameter(Mandatory=$true)][string]$ProjectRoot,[ValidateSet('3.11.17','3.12.12')][string]$Version='3.11.17')
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    $OutputEncoding = [Console]::OutputEncoding
    $ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
    $capriBundledUv = Join-Path $ProjectRoot '.runtime/uv/uv.exe'
    $capriUvCommand = Get-Command uv.exe -CommandType Application -ErrorAction SilentlyContinue
    $capriUvPath = if (Test-Path -LiteralPath $capriBundledUv -PathType Leaf) { $capriBundledUv } elseif ($capriUvCommand) { $capriUvCommand.Source } else { $capriBundledUv }
    if (-not (Test-Path -LiteralPath $capriUvPath -PathType Leaf)) {
        $capriRepairMessage = 'Run Capri Setup to repair this folder, or install Node 24 and retry. The private uv runtime can then be restored automatically.'
        $capriRepairNode = $null
        try {
            $capriRepairManifest = Get-Content -LiteralPath (Join-Path $ProjectRoot 'config/installer.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $capriRepairDirectory = [string]$capriRepairManifest.artifacts.node.directory
            if ($capriRepairDirectory -match '^node-v[0-9.]+-win-x64$') {
                $capriRepairBundledNode = Join-Path $ProjectRoot ('.runtime/'+$capriRepairDirectory+'/node.exe')
                if (Test-Path -LiteralPath $capriRepairBundledNode -PathType Leaf) { $capriRepairNode = $capriRepairBundledNode }
            }
        } catch {}
        if (-not $capriRepairNode) {
            $capriRepairNodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
            if ($capriRepairNodeCommand) { $capriRepairNode = $capriRepairNodeCommand.Source }
        }
        if (-not $capriRepairNode) { throw $capriRepairMessage }
        $capriRepairCursor = [IO.Path]::GetFullPath($capriRepairNode)
        while ($capriRepairCursor) {
            if ((Test-Path -LiteralPath $capriRepairCursor) -and ((Get-Item -LiteralPath $capriRepairCursor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Python setup paths cannot contain filesystem links.' }
            $capriRepairCursor = [IO.Path]::GetDirectoryName($capriRepairCursor)
        }
        $capriRepairVersion = & $capriRepairNode --version
        if ($LASTEXITCODE -ne 0 -or [string]$capriRepairVersion -notmatch '^v24\.') { throw $capriRepairMessage }
        Write-Host 'Restoring the verified Capri runtime...'
        & $capriRepairNode (Join-Path $PSScriptRoot 'ensure-uv.mjs') --root $ProjectRoot | Out-Host
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $capriBundledUv -PathType Leaf)) { throw 'Could not restore the private uv runtime. Check the network and retry, or run Capri Setup to repair this folder.' }
        $capriUvPath = $capriBundledUv
    }
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $ProjectRoot '.runtime/python'
    $env:UV_PYTHON_BIN_DIR = Join-Path $ProjectRoot '.runtime/python-bin'
    $env:UV_PYTHON_INSTALL_BIN = '0'
    $env:UV_PYTHON_INSTALL_REGISTRY = '0'
    $env:UV_PYTHON_NO_REGISTRY = '1'
    $env:UV_PYTHON_PREFERENCE = 'only-managed'
    $env:UV_NO_CONFIG = '1'
    $env:UV_CACHE_DIR = Join-Path $ProjectRoot '.runtime/uv-cache'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:TMP = Join-Path $ProjectRoot '.runtime/tmp'
    $env:TEMP = $env:TMP
    # The installer supports Windows x64 and pins this exact interpreter key.
    # Do not decode a path from `uv python find`: Windows PowerShell's default
    # native-output decoding can corrupt Unicode paths, or find another app's
    # interpreter instead of this installation's owned runtime.
    $capriPythonKey = "cpython-$Version-windows-x86_64-none"
    $capriPythonPath = Join-Path $env:UV_PYTHON_INSTALL_DIR ($capriPythonKey + '/python.exe')
    foreach ($capriOwnedPath in @($capriUvPath, $capriPythonPath, $env:UV_CACHE_DIR, $env:UV_PYTHON_BIN_DIR, $env:TMP)) {
        $capriCursor = [IO.Path]::GetFullPath($capriOwnedPath)
        while ($capriCursor) {
            # AppData is hidden: Get-Item needs -Force even when Test-Path succeeds.
            # Read its attributes without changing them or weakening the link check.
            if ((Test-Path -LiteralPath $capriCursor) -and ((Get-Item -LiteralPath $capriCursor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Python setup paths cannot contain filesystem links.' }
            $capriCursor = [IO.Path]::GetDirectoryName($capriCursor)
        }
    }
    New-Item -ItemType Directory -Force -Path $env:TMP | Out-Null
    if (-not (Test-Path -LiteralPath $capriPythonPath -PathType Leaf)) {
        & $capriUvPath python install $capriPythonKey --no-bin --no-registry --no-config | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned Python runtime.' }
    }
    if (-not $capriPythonPath -or -not (Test-Path -LiteralPath $capriPythonPath -PathType Leaf)) { throw 'Pinned Python 3.11.17 is unavailable.' }
    $capriPythonVersion = & $capriPythonPath --version
    if ($LASTEXITCODE -ne 0 -or "$capriPythonVersion".Trim() -ne "Python $Version") { throw 'The local Python runtime does not match pinned Python 3.11.17.' }
    return @{ Uv = $capriUvPath; Python = $capriPythonPath; Version = $Version }
}

function Ensure-CapriVirtualEnvironment {
    param([Parameter(Mandatory=$true)][string]$ProjectRoot,[Parameter(Mandatory=$true)][ValidateSet('asr-venv','router-venv','voice-training-venv','qwen-tts-venv')][string]$Name,[Parameter(Mandatory=$true)]$Runtime)
    $capriRuntimeRoot=[IO.Path]::GetFullPath((Join-Path $ProjectRoot '.runtime')).TrimEnd('\')
    $capriVenv=[IO.Path]::GetFullPath((Join-Path $capriRuntimeRoot $Name))
    if(-not $capriVenv.StartsWith($capriRuntimeRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid owned Python environment path.'}
    $capriCursor=$capriVenv
    while($capriCursor){
        if((Test-Path -LiteralPath $capriCursor) -and ((Get-Item -LiteralPath $capriCursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Python environment paths cannot contain filesystem links.'}
        $capriCursor=[IO.Path]::GetDirectoryName($capriCursor)
    }
    $capriRequiredSeries=if($Runtime.Version){$Runtime.Version -replace '\.\d+$',''}else{'3.11'}
    $capriVenvPython=Join-Path $capriVenv 'Scripts/python.exe'
    if(Test-Path -LiteralPath $capriVenvPython -PathType Leaf){
        try{
            $capriVenvVersion=& $capriVenvPython --version 2>$null
            if($LASTEXITCODE -eq 0 -and [string]$capriVenvVersion -match ('^Python '+[regex]::Escape($capriRequiredSeries)+'\.\d+')){return $capriVenvPython}
        }catch{}
    }
    if(Test-Path -LiteralPath $capriVenv){
        if(-not(Test-Path -LiteralPath $capriVenv -PathType Container)){throw 'The owned Python environment path is not a directory.'}
        $capriRecovery=[IO.Path]::GetFullPath((Join-Path $capriRuntimeRoot ('venv-recovery/'+$Name+'-'+[Guid]::NewGuid().ToString('N'))))
        if(-not $capriRecovery.StartsWith($capriRuntimeRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid Python recovery destination.'}
        $capriRecoveryParent=Split-Path -Parent $capriRecovery
        if((Test-Path -LiteralPath $capriRecoveryParent) -and ((Get-Item -LiteralPath $capriRecoveryParent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Python recovery directory cannot be a filesystem link.'}
        [IO.Directory]::CreateDirectory($capriRecoveryParent)|Out-Null
        # Same-volume directory rename preserves the interrupted environment. No
        # recursive deletion, package-cache removal or private-data reset.
        [IO.Directory]::Move($capriVenv,$capriRecovery)
        Write-Host ('Repairing '+$Name+'. Previous environment retained at '+$capriRecovery)
    }
    & $Runtime.Uv venv $capriVenv --python $Runtime.Python | Out-Host
    if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $capriVenvPython -PathType Leaf)){throw ('Could not create the owned Python environment: '+$Name)}
    return $capriVenvPython
}
