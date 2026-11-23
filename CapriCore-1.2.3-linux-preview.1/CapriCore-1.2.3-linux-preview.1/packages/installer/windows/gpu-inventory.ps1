param([switch]$Json)
# SPDX-License-Identifier: GPL-3.0-only

# Shared by the native wizard and the bounded runtime probe. It reads hardware
# metadata only: no models, rendering, driver install, credentials, or log output.
$script:CapriGpuInventorySource = Join-Path $PSScriptRoot 'gpu-inventory.cs'
function Get-CapriGpuInventory {
    param([ValidateRange(250,3500)][int]$TimeoutMilliseconds=2500)
    if(-not('Capri.Setup.GpuInventory' -as [type])) {
        Add-Type -Path $script:CapriGpuInventorySource -ErrorAction Stop | Out-Null
    }
    return [Capri.Setup.GpuInventory]::Read($TimeoutMilliseconds)
}

if($Json) {
    [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
    $OutputEncoding=[Console]::OutputEncoding
    try {
        $adapters = @(Get-CapriGpuInventory)
        @{success=$true;adapters=$adapters} | ConvertTo-Json -Depth 5 -Compress
    } catch {
        # A valid empty inventory differs from a failed probe. Raw driver/error
        # strings can contain machine details and are not sent to the caller.
        @{success=$false;adapters=@()} | ConvertTo-Json -Depth 5 -Compress
    }
}
