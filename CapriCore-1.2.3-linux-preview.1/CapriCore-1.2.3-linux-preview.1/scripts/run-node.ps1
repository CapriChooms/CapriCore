# Compatibility command.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CapriArguments)
& (Join-Path $PSScriptRoot '../packages/runtime/bin/run-node.ps1') @CapriArguments
exit $LASTEXITCODE
