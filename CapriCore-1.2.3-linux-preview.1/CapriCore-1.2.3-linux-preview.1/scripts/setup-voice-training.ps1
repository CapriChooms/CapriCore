# Compatibility command.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot '../tools/setup/setup-voice-training.ps1') @args
exit $LASTEXITCODE
