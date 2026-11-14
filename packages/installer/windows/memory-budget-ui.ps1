# SPDX-License-Identifier: GPL-3.0-only
# Fixed above navigation: estimates stay visible while the component list scrolls.
$budgetPanel=New-Object Capri.Setup.Cyberpunk.Panel
$budgetPanel.BackColor=[Drawing.Color]::FromArgb(231,241,243)
$form.Controls.Add($budgetPanel)
$budgetTitle=New-Object Capri.Setup.Cyberpunk.Label;$budgetPanel.Controls.Add($budgetTitle)
$budgetHelp=New-Object Capri.Setup.Cyberpunk.Label;$budgetPanel.Controls.Add($budgetHelp)
$budgetInfo=New-CapriInfoButton 'memory' ''
$budgetPanel.Controls.Add($budgetInfo)
$budgetRefresh=New-Object Capri.Setup.Cyberpunk.Button;$budgetRefresh.FlatStyle='Flat';$budgetPanel.Controls.Add($budgetRefresh)
$budgetRows=@{}
foreach($kind in @('ram','vram')){
    $label=New-Object Capri.Setup.Cyberpunk.Label;$budgetPanel.Controls.Add($label)
    $detail=New-Object Capri.Setup.Cyberpunk.Label;$budgetPanel.Controls.Add($detail)
    $bar=New-Object Capri.Setup.Cyberpunk.Panel;$budgetPanel.Controls.Add($bar)
    $bar.Add_Paint({param($sender,$eventArgs)
        $row=$sender.Tag;if(-not $row){return}
        $g=$eventArgs.Graphics;$w=$sender.ClientSize.Width;$h=$sender.ClientSize.Height
        $g.Clear([Drawing.Color]::FromArgb(23,49,61))
        if($null -eq $row.total -or $null -eq $row.available -or $row.total -le 0){return}
        $occupied=[Math]::Max(0,[Math]::Min($w,$w*($row.total-$row.available)/$row.total))
        $planned=[Math]::Max(0,[Math]::Min(($w-$occupied),($w*$row.estimate[1]/$row.total)))
        $gray=New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(73,98,113))
        $accent=New-Object Drawing.SolidBrush($(if($row.exceedsAvailable){[Drawing.Color]::FromArgb(255,196,94)}else{[Drawing.Color]::FromArgb(109,247,242)}))
        try{$g.FillRectangle($gray,0,0,[single]$occupied,[single]$h);$g.FillRectangle($accent,[single]$occupied,0,[single]$planned,[single]$h)}finally{$gray.Dispose();$accent.Dispose()}
    })
    $budgetRows[$kind]=@{label=$label;detail=$detail;bar=$bar}
}
function Layout-CapriMemoryBudget {
    $width=$budgetPanel.Width;$column=($width-(D 72))/2
    $budgetTitle.SetBounds((D 28),(D 8),($width-(D 240)),(D 26))
    $budgetInfo.SetBounds(($width-(D 204)),(D 6),(D 26),(D 26))
    $budgetRefresh.SetBounds(($width-(D 173)),(D 5),(D 145),(D 29))
    $i=0
    foreach($kind in @('ram','vram')){
        $x=(D 28)+$i*($column+(D 16));$row=$budgetRows[$kind]
        $row.label.SetBounds($x,(D 38),$column,(D 36))
        $row.bar.SetBounds($x,(D 78),$column,(D 8))
        $row.detail.SetBounds($x,(D 94),$column,(D 44));$i++
    }
    $budgetHelp.SetBounds((D 28),(D 143),($width-(D 56)),([Math]::Max(0,$budgetPanel.Height-(D 147))))
}
function Update-CapriMemoryBudgetView {
    if($script:page -notin @(3,4,5)){return}
    $selection=$options.Clone()
    $selection.router=$true
    if($script:fields.ContainsKey('profile')){$selection.profile=Selected-Capri 'profile'}
    if($script:fields.ContainsKey('conversationLanguage') -and $script:fields.conversationLanguage.Enabled){
        $selection.conversationLanguage=Selected-Capri 'conversationLanguage'
    }
    if($script:fields.ContainsKey('api')){$selection.inferenceMode=if($script:fields.api.Checked){'api'}else{'local'}}
    if($script:fields.ContainsKey('huggingface')){$selection.modelSource=if($script:fields.huggingface.Checked){'huggingface'}else{'catalog'}}
    if($script:page -eq 4 -and $script:fields.ContainsKey('voiceMode')){
        $selection.downloadModels=$script:fields.models.Checked
        $selection.recognition=$script:fields.recognition.Checked
        if($script:fields.voiceMode.SelectedIndex -lt 0){return}
        $selection.voiceMode=Selected-Capri 'voiceMode'
        $selection.voicePack=$selection.voiceMode -in @('bundled','custom')
    }
    if($selection.inferenceMode -eq 'api' -or $selection.modelSource -eq 'huggingface'){$selection.downloadModels=$false}
    $selection.installedModel=$selection.profile -match '^hf-[a-f0-9]{24}$'
    if($script:fields.ContainsKey('storageEstimate')){
        $script:fields.storageEstimate.Text=Format-CapriStorageEstimate (Get-CapriStorageEstimate $selection $manifest $storageCatalog $rocmVoice $hardware)
    }
    $unknown=$selection.inferenceMode -ne 'api' -and ($selection.modelSource -eq 'huggingface' -or $selection.installedModel)
    $script:memoryBudget=if($unknown){@{mode='unknown'}}else{Get-CapriMemoryBudget $selection $hardware $memoryEstimates}
    $budgetTitle.Text=(Text-Capri 'budgetTitle')+$(if($selection.inferenceMode -eq 'api'){' | API'}elseif($unknown){' | Hugging Face'}else{' | 32K | '+$script:memoryBudget.mode.ToUpperInvariant()})
    $budgetRefresh.Text=Text-Capri 'budgetRefresh'
    foreach($kind in @('ram','vram')){
        $controls=$budgetRows[$kind]
        $controls.bar.Visible=-not $unknown
        $controls.detail.Visible=-not $unknown
        if($unknown){$controls.label.Text=$kind.ToUpperInvariant()+' | '+(Text-Capri 'budgetUse')+': ?';continue}
        $row=$script:memoryBudget[$kind]
        $controls.label.Text=$kind.ToUpperInvariant()+' | '+(Text-Capri 'budgetUse')+': '+(Format-CapriMemoryRange $row.estimate)
        $free=if($null -eq $row.available){Text-Capri 'unknown'}else{$row.available.ToString('0.0')+' GiB'}
        $after=if($null -eq $row.remaining){Text-Capri 'unknown'}else{Format-CapriMemoryRange $row.remaining}
        $controls.detail.Text=(Text-Capri 'budgetFree')+': '+$free+"`n"+(Text-Capri 'budgetAfter')+': '+$after
        $controls.detail.ForeColor=if($row.exceedsAvailable){[Drawing.Color]::FromArgb(155,57,20)}else{[Drawing.Color]::FromArgb(23,49,58)}
        $controls.bar.Tag=$row;$controls.bar.Invalidate()
        $controls.bar.AccessibleName=$controls.label.Text+'; '+$controls.detail.Text
    }
    $warning=-not $unknown -and ($script:memoryBudget.ram.exceedsAvailable -or $script:memoryBudget.vram.exceedsAvailable)
    $budgetInfo.AccessibleName=Text-Capri 'info.memoryTitle'
    $budgetInfo.AccessibleDescription=Text-Capri $(if($unknown){'budgetHuggingFaceUnknown'}else{'budgetHelp'})
    $budgetHelp.Text=if($warning){Text-Capri 'budgetWarning'}else{''}
    $budgetHelp.ForeColor=if($warning){[Drawing.Color]::FromArgb(155,57,20)}else{[Drawing.Color]::FromArgb(45,69,77)}
    Layout-CapriWizard
}
$budgetRefresh.Add_Click({
    $budgetRefresh.Enabled=$false
    try{Update-CapriMemorySnapshot $hardware;Update-CapriHardwareLabel;Update-CapriModelRecommendations;Update-CapriMemoryBudgetView;Update-CapriDiskReview;Fit-CapriPage}
    finally{$budgetRefresh.Enabled=$true}
})
