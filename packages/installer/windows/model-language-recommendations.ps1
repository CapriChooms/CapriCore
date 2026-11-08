# SPDX-License-Identifier: GPL-3.0-only
function Get-CapriRecommendedLanguageProfiles([string]$Language,$Benchmark,$Profiles,$Hardware,$Estimates) {
    if(-not $Benchmark){return}
    $schema=$Benchmark.PSObject.Properties['schemaVersion']
    $recommendations=$Benchmark.PSObject.Properties['recommendations']
    if(-not $schema -or $schema.Value -ne 1 -or -not $recommendations -or -not $recommendations.Value){return}
    $entry=$recommendations.Value.PSObject.Properties[$Language]
    if(-not $entry){return}
    $shown=@()
    foreach($id in @($entry.Value)){
        $profile=$Profiles|Where-Object{$_.id -eq $id}|Select-Object -First 1
        if(-not $profile -or $profile.id -in $shown){continue}
        if($profile.recommendedVramGiB -gt 4 -and $Hardware.vramGiB -lt ($profile.recommendedVramGiB-0.125)){continue}
        $ram=Get-CapriRequiredRam $profile $Hardware $Estimates
        if(-not(Test-CapriProfileRam $Hardware.ramGiB $ram)){continue}
        $shown+=$profile.id
        $profile
        if($shown.Count -eq 2){break}
    }
}
