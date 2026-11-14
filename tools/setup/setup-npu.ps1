# SPDX-License-Identifier: GPL-3.0-only
param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Version.Build -lt 22621) { throw 'The current OpenVINO NPU runtime requires Windows 11 22H2. CPU/GPU models remain available.' }
. (Join-Path $ProjectRoot 'tools/setup/python-runtime.ps1')
$pythonRuntime = Get-CapriPythonRuntime -ProjectRoot $ProjectRoot -Version '3.12.12'
$python = Ensure-CapriVirtualEnvironment -ProjectRoot $ProjectRoot -Name 'npu-openvino' -Runtime $pythonRuntime
& $pythonRuntime.Python (Join-Path $ProjectRoot 'tools/setup/uv-retry.py') --uv $pythonRuntime.Uv -- pip install --python $python 'openvino==2026.4.0' 'openvino-tokenizers==2026.4.0.0' 'openvino-genai==2026.4.0.0'
if ($LASTEXITCODE -ne 0) { throw 'Native NPU dependencies could not be installed. Check the connection and retry.' }
