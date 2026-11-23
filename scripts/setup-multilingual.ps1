# Compatibility command.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot '../tools/setup/setup-multilingual.ps1') @args
exit $LASTEXITCODE
