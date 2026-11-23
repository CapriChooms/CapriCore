# Compatibility command.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot '../tools/setup/setup-streaming-asr.ps1') @args
exit $LASTEXITCODE
