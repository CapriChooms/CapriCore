# Compatibility command.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot '../tools/fixtures/prepare-asr-command-fixtures.ps1') @args
exit $LASTEXITCODE
