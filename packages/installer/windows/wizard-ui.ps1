# Loaded by wizard.ps1, which owns DPI initialization, diagnostics and the recovery lease.
# SPDX-License-Identifier: GPL-3.0-only
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'install-discovery.ps1')
. (Join-Path $PSScriptRoot 'localization.ps1')
. (Join-Path $PSScriptRoot 'memory-budget.ps1')
. (Join-Path $PSScriptRoot 'model-language-recommendations.ps1')
. (Join-Path $PSScriptRoot 'storage-estimate.ps1')
. (Join-Path $PSScriptRoot 'install-progress.ps1')
. (Join-Path $PSScriptRoot 'install-progress-ui.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
. (Join-Path $PSScriptRoot 'cyberpunk-theme.ps1')
$sourceRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$manifest=Read-CapriJson (Join-Path $sourceRoot 'config/installer.json')
$storageCatalog=Read-CapriStorageCatalog $sourceRoot
$memoryEstimates=Read-CapriJson (Join-Path $sourceRoot 'config/memory-estimates.json')
$modelBenchmark=$null
$modelBenchmarkPath=Join-Path $sourceRoot 'packages/runtime/src/hardware/model-language-benchmark.json'
try{
    if(Test-Path -LiteralPath $modelBenchmarkPath){$modelBenchmark=Read-CapriJson $modelBenchmarkPath}
}catch{
    $script:uiDiagnostics.Record('model-benchmark-unavailable',$_.Exception.GetType().Name)
}
$catalog=Read-CapriJson (Join-Path $sourceRoot 'apps/shared/languages.json')
$locales=Read-CapriJson (Join-Path $sourceRoot 'config/installer-languages.json')
$interfaceLocales=Read-CapriJson (Join-Path $sourceRoot 'config/interface-locales.json')
$translations=Read-CapriJson (Join-Path $sourceRoot 'config/installer-text.json')
$progressTranslations=Read-CapriJson (Join-Path $sourceRoot 'config/installer-progress-text.json')
$script:uiDiagnostics.Record('ui-build',((Read-CapriJson (Join-Path $sourceRoot 'config/release.json')).tag))
$installerLanguage=Get-CapriInstallerCulture $(if($Language){$Language}else{[Globalization.CultureInfo]::CurrentUICulture.Name}) $locales
$hardware=@{ramGiB=0;
    threads=[Environment]::ProcessorCount;
    gpu='';
    vramGiB=0;availableRamGiB=$null;availableVramGiB=$null}
try{$hardware.ramGiB=[Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1);
    $hardware.gpu=((Get-CimInstance Win32_VideoController|ForEach-Object{$_.Name}) -join ', ')}catch{}
Update-CapriMemorySnapshot $hardware
if($hardware.ramGiB -eq 0){try{Add-Type -AssemblyName Microsoft.VisualBasic;
        $memory=New-Object Microsoft.VisualBasic.Devices.ComputerInfo;
        $hardware.ramGiB=[Math]::Round($memory.TotalPhysicalMemory/1GB,1)}catch{}}
$voiceGpu=($hardware.gpu -match 'NVIDIA') -or (([Environment]::OSVersion.Version.Build -ge 22000) -and ($hardware.gpu -match '\b(?:RX (?:9070(?: XT)?|9060 XT|7900 XTX|7700)|(?:AI )?PRO (?:R9700|W7900(?: Dual Slot)?))\b'))
$rocmVoice=$hardware.gpu -notmatch 'NVIDIA' -and $hardware.gpu -match '\b(?:RX (?:9070(?: XT)?|9060 XT|7900 XTX|7700)|(?:AI )?PRO (?:R9700|W7900(?: Dual Slot)?))\b'
if(-not $BundledVoicePack -and (Test-Path -LiteralPath (Join-Path $sourceRoot '.bundled-voice/voice-profile.json'))){$BundledVoicePack=Join-Path $sourceRoot '.bundled-voice'}
if($BundledVoicePack){$BundledVoicePack=Assert-CapriVoicePack $BundledVoicePack}
$qwenVoice=@((Read-CapriJson (Join-Path $sourceRoot 'config/tts-catalog.json')).models|Where-Object{$_.id -eq 'qwen3-tts-0.6b-base'})[0]
$recommendation='minimal'
foreach($candidate in @($manifest.profiles|Where-Object{$_.id -in @('balanced','desktop','quality')})){
    $ram=Get-CapriRequiredRam $candidate $hardware $memoryEstimates
    if((Test-CapriProfileRam $hardware.ramGiB $ram) -and ($candidate.id -eq 'balanced' -or $hardware.vramGiB -ge ($candidate.recommendedVramGiB-0.125))){$recommendation=$candidate.id}
}
$version=(Read-CapriJson (Join-Path $sourceRoot 'package.json')).version
$script:installations=@(if(-not $VerificationDirectory){Get-CapriInstallations|Sort-Object @{Expression={[version]$_.version};Descending=$true},path})
$options=@{schemaVersion=1;
    target=(Get-CapriDefaultTarget);
    profile=$recommendation;
    inferenceMode='local';
    modelSource='catalog';
    interfaceLanguage=$installerLanguage;
    conversationLanguage='en';
    recognition=$true;
    router=$true;
    downloadModels=$true;
    desktopShortcut=$true;
    startMenuShortcut=$true;
    voiceMode=$(if($BundledVoicePack -and $voiceGpu){'bundled'}else{'off'});
    voicePack=$(if($BundledVoicePack -and $voiceGpu){$BundledVoicePack}else{''});
    bundledVoicePack=$(if($BundledVoicePack){$BundledVoicePack}else{''});
    acceptLicense=$false;
    acceptDownloads=$false}
$initialInstallation=Select-CapriInitialInstallation $script:installations ([version]$version)
if($initialInstallation){$options.target=$initialInstallation.path}
$script:page=0;
$script:settingsTarget=$null
$script:fields=@{};
$script:worker=$null;
$script:session=$null;
$script:result=$null;
$script:launchOnFinish=$true
$script:preloadOnFirstLaunch=$true
$script:failure='';
$script:networkAdviceShown=$false
$script:cancelRequested=$false
$script:recovered=$false;$script:superseded=$false;$script:progressView=$null;$script:lastPollError=''
$options['updating']=$false
$script:installProgress=New-CapriInstallProgress
$script:lastHeartbeat=[DateTime]::MinValue
$script:displayDpi=if($VerificationDirectory -and $VerificationDpi){$VerificationDpi}else{[Capri.Setup.Display]::Dpi([IntPtr]::Zero)}
if($script:displayDpi -lt 96 -or $script:displayDpi -gt 384){throw 'Unsupported display DPI.'}
$script:displayScale=$script:displayDpi/96.0
function D([double]$Value){return [int][Math]::Round($Value*$script:displayScale)}
function New-CapriFont([double]$Points,[Drawing.FontStyle]$Style='Regular'){
    return New-Object Drawing.Font('Segoe UI',[single]($Points*96.0/72*$script:displayScale),$Style,[Drawing.GraphicsUnit]::Pixel)
}
function Set-CapriBounds($Control,[double]$X,[double]$Y,[double]$Width,[double]$Height){$Control.SetBounds((D $X),(D $Y),(D $Width),(D $Height))}
$form=New-Object Capri.Setup.WizardForm;
$form.Icon=New-Object Drawing.Icon -ArgumentList (Join-Path $sourceRoot 'assets/default/app.ico');
$form.ClientSize=New-Object Drawing.Size((D 920),(D 680));
$form.MinimumSize=New-Object Drawing.Size((D 936),(D 719));
$form.StartPosition='CenterScreen';
$form.Font=New-CapriFont 10;
$form.BackColor=[Drawing.Color]::FromArgb(247,249,252);
$form.AutoScaleMode='None'
$sidebar=New-Object Capri.Setup.Cyberpunk.Panel;
$sidebar.Dock='None';
$sidebar.Width=205;
$sidebar.BackColor=[Drawing.Color]::FromArgb(14,24,39);
$form.Controls.Add($sidebar)
$brand=New-Object Capri.Setup.Cyberpunk.Label;
$brand.Text='CAPRI v'+$version;
$brand.Font=New-CapriFont 19 'Bold';
$brand.ForeColor=[Drawing.Color]::FromArgb(67,225,225);
Set-CapriBounds $brand (24) (26) (175) (48);
$sidebar.Controls.Add($brand)
$releaseLabel=New-Object Capri.Setup.Cyberpunk.Label
$releaseLabel.Text='v'+$version
$releaseLabel.Visible=$false
$releaseLabel.Font=New-CapriFont 9
$releaseLabel.ForeColor=[Drawing.Color]::FromArgb(154,173,190)
Set-CapriBounds $releaseLabel (25) (80) (175) (36)
$sidebar.Controls.Add($releaseLabel)
$authorLabel=New-Object Capri.Setup.Cyberpunk.Label
$authorLabel.Text='by Overyx'
$authorLabel.Font=New-CapriFont 9
$authorLabel.ForeColor=$releaseLabel.ForeColor
Set-CapriBounds $authorLabel 25 76 175 24
$sidebar.Controls.Add($authorLabel)
$steps=@();
for($i=0;
$i -lt 8;
$i++){$label=New-Object Capri.Setup.Cyberpunk.Label;
    Set-CapriBounds $label (24) ((125+$i*48)) (175) (44);
    $label.Font=New-CapriFont 9;
    $sidebar.Controls.Add($label);
    $steps+=$label}
$footer=New-Object Capri.Setup.Cyberpunk.Panel;
$footer.Dock='None';
$footer.Height=70;
$form.Controls.Add($footer)
$back=New-Object Capri.Setup.Cyberpunk.Button;
Set-CapriBounds $back (365) (19) (110) (33);
$back.Anchor='Bottom,Right';
$footer.Controls.Add($back)
$next=New-Object Capri.Setup.Cyberpunk.Button;
Set-CapriBounds $next (485) (19) (110) (33);
$next.Anchor='Bottom,Right';
$next.BackColor=[Drawing.Color]::FromArgb(0,108,119);
$next.ForeColor=[Drawing.Color]::White;
$next.FlatStyle='Flat';
$footer.Controls.Add($next)
$cancel=New-Object Capri.Setup.Cyberpunk.Button;
Set-CapriBounds $cancel (605) (19) (95) (33);
$cancel.Anchor='Bottom,Right';
$footer.Controls.Add($cancel)
$pause=New-Object Capri.Setup.Cyberpunk.Button
Set-CapriBounds $pause (20) (19) (145) (33)
$pause.Visible=$false
$footer.Controls.Add($pause)
$pause.Add_Click({
    if(-not $script:session -or -not $script:uiLease){return}
    $pausePath=Join-Path $script:session 'pause'
    if(Test-Path -LiteralPath $pausePath){
        $script:uiLease.Control('resume')
        $pause.Text=Text-Capri 'pause'
    }else{
        $script:uiLease.Control('pause')
        $pause.Text=Text-Capri 'resume'
    }
    Set-CapriProgressPaused $script:installProgress ($pause.Text -eq (Text-Capri 'resume'))
    $script:fields.progressText.Text=Format-CapriInstallProgress
    Fit-CapriPage
})
$body=New-Object Capri.Setup.Cyberpunk.Panel;
$body.Dock='None';
$body.Padding=New-Object Windows.Forms.Padding((D 28));
$body.AutoScroll=$true
$form.Controls.Add($body);
$body.BringToFront();
$sidebar.BringToFront()
function Text-Capri([string]$Key){
    $text=Get-CapriInstallerText $translations $installerLanguage $Key
    if($text -eq $Key){$text=Get-CapriInstallerText $progressTranslations $installerLanguage $Key}
    return $text
}
$script:infoTips=New-Object Windows.Forms.ToolTip
$script:infoTips.AutoPopDelay=16000
$script:memoryBudget=$null
$script:updatingModelRecommendations=$false
function New-CapriInfoButton([string]$Topic,[string]$Description) {
    $button=New-Object Capri.Setup.Cyberpunk.Button
    $button.Name='info-'+$Topic
    $button.Text=[string][char]0x24D8
    $button.FlatStyle='Flat'
    $button.FlatAppearance.BorderSize=0
    $button.ForeColor=[Drawing.Color]::FromArgb(0,89,103)
    $button.Font=New-CapriFont 12 'Bold'
    $button.AccessibleName=Text-Capri 'info.title'
    $button.AccessibleDescription=$Description
    $script:infoTips.SetToolTip($button,(Text-Capri 'info.title'))
    $button.Add_Click({
        [Windows.Forms.MessageBox]::Show($form,$this.AccessibleDescription,(Text-Capri 'info.title'),'OK','Information')|Out-Null
    })
    return $button
}
. (Join-Path $PSScriptRoot 'memory-budget-ui.ps1')
function Layout-CapriWizard {
    $buttonWidths=@($back,$next,$cancel)|ForEach-Object{[Math]::Max((D 95),([Windows.Forms.TextRenderer]::MeasureText($_.Text,$_.Font).Width+(D 24)))}
    # Reserve both labels: pause/resume must never change the footer row or viewport.
    $pauseWidth=D 145
    foreach($key in @('pause','resume')){
        $label=Get-CapriInstallerText $translations $installerLanguage $key
        $pauseWidth=[Math]::Max($pauseWidth,([Windows.Forms.TextRenderer]::MeasureText($label,$pause.Font).Width+(D 24)))
    }
    $buttonTotal=($buttonWidths|Measure-Object -Sum).Sum+(D 24)
    $footerHeight=if($pause.Visible -and ($buttonTotal+$pauseWidth+(D 60)) -gt ($form.ClientSize.Width-(D 205))){D 110}else{D 70}
    $sidebar.SetBounds(0,0,(D 205),$form.ClientSize.Height)
    $footer.SetBounds((D 205),($form.ClientSize.Height-$footerHeight),($form.ClientSize.Width-(D 205)),$footerHeight)
    $budgetPanel.Visible=$script:page -in @(3,4,5)
    $budgetHeight=0
    if($budgetPanel.Visible){
        $helpWidth=[Math]::Max((D 100),($form.ClientSize.Width-(D 261)))
        $budgetHeight=if($script:memoryBudget -and $script:memoryBudget.mode -eq 'unknown'){D 83}else{D 143}
        if($budgetHelp.Text){
            $helpSize=[Windows.Forms.TextRenderer]::MeasureText($budgetHelp.Text,$form.Font,(New-Object Drawing.Size($helpWidth,10000)),[Windows.Forms.TextFormatFlags]::WordBreak)
            $budgetHeight+=$helpSize.Height+(D 12)
        }
    }
    $budgetPanel.SetBounds((D 205),($form.ClientSize.Height-$footerHeight-$budgetHeight),($form.ClientSize.Width-(D 205)),$budgetHeight)
    Layout-CapriMemoryBudget
    $body.SetBounds((D 205),0,($form.ClientSize.Width-(D 205)),($form.ClientSize.Height-$footerHeight-$budgetHeight))
    $right=$footer.Width-(D 28)
    for($index=2;$index -ge 0;$index--){$button=@($back,$next,$cancel)[$index];$width=$buttonWidths[$index];$right-=$width;$button.SetBounds($right,(D 19),$width,(D 33));$right-=(D 12)}
    $pause.SetBounds((D 20),$(if($footerHeight -gt (D 70)){D 64}else{D 19}),$pauseWidth,(D 33))
}

$form.Add_SizeChanged({
    Layout-CapriWizard
    if($script:fields.ContainsKey('heading')){Fit-CapriPage}
})
Layout-CapriWizard
function Capri-SetupError([string]$Message,[string]$Code='') {
    return (Get-CapriSetupError $translations $installerLanguage $Message $Code)
}
function Fit-CapriPage {
    # A newly visible scrollbar narrows anchored labels. Settle their wrapped
    # height now, rather than on the next pause/progress event (a visible jump).
    for($pass=0;$pass -lt 3;$pass++){
        $width=$body.ClientSize.Width
        Fit-CapriPageRows
        if($width -eq $body.ClientSize.Width){break}
    }
}
function Fit-CapriPageRows {
    # Grow wrapped text and shift following rows. Long translations scroll instead of clipping.
    $scroll=$body.AutoScrollPosition
    $body.AutoScrollPosition=New-Object Drawing.Point(0,0)
    foreach($control in $body.Controls){
        if(-not $control.Tag){$control.Tag=@{top=$control.Top;height=$control.Height;width=$control.Width}}
        $control.Top=$control.Tag.top
        $control.Height=$control.Tag.height
    }
    # A single viewport edge drives both the help column and the controls beside it.
    $helpRight=[Math]::Min((D 648),($body.ClientSize.Width-(D 28)))
    $helpGap=D 6
    if($script:page -eq 4){
        # Use the same right edge for both language columns and the full-width rows.
        $columnGap=D 20
        $columnWidth=[int][Math]::Floor(($helpRight-(D 28)-$columnGap)/2)
        $left=D 28
        foreach($key in @('interfaceLanguage','conversationLanguage')){
            $button=$body.Controls['info-'+$key]
            $button.Left=$left+$columnWidth-$button.Width
            $label=$script:fields[$key+'Label']
            $choice=$script:fields[$key]
            $label.Left=$choice.Left=$left
            $label.Width=$choice.Width=[Math]::Max(1,($button.Left-$helpGap-$left))
            $left+=$columnWidth+$columnGap
        }
    }
    $offset=0
    $rows=@($body.Controls|Sort-Object Top)
    for($index=0;$index -lt $rows.Count;){
        $top=$rows[$index].Top;$group=@();$originalBottom=$top;$bottom=$top
        while($index -lt $rows.Count -and [Math]::Abs($rows[$index].Top-$top) -le (D 4)){$group+=$rows[$index];$index++}
        $help=@($group|Where-Object{$_.Name -like 'info-*'})
        if($help.Count -eq 1){
            $button=$help[0]
            $button.Left=$helpRight-$button.Width
            foreach($control in $group){
                if($control -eq $button){continue}
                $control.Anchor='Top,Left'
                $control.Width=[Math]::Max(1,[Math]::Min($control.Tag.width,($button.Left-$helpGap-$control.Left)))
            }
        }
        foreach($control in $group){
            $originalBottom=[Math]::Max($originalBottom,$control.Bottom)
            if($control -is [Windows.Forms.Label] -or $control -is [Windows.Forms.CheckBox] -or $control -is [Windows.Forms.RadioButton]){
                if($script:page -eq 5 -and $control -is [Windows.Forms.Label]){
                    # Use the Label's own wrapping and padding rules on the compact review page.
                    $needed=$control.GetPreferredSize((New-Object Drawing.Size($control.Width,0))).Height+(D 6)
                }else{
                    $width=$control.Width-$(if($control -is [Windows.Forms.Label]){0}else{D 26})
                    $flags=[Windows.Forms.TextFormatFlags]::WordBreak -bor [Windows.Forms.TextFormatFlags]::NoPrefix
                    $needed=[Windows.Forms.TextRenderer]::MeasureText($control.Text,$control.Font,(New-Object Drawing.Size($width,10000)),$flags).Height+(D 6)
                }
                if($script:page -eq 6 -and $script:fields.ContainsKey('progressText') -and $control -eq $script:fields.progressText){
                    $pauseText=((Text-Capri 'progressOverall') -f 100)+"`r`n"+(Text-Capri 'pauseHelp')
                    $pauseHeight=[Windows.Forms.TextRenderer]::MeasureText($pauseText,$control.Font,(New-Object Drawing.Size($width,10000)),$flags).Height+(D 6)
                    $needed=[Math]::Max($needed,$pauseHeight)
                }
                if($needed -gt $control.Height){$control.Height=$needed}
            }
            $bottom=[Math]::Max($bottom,$control.Bottom)
            $control.Top+=$offset
            if($control -is [Windows.Forms.TextBox]){$control.RightToLeft='No';$control.TextAlign='Left'}
        }
        $offset+=$bottom-$originalBottom
    }
    $body.AutoScrollMinSize=New-Object Drawing.Size(0,([Math]::Max(0,($rows|Measure-Object Bottom -Maximum).Maximum)+(D 28)))
    Layout-CapriWizard
    $body.AutoScrollPosition=New-Object Drawing.Point((-$scroll.X),(-$scroll.Y))
}
function Add-CapriLabel([string]$Text,[int]$Y,[int]$Height=50){$c=New-Object Capri.Setup.Cyberpunk.Label;
    $c.Text=$Text;
    Set-CapriBounds $c (28) ($Y) (620) ($Height);
    $c.Anchor='Top,Left,Right';
    $body.Controls.Add($c);
    return $c}
function Add-CapriInfo([string]$Topic,[int]$Y,[int]$X=622,[string]$Description) {
    if(-not $Description){$Description=Text-Capri ('info.'+$Topic)}
    $button=New-CapriInfoButton $Topic $Description
    Set-CapriBounds $button $X $Y 26 26
    $button.Anchor='Top,Left'
    $body.Controls.Add($button)
    return $button
}
function Add-CapriCheck([string]$Key,[int]$Y,[bool]$Checked){$c=New-Object Capri.Setup.Cyberpunk.CheckBox;
    $c.Text=Text-Capri $Key;
    $c.Checked=$Checked;
    Set-CapriBounds $c (28) ($Y) (588) (29);
    $body.Controls.Add($c);
    $script:fields[$Key]=$c;
    return $c}
function Add-CapriCombo([string]$Key,[int]$Y,$Items,[string]$Selected){$c=New-Object Capri.Setup.Cyberpunk.ComboBox;
    $c.DropDownStyle='DropDownList';
    $c.MaxDropDownItems=16
    $c.IntegralHeight=$false
    Set-CapriBounds $c (28) ($Y) (588) (29);
    foreach($item in $Items){$null=$c.Items.Add($item)};
    $body.Controls.Add($c)
    $index=0
    for($itemIndex=0;$itemIndex -lt $c.Items.Count;$itemIndex++){
        if((([string]$c.Items[$itemIndex] -split '\|')[0]).Trim() -eq $Selected){$index=$itemIndex;break}
    }
    $c.SelectedIndex=$index
    $script:fields[$Key]=$c;
    return $c}
function Selected-Capri([string]$Key){return ($script:fields[$Key].SelectedItem -split '\|')[0].Trim()}
function Format-CapriModelChoice($Profile,[bool]$Recommended) {
    $beta=if($Profile.PSObject.Properties['experimental'] -and $Profile.experimental){' (BETA)'}else{''}
    $vram=$memoryEstimates.models.PSObject.Properties[$Profile.id].Value.vram -join '-'
    $ram=Get-CapriRequiredRam $Profile $hardware $memoryEstimates
    $badge=if($Recommended){' | '+[char]0x2605+' '+(Text-Capri 'modelRecommended')}else{''}
    return $Profile.id+' | '+$Profile.model+$beta+' | VRAM ~'+$vram+' GiB | RAM '+$ram+'+ GiB'+$badge
}
function Update-CapriHardwareLabel {
    if(-not $script:fields.ContainsKey('modelHardware')){return}
    $gpuName=if($hardware.selectedGpu){$hardware.selectedGpu.name}elseif($hardware.gpu){$hardware.gpu}else{Text-Capri 'unknown'}
    $vram=if($hardware.vramGiB){[Math]::Round($hardware.vramGiB,1).ToString()+' GiB'}else{Text-Capri 'unknown'}
    $script:fields.modelHardware.Text=(Text-Capri 'ramLabel')+': '+$hardware.ramGiB+' GiB'+"`nGPU: "+$gpuName+"`n"+(Text-Capri 'vramLabel')+': '+$vram
}
function Update-CapriModelRecommendations {
    if($script:page -ne 3 -or -not $script:fields.ContainsKey('profile')){return}
    $profile=$script:fields.profile
    $recommended=@(
        if($script:fields.local.Checked){
            $language=if($script:fields.conversationLanguage.Enabled){Selected-Capri 'conversationLanguage'}else{$options.conversationLanguage}
            Get-CapriRecommendedLanguageProfiles $language $modelBenchmark $manifest.profiles $hardware $memoryEstimates
        }
    )
    $label=$script:fields.modelRecommendations
    $label.Text=if($recommended.Count){(Text-Capri 'modelRecommended')+': '+(($recommended|ForEach-Object{$_.model}) -join ', ')}else{''}
    $label.Visible=$recommended.Count -gt 0
    $reserved=if($recommended.Count){28}else{0}
    foreach($row in @(@($script:fields.storageEstimate,282),@($body.Controls['info-storage'],282),@($script:fields.modelHardware,342))){
        $control=$row[0]
        $top=D ($row[1]+$reserved)
        if($control.Tag){$control.Tag.top=$top}else{$control.Top=$top}
    }
    $index=$profile.SelectedIndex
    $recommendedIds=@($recommended|ForEach-Object{$_.id})
    $items=@($manifest.profiles|ForEach-Object{Format-CapriModelChoice $_ ($_.id -in $recommendedIds)})
    $script:updatingModelRecommendations=$true
    $profile.BeginUpdate()
    try{
        for($i=0;$i -lt $items.Count;$i++){
            if($profile.Items[$i] -cne $items[$i]){$profile.Items[$i]=$items[$i]}
        }
        $profile.SelectedIndex=$index
        $width=($items|ForEach-Object{[Windows.Forms.TextRenderer]::MeasureText($_,$profile.Font).Width+(D 40)}|Measure-Object -Maximum).Maximum
        $profile.DropDownWidth=[Math]::Max($profile.Width,$width)
    }finally{
        $profile.EndUpdate()
        $script:updatingModelRecommendations=$false
    }
}
function Format-CapriGiB([long]$Bytes){return ($Bytes/1GB).ToString('0.00')+' GiB'}
function Format-CapriStorageEstimate($Estimate){
    return (Text-Capri 'storage')+': '+(Format-CapriGiB $Estimate.requiredBytes)+"`n"+(Text-Capri 'download')+': ~'+(Format-CapriGiB $Estimate.downloadBytes)
}
function Format-CapriAvailableDisk([string]$Target,$Available){
    $drive=[IO.Path]::GetPathRoot($Target)
    $value=if($null -eq $Available){Text-Capri 'unknown'}else{Format-CapriGiB $Available}
    return (Text-Capri 'budgetFree')+" ($drive): "+$value
}
function Update-CapriDiskReview($Available) {
    if($script:page -ne 5 -or -not $script:fields.ContainsKey('reviewSummary')){return}
    if(-not $PSBoundParameters.ContainsKey('Available')){$available=Get-CapriAvailableDiskBytes $options.target}
    $fits=$null -ne $available -and $available -ge $script:reviewStorage.requiredBytes
    $script:fields.reviewSummary.Text=$script:reviewSummary+"`n"+(Format-CapriAvailableDisk $options.target $available)
    if(-not $fits){$script:fields.reviewSummary.Text+="`n"+(Text-Capri 'diskSpaceError')}
    $next.Enabled=$script:fields.consent.Checked -and $fits
}
function Add-CapriInferenceChoice([string]$Mode,[string]$Key,[int]$Y){
    $control=New-Object Capri.Setup.Cyberpunk.RadioButton
    $control.Text=Text-Capri $Key
    if($Mode -eq 'api'){$control.Text+=' (BETA)'}
    $control.Checked=if($Mode -eq 'huggingface'){$options.inferenceMode -eq 'local' -and $options.modelSource -eq 'huggingface'}elseif($Mode -eq 'local'){$options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface'}else{$options.inferenceMode -eq $Mode}
    Set-CapriBounds $control 28 $Y 588 30
    $control.Anchor='Top,Left,Right'
    $body.Controls.Add($control)
    $script:fields[$Mode]=$control
}
function Save-CapriPage{
    switch($script:page){
        1{$options.acceptLicense=$script:fields.accept.Checked}
        2{$options.target=$script:fields.target.Text.Trim()}
        3{$options.inferenceMode=if($script:fields.api.Checked){'api'}else{'local'}
            $options.modelSource=if($script:fields.huggingface.Checked){'huggingface'}else{'catalog'}
            if($script:fields.conversationLanguage.Enabled){$options.conversationLanguage=Selected-Capri 'conversationLanguage'}
            $options.profile=Selected-Capri 'profile'}
        4{foreach($key in @('recognition','models','desktop','startMenu')){$name=@{models='downloadModels';
                    desktop='desktopShortcut';
                    startMenu='startMenuShortcut'}[$key];
                if(-not $name){$name=$key};
                if($key -ne 'models' -or ($options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface')){$options[$name]=$script:fields[$key].Checked}};
            $options.interfaceLanguage=Selected-Capri 'interfaceLanguage';
            $options.conversationLanguage=Selected-Capri 'conversationLanguage';
            $options.voiceMode=Selected-Capri 'voiceMode';
            $options.voicePack=switch($options.voiceMode){'bundled'{$BundledVoicePack};'custom'{$script:fields.voicePack.Text.Trim()};default{''}}}
        5{$options.acceptDownloads=$script:fields.consent.Checked}
        7{if($script:result){
            $script:launchOnFinish=$script:fields.launch.Checked
            $script:preloadOnFirstLaunch=$options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface' -and $script:fields.preloadOnFirstLaunch.Checked
        }}
    }
}
function Load-CapriRepairSettings {
    if($script:settingsTarget -ieq $options.target){return}
    $script:settingsTarget=$options.target
    $options['repair']=$false
    $options.modelSource='catalog'
    $options.inferenceMode='local'
    $options.profile=$recommendation
    $options.interfaceLanguage=$installerLanguage
    $options.conversationLanguage='en'
    if(-not(Test-Path -LiteralPath (Join-Path $options.target '.capri-install.json'))){return}
    $local=Join-Path $options.target 'config/core.local.json'
    $options['repair']=Test-Path -LiteralPath $local
    $journal=Join-Path $options.target '.runtime/installer/state.json'
    if(-not $options.repair -and (Test-Path -LiteralPath $journal)){
        Assert-CapriNoLinks $journal
        $previous=Read-CapriJson $journal
        $options.profile=$previous.plan.profile
        if($previous.plan.PSObject.Properties['modelSource']){$options.modelSource=$previous.plan.modelSource}
        $options.interfaceLanguage=$previous.plan.languages.interface
        $options.conversationLanguage=$previous.plan.languages.conversation
    }
    if(Test-Path -LiteralPath $local){Assert-CapriNoLinks $local;
        $config=Read-CapriJson $local;
        if($config.PSObject.Properties['resourceProfile'] -and $config.resourceProfile -in $manifest.profiles.id){$options.profile=$config.resourceProfile}
        if(($config.PSObject.Properties['modelSetupRequired'] -and $config.modelSetupRequired) -or
           ($config.PSObject.Properties['model'] -and $config.model -match '^capri-hf-[a-f0-9]{24}:latest$')){$options.modelSource='huggingface'}}
    $inference=Join-Path $options.target 'data/desktop/inference-api.json'
    if(Test-Path -LiteralPath $inference){
        Assert-CapriNoLinks $inference
        try{
            $savedInference=Read-CapriJson $inference
            if(($savedInference.PSObject.Properties['enabled'] -and $savedInference.enabled) -or
               ($savedInference.PSObject.Properties['setupRequired'] -and $savedInference.setupRequired)){$options.inferenceMode='api'}
        }catch{}
    }
    $languages=Join-Path $options.target 'data/desktop/languages.json'
    if(Test-Path -LiteralPath $languages){Assert-CapriNoLinks $languages;
        $saved=Read-CapriJson $languages;
        $options.interfaceLanguage=$saved.settings.interface;
        $options.conversationLanguage=$saved.settings.conversation}
    $voiceSelections=Join-Path $options.target 'data/speech/voice-selections.json'
    if(Test-Path -LiteralPath $voiceSelections){
        Assert-CapriNoLinks $voiceSelections
        try{
            $voices=Read-CapriJson $voiceSelections
            $savedVoice=$voices.languages.PSObject.Properties[$options.conversationLanguage]
            if($savedVoice -and $savedVoice.Value -eq $qwenVoice.id){
                $options.voiceMode='qwen'
                $options.voicePack=''
            }
        }catch{}
    }
    # Component defaults belong to this wizard. Navigation keeps the user's current
    # selection; attaching to a running session restores its exact request separately.
}
function Render-CapriPage{
    if($script:fields.ContainsKey('stage')){
        $script:progressView=@{stage=$script:fields.stage.Text;style=$script:fields.progress.Style;value=$script:fields.progress.Value;text=$script:fields.progressText.Text;log=$script:fields.log.Text}
    }
    $body.AutoScrollPosition=New-Object Drawing.Point(0,0)
    $body.AutoScrollMinSize=New-Object Drawing.Size(0,0)
    foreach($control in @($body.Controls)){$body.Controls.Remove($control);
        $script:infoTips.SetToolTip($control,$null)
        $control.Dispose()};
    $script:fields=@{}
    $rtl=@($interfaceLocales.locales|Where-Object{$_.id -eq $installerLanguage})[0].direction -eq 'rtl'
    $form.RightToLeft=if($rtl){'Yes'}else{'No'}
    $form.RightToLeftLayout=$rtl
    $form.Text=Text-Capri 'title';
    $back.Text=Text-Capri 'back';
    $cancel.Text=Text-Capri 'cancel';
    $next.Text=Text-Capri 'next';
    $back.Enabled=$script:page -gt 0 -and $script:page -lt 6;
    $next.Enabled=$true;
    $cancel.Enabled=$true
    $pause.Visible=$script:page -eq 6
    $pause.Text=Text-Capri $(if($script:session -and (Test-Path -LiteralPath (Join-Path $script:session 'pause'))){'resume'}else{'pause'})
    $installationTitle=if($options.updating -eq $true){(Text-Capri 'updatingTo') -f ('v'+$version)}else{$translations.$installerLanguage.pages[6]}
    for($i=0;
    $i -lt 8;
    $i++){$steps[$i].Text=($i+1).ToString('00')+'  '+$(if($i -eq 6){$installationTitle}else{$translations.$installerLanguage.pages[$i]});
        $steps[$i].ForeColor=if($i -eq $script:page){[Drawing.Color]::FromArgb(67,225,225)}else{[Drawing.Color]::FromArgb(155,171,190)}}
    $heading=Add-CapriLabel $translations.$installerLanguage.pages[$script:page] 22 44;
    $heading.Width=D 588
    $heading.Font=New-CapriFont 19 'Bold'
    $script:fields.heading=$heading
    if($script:page -eq 6){$heading.Text=$installationTitle}
    $null=Add-CapriInfo (@('welcome','license','location','hardware','components','review','progress','finish')[$script:page]) 25
    switch($script:page){
        0{
            $null=Add-CapriLabel (Text-Capri 'welcome') 88 36;
            $null=Add-CapriLabel (Text-Capri 'installerLanguage') 138 28
            $combo=Add-CapriCombo 'installerLanguage' 171 @($locales|ForEach-Object{$_.id+' | '+$_.nativeName}) $installerLanguage
            $null=Add-CapriInfo 'installerLanguage' 171
            $combo.Add_SelectionChangeCommitted({$previous=$script:installerLanguage;$script:installerLanguage=Selected-Capri 'installerLanguage';
                if($options.interfaceLanguage -eq $previous){$options.interfaceLanguage=$script:installerLanguage}
                Render-CapriPage})
        }
        1{
            $null=Add-CapriLabel (Text-Capri 'license') 82 28;
            $license=New-Object Capri.Setup.Cyberpunk.TextBox;
            $license.Multiline=$true;
            $license.ReadOnly=$true;
            $license.ScrollBars='Vertical';
            $license.Text=[IO.File]::ReadAllText((Join-Path $sourceRoot 'LICENSE'));
            Set-CapriBounds $license (28) (118) (620) (315);
            $license.Anchor='Top,Left,Right';
            $body.Controls.Add($license)
            $accept=Add-CapriCheck 'accept' 447 $options.acceptLicense;
            $next.Enabled=$options.acceptLicense;
            $accept.Add_CheckedChanged({$next.Enabled=$script:fields.accept.Checked});
            $null=Add-CapriInfo 'accept' 447
        }
        2{
            $null=Add-CapriLabel (Text-Capri 'locationPath') 82 25
            $null=Add-CapriInfo 'target' 82
            $box=New-Object Capri.Setup.Cyberpunk.TextBox;
            $box.Text=$options.target;
            Set-CapriBounds $box (28) (110) (510) (29);
            $body.Controls.Add($box);
            $script:fields.target=$box
            $browse=New-Object Capri.Setup.Cyberpunk.Button;
            $browse.Text=Text-Capri 'browse';
            Set-CapriBounds $browse (548) (108) (100) (32);
            $browse.Add_Click({$dialog=New-Object Windows.Forms.FolderBrowserDialog;
                $dialog.Description=Text-Capri 'locationBrowse';
                $dialog.SelectedPath=$script:fields.target.Text;
                try{if($dialog.ShowDialog() -eq 'OK'){$script:fields.target.Text=Resolve-CapriInstallFolder $dialog.SelectedPath $sourceRoot (Read-CapriJson (Join-Path $sourceRoot 'package.json')).version}}
                catch{[Windows.Forms.MessageBox]::Show((Capri-SetupError $_.Exception.Message),(Text-Capri 'error'),'OK','Warning')|Out-Null}
                finally{$dialog.Dispose()}});
            $body.Controls.Add($browse)
            if($script:installations.Count){
                $null=Add-CapriLabel (Text-Capri 'existingInstallations') 164 28
                $null=Add-CapriInfo 'existing' 164
                $installed=New-Object Capri.Setup.Cyberpunk.ComboBox;$installed.DropDownStyle='DropDownList'
                Set-CapriBounds $installed 28 197 620 32
                foreach($entry in $script:installations){$null=$installed.Items.Add(('v'+$entry.version+' | '+$entry.path))}
                $script:fields.existing=$installed
                for($index=0;$index -lt $script:installations.Count;$index++){
                    if($script:installations[$index].path -ieq $box.Text){$installed.SelectedIndex=$index;break}
                }
                $installed.Add_SelectionChangeCommitted({if($this.SelectedIndex -ge 0){$script:fields.target.Text=$script:installations[$this.SelectedIndex].path}})
                $box.Add_TextChanged({
                    $index=-1
                    for($i=0;$i -lt $script:installations.Count;$i++){
                        if($script:installations[$i].path -ieq $this.Text.Trim().TrimEnd('\')){$index=$i;break}
                    }
                    $script:fields.existing.SelectedIndex=$index
                })
                $body.Controls.Add($installed)
            }
        }
        3{
            Add-CapriInferenceChoice 'local' 'inferenceLocal' 83
            Add-CapriInferenceChoice 'api' 'inferenceApi' 116
            Add-CapriInferenceChoice 'huggingface' 'inferenceHuggingFace' 149
            $null=Add-CapriInfo 'local' 83
            $null=Add-CapriInfo 'api' 116
            $null=Add-CapriInfo 'huggingface' 149
            $null=Add-CapriLabel (Text-Capri 'conversationLanguage') 181 25
            $conversationChoice=Add-CapriCombo 'conversationLanguage' 208 @($catalog|ForEach-Object{$_.id+' | '+$_.label}) $options.conversationLanguage
            $conversationChoice.Enabled=-not ($options.ContainsKey('repair') -and $options.repair)
            $null=Add-CapriInfo 'conversationLanguage' 208
            $null=Add-CapriInfo 'profile' 245
            $script:fields.modelRecommendations=Add-CapriLabel '' 279 26
            $script:fields.storageEstimate=Add-CapriLabel '' 310 56
            $null=Add-CapriInfo 'storage' 310
            $script:fields.modelHardware=Add-CapriLabel '' 370 62
            Update-CapriHardwareLabel
            $items=@($manifest.profiles|ForEach-Object{Format-CapriModelChoice $_ $false})
            $profile=Add-CapriCombo 'profile' 245 $items $options.profile
            $profile.Add_SelectedIndexChanged({
                if(-not $script:updatingModelRecommendations){Update-CapriMemoryBudgetView}
            })
            $updateInferenceChoice={
                $useApi=$script:fields.api.Checked
                $useHub=$script:fields.huggingface.Checked
                $script:fields.profile.Enabled=-not ($useApi -or $useHub -or ($options.ContainsKey('repair') -and $options.repair))
                Update-CapriModelRecommendations
                Update-CapriMemoryBudgetView
                Fit-CapriPage
            }
            foreach($mode in @('local','api','huggingface')){$script:fields[$mode].Add_CheckedChanged($updateInferenceChoice)}
            $conversationChoice.Add_SelectedIndexChanged({
                Update-CapriModelRecommendations
                Update-CapriMemoryBudgetView
                Fit-CapriPage
            })
            & $updateInferenceChoice
        }
        4{
            $uiLabel=Add-CapriLabel (Text-Capri 'uiLanguage') 85 25;Set-CapriBounds $uiLabel 28 85 268 25;$uiLabel.Anchor='Top,Left'
            $script:fields.interfaceLanguageLabel=$uiLabel
            $uiChoice=Add-CapriCombo 'interfaceLanguage' 113 @($locales|Sort-Object id|ForEach-Object{$_.id+' | '+$_.nativeName}) $options.interfaceLanguage;Set-CapriBounds $uiChoice 28 113 268 29
            $null=Add-CapriInfo 'interfaceLanguage' 113 302
            $languageLabel=Add-CapriLabel (Text-Capri 'conversationLanguage') 85 25;Set-CapriBounds $languageLabel 348 85 268 25;$languageLabel.Anchor='Top,Left'
            $script:fields.conversationLanguageLabel=$languageLabel
            $languageChoice=Add-CapriCombo 'conversationLanguage' 113 @($catalog|ForEach-Object{$_.id+' | '+$_.label}) $options.conversationLanguage;Set-CapriBounds $languageChoice 348 113 268 29
            $null=Add-CapriInfo 'conversationLanguage' 113 622
            $null=Add-CapriCheck 'recognition' 158 $options.recognition;
            $null=Add-CapriInfo 'recognition' 158
            $script:fields.classifier=Add-CapriLabel (Text-Capri 'classifierIncluded') 191 28
            $script:fields.classifier.Width=D 588
            $null=Add-CapriInfo 'classifier' 191
            $downloadChoice=Add-CapriCheck 'models' 224 ($options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface' -and $options.downloadModels)
            $downloadChoice.Enabled=$options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface'
            $null=Add-CapriInfo 'models' 224
            $null=Add-CapriLabel (Text-Capri 'voiceChoice') 257 25
            $choice=Add-CapriCombo 'voiceMode' 286 @('off | '+(Text-Capri 'voiceOff')) 'off'
            $null=Add-CapriInfo 'voiceMode' 286
            $box=New-Object Capri.Setup.Cyberpunk.TextBox
            $box.Text=if($options.voiceMode -eq 'custom'){$options.voicePack}else{''}
            $box.ReadOnly=$true
            $box.Enabled=(Selected-Capri 'voiceMode') -eq 'custom'
            $box.Visible=$box.Enabled
            Set-CapriBounds $box (28) (323) (510) (29)
            $body.Controls.Add($box)
            $script:fields.voicePack=$box
            $browse=New-Object Capri.Setup.Cyberpunk.Button
            $browse.Text=Text-Capri 'browse'
            $browse.Enabled=$box.Enabled
            $browse.Visible=$box.Enabled
            Set-CapriBounds $browse (548) (321) (100) (32)
            $script:fields.voiceBrowse=$browse
            $browse.Add_Click({
                $dialog=New-Object Windows.Forms.OpenFileDialog
                $dialog.Title=Text-Capri 'voiceSelect'
                $dialog.Filter=(Text-Capri 'voiceFileFilter')+' (voice-profile.json)|voice-profile.json'
                $dialog.FileName='voice-profile.json'
                $dialog.CheckFileExists=$true
                $dialog.Multiselect=$false
                try{
                    if($dialog.ShowDialog() -eq 'OK'){
                        $folder=Assert-CapriVoicePack (Split-Path -Parent $dialog.FileName)
                        $script:fields.voicePack.Text=$folder
                    }
                }catch{[Windows.Forms.MessageBox]::Show((Capri-SetupError $_.Exception.Message),(Text-Capri 'error'),'OK','Warning')|Out-Null}
                finally{$dialog.Dispose()}
            })
            $body.Controls.Add($browse)
            $choice.Add_SelectedIndexChanged({
                $custom=$script:fields.voiceMode.SelectedIndex -ge 0 -and (Selected-Capri 'voiceMode') -eq 'custom'
                $script:fields.voicePack.Enabled=$custom
                $script:fields.voiceBrowse.Enabled=$custom
                $script:fields.voicePack.Visible=$custom
                $script:fields.voiceBrowse.Visible=$custom
            })
            $null=Add-CapriCheck 'desktop' 365 $options.desktopShortcut;
            $null=Add-CapriInfo 'desktop' 365
            $null=Add-CapriCheck 'startMenu' 398 $options.startMenuShortcut
            $null=Add-CapriInfo 'startMenu' 398
            $script:fields.storageEstimate=Add-CapriLabel '' 435 56
            $script:fields.storageEstimate.Width=D 588
            $null=Add-CapriInfo 'storage' 435
            $refreshVoiceSupport={
                $selectedLanguage=Selected-Capri 'conversationLanguage'
                $supported=@($catalog|Where-Object{$_.id -eq $selectedLanguage -and $_.speech}).Count -gt 0
                $combo=$script:fields.voiceMode
                $previous=if($combo.SelectedIndex -ge 0){Selected-Capri 'voiceMode'}else{$options.voiceMode}
                $items=@('off | '+(Text-Capri 'voiceOff'))
                if($supported -and $voiceGpu){
                    if($BundledVoicePack){$items+=('bundled | Chatterbox / Capri / '+(Text-Capri 'conversationLanguage'))}
                    $items+=('custom | '+(Text-Capri 'voiceCustom'))
                }
                if($selectedLanguage -in $qwenVoice.languages){$items+=('qwen | '+(Text-Capri 'voiceHuggingFace'))}
                $combo.BeginUpdate()
                try{
                    $combo.Items.Clear()
                    $combo.Items.AddRange([object[]]$items)
                    $index=0
                    for($i=0;$i -lt $items.Count;$i++){if($items[$i].StartsWith($previous+' |')){$index=$i;break}}
                    $combo.SelectedIndex=$index
                    $combo.Enabled=$items.Count -gt 1
                }finally{$combo.EndUpdate()}
            }
            $script:fields.conversationLanguage.Add_SelectedIndexChanged($refreshVoiceSupport)
            $choice.SelectedIndex=-1
            & $refreshVoiceSupport
            foreach($key in @('recognition','models')){$script:fields[$key].Add_CheckedChanged({Update-CapriMemoryBudgetView})}
            foreach($key in @('conversationLanguage','voiceMode')){$script:fields[$key].Add_SelectedIndexChanged({Update-CapriMemoryBudgetView})}
            if($options.ContainsKey('repair') -and $options.repair){$script:fields.interfaceLanguage.Enabled=$false;$script:fields.conversationLanguage.Enabled=$false}

        }
        5{
            $selected=@($manifest.profiles|Where-Object{$_.id -eq $options.profile})[0];
            $modelSummary=if($options.inferenceMode -eq 'api'){Text-Capri 'inferenceApi'}elseif($options.modelSource -eq 'huggingface'){Text-Capri 'inferenceHuggingFace'}else{$selected.model}
            if($options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface' -and -not $options.downloadModels){
                $modelSummary+="`n"+(Text-Capri 'models')+': '+(Text-Capri 'off')
            }
            $script:reviewStorage=Get-CapriStorageEstimate $options $manifest $storageCatalog $rocmVoice $hardware
            $storage=Format-CapriStorageEstimate $script:reviewStorage
            $voiceSummary=if($options.voiceMode -eq 'qwen'){Text-Capri 'voiceHuggingFace'}elseif($options.voicePack){'Chatterbox / Capri / '+$options.conversationLanguage+' / '+(Text-Capri 'on')}else{Text-Capri 'voiceOff'}
            $summary=$options.target+"`n"+$modelSummary+"`n"+(Text-Capri 'uiLanguage')+': '+$options.interfaceLanguage+'  |  '+(Text-Capri 'conversationLanguage')+': '+$options.conversationLanguage+"`n"+(Text-Capri 'recognition')+': '+$(if($options.recognition){Text-Capri 'on'}else{Text-Capri 'off'})+'  |  '+(Text-Capri 'classifierIncluded')+"`n"+(Text-Capri 'voiceChoice')+': '+$voiceSummary+"`n`n"+$storage+"`n"+(Text-Capri 'dataLabel')+': '+(Join-Path $options.target 'data')
            # Compact minimum rows. Fit-CapriPageRows grows each block to its
            # wrapped height and preserves the gap before the next one.
            $script:reviewSummary=$summary
            $script:fields.reviewSummary=Add-CapriLabel $summary 76 24
            $consent=Add-CapriCheck 'consent' 108 $options.acceptDownloads
            $null=Add-CapriInfo 'consent' 108
            $consent.Anchor='Top,Left,Right'
            $consent.Add_CheckedChanged({Update-CapriDiskReview;Fit-CapriPage});
            Update-CapriDiskReview
            $next.Text=Text-Capri 'install'
        }
        6{
            $script:fields.stage=Add-CapriLabel (Text-Capri 'working') 90 55;
            $bar=New-Object Capri.Setup.Cyberpunk.ProgressBar;
            Set-CapriBounds $bar (28) (158) (620) (18);
            $bar.Style='Continuous';
            $body.Controls.Add($bar);
            $script:fields.progress=$bar
            $script:fields.progressText=Add-CapriLabel (Format-CapriInstallProgress) 188 42;
            $script:fields.warning=Add-CapriLabel (Text-Capri 'installationWarning') 242 28;
            $box=New-Object Capri.Setup.Cyberpunk.TextBox;
            $box.Multiline=$true;
            $box.ReadOnly=$true;
            $box.ScrollBars='Vertical';
            Set-CapriBounds $box (28) (326) (620) (198);
            $box.Anchor='Top,Left,Right';
            $body.Controls.Add($box);
            $script:fields.log=$box;
            $script:fields.recovery=Add-CapriLabel $(if($script:recovered){Text-Capri 'recovered'}else{''}) 536 76
            Add-CapriReportButtons 278
            if($script:progressView){
                $script:fields.stage.Text=$script:progressView.stage;$script:fields.progress.Style=$script:progressView.style
                $script:fields.progress.Value=$script:progressView.value;$script:fields.progressText.Text=$script:progressView.text;$script:fields.log.Text=$script:progressView.log
            }
            $back.Enabled=$false;
            $next.Enabled=$false
        }
        7{
            if($script:result){$heading.Text=Text-Capri 'complete';
                $null=Add-CapriLabel $(if($options.inferenceMode -eq 'api'){Text-Capri 'inferenceSetup'}elseif($options.modelSource -eq 'huggingface'){Text-Capri 'inferenceHuggingFaceSetup'}elseif($script:result.modelsReady){Text-Capri 'ready'}else{Text-Capri 'deferred'}) 95 90;
                $null=Add-CapriLabel ($options.target+"`n`n"+(Text-Capri 'dataLabel')+': '+(Join-Path $options.target 'data')+"`n"+(Text-Capri 'logsLabel')+': '+(Join-Path $options.target 'logs')) 215 145;
                $launch=Add-CapriCheck 'launch' 389 $script:launchOnFinish
                $null=Add-CapriInfo 'launch' 389
                $launch.Anchor='Top,Left,Right'
                if($options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface'){
                    $preload=Add-CapriCheck 'preloadOnFirstLaunch' 424 $script:preloadOnFirstLaunch
                    $null=Add-CapriInfo 'preloadOnFirstLaunch' 424
                    $preload.Anchor='Top,Left,Right'
                }
                $next.Text=Text-Capri 'finish'}
            else{$heading.Text=Text-Capri 'failed';
                $null=Add-CapriLabel (Text-Capri 'failedHelp') 95 100;
                $box=New-Object Capri.Setup.Cyberpunk.TextBox;
                $box.Multiline=$true;
                $box.ReadOnly=$true;
                $box.ScrollBars='Vertical';
                $box.Text=$script:failure;
                Set-CapriBounds $box (28) (218) (620) (260);
                $body.Controls.Add($box);
                $back.Enabled=$true;
                $next.Text=Text-Capri 'retry'}
            Add-CapriReportButtons $(if($script:result -and ($options.inferenceMode -eq 'api' -or $options.modelSource -eq 'huggingface')){463}else{498})
        }
    }
    Update-CapriMemoryBudgetView
    Fit-CapriPage
    Update-CapriCyberpunkTheme $form
    if($script:uiLease -and $script:uiLease.IsOwner()){$script:uiLease.Window($form.Handle.ToInt64())}
}
function Start-CapriInstall{
    if($options.voicePack){$options.voicePack=Assert-CapriVoicePack $options.voicePack}
    if($options.bundledVoicePack){$options.bundledVoicePack=Assert-CapriVoicePack $options.bundledVoicePack}
    $options.target=Assert-CapriTarget $options.target $sourceRoot (Read-CapriJson (Join-Path $sourceRoot 'package.json')).version
    if(-not $options.acceptLicense -or -not $options.acceptDownloads){throw 'License acceptance and download consent are required.'}
    $estimate=Get-CapriStorageEstimate $options $manifest $storageCatalog $rocmVoice $hardware
    $free=Get-CapriAvailableDiskBytes $options.target
    if($null -eq $free -or $free -lt $estimate.requiredBytes){
        Update-CapriDiskReview -Available $free
        Fit-CapriPage
        $details=(Text-Capri 'diskSpaceError')+"`n`n"+(Format-CapriStorageEstimate $estimate)+"`n"+(Format-CapriAvailableDisk $options.target $free)
        [Windows.Forms.MessageBox]::Show($details,(Text-Capri 'error'),'OK','Warning')|Out-Null
        return
    }
    Initialize-CapriDefaultTarget $options.target
    if($script:session){Clear-CapriSession}
    $options.updating=Test-CapriUpdateTarget $options.target $version
    $newSession=New-CapriSession
    Open-CapriSession $newSession
    $script:recovered=$false;$script:progressView=$null
    $script:installProgress=New-CapriInstallProgress
    $request=Join-Path $script:session 'request.json';
    $events=Join-Path $script:session 'events.jsonl';
    $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'worker.ps1'),'-RequestFile',$request,'-EventsFile',$events,'-CancelFile',(Join-Path $script:session 'cancel'),'-SessionDirectory',$script:session)|ForEach-Object{Quote-CapriArgument $_}
    $script:worker=Start-Process -FilePath 'powershell.exe' -ArgumentList ($arguments -join ' ') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $script:session 'worker.log') -RedirectStandardError (Join-Path $script:session 'worker.error.log')
    $script:uiDiagnostics.AttachWorker()
    $script:result=$null;
    $script:failure='';
    $script:networkAdviceShown=$false
    $script:cancelRequested=$false;
    $script:page=6;
    Render-CapriPage
}
function Poll-CapriInstall{
    if(-not $script:session){return}
    try{
        if($script:uiLease.Superseded){$script:superseded=$true;$script:uiDiagnostics.ExitReason('superseded');$form.Close();return}
        if(([DateTime]::UtcNow-$script:lastHeartbeat).TotalSeconds -ge 1){$null=$script:uiLease.Heartbeat($form.Visible);$script:lastHeartbeat=[DateTime]::UtcNow}
        if($script:page -ne 6){return}
        $paused=Test-Path -LiteralPath (Join-Path $script:session 'pause')
        Read-CapriInstallProgress $paused
        if($paused){
            $pause.Text=Text-Capri 'resume'
            if(Test-Path -LiteralPath (Join-Path $script:session 'ui-loss.json')){
                $hint=Text-Capri 'ownerLostPause'
                if($script:fields.recovery.Text -ne $hint){$script:fields.recovery.Text=$hint;Fit-CapriPage}
            }
        }else{
            $pause.Text=Text-Capri 'pause'
            if($script:fields.recovery.Text){$script:fields.recovery.Text='';Fit-CapriPage}
        }
        $exited=if($script:worker){$script:worker.HasExited}else{-not(Test-CapriWorker $script:session)}
        if($exited -and $script:eventsCursor.AtEnd){if(-not $script:result -and -not $script:failure){$script:failure=Text-Capri 'workerStopped'};
            if($script:worker){$script:worker.Dispose()}
            $script:worker=$null;
            $script:page=7;
            Render-CapriPage}
    }catch{
        $message=($_|Out-String)
        if($message -ne $script:lastPollError){$script:uiDiagnostics.Record('ui-poll-error',$message);$script:lastPollError=$message}
        if($script:uiLease -and $script:uiLease.IsOwner()){$script:uiLease.Control('pause')}
        if($script:fields.ContainsKey('recovery')){$script:fields.recovery.Text=Text-Capri 'uiError'}
    }
}
function Open-CapriSetupLogs {
    $form.UseWaitCursor=$true
    try {
        . (Join-Path $PSScriptRoot 'diagnostics.ps1')
        $logSession=if($script:session){$script:session}else{$script:lastDiagnosticSession}
        $logTarget=if($VerificationDirectory){Join-Path $VerificationDirectory 'fixture-install'}else{$options.target}
        $script:lastSetupLog=Save-CapriSetupLog -RegistryRoot $script:sessionsRoot -SessionDirectory $logSession -UiLogPath $UiLogPath -Target $logTarget -Failure $script:failure
        if(-not $VerificationDirectory){Start-Process -FilePath 'notepad.exe' -ArgumentList (Quote-CapriArgument $script:lastSetupLog)|Out-Null}
    }catch{
        $script:uiDiagnostics.Record('setup-log-open-failed',($_|Out-String))
        if($VerificationDirectory){throw}
        [Windows.Forms.MessageBox]::Show((Capri-SetupError $_.Exception.Message),(Text-Capri 'error'),'OK','Error')|Out-Null
    }finally{$form.UseWaitCursor=$false}
}
function Add-CapriReportButtons([int]$Y) {
    $report=New-Object Capri.Setup.Cyberpunk.Button
    $report.Name='saveDiagnostics';$report.Text=Text-Capri 'saveDiagnostics'
    Set-CapriBounds $report 28 $Y 300 34
    $report.Add_Click({Save-CapriReportFromWizard});$body.Controls.Add($report)
    $script:fields.reportButton=$report
    $logs=New-Object Capri.Setup.Cyberpunk.Button
    $logs.Text=Text-Capri 'logs';Set-CapriBounds $logs 348 $Y 300 34
    $logs.Add_Click({Open-CapriSetupLogs});$body.Controls.Add($logs)
    $script:fields.logsButton=$logs
    # Stage 6 uses its recovery notice below the log; avoid covering that surface.
    $script:fields.reportStatus=Add-CapriLabel '' $(if($Y -lt 400){620}else{$Y+42}) 58
}
function Save-CapriReportFromWizard {
    $script:fields.reportButton.Enabled=$false;$form.UseWaitCursor=$true
    try {
        . (Join-Path $PSScriptRoot 'diagnostics.ps1')
        $reportSession=if($script:session){$script:session}else{$script:lastDiagnosticSession}
        $reportTarget=if($VerificationDirectory){Join-Path $VerificationDirectory 'fixture-install'}else{$options.target}
        $reportOutput=if($VerificationDirectory){Join-Path $VerificationDirectory 'reports'}else{''}
        $saved=Save-CapriSetupDiagnostics -RegistryRoot $script:sessionsRoot -SessionDirectory $reportSession -UiLogPath $UiLogPath -Target $reportTarget -Failure $script:failure -OutputDirectory $reportOutput
        $script:lastDiagnosticReport=$saved
        $script:fields.reportStatus.Text=(Text-Capri 'diagnosticsSaved')+"`n"+$saved
        Fit-CapriPage
        $script:uiDiagnostics.Record('report-saved',[IO.Path]::GetFileName($saved))
        if(-not $VerificationDirectory){Start-Process -FilePath explorer.exe -ArgumentList ('/select,'+(Quote-CapriArgument $saved))|Out-Null}
    }catch{
        $script:uiDiagnostics.Record('report-export-failed',($_|Out-String))
        if($VerificationDirectory){throw}
        [Windows.Forms.MessageBox]::Show(((Text-Capri 'diagnosticsFailed')+"`n"+$_.Exception.Message),(Text-Capri 'error'),'OK','Error')|Out-Null
    }finally{$form.UseWaitCursor=$false;$script:fields.reportButton.Enabled=$true}
}
$timer=New-Object Windows.Forms.Timer;
$timer.Interval=250;
$timer.Add_Tick({Poll-CapriInstall});
$timer.Start()
$back.Add_Click({Save-CapriPage;
    $script:page=if($script:page -eq 7){5}else{$script:page-1};
    Render-CapriPage})
$next.Add_Click({try{
        Save-CapriPage
        if($script:page -eq 1 -and -not $options.acceptLicense){throw 'Please accept the license to continue.'}
        if($script:page -eq 2){$options.target=Assert-CapriTarget $options.target $sourceRoot (Read-CapriJson (Join-Path $sourceRoot 'package.json')).version;
            Load-CapriRepairSettings}
        if($script:page -eq 3 -and $options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface'){$selected=@($manifest.profiles|Where-Object{$_.id -eq $options.profile})[0];
            if(-not(Test-CapriProfileRam $hardware.ramGiB (Get-CapriRequiredRam $selected $hardware $memoryEstimates))){throw 'This profile requires more RAM.'}}
        if($script:page -eq 4 -and $options.voiceMode -in @('bundled','custom')){$options.voicePack=Assert-CapriVoicePack $options.voicePack}
    if($script:page -eq 5 -or ($script:page -eq 7 -and -not $script:result)){Start-CapriInstall;
            return}
        if($script:page -eq 7){
            Save-CapriFirstLaunchChoice $options.target $script:preloadOnFirstLaunch
            if($script:launchOnFinish){
                $next.Enabled=$false;$cancel.Enabled=$false;$form.UseWaitCursor=$true
                try{$script:uiDiagnostics.Record('launch-requested',$options.target)
                    $opened=Start-CapriInstalledApp $options.target
                    $script:uiDiagnostics.Record('launch-ready',([string]$opened.pid))
                }catch{$script:uiDiagnostics.Record('launch-failed',$_.Exception.Message);throw}
                finally{$next.Enabled=$true;$cancel.Enabled=$true;$form.UseWaitCursor=$false}
            };
            Clear-CapriSession
            $form.Close();
            return}
        $script:page++;
        Render-CapriPage
    }catch{[Windows.Forms.MessageBox]::Show((Capri-SetupError $_.Exception.Message),(Text-Capri 'error'),'OK','Warning')|Out-Null}})
$cancel.Add_Click({if($script:session -and $script:page -eq 6){if([Windows.Forms.MessageBox]::Show((Text-Capri 'cancelQuestion'),(Text-Capri 'title'),'YesNo','Question') -eq 'Yes'){$script:uiLease.Control('cancel');
            $script:cancelRequested=$true;
            $cancel.Enabled=$false;
            $script:fields.stage.Text=Text-Capri 'cancelWait'}}else{$form.Close()}})
$form.Add_FormClosing({param($sender,$eventArgs)
    $script:uiDiagnostics.Record('form-closing',[string]$eventArgs.CloseReason)
    if($script:superseded){return}
    if($script:session -and $script:page -eq 6){
        if(-not $VerificationDirectory -and $eventArgs.CloseReason -eq 'UserClosing' -and [Windows.Forms.MessageBox]::Show((Text-Capri 'closeInstallQuestion'),(Text-Capri 'title'),'YesNo','Question') -ne 'Yes'){$eventArgs.Cancel=$true;return}
        $script:uiLease.Control('pause')
        $script:uiLease.Dispose()
        $script:uiDiagnostics.ExitReason('paused-and-window-closed')
    }elseif($script:session){Clear-CapriSession}
})
function Update-CapriDisplay {
    $nextDpi=if($VerificationDirectory -and $VerificationDpi){$VerificationDpi}else{[Capri.Setup.Display]::Dpi($form.Handle)}
    if($nextDpi -eq $script:displayDpi){return}
    Save-CapriPage
    $script:displayDpi=$nextDpi;$script:displayScale=$nextDpi/96.0
    $form.Font=New-CapriFont 10;$brand.Font=New-CapriFont 19 'Bold';$releaseLabel.Font=New-CapriFont 9;$authorLabel.Font=New-CapriFont 9
    Set-CapriBounds $brand 24 26 175 48;Set-CapriBounds $releaseLabel 25 80 175 36
    Set-CapriBounds $authorLabel 25 76 175 24
    for($i=0;$i -lt $steps.Count;$i++){$steps[$i].Font=New-CapriFont 9;Set-CapriBounds $steps[$i] 24 (125+$i*48) 175 44}
    $body.Padding=New-Object Windows.Forms.Padding((D 28))
    $form.MinimumSize=New-Object Drawing.Size((D 936),(D 719))
    if(-not $VerificationDirectory){
        $area=[Windows.Forms.Screen]::FromControl($form).WorkingArea
        $form.MinimumSize=New-Object Drawing.Size(([Math]::Min((D 936),$area.Width)),([Math]::Min((D 719),$area.Height)))
        $form.Size=New-Object Drawing.Size(([Math]::Min($form.Width,$area.Width)),([Math]::Min($form.Height,$area.Height)))
    }
    Layout-CapriWizard;Render-CapriPage
    $script:uiDiagnostics.Record('dpi-change',('DPI='+$nextDpi))
}
$form.Add_MonitorDpiChanged({Update-CapriDisplay})
$form.Add_Shown({Update-CapriDisplay})
$form.Add_VisibleChanged({
    $script:uiDiagnostics.Record('ui-visibility',([string]$form.Visible))
    if($script:session -and $script:uiLease -and $script:uiLease.IsOwner()){
        $null=$script:uiLease.Heartbeat($form.Visible)
        if(-not $form.Visible -and (Test-CapriWorker $script:session)){[Capri.Setup.SessionIO]::Pause($script:session,'ui-window-hidden')}
    }
})
$form.Add_FormClosed({param($sender,$eventArgs)$script:uiDiagnostics.Record('form-closed',[string]$eventArgs.CloseReason)})
if(-not $VerificationDirectory){
    $area=[Windows.Forms.Screen]::FromPoint([Windows.Forms.Cursor]::Position).WorkingArea
    $form.MinimumSize=New-Object Drawing.Size(([Math]::Min((D 936),$area.Width)),([Math]::Min((D 719),$area.Height)))
    $form.Size=New-Object Drawing.Size(([Math]::Min($form.Width,$area.Width)),([Math]::Min($form.Height,$area.Height)))
}
Initialize-CapriCyberpunkTheme $form $sidebar $body $footer $brand $releaseLabel $steps $back $next $cancel $pause
$authorLabel.ForeColor=$releaseLabel.ForeColor
$existingSession=Get-CapriCurrentSession
if($ReconnectSession -and (-not $existingSession -or (Split-Path $existingSession -Leaf) -ne $ReconnectSession)){
    $script:uiDiagnostics.ExitReason('recovery-session-no-longer-active')
    $timer.Dispose();$form.Dispose();return
}
if($existingSession){
    try{Open-CapriSession $existingSession}
    catch{
        if($_.Exception.ToString() -match 'INSTALLER_UI_ALREADY_OPEN'){
            $script:uiDiagnostics.Record('duplicate-ui',($_|Out-String))
            if($ReconnectSession){$timer.Dispose();$form.Dispose();return}
            $owner=Read-CapriJson (Join-Path $existingSession 'ui-owner.json')
            $focused=[Capri.Setup.Display]::Focus([int]$owner.pid,[string]$owner.stamp,[long]$owner.windowHandle)
            if(-not $focused -and -not $VerificationDirectory){[Windows.Forms.MessageBox]::Show((Text-Capri 'windowAlreadyOpen'),(Text-Capri 'title'))|Out-Null}
            $timer.Dispose();$form.Dispose();return
        }
        throw
    }
}
Render-CapriPage
if($VerificationDirectory -and $VerificationFault -eq 'after-attach'){throw 'Injected UI failure after attaching to installation.'}
if($VerificationDirectory){
    $check=[IO.Path]::GetFullPath($VerificationDirectory);
    if(-not $check.StartsWith((Join-Path $sourceRoot '.runtime')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Verification output must stay inside the project cache.'};
    [IO.Directory]::CreateDirectory($check)|Out-Null
    $form.Show();
    [Windows.Forms.Application]::DoEvents()
    if([Capri.Setup.Display]::AppId() -ne 'Capri.Setup'){throw 'The installer taskbar identity is not Capri.Setup.'}
    if($VerificationFault -eq 'report-export'){
        $script:page=6;Render-CapriPage;Update-CapriDownloadProgress ([pscustomobject]@{received=1024;total=$null})
        if($script:fields.progress.Style -ne 'Continuous' -or $script:installProgress.value -ne 0 -or -not $script:installProgress.transfer){throw 'Unknown download size did not retain overall progress and transfer text.'}
        $script:failure='Injected installation failure before npm/Node is ready.';$script:page=7;Render-CapriPage
        $script:fields.reportButton.PerformClick()
        if(-not $script:lastDiagnosticReport -or -not (Test-Path -LiteralPath $script:lastDiagnosticReport)){throw 'The report button did not save a ZIP.'}
        $script:fields.logsButton.PerformClick()
        if(-not $script:lastSetupLog -or -not (Test-Path -LiteralPath $script:lastSetupLog)){throw 'The logs button did not create the combined log.'}
        Write-CapriJson (Join-Path $check 'report-export.json') @{file=$script:lastDiagnosticReport;log=$script:lastSetupLog;label=$script:fields.reportButton.Text;ownerDataAccessed=$false}
        $form.Close();$timer.Dispose();return
    }
    if($VerificationFault -eq 'reconnect'){
        if(-not $script:session -or -not $script:uiLease.IsOwner()){throw 'Fixture UI did not reconnect.'}
        $deadline=[DateTime]::UtcNow.AddSeconds(10)
        do{Poll-CapriInstall;[Windows.Forms.Application]::DoEvents();[Threading.Thread]::Sleep(50)}while($script:fields.progress.Value -ne 20 -and [DateTime]::UtcNow -lt $deadline)
        if($script:fields.progress.Value -ne 20 -or -not $pause.Enabled -or -not $cancel.Enabled){throw 'Recovered controls/progress are unavailable.'}
        if(-not(Test-Path -LiteralPath (Join-Path $script:session 'pause'))){throw 'Reconnection silently resumed installation.'}
        $script:uiLease.Control('resume')
        if(Test-Path -LiteralPath (Join-Path $script:session 'pause')){throw 'Resume did not clear the pause.'}
        Poll-CapriInstall
        if($script:fields.recovery.Text -or $pause.Text -ne (Text-Capri 'pause')){throw 'Resume left a stale automatic-pause notice.'}
        $script:uiLease.Control('pause')
        $script:uiLease.Control('cancel')
        $deadline=[DateTime]::UtcNow.AddSeconds(10)
        do{Poll-CapriInstall;[Windows.Forms.Application]::DoEvents();[Threading.Thread]::Sleep(50)}while($script:page -ne 7 -and [DateTime]::UtcNow -lt $deadline)
        if($script:page -ne 7){throw 'Cancel did not finish the fixture worker.'}
        Write-CapriJson (Join-Path $check 'recovery.json') @{reconnected=$true;progress=20;resumeWorked=$true;cancelWorked=$true;pausedUntilExplicitResume=$true}
        $form.Close();$timer.Dispose();return
    }
    $verificationIds=if($VerificationLanguages){@($VerificationLanguages -split ',')}else{@($locales|ForEach-Object{$_.id})}
    function Assert-CapriHelpLayout {
        foreach($button in @($body.Controls|Where-Object{$_.Visible -and $_.Name -like 'info-*'})){
            if($button.Left -lt 0 -or $button.Right -gt $body.ClientSize.Width){
                throw ('Help button outside the page: '+$button.Name)
            }
            foreach($control in $body.Controls){
                if($control -ne $button -and $control.Visible -and $button.Bounds.IntersectsWith($control.Bounds)){
                    throw ('Help button overlaps '+$control.GetType().Name+' on '+$installerLanguage+' page '+$script:page+': '+$button.Name+' '+$button.Bounds+' / '+$control.Bounds)
                }
            }
        }
    }
    function Select-CapriFixtureConversation([string]$Id){
        $choice=$script:fields.conversationLanguage
        for($index=0;$index -lt $choice.Items.Count;$index++){
            if(([string]$choice.Items[$index]).StartsWith($Id+' | ')){$choice.SelectedIndex=$index;return}
        }
        throw ('Conversation language is missing: '+$Id)
    }
    function Assert-CapriModelRecommendations {
        $savedOptions=$options.Clone()
        $savedBenchmark=$script:modelBenchmark
        $savedRam=$hardware.ramGiB
        $savedVram=$hardware.vramGiB
        try{
            $script:modelBenchmark=[pscustomobject]@{
                schemaVersion=1
                recommendations=[pscustomobject]@{
                    en=@('gemma4-e2b','quality','minimal')
                    ru=@('ministral-3-3b','desktop','balanced','minimal')
                }
            }
            $hardware.ramGiB=64;$hardware.vramGiB=12
            $script:fields.profile.SelectedIndex=1
            Select-CapriFixtureConversation 'en'
            Update-CapriModelRecommendations
            $caption=(Text-Capri 'modelRecommended')+': '
            $star=[string][char]0x2605
            $badges=@($script:fields.profile.Items|Where-Object{([string]$_).Contains($star)})
            if($script:fields.modelRecommendations.Text -cne ($caption+'gemma4:e2b, qwen3.5:9b') -or
               $badges.Count -ne 2 -or -not ($badges|Where-Object{([string]$_).Contains('gemma4:e2b (BETA)')})){
                throw 'The installer did not display the two highest-ranked compatible model recommendations.'
            }
            Select-CapriFixtureConversation 'ru'
            if($script:fields.modelRecommendations.Text -cne ($caption+'ministral-3:3b, qwen3.5:4b') -or
               (Selected-Capri 'profile') -ne 'balanced'){
                throw 'Changing the conversation language must refresh recommendations and retain the selected model.'
            }
            $hardware.ramGiB=16;$hardware.vramGiB=0
            Update-CapriModelRecommendations
            if($script:fields.modelRecommendations.Text -cne ($caption+'qwen3.5:2b, qwen3.5:0.8b')){
                throw 'Model recommendations must fit CPU-only hardware.'
            }
            $script:fields.api.Checked=$true
            if($script:fields.modelRecommendations.Visible){throw 'API mode must not show local model recommendations.'}
            $script:fields.huggingface.Checked=$true
            if($script:fields.modelRecommendations.Visible){throw 'Hugging Face mode must not show catalog recommendations.'}
            $script:fields.local.Checked=$true
            Save-CapriPage
            $script:page=4
            Render-CapriPage
            if((Selected-Capri 'conversationLanguage') -ne 'ru'){throw 'Components lost the language chosen on the model page.'}
            Select-CapriFixtureConversation 'tr'
            Save-CapriPage
            $script:page=3
            Render-CapriPage
            if((Selected-Capri 'conversationLanguage') -ne 'tr' -or
               (Selected-Capri 'profile') -ne 'balanced' -or $script:fields.modelRecommendations.Visible){
                throw 'Returning from Components must retain the new language and selected model without inventing recommendations.'
            }
        }finally{
            $script:modelBenchmark=$savedBenchmark
            $hardware.ramGiB=$savedRam;$hardware.vramGiB=$savedVram
            foreach($key in $savedOptions.Keys){$options[$key]=$savedOptions[$key]}
            $script:page=3
            Render-CapriPage
        }
    }
    foreach($language in $verificationIds){
        if(-not @($locales|Where-Object{$_.id -eq $language}).Count){throw 'Unsupported verification language.'}
        $script:installerLanguage=$language;
        $script:result=$null
        $script:progressView=$null
        foreach($number in @(0,1,2,3,4,5,6,7)){
            $script:page=$number;
            if($number -eq 7){$script:result=[PSCustomObject]@{modelsReady=$true}};
            Render-CapriPage;
            if($form.Text -cne $translations.$language.title){throw ('Installer title was not translated: '+$language)}
            if($number -eq 2 -and $language -eq $verificationIds[0]){
                $defaultTarget=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Capri'
                if($script:fields.target.Text -ne $defaultTarget){throw 'A new installation must default to Program Files.'}
                $older=Join-Path $check 'older Capri'
                $previous=Join-Path $check 'previous Capri'
                foreach($entry in @(@($older,'0.0.1'),@($previous,'0.0.2'))){
                    Write-CapriJson (Join-Path $entry[0] '.capri-install.json') @{
                        schemaVersion=1;productId='capri.desktop';root=$entry[0];version=$entry[1];installId=[Guid]::NewGuid().ToString()
                    }
                }
                $script:installations=@(Get-CapriInstallations -Candidates @($older,$previous) -NoRegistry)
                $selected=Select-CapriInitialInstallation $script:installations ([version]$version)
                $options.target=$selected.path
                Render-CapriPage
                if($script:fields.target.Text -ne $previous -or $script:fields.existing.SelectedIndex -lt 0 -or
                   -not $script:fields.existing.Text.StartsWith('v0.0.2 | ')){throw 'Existing installation was not selected by default.'}
                $script:fields.target.Text=Join-Path $check 'different Capri'
                if($script:fields.existing.SelectedIndex -ne -1){throw 'Editing the target left a stale existing installation selection.'}
                $script:fields.target.Text=$older
                if($script:fields.existing.SelectedIndex -lt 0 -or -not $script:fields.existing.Text.StartsWith('v0.0.1 | ')){
                    throw 'Typing the previous path did not select its existing installation.'
                }
                $options.target=$defaultTarget
                $script:installations=@()
                Render-CapriPage
            }
            $helpButtons=@($body.Controls|Where-Object{$_.Name -like 'info-*'})
            if(-not $helpButtons.Count -or @($helpButtons|Where-Object{$_.AccessibleDescription.Length -lt 12}).Count){
                throw ('Wizard contextual help is missing on page '+$number)
            }
            Assert-CapriHelpLayout
            if($number -eq 4){
                $normalSize=$form.ClientSize
                $normalMinimum=$form.MinimumSize
                try{
                    $form.MinimumSize=[Drawing.Size]::Empty
                    $form.ClientSize=New-Object Drawing.Size((D 825),(D 610))
                    [Windows.Forms.Application]::DoEvents()
                    if(-not $body.VerticalScroll.Visible){throw 'The components layout did not exercise vertical scrolling.'}
                    Assert-CapriHelpLayout
                }finally{
                    $form.ClientSize=$normalSize
                    $form.MinimumSize=$normalMinimum
                }
                Assert-CapriHelpLayout
            }
            $expectedRtl=@($interfaceLocales.locales|Where-Object{$_.id -eq $language})[0].direction -eq 'rtl'
            if($form.RightToLeftLayout -ne $expectedRtl){throw ('Incorrect layout direction: '+$language)}
            if($number -in @(3,4,5)){
                if(-not $budgetPanel.Visible -or $body.Bottom -gt $budgetPanel.Top -or $budgetPanel.Bottom -gt $footer.Top){throw 'Memory estimate overlaps navigation or component controls.'}
            }
            if($number -eq 3){
                if(-not $script:fields.api.Text.EndsWith(' (BETA)')){throw 'The API installation option must be marked BETA.'}
                if($language -eq $verificationIds[0]){Assert-CapriModelRecommendations}
                $initialProfile=$script:fields.profile.SelectedIndex
                $initialProfileId=$options.profile
                if($language -eq 'en'){
                    $storageLabels=@{}
                    for($index=0;$index -lt $manifest.profiles.Count;$index++){
                        $script:fields.profile.SelectedIndex=$index
                        $model=$manifest.profiles[$index]
                        $estimate=$script:fields.storageEstimate.Text
                        if($storageLabels.ContainsKey($estimate)){throw ('Duplicate local disk estimate for '+$model.id)}
                        $storageLabels[$estimate]=$true
                        Save-CapriPage
                        if($options.profile -ne $model.id){throw ('Selected model was not saved: '+$model.id)}
                        $script:page=5
                        Render-CapriPage
                        if(-not $script:fields.reviewSummary.Text.Contains($estimate) -or
                           -not $script:fields.reviewSummary.Text.Contains($model.model)){throw ('Review lost the selected model or disk estimate: '+$model.id)}
                        $script:page=3
                        Render-CapriPage
                    }
                    $options.profile=$initialProfileId
                }
                $script:fields.profile.SelectedIndex=0
                $smallBudget=$script:memoryBudget
                $script:fields.profile.SelectedIndex=3
                if($script:memoryBudget.ram.estimate[1] -le $smallBudget.ram.estimate[1]){throw 'Selecting a larger model did not update memory.'}
                $localBudget=$script:memoryBudget
                $script:fields.api.Checked=$true
                if($script:fields.profile.Enabled -or $script:memoryBudget.ram.estimate[1] -ge $localBudget.ram.estimate[1]){throw 'API mode must disable the local model and remove its memory budget.'}
                $apiStorage=$script:fields.storageEstimate.Text
                $script:fields.profile.SelectedIndex=0
                if($apiStorage -ne $script:fields.storageEstimate.Text){throw 'API mode included local model disk space.'}
                Save-CapriPage
                if($options.inferenceMode -ne 'api'){throw 'API mode was not retained.'}
                $script:page=4
                Render-CapriPage
                if($script:fields.models.Enabled -or $script:fields.models.Checked){throw 'API mode offered local model downloads.'}
                $script:page=3
                Render-CapriPage
                $script:fields.huggingface.Checked=$true
                if($script:fields.profile.Enabled -or $script:fields.storageEstimate.Text -ne $apiStorage){throw 'Hugging Face mode must defer the catalog model and retain the component estimate.'}
                foreach($kind in @('ram','vram')){
                    if($budgetRows[$kind].bar.Visible -or -not $budgetRows[$kind].label.Text.EndsWith('?')){throw 'An unselected Hugging Face model must have unknown memory use and no bar.'}
                }
                if($budgetInfo.AccessibleDescription -ne (Text-Capri 'budgetHuggingFaceUnknown')){throw 'Hugging Face memory help must explain why the estimate is unknown.'}
                Save-CapriPage
                if($options.inferenceMode -ne 'local' -or $options.modelSource -ne 'huggingface'){throw 'Hugging Face must remain a local-model choice.'}
                $script:page=4
                Render-CapriPage
                if($script:fields.models.Enabled -or $script:fields.models.Checked){throw 'Hugging Face mode offered catalog downloads.'}
                $options.inferenceMode='local'
                $options.modelSource='catalog'
                $options.profile=$initialProfileId
                $script:page=3
                Render-CapriPage
                $script:fields.profile.SelectedIndex=$initialProfile
            }
            if($number -eq 4){
                if($script:fields.ContainsKey('router') -or -not $script:fields.ContainsKey('classifier')){throw 'The CPU classifier must be mandatory.'}
                foreach($key in @('recognition','models','desktop','startMenu')){
                    if(-not $script:fields[$key].Checked){throw ('An installation component is not selected by default: '+$key)}
                }
                if(-not $script:fields.voicePack.ReadOnly -or $script:fields.voiceBrowse.Enabled){throw 'Voice source must be read-only and selected automatically or explicitly.'}
                $initialBudget=$script:memoryBudget|ConvertTo-Json -Depth 8 -Compress
                foreach($key in @('recognition','models')){
                    $before=$script:memoryBudget
                    $script:fields[$key].Checked=$false
                    if($script:memoryBudget.ram.estimate[1] -ge $before.ram.estimate[1]){throw ('Memory estimate did not react to deselecting '+$key)}
                    if($key -eq 'recognition' -and $script:memoryBudget.vram.estimate[1] -ne $before.vram.estimate[1]){throw 'CPU recognition incorrectly changed VRAM.'}
                    $script:fields[$key].Checked=$true
                }
                $initialLanguage=$script:fields.conversationLanguage.SelectedIndex
                $englishBudget=$script:memoryBudget
                for($index=0;$index -lt $script:fields.conversationLanguage.Items.Count;$index++){
                    if(([string]$script:fields.conversationLanguage.Items[$index]).StartsWith('ru |')){$script:fields.conversationLanguage.SelectedIndex=$index;break}
                }
                if($script:memoryBudget.ram.estimate[1] -le $englishBudget.ram.estimate[1]){throw 'Multilingual recognition did not update RAM.'}
                $script:fields.conversationLanguage.SelectedIndex=$initialLanguage
                if(($script:memoryBudget|ConvertTo-Json -Depth 8 -Compress) -ne $initialBudget){throw 'Memory estimate did not return to the original selection.'}
                $initial=Selected-Capri 'voiceMode'
                if($BundledVoicePack -and $voiceGpu -and $initial -ne 'bundled'){throw 'Included voice must be recommended on supported hardware.'}
                for($index=0;$index -lt $script:fields.voiceMode.Items.Count;$index++){
                    if(([string]$script:fields.voiceMode.Items[$index]).StartsWith('custom |')){
                        $script:fields.voiceMode.SelectedIndex=$index
                        if(-not $script:fields.voiceBrowse.Enabled){throw 'Custom voice did not enable its picker.'}
                        $script:fields.voicePack.Text=Join-Path $check 'not-a-voice-pack'
                    }
                }
                for($index=0;$index -lt $script:fields.voiceMode.Items.Count;$index++){
                    if(([string]$script:fields.voiceMode.Items[$index]).StartsWith('off |')){$script:fields.voiceMode.SelectedIndex=$index}
                }
                if($initial -eq 'bundled' -and $script:memoryBudget.vram.estimate[1] -ge $englishBudget.vram.estimate[1]){throw 'Disabling voice did not lower the VRAM estimate.'}
                Save-CapriPage
                if($options.voicePack){throw 'Text mode retained a stale voice source.'}
                $offEstimate=$script:fields.storageEstimate.Text
                $offVram=$script:memoryBudget.vram.estimate[1]
                for($index=0;$index -lt $script:fields.voiceMode.Items.Count;$index++){
                    if(([string]$script:fields.voiceMode.Items[$index]).StartsWith('qwen |')){$script:fields.voiceMode.SelectedIndex=$index;break}
                }
                Save-CapriPage
                if($options.voiceMode -ne 'qwen' -or $options.voicePack -or $options.bundledVoicePack -ne $BundledVoicePack -or $script:fields.storageEstimate.Text -eq $offEstimate -or $script:memoryBudget.vram.estimate[1] -ne $offVram){throw 'Hugging Face CPU voice choice, included reference or budget is incorrect.'}
                for($index=0;$index -lt $script:fields.conversationLanguage.Items.Count;$index++){
                    if(([string]$script:fields.conversationLanguage.Items[$index]).StartsWith('tr |')){$script:fields.conversationLanguage.SelectedIndex=$index;break}
                }
                if((Selected-Capri 'voiceMode') -ne 'off' -or @($script:fields.voiceMode.Items|Where-Object{$_ -like 'qwen |*'}).Count){throw 'Qwen was offered for an unsupported language.'}
                $script:fields.conversationLanguage.SelectedIndex=$initialLanguage
                $script:fields.voicePack.Text=''
                for($index=0;$index -lt $script:fields.voiceMode.Items.Count;$index++){
                    if(([string]$script:fields.voiceMode.Items[$index]).StartsWith($initial+' |')){$script:fields.voiceMode.SelectedIndex=$index}
                }
                Save-CapriPage
                if($initial -eq 'bundled' -and $options.voicePack -ne $BundledVoicePack){throw 'Included voice was not selected for the installation request.'}
                Write-CapriJson (Join-Path $check ($language+'-voice.json')) @{mode=$options.voiceMode;source=$options.voicePack;gpu=$voiceGpu}
                $savedBudget=$script:memoryBudget|ConvertTo-Json -Depth 8 -Compress
                $script:page=5;Render-CapriPage
                if(($script:memoryBudget|ConvertTo-Json -Depth 8 -Compress) -ne $savedBudget){throw 'Review changed the memory estimate.'}
                $script:page=4;Render-CapriPage
                if(($script:memoryBudget|ConvertTo-Json -Depth 8 -Compress) -ne $savedBudget){throw 'Returning to components lost the memory estimate.'}
            }
            [Windows.Forms.Application]::DoEvents();
            if($number -eq 5){
                $consentGap=$script:fields.consent.Top-$script:fields.reviewSummary.Bottom
                if($consentGap -lt (D 8) -or $consentGap -gt (D 16)){
                    throw ('Review rows overlap or have excessive spacing: '+$language)
                }
                $script:fields.consent.Checked=$true
                Update-CapriDiskReview -Available ($script:reviewStorage.requiredBytes-1)
                if($next.Enabled -or -not $script:fields.reviewSummary.Text.Contains((Text-Capri 'diskSpaceError'))){
                    throw 'Insufficient space must block installation and show the warning.'
                }
                Update-CapriDiskReview -Available $script:reviewStorage.requiredBytes
                if(-not $next.Enabled){throw 'Setup did not enable installation after space was freed.'}
                $script:fields.consent.Checked=$options.acceptDownloads
            }
            if($number -eq 7 -and $language -eq $verificationIds[0]){
                if(-not $script:fields.preloadOnFirstLaunch.Checked){throw 'First-launch model preload must default to on.'}
                $script:fields.launch.Checked=$false
                $script:fields.preloadOnFirstLaunch.Checked=$false
                Save-CapriPage
                Render-CapriPage
                if($script:fields.launch.Checked -or $script:fields.preloadOnFirstLaunch.Checked){throw 'The first-launch options were lost on redraw.'}
                $fixtureTarget=Join-Path $check 'first-launch-choice'
                Save-CapriFirstLaunchChoice $fixtureTarget $script:preloadOnFirstLaunch
                $saved=Read-CapriJson (Join-Path $fixtureTarget 'data/desktop/first-start.json')
                if($saved.schemaVersion -ne 1 -or $saved.preloadModels -cne $false){throw 'The first-launch preference was not saved.'}
                $script:launchOnFinish=$true
                $script:preloadOnFirstLaunch=$true
                $options.inferenceMode='api'
                Render-CapriPage
                if(-not $script:fields.launch.Checked -or $script:fields.ContainsKey('preloadOnFirstLaunch')){
                    throw 'API setup must offer app launch without a local model preload checkbox.'
                }
                Save-CapriPage
                Save-CapriFirstLaunchChoice $fixtureTarget $script:preloadOnFirstLaunch
                $saved=Read-CapriJson (Join-Path $fixtureTarget 'data/desktop/first-start.json')
                if($saved.preloadModels -cne $false){throw 'API setup must disable first-launch preloading.'}
                $options.inferenceMode='local'
                $options.modelSource='huggingface'
                Render-CapriPage
                if($script:fields.ContainsKey('preloadOnFirstLaunch')){throw 'Hugging Face setup must not offer preloading before a model is selected.'}
                Save-CapriPage
                if($script:preloadOnFirstLaunch){throw 'Hugging Face setup must defer first-launch preloading.'}
                $options.modelSource='catalog'
                $script:preloadOnFirstLaunch=$true
                Render-CapriPage
            }
            if($number -eq 3){Write-CapriJson (Join-Path $check ($language+'-models.json')) @{items=@($script:fields.profile.Items);index=$script:fields.profile.SelectedIndex;text=$script:fields.profile.Text}}
            if($number -eq 0){Write-CapriJson (Join-Path $check ($language+'-selection.json')) @{items=@($script:fields.installerLanguage.Items);index=$script:fields.installerLanguage.SelectedIndex;text=$script:fields.installerLanguage.Text}}
        $image=New-Object Drawing.Bitmap($form.Width,$form.Height);
            $form.DrawToBitmap($image,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)));
            $image.Save((Join-Path $check ($language+'-'+$number+'.png')));
            $image.Dispose()
        }
        # Exercise the real progress page and heading with a local fixture only.
        $progressTarget=Join-Path $check 'progress-target'
        [IO.Directory]::CreateDirectory($progressTarget)|Out-Null
        $progressIdentity=Join-Path $progressTarget '.capri-install.json'
        $progressRecord=@{schemaVersion=1;productId='capri.desktop';installId='11111111-1111-4111-8111-111111111111';root=$progressTarget;version='0.0.1'}
        Write-CapriJson $progressIdentity $progressRecord
        $options.updating=Test-CapriUpdateTarget (Assert-CapriTarget $progressTarget $sourceRoot $version) $version
        $script:page=6;Render-CapriPage
        if(-not $options.updating -or $script:fields.heading.Text -ne ((Text-Capri 'updatingTo') -f ('v'+$version))){throw 'The older installation did not display the target update version.'}
        $progressRecord.version=$version
        Write-CapriJson $progressIdentity $progressRecord
        $options.updating=Test-CapriUpdateTarget (Assert-CapriTarget $progressTarget $sourceRoot $version) $version
        if($options.updating){throw 'Repairing the current version was misidentified as an update.'}
        $script:installProgress=New-CapriInstallProgress
        $fixtureProgress=$script:installProgress
        Set-CapriProgressPlan $fixtureProgress @('node','models','finalize')
        Set-CapriProgressFraction $fixtureProgress 'models' 0.25
        if($fixtureProgress.value -ne 21){throw 'Model progress did not map to its portion of the overall bar.'}
        Set-CapriProgressFraction $fixtureProgress 'models' 0.05
        if($fixtureProgress.value -ne 21){throw 'The overall progress went backwards when a new file started.'}
        $fixtureProgress.started=[DateTime]::UtcNow.AddSeconds(-30)
        if(-not (Get-CapriProgressEta $fixtureProgress)){throw 'Active progress did not produce an ETA.'}
        Set-CapriProgressPaused $fixtureProgress $true
        if(Get-CapriProgressEta $fixtureProgress){throw 'An ETA was shown while the installer was paused.'}
        Set-CapriProgressPaused $fixtureProgress $false
        Set-CapriProgressFraction $fixtureProgress 'finalize' 1
        if($fixtureProgress.value -ne 99){throw 'Progress reached 100% before successful completion.'}
        $script:installProgress=New-CapriInstallProgress
        $script:progressView=$null
        $script:page=6;Render-CapriPage
        $geometry=@($form.Bounds.ToString(),$footer.Bounds.ToString(),$script:fields.log.Bounds.ToString(),$body.AutoScrollPosition.ToString()) -join '|'
        for($cycle=0;$cycle -lt 6;$cycle++){
            $pause.Text=Text-Capri $(if($cycle%2){'pause'}else{'resume'})
            $script:fields.progressText.Text=$(if($cycle%2){'25%'}else{Text-Capri 'pauseHelp'})
            Fit-CapriPage;[Windows.Forms.Application]::DoEvents()
            $after=@($form.Bounds.ToString(),$footer.Bounds.ToString(),$script:fields.log.Bounds.ToString(),$body.AutoScrollPosition.ToString()) -join '|'
            if($geometry -ne $after){throw ('Pause/resume moved the installation viewport: '+$language+'; '+$geometry+' -> '+$after)}
        }
        $script:fields.progressText.Text=Text-Capri 'pauseHelp';Fit-CapriPage
        if($script:fields.progressText.Bottom+(D 8) -gt $script:fields.warning.Top -or $script:fields.warning.Bottom+(D 8) -gt $script:fields.log.Top){throw ('Installation warning overlaps adjacent content: '+$language)}
        $script:page=7;$script:result=$null
        $networkDetails='Component exited 1. Failed to fetch model: tls handshake eof (UND_ERR_CONNECT_TIMEOUT)'
        $script:failure=Capri-SetupError $networkDetails
        if(-not $script:failure.Contains((Text-Capri 'networkHelp')) -or -not $script:failure.Contains($networkDetails)){
            throw ('Network recovery advice or technical details are missing: '+$language)
        }
        Render-CapriPage
        $networkCheck=Join-Path $check 'network-errors'
        [IO.Directory]::CreateDirectory($networkCheck)|Out-Null
        $networkImage=New-Object Drawing.Bitmap($form.Width,$form.Height)
        $form.DrawToBitmap($networkImage,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
        $networkImage.Save((Join-Path $networkCheck ($language+'.png')))
        $networkImage.Dispose()
        $script:failure=Capri-SetupError 'VOICE_PACK_PROFILE_MISSING'
        Render-CapriPage
        if($script:failure -cne (Text-Capri 'voiceProfileMissing')){throw ('Voice error was not translated: '+$language)}
        Write-CapriJson (Join-Path $check ($language+'-layout.json')) @{rtl=$form.RightToLeftLayout;scrollable=$body.AutoScroll;title=$form.Text;versionLabel=$releaseLabel.Text;voiceError=$script:failure;languageCount=$locales.Count;stages=$translations.$language.stages;dpi=$script:displayDpi;fontUnit=[string]$form.Font.Unit;fontPixels=$form.Font.Size;footerTop=$footer.Top;footerBottom=$footer.Bottom;clientHeight=$form.ClientSize.Height;perMonitorV2=[Capri.Setup.Display]::PerMonitorV2($form.Handle)}
    }
    $form.Close();
    $timer.Dispose();
    Write-Output 'Wizard pages rendered; no installation or user data access performed.'
}else{[Windows.Forms.Application]::Run($form);
    $timer.Dispose()}
