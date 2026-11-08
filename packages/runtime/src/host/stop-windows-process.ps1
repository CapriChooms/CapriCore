# SPDX-License-Identifier: GPL-3.0-only
param(
    [Parameter(Mandatory=$true)][int]$ProcessId,
    [Parameter(Mandatory=$true)][string]$StartedAt,
    [Parameter(Mandatory=$true)][string]$StopFile,
    [Parameter(Mandatory=$true)][int]$WaitMilliseconds,
    [switch]$Graceful
)
$ErrorActionPreference = 'Stop'
# One process handle and one wait replace repeated PowerShell launches. The
# creation timestamp must match before either writing a lifeline or terminating.
$capriTarget = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if ($null -eq $capriTarget) { exit 0 }
try {
    if ($capriTarget.StartTime.ToUniversalTime().Ticks.ToString() -ne $StartedAt) { exit 0 }
    # Opening the handle pins the process identity throughout the wait.
    $null = $capriTarget.Handle
    if ($Graceful) {
        [System.IO.File]::WriteAllText($StopFile, "stop`n")
    } else {
        Stop-Process -InputObject $capriTarget -ErrorAction Stop
    }
    if (-not $capriTarget.WaitForExit($WaitMilliseconds)) {
        throw 'The managed service did not finish its shutdown. Its process marker was preserved.'
    }
} finally {
    $capriTarget.Dispose()
}
