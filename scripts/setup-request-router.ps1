# Compatibility command.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot '../tools/setup/setup-request-router.ps1') @args
exit $LASTEXITCODE
