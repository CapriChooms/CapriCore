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
        $plannedMin=[Math]::Max(0,[Math]::Min(($w-$occupied),($w*$row.estimate[0]/$row.total)))
        $plannedMax=[Math]::Max($plannedMin,[Math]::Min(($w-$occupied),($w*$row.estimate[1]/$row.total)))
        $gray=New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(73,98,113))
        $color=if($row.exceedsAvailable){[Drawing.Color]::FromArgb(255,196,94)}else{[Drawing.Color]::FromArgb(109,247,242)}
        $accent=New-Object Drawing.SolidBrush($color)
        $range=New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(130,$color))
        try{
            $g.FillRectangle($gray,0,0,[single]$occupied,[single]$h)
            $g.FillRectangle($accent,[single]$occupied,0,[single]$plannedMin,[single]$h)
            $g.FillRectangle($range,[single]($occupied+$plannedMin),0,[single]($plannedMax-$plannedMin),[single]$h)
        }finally{$gray.Dispose();$accent.Dispose();$range.Dispose()}
    })
    $budgetRows[$kind]=@{label=$label;detail=$detail;bar=$bar}
}
function Get-CapriMemoryBudgetLayout([int]$Width) {
    $column=[Math]::Max(1,[int][Math]::Floor(($Width-(D 72))/2))
    $unknown=$script:memoryBudget -and $script:memoryBudget.mode -eq 'unknown'
    $flags=[Windows.Forms.TextFormatFlags]::WordBreak -bor [Windows.Forms.TextFormatFlags]::NoPrefix
    $detailsHeight=D 55
    if(-not $unknown){
        foreach($kind in @('ram','vram')){
            $detail=$budgetRows[$kind].detail
            $height=[Windows.Forms.TextRenderer]::MeasureText($detail.Text,$detail.Font,(New-Object Drawing.Size($column,10000)),$flags).Height+(D 5)
            $detailsHeight=[Math]::Max($detailsHeight,$height)
        }
    }
    $rowsBottom=if($unknown){D 67}else{(D 85)+$detailsHeight}
    $helpHeight=0
    if($budgetHelp.Text){
        $helpWidth=[Math]::Max((D 100),($Width-(D 56)))
        $helpHeight=[Windows.Forms.TextRenderer]::MeasureText($budgetHelp.Text,$budgetHelp.Font,(New-Object Drawing.Size($helpWidth,10000)),$flags).Height+(D 5)
    }
    return @{column=$column;detailsHeight=$detailsHeight;rowsBottom=$rowsBottom;helpHeight=$helpHeight;height=$rowsBottom+$helpHeight+(D 10)}
}
function Layout-CapriMemoryBudget($Layout) {
    $width=$budgetPanel.Width;$column=$Layout.column
    $refreshWidth=[Math]::Max((D 145),([Windows.Forms.TextRenderer]::MeasureText($budgetRefresh.Text,$budgetRefresh.Font).Width+(D 20)))
    $refreshWidth=[Math]::Min($refreshWidth,[int]($width*0.42))
    $refreshLeft=$width-(D 28)-$refreshWidth
    $infoLeft=$refreshLeft-(D 31)
    $budgetTitle.SetBounds((D 28),(D 8),([Math]::Max(1,($infoLeft-(D 34)))),(D 26))
    $budgetInfo.SetBounds($infoLeft,(D 6),(D 26),(D 26))
    $budgetRefresh.SetBounds($refreshLeft,(D 5),$refreshWidth,(D 29))
    $i=0
    foreach($kind in @('ram','vram')){
        $x=(D 28)+$i*($column+(D 16));$row=$budgetRows[$kind]
        $row.label.SetBounds($x,(D 37),$column,(D 28))
        $row.bar.SetBounds($x,(D 67),$column,(D 8))
        $row.detail.SetBounds($x,(D 85),$column,$Layout.detailsHeight);$i++
    }
    $budgetHelp.SetBounds((D 28),$Layout.rowsBottom,($width-(D 56)),$Layout.helpHeight)
}
function Update-CapriMemoryBudgetView {
    if($script:page -notin @('device','model','voice','components','review')){return}
    $selection=$options.Clone()
    $selection.router=$true
    if($script:fields.ContainsKey('languageDevice') -and $script:fields.languageDevice.Enabled -and $script:fields.languageDevice.SelectedIndex -ge 0){
        $selection.languageDevice=Selected-Capri 'languageDevice'
    }
    if(-not $selection['languageDevice'] -or $selection.languageDevice -eq 'keep'){$selection.languageDevice=$script:currentLanguageDevice}
    if($script:fields.ContainsKey('profile') -and $script:fields.profile.SelectedIndex -ge 0){$selection.profile=Selected-Capri 'profile'}
    if($script:fields.ContainsKey('conversationLanguage') -and $script:fields.conversationLanguage.Enabled){
        $selection.conversationLanguage=Selected-Capri 'conversationLanguage'
    }
    if($script:fields.ContainsKey('api')){$selection.inferenceMode=if($script:fields.api.Checked){'api'}else{'local'}}
    if($script:fields.ContainsKey('huggingface')){$selection.modelSource=if($script:fields.huggingface.Checked){'huggingface'}else{'catalog'}}
    if($script:fields.ContainsKey('models')){$selection.downloadModels=$script:fields.models.Checked}
    if($script:fields.ContainsKey('recognition')){$selection.recognition=$script:fields.recognition.Checked}
    if($script:fields.ContainsKey('voiceMode') -and $script:fields.voiceMode.SelectedIndex -ge 0){
        $selection.voiceMode=Selected-Capri 'voiceMode'
        $selection.voicePack=$selection.voiceMode -in @('bundled','custom')
    }
    if($selection.inferenceMode -eq 'api'){$selection.profile='minimal'}
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
        $knownUsage=$null -ne $row.available -and $null -ne $row.total -and $row.total -gt 0
        $occupied=if($knownUsage){[Math]::Max(0.0,($row.total-$row.available)).ToString('0.0')+' GiB'}else{Text-Capri 'unknown'}
        $free=if($knownUsage){$row.available.ToString('0.0')+' / '+$row.total.ToString('0.0')+' GiB'}elseif($null -ne $row.available){$row.available.ToString('0.0')+' GiB'}else{Text-Capri 'unknown'}
        $after=if($null -eq $row.remaining){Text-Capri 'unknown'}else{Format-CapriMemoryRange $row.remaining}
        $controls.detail.Text=(Text-Capri 'budgetInUse')+': '+$occupied+"`n"+(Text-Capri 'budgetFree')+': '+$free+"`n"+(Text-Capri 'budgetAfter')+': '+$after
        $controls.detail.ForeColor=if($row.exceedsAvailable){[Drawing.Color]::FromArgb(155,57,20)}else{[Drawing.Color]::FromArgb(23,49,58)}
        $controls.bar.Tag=$row;$controls.bar.Invalidate()
        $controls.bar.AccessibleName=$controls.label.Text+'; '+$controls.detail.Text
    }
    $warning=-not $unknown -and ($script:memoryBudget.ram.exceedsAvailable -or $script:memoryBudget.vram.exceedsAvailable)
    $budgetInfo.AccessibleName=Text-Capri 'info.memoryTitle'
    $budgetInfo.AccessibleDescription=Text-Capri $(if($unknown){'budgetHuggingFaceUnknown'}else{'budgetHelp'})
    $budgetHelp.Text=if($unknown){Text-Capri 'budgetHuggingFaceUnknown'}elseif($warning){Text-Capri 'budgetWarning'}else{''}
    $budgetHelp.ForeColor=if($warning){[Drawing.Color]::FromArgb(155,57,20)}else{[Drawing.Color]::FromArgb(45,69,77)}
    Layout-CapriWizard
}
$budgetRefresh.Add_Click({
    $budgetRefresh.Enabled=$false
    try{Update-CapriMemorySnapshot $hardware;Update-CapriHardwareLabel;Update-CapriModelRecommendations;Update-CapriMemoryBudgetView;Update-CapriDiskReview;Fit-CapriPage}
    finally{$budgetRefresh.Enabled=$true}
})
