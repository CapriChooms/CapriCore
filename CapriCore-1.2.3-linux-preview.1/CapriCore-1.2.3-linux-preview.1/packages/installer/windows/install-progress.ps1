# SPDX-License-Identifier: GPL-3.0-only
function New-CapriInstallProgress {
    return @{
        # Compatibility for a recovered session created by a previous Setup.
        stages=@('node','source','dependencies','ollama','configuration','python','recognition','router','voice-runtime','voice-pack','models','verify','shortcuts','finalize')
        step=''; value=0; fractionalValue=0.0; activity=''; transfer=''; complete=$false
        transferEta=$null; transferEtaAt=[DateTime]::MinValue
        started=[DateTime]::UtcNow; advanced=[DateTime]::UtcNow
        pauseStarted=$null; pausedSeconds=0.0; lastLog=[DateTime]::UtcNow; lastTransferLog=[DateTime]::MinValue
    }
}
function Set-CapriProgressPlan($State,[string[]]$Stages) {
    if(-not $Stages -or $Stages.Count -lt 2 -or $Stages.Count -gt 18 -or $Stages[0] -ne 'node'){return}
    if(@($Stages | Where-Object {$_ -notmatch '^[a-z][a-z-]{0,29}$'}).Count -or @($Stages | Select-Object -Unique).Count -ne $Stages.Count){return}
    $State.stages=$Stages
}
function Set-CapriProgressFraction($State,[string]$Step,[double]$Fraction) {
    $index=[Array]::IndexOf($State.stages,$Step)
    if($index -lt 0 -or [double]::IsNaN($Fraction) -or [double]::IsInfinity($Fraction)){return}
    # Keep bootstrap at 10%. Distribute the remaining share among the actual
    # selected steps and round boundaries to the nearest five points.
    $start=if($index -eq 0){0}else{5*[Math]::Round((10+90*($index-1)/($State.stages.Count-1))/5)}
    $end=if($index -eq 0){10}else{5*[Math]::Round((10+90*$index/($State.stages.Count-1))/5)}
    $bounded=[Math]::Min(1.0,[Math]::Max(0.0,$Fraction))
    $value=[Math]::Min(99.0,$start+($end-$start)*$bounded)
    if($value -gt $State.fractionalValue){
        $State.fractionalValue=$value
        $State.value=[int][Math]::Floor($value)
        $State.advanced=[DateTime]::UtcNow
    }
}
function Set-CapriProgressPaused($State,[bool]$Paused,[DateTime]$Now=[DateTime]::UtcNow) {
    if($Paused -and -not $State.pauseStarted){$State.pauseStarted=$Now}
    elseif(-not $Paused -and $State.pauseStarted){
        $seconds=($Now-$State.pauseStarted).TotalSeconds
        $State.pausedSeconds+=$seconds
        $State.advanced=$State.advanced.AddSeconds($seconds)
        $State.lastLog=$State.lastLog.AddSeconds($seconds)
        if($State.transferEta){$State.transferEtaAt=$State.transferEtaAt.AddSeconds($seconds)}
        $State.pauseStarted=$null
    }
}
function Get-CapriProgressEta($State,[DateTime]$Now=[DateTime]::UtcNow) {
    if($State.complete -or $State.pauseStarted -or $State.value -lt 10 -or ($Now-$State.advanced).TotalSeconds -gt 30){return}
    $elapsed=($Now-$State.started).TotalSeconds-$State.pausedSeconds
    if($elapsed -lt 10){return}
    $seconds=$elapsed*(100-$State.fractionalValue)/$State.fractionalValue
    $sampleAge=($Now-$State.transferEtaAt).TotalSeconds
    if($State.transferEta -and $sampleAge -le 15){
        $seconds=[Math]::Max($seconds,$State.transferEta-$sampleAge)
    }
    if($seconds -gt 86400){return}
    # Coarse units reflect an estimate across disk work and network transfers.
    return [int][Math]::Max(5,[Math]::Ceiling($seconds/5)*5)
}
function Format-CapriProgressTime([int]$Seconds) {
    if($Seconds -ge 3600){return [TimeSpan]::FromSeconds($Seconds).ToString('h\:mm\:ss')}
    return [TimeSpan]::FromSeconds($Seconds).ToString('m\:ss')
}
