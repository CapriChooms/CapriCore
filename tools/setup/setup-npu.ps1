# SPDX-License-Identifier: GPL-3.0-only
param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Version.Build -lt 22621) { throw 'The current OpenVINO NPU runtime requires Windows 11 22H2. CPU/GPU models remain available.' }
. (Join-Path $ProjectRoot 'tools/setup/python-runtime.ps1')
$pythonRuntime = Get-CapriPythonRuntime -ProjectRoot $ProjectRoot -Version '3.12.12'
$python = Ensure-CapriVirtualEnvironment -ProjectRoot $ProjectRoot -Name 'npu-openvino' -Runtime $pythonRuntime
& $pythonRuntime.Python (Join-Path $ProjectRoot 'tools/setup/uv-retry.py') --uv $pythonRuntime.Uv -- pip sync --require-hashes --no-config --default-index https://pypi.org/simple --index-strategy first-index --python $python (Join-Path $ProjectRoot 'config/npu-requirements.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Native NPU dependencies could not be installed. Check the connection and retry.' }
