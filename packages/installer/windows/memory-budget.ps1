# SPDX-License-Identifier: GPL-3.0-only
# Uses the same versioned planning ranges as the runtime; no model is loaded.
function Format-CapriMemoryRange($Range) {
    return (@($Range|ForEach-Object{([Math]::Max(0.0,[double]$_)).ToString('0.0')}) -join ' - ')+' GiB'
}
function Get-CapriRequiredRam($Profile,$Hardware,$Estimates) {
    $model=$Estimates.models.PSObject.Properties[$Profile.id].Value
    $threshold=if($Profile.recommendedVramGiB -gt 0){$Profile.recommendedVramGiB}else{[Math]::Ceiling($model.vram[1])}
    if($Hardware.vramGiB -gt 0 -and $Hardware.vramGiB -ge ($threshold-0.125)){return $model.gpuSystemRamGiB}
    return $Profile.ramGiB
}
function Get-CapriMemoryBudget($Selection,$Hardware,$Estimates) {
    $modelProperty=$Estimates.models.PSObject.Properties[$Selection.profile]
    if(-not $modelProperty){throw 'Unknown model memory estimate'}
    $model=$modelProperty.Value;$gpu=$Hardware.vramGiB -gt 0
    $freeVram=if($gpu -and $null -ne $Hardware.availableVramGiB){$Hardware.availableVramGiB}else{$null}
    $gpuBudget=if($null -ne $freeVram){$freeVram}else{$Hardware.vramGiB}
    $ram=@([double]$Estimates.base.ram[0],[double]$Estimates.base.ram[1])
    $vram=if($gpu){@([double]$Estimates.base.vram[0],[double]$Estimates.base.vram[1])}else{@(0.0,0.0)}
    $parts=New-Object Collections.Generic.List[object]
    if($Selection.downloadModels){
        $parts.Add(@{ram=$(if($gpu){$model.hostRam}else{$model.cpuRam});vram=$(if($gpu){$model.vram}else{@(0,0)})})
    }
    $english=$Selection.conversationLanguage -eq 'en'
    if($Selection.recognition){$parts.Add($(if($english){$Estimates.recognitionEnglish}else{$Estimates.recognitionMultilingual}))}
    if($Selection.router){$parts.Add($Estimates.router)}
    if($Selection.voiceMode -eq 'qwen'){$parts.Add($Estimates.voiceQwenCpu)}
    if($Selection.voiceMode -eq 'qwen-ru'){$parts.Add($Estimates.voiceQwenRussianCpu)}
    foreach($part in $parts){for($i=0;$i -lt 2;$i++){$ram[$i]+=$part.ram[$i];$vram[$i]+=$part.vram[$i]}}
    if($Selection.voiceMode -and $Selection.voiceMode -notin @('off','qwen','qwen-ru')){
        $voice=if($english){$Estimates.voiceEnglish}else{$Estimates.voiceMultilingual}
        for($i=0;$i -lt 2;$i++){
            if(-not $gpu){$ram[$i]+=$voice.cpuRam[$i]}
            else{
                $decoder=if(($gpuBudget-$vram[$i]-$voice.cpuDecoder.vram[$i]) -lt $Estimates.voiceDecoderPromotionGiB){$voice.cpuDecoder}else{$voice}
                $ram[$i]+=$decoder.ram[$i];$vram[$i]+=$decoder.vram[$i]
            }
        }
    }
    $offload=$Selection.downloadModels -and $gpu -and $vram[1] -gt $gpuBudget
    if($offload){for($i=0;$i -lt 2;$i++){
        $fraction=[Math]::Min(1.0,[Math]::Max(0.0,([double]$vram[$i]-[double]$gpuBudget))/[double]$model.vram[$i])
        $ram[$i]+=$fraction*[Math]::Max(0.0,([double]$model.cpuRam[$i]-[double]$model.hostRam[$i]))
    }}
    function Row($Range,$Total,$Available) {
        $known=$null -ne $Available -and -not([double]::IsNaN($Available) -or [double]::IsInfinity($Available)) -and $Available -ge 0
        $limit=if($known){$Available}else{$Total}
        return @{estimate=@($Range|ForEach-Object{[Math]::Round($_,1,[MidpointRounding]::AwayFromZero)});total=$Total;available=$(if($known){$Available}else{$null});remaining=$(if($known){@([Math]::Round(($Available-$Range[1]),1,[MidpointRounding]::AwayFromZero),[Math]::Round(($Available-$Range[0]),1,[MidpointRounding]::AwayFromZero))}else{$null});exceedsAvailable=($null -ne $limit -and $Range[1] -gt $limit)}
    }
    return @{contextTokens=$Estimates.contextTokens;mode=$(if($gpu){'gpu'}else{'cpu'});offload=[bool]$offload;ram=(Row $ram $Hardware.ramGiB $Hardware.availableRamGiB);vram=(Row $vram $(if($gpu){$Hardware.vramGiB}else{$null}) $freeVram)}
}
function Update-CapriMemorySnapshot($Hardware) {
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $info=New-Object Microsoft.VisualBasic.Devices.ComputerInfo
        $Hardware.availableRamGiB=$info.AvailablePhysicalMemory/1GB
    } catch {$Hardware.availableRamGiB=$null}
    $Hardware.vramGiB=0
    $Hardware.availableVramGiB=$null
    $Hardware.selectedGpu=$null
    $Hardware.gpus=@()
    try {
        . (Join-Path $PSScriptRoot 'gpu-inventory.ps1')
        $Hardware.gpus=@(Get-CapriGpuInventory)
        $names=@(@($Hardware.gpu -split ',\s*')+@($Hardware.gpus|ForEach-Object{$_.name})|Where-Object{$_}|Select-Object -Unique)
        $Hardware.gpu=$names -join ', '
        $dedicated=@($Hardware.gpus|Where-Object{
            $_.memoryKind -eq 'dedicated' -and $null -ne $_.vramMiB -and
            -not([double]::IsNaN([double]$_.vramMiB) -or [double]::IsInfinity([double]$_.vramMiB)) -and $_.vramMiB -gt 0
        }|Sort-Object vramMiB -Descending)
        if($dedicated.Count){
            $Hardware.selectedGpu=$dedicated[0]
            $Hardware.vramGiB=[double]$dedicated[0].vramMiB/1024
            $free=$dedicated[0].freeVramMiB
            if($null -ne $free -and -not([double]::IsNaN([double]$free) -or [double]::IsInfinity([double]$free)) -and $free -ge 0 -and $free -le $dedicated[0].vramMiB){$Hardware.availableVramGiB=[double]$free/1024}
        }
    } catch {}
    # NVIDIA's driver can provide more precise telemetry for the selected NVIDIA
    # adapter, or recover detection if Windows inventory is unavailable.
    if($Hardware.selectedGpu -and $Hardware.selectedGpu.vendor -ne 'nvidia'){return}
    $smi=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if(-not $smi){return}
    $process=New-Object Diagnostics.Process
    try {
        $process.StartInfo=New-Object Diagnostics.ProcessStartInfo
        $process.StartInfo.FileName=$smi.Source
        $process.StartInfo.Arguments='--query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits'
        $process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true
        $process.StartInfo.RedirectStandardOutput=$true;$process.StartInfo.RedirectStandardError=$true
        $null=$process.Start()
        $output=$process.StandardOutput.ReadToEndAsync()
        $errors=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(3000)){$process.Kill();return}
        if($process.ExitCode -ne 0){return}
        $cards=@($output.GetAwaiter().GetResult() -split '\r?\n'|ForEach-Object {
            if($_ -match '^\s*(.+),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\s*$'){
                $name=$Matches[1].Trim()
                $total=[double]::Parse($Matches[2],[Globalization.CultureInfo]::InvariantCulture)
                $free=[double]::Parse($Matches[3],[Globalization.CultureInfo]::InvariantCulture)
                if($total -gt 0 -and $free -ge 0 -and $free -le $total -and (-not $Hardware.selectedGpu -or $name -eq $Hardware.selectedGpu.name)){[PSCustomObject]@{name=$name;total=$total;free=$free}}
            }
        }|Sort-Object total -Descending)
        if($cards.Count){
            $card=$cards[0]
            $Hardware.vramGiB=$card.total/1024;$Hardware.availableVramGiB=$card.free/1024
            $Hardware.selectedGpu=[PSCustomObject]@{name=$card.name;vendor='nvidia';vramMiB=$card.total;freeVramMiB=$card.free;memoryKind='dedicated';luid=$null}
            if(-not @($Hardware.gpus|Where-Object{$_.name -eq $card.name}).Count){$Hardware.gpus+=@($Hardware.selectedGpu)}
            if(-not $Hardware.gpu){$Hardware.gpu=$card.name}
        }
    } catch {} finally {$process.Dispose()}
}
