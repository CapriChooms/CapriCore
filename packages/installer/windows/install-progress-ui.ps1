# SPDX-License-Identifier: GPL-3.0-only
function Test-CapriUpdateTarget([string]$Target,[version]$Version) {
    # Caller validated the ownership and root through Assert-CapriTarget.
    $identityPath=Join-Path $Target '.capri-install.json'
    return (Test-Path -LiteralPath $identityPath -PathType Leaf) -and ([version](Read-CapriJson $identityPath).version -lt $Version)
}
function Get-CapriInstallStage([string]$Step) {
    if($Step -eq 'models' -and (-not $options.downloadModels -or $options.inferenceMode -eq 'api' -or $options.modelSource -eq 'huggingface')){
        return (Text-Capri 'inferenceMemory')
    }
    return (Text-Capri ('stages.'+$Step))
}
function Format-CapriInstallProgress {
    $progress=$script:installProgress
    $text=(Text-Capri 'progressOverall') -f $progress.value
    if($progress.pauseStarted){return $text+"`r`n"+(Text-Capri 'pauseHelp')}
    if(-not $progress.complete){
        $eta=Get-CapriProgressEta $progress
        $text+='  |  '+$(if($null -ne $eta){(Text-Capri 'progressEta') -f (Format-CapriProgressTime $eta)}else{Text-Capri 'progressEstimating'})
    }
    if($progress.transfer){$text+="`r`n"+$progress.transfer}
    return $text
}
function Update-CapriDownloadProgress($Event) {
    try {
        if(-not $Event.PSObject.Properties['received']){return}
        $received=[double]$Event.received
        $total=if($Event.PSObject.Properties['total']){[double]$Event.total}else{0}
        if([double]::IsNaN($received) -or [double]::IsInfinity($received) -or $received -lt 0 -or [double]::IsNaN($total) -or [double]::IsInfinity($total)){return}
        $progress=$script:installProgress
        $amount=([Math]::Round($received/1e6,1)).ToString()
        if($total -gt 0){
            $fraction=if($Event.PSObject.Properties['stageFraction']){[double]$Event.stageFraction}else{$received/$total}
            if([double]::IsNaN($fraction) -or [double]::IsInfinity($fraction) -or $fraction -lt 0 -or $fraction -gt 1){return}
            Set-CapriProgressFraction $progress $(if($Event.PSObject.Properties['step']){$Event.step}else{$progress.step}) (0.9*$fraction)
            $amount+=' / '+([Math]::Round($total/1e6,1)).ToString()
        }
        $progress.transferEta=$null
        if($Event.PSObject.Properties['secondsRemaining']){
            $estimate=[double]$Event.secondsRemaining
            if($estimate -gt 0 -and $estimate -le 86400){$progress.transferEta=$estimate;$progress.transferEtaAt=[DateTime]::UtcNow}
        }
        $progress.transfer=(Text-Capri 'progressTransferred') -f ($amount+' MB')
    }catch{$script:uiDiagnostics.Record('invalid-download-progress',($_|Out-String))}
}
function Read-CapriInstallProgress([bool]$Paused) {
    $logBatch=New-Object 'Collections.Generic.List[string]'
    $progress=$script:installProgress
    $now=[DateTime]::UtcNow
    Set-CapriProgressPaused $progress $Paused $now
    $previousStage=$script:fields.stage.Text
    $previousText=$script:fields.progressText.Text
    foreach($line in $script:eventsCursor.Read()){
        if(-not $line.Trim()){continue}
        try{$event=$line|ConvertFrom-Json}catch{$script:uiDiagnostics.Record('invalid-worker-event',($_|Out-String));continue}
        switch($event.type){
            'stage-plan'{Set-CapriProgressPlan $progress $event.stages}
            'stage'{
                $progress.step=[string]$event.step
                $progress.transfer='';$progress.activity='';$progress.transferEta=$null
                Set-CapriProgressFraction $progress $progress.step 0
                $logBatch.Add((Get-CapriInstallStage $progress.step))
            }
            'stage-complete'{
                Set-CapriProgressFraction $progress $event.step 1
                $progress.transfer='';$progress.activity='';$progress.transferEta=$null
                $logBatch.Add(((Text-Capri 'progressStageComplete') -f (Get-CapriInstallStage $event.step)))
            }
            'activity'{
                $key='progressActivity.'+[string]$event.action
                $description=Text-Capri $key
                if($description -ne $key){
                    $component=if($event.PSObject.Properties['component']){Text-Capri ('progressComponent.'+[string]$event.component)}else{''}
                    $progress.activity=$description -f $component
                    $progress.transfer='';$progress.transferEta=$null
                    $logBatch.Add($progress.activity)
                }
            }
            'download'{
                Update-CapriDownloadProgress $event
                if($progress.transfer -and ($now-$progress.lastTransferLog).TotalSeconds -ge 5){
                    $logBatch.Add($progress.transfer)
                    $progress.lastTransferLog=$now
                }
            }
            'percent'{
                Set-CapriProgressFraction $progress $(if($event.PSObject.Properties['step']){$event.step}else{$progress.step}) (0.9*[double]$event.percent/100)
            }
            'fraction'{Set-CapriProgressFraction $progress $event.step (0.9*[double]$event.fraction)}
            'log'{
                $logBatch.Add([string]$event.message)
                if(-not $script:networkAdviceShown -and (Test-CapriSetupNetworkError ([string]$event.message))){
                    $script:networkAdviceShown=$true
                    $logBatch.Add((Text-Capri 'networkHelp'))
                }
            }
            'complete'{$script:result=$event;$progress.complete=$true;$progress.value=100;$progress.transfer='';$progress.activity=''}
            'failed'{$script:failure=Capri-SetupError $event.message}
            'error'{$code=if($event.PSObject.Properties['code']){$event.code}else{''};$script:failure=Capri-SetupError $event.message $code}
            'cancelled'{$script:failure=Text-Capri 'installationCancelled'}
            'ui-reader-error'{$script:uiDiagnostics.Record('invalid-worker-event',[string]$event.message);$script:uiLease.Control('pause');$script:fields.recovery.Text=Text-Capri 'uiError'}
        }
    }
    if(-not $Paused -and -not $progress.complete -and $progress.step -and -not $logBatch.Count -and ($now-$progress.lastLog).TotalSeconds -ge 15){
        $active=Format-CapriProgressTime ([Math]::Max(0,($now-$progress.started).TotalSeconds-$progress.pausedSeconds))
        $logBatch.Add(((Text-Capri 'progressStillWorking') -f $active,$(if($progress.activity){$progress.activity}else{Get-CapriInstallStage $progress.step})))
    }
    if($logBatch.Count){
        $progress.lastLog=$now
        $script:fields.log.AppendText(($logBatch -join "`r`n")+"`r`n")
        if($script:fields.log.TextLength -gt 20000){$script:fields.log.Text=$script:fields.log.Text.Substring($script:fields.log.TextLength-16000)}
        $script:fields.log.SelectionStart=$script:fields.log.TextLength
        $script:fields.log.ScrollToCaret()
    }
    $script:fields.stage.Text=if($progress.step){
        (Get-CapriInstallStage $progress.step)+$(if($progress.activity){"`r`n"+$progress.activity})
    }else{Text-Capri 'working'}
    $script:fields.progress.Value=$progress.value
    $script:fields.progressText.Text=Format-CapriInstallProgress
    if($previousStage -ne $script:fields.stage.Text -or ($previousText -split "`n").Count -ne ($script:fields.progressText.Text -split "`n").Count){Fit-CapriPage}
}
