# SPDX-License-Identifier: GPL-3.0-only
$ErrorActionPreference = 'Stop'
$capriCheckRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$capriScriptCount = 0
foreach ($capriSourceDirectory in @('apps','packages','integrations','scripts','tools')) {
    foreach ($capriScript in Get-ChildItem -LiteralPath (Join-Path $capriCheckRoot $capriSourceDirectory) -Filter '*.ps1' -File -Recurse) {
        $capriParseTokens = $null
        $capriParseErrors = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile($capriScript.FullName,[ref]$capriParseTokens,[ref]$capriParseErrors)
        if ($capriParseErrors.Count -gt 0) { throw ($capriScript.Name + ': ' + ($capriParseErrors.Message -join '; ')) }
        $capriScriptCount++
    }
}
Write-Output ('PowerShell syntax checked: ' + $capriScriptCount)
