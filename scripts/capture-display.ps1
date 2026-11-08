# Compatibility command.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot '../integrations/perception/native/capture-display.ps1') @args
exit $LASTEXITCODE
