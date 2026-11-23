# SPDX-License-Identifier: GPL-3.0-only
function Get-CapriRecommendedLanguageProfiles([string]$Language,$Benchmark,$Profiles,$Hardware,$Estimates,$LanguageCatalog,[string]$LanguageDevice) {
    if(-not $Benchmark){return}
    $schema=$Benchmark.PSObject.Properties['schemaVersion']
    $recommendations=$Benchmark.PSObject.Properties['recommendations']
    if(-not $schema -or $schema.Value -ne 1 -or -not $recommendations -or -not $recommendations.Value){return}
    $entry=$recommendations.Value.PSObject.Properties[$Language]
    $scores=$Benchmark.PSObject.Properties['scores']
    if(-not $entry -and -not ($scores -and $scores.Value -and $scores.Value.PSObject.Properties[$Language])){
        $variant=$LanguageCatalog|Where-Object{$_.id -eq $Language}|Select-Object -First 1
        $base=if($variant){$variant.PSObject.Properties['modelLanguage']}
        if($base -and $base.Value){$entry=$recommendations.Value.PSObject.Properties[$base.Value]}
    }
    if(-not $entry){return}
    $shown=@()
    $vram=if($LanguageDevice -eq 'cpu'){0}else{$Hardware.vramGiB}
    foreach($id in @($entry.Value)){
        $profile=$Profiles|Where-Object{$_.id -eq $id}|Select-Object -First 1
        if(-not $profile -or $profile.id -in $shown){continue}
        if($profile.recommendedVramGiB -gt 4 -and $vram -lt ($profile.recommendedVramGiB-0.125)){continue}
        $ram=Get-CapriRequiredRam $profile $Hardware $Estimates $LanguageDevice
        if(-not(Test-CapriProfileRam $Hardware.ramGiB $ram)){continue}
        $shown+=$profile.id
        $profile
        if($shown.Count -eq 2){break}
    }
}
