param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination,[long]$MaximumBytes=20GB)
. (Join-Path $PSScriptRoot 'common.ps1')
Expand-CapriArchive -Archive $Archive -Destination $Destination -MaximumBytes $MaximumBytes
