# Loaded by wizard.ps1, which owns DPI initialization, diagnostics and the recovery lease.
# SPDX-License-Identifier: GPL-3.0-only
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'install-discovery.ps1')
. (Join-Path $PSScriptRoot 'installed-models.ps1')
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
$script:catalogProfiles=@($manifest.profiles)
$script:currentModelProfile=$null
$script:installedModelNames=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
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
$surveyTranslations=Read-CapriJson (Join-Path $sourceRoot 'config/installer-survey-text.json')
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
$voiceCatalog=(Read-CapriJson (Join-Path $sourceRoot 'config/tts-catalog.json')).models
$qwenVoice=@($voiceCatalog|Where-Object{$_.id -eq 'qwen3-tts-0.6b-base'})[0]
$russianVoice=@($voiceCatalog|Where-Object{$_.id -eq 'qwen3-tts-1.7b-capri-ru'})[0]
$russianPack=(Read-CapriJson (Join-Path $sourceRoot 'config/qwen-ru-voice.json')).pack
$russianVoiceLabel=$russianVoice.name+' / CPU / NVIDIA CUDA'
function Test-CapriRussianVoicePack([string]$Folder) {
    if(-not $Folder){return $false}
    try{
        foreach($entry in $russianPack.files){
            $file=Join-Path $Folder $entry.file
            Assert-CapriNoLinks $file
            if(-not(Test-Path -LiteralPath $file -PathType Leaf) -or
               (Get-Item -LiteralPath $file -Force).Length -ne $entry.bytes -or
               (Get-CapriHash $file) -ne $entry.sha256){return $false}
        }
        return $true
    }catch{return $false}
}
$script:bundledRussianVoiceAvailable=$BundledVoicePack -and (Test-CapriRussianVoicePack (Join-Path $BundledVoicePack 'russian'))
$script:russianVoiceAvailable=$script:bundledRussianVoiceAvailable
$recommendation='minimal'
foreach($candidate in @($manifest.profiles|Where-Object{$_.id -in @('balanced','desktop','quality')})){
    $ram=Get-CapriRequiredRam $candidate $hardware $memoryEstimates
    if((Test-CapriProfileRam $hardware.ramGiB $ram) -and ($candidate.id -eq 'balanced' -or $hardware.vramGiB -ge ($candidate.recommendedVramGiB-0.125))){$recommendation=$candidate.id}
}
$version=(Read-CapriJson (Join-Path $sourceRoot 'package.json')).version
$releaseTag=(Read-CapriJson (Join-Path $sourceRoot 'config/release.json')).tag
$displayVersion=$version
if($releaseTag -cmatch '^v(\d+\.\d+\.\d+)-experimental\.(\d+)$' -and $Matches[1] -eq $version){$displayVersion=$version+'E'+$Matches[2]}
$script:installations=@(if(-not $VerificationDirectory){Get-CapriInstallations|Sort-Object @{Expression={[version]$_.version};Descending=$true},path})
$options=@{schemaVersion=1;
    target=(Get-CapriDefaultTarget);
    profile=$recommendation;
    languageDevice='';
    inferenceMode='local';
    modelSource='catalog';
    repair=$false;
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
$script:questionPages=@('interface','license','location','device','conversation','model','voice','components','review')
$script:surveyPages=$script:questionPages+@('progress','finish')
$script:page='interface'
$script:budgetPages=@('device','model','voice','components','review')
$script:interfaceLanguageChosen=$false
$script:modelSelectionExplicit=$false
$script:currentLanguageDevice='auto'
$script:settingsTarget=$null
$script:customConversation=''
$script:fields=@{};
$script:worker=$null;
$script:session=$null;
$script:result=$null;
$script:completionSession=$null
$script:completionNoticeCount=0
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
$script:questionView=''
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
$brand.Text='CAPRI';
$brand.Font=New-CapriFont 19 'Bold';
$brand.ForeColor=[Drawing.Color]::FromArgb(67,225,225);
$sidebar.Controls.Add($brand)
$releaseLabel=New-Object Capri.Setup.Cyberpunk.Label
$releaseLabel.Text='v'+$displayVersion
$releaseLabel.Font=New-CapriFont 13 'Bold'
$releaseLabel.UseMnemonic=$false
$releaseLabel.RightToLeft='No'
$releaseLabel.ForeColor=$brand.ForeColor
$sidebar.Controls.Add($releaseLabel)
$authorLabel=New-Object Capri.Setup.Cyberpunk.Label
$authorLabel.Text='by Overyx'
$authorLabel.Font=New-CapriFont 9
$authorLabel.ForeColor=[Drawing.Color]::FromArgb(154,173,190)
$sidebar.Controls.Add($authorLabel)
$steps=@();
for($i=0;
$i -lt $script:surveyPages.Count;
$i++){$label=New-Object Capri.Setup.Cyberpunk.Label;
    $label.Font=New-CapriFont 9;
    $sidebar.Controls.Add($label);
    $steps+=$label}
function Layout-CapriSidebarHeader {
    $left=D 24
    $width=D 157
    Set-CapriBounds $brand 24 26 157 32
    $versionHeight=$releaseLabel.GetPreferredSize([Drawing.Size]::new($width,0)).Height
    $releaseLabel.SetBounds($left,$brand.Bottom,$width,$versionHeight)
    $authorLabel.SetBounds($left,($releaseLabel.Bottom+(D 2)),$width,(D 20))
    $sidebar.SidebarDividerY=$authorLabel.Bottom+(D 9)
    $sidebar.Invalidate()
}
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
function Survey-Capri([string]$Key,[string]$Fallback=''){
    $locale=$surveyTranslations.PSObject.Properties[$installerLanguage]
    if($locale -and $locale.Value.PSObject.Properties[$Key]){return $locale.Value.$Key}
    if($Fallback){return (Text-Capri $Fallback)}
    return $surveyTranslations.en.$Key
}
function Get-CapriQuestionTitle([string]$Page){
    switch($Page){
        'interface'{Survey-Capri 'interface' 'uiLanguage'}
        'device'{Survey-Capri 'device' 'survey.hardware'}
        'conversation'{Survey-Capri 'conversation' 'conversationLanguage'}
        'model'{Text-Capri 'survey.profile'}
        'voice'{Survey-Capri 'voice' 'voiceChoice'}
        default{Text-Capri ('survey.'+$Page)}
    }
}
function Get-CapriDeviceChoiceLabel([string]$Device){
    switch($Device){
        'cpu'{Survey-Capri 'deviceCpu'}
        'auto'{Survey-Capri 'deviceAuto'}
        default{Survey-Capri 'deviceKeep'}
    }
}
function Get-CapriEffectiveLanguageDevice {
    if($options.languageDevice){return $options.languageDevice}
    return $script:currentLanguageDevice
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
    $budgetPanel.Visible=$script:page -in $script:budgetPages
    $budgetLayout=Get-CapriMemoryBudgetLayout ($form.ClientSize.Width-(D 205))
    $budgetHeight=if($budgetPanel.Visible){$budgetLayout.height}else{0}
    $budgetPanel.SetBounds((D 205),($form.ClientSize.Height-$footerHeight-$budgetHeight),($form.ClientSize.Width-(D 205)),$budgetHeight)
    Layout-CapriMemoryBudget $budgetLayout
    $body.SetBounds((D 205),0,($form.ClientSize.Width-(D 205)),($form.ClientSize.Height-$footerHeight-$budgetHeight))
    $right=$footer.Width-(D 28)
    for($index=2;$index -ge 0;$index--){$button=@($back,$next,$cancel)[$index];$width=$buttonWidths[$index];$right-=$width;$button.SetBounds($right,(D 19),$width,(D 33));$right-=(D 12)}
    $pause.SetBounds((D 20),$(if($footerHeight -gt (D 70)){D 64}else{D 19}),$pauseWidth,(D 33))
}

$form.Add_SizeChanged({
    if($script:fields.ContainsKey('heading')){Fit-CapriPage}else{Layout-CapriWizard}
})
Layout-CapriWizard
function Capri-SetupError([string]$Message,[string]$Code='') {
    return (Get-CapriSetupError $translations $installerLanguage $Message $Code)
}
function Fit-CapriPage {
    $body.BeginPageUpdate()
    try{
        $body.FinishQuestionReveal()
        $body.CloseDropDowns()
        Layout-CapriWizard
        # A newly visible scrollbar narrows anchored labels. Settle their wrapped
        # height in the same update rather than waiting for the next event.
        for($pass=0;$pass -lt 3;$pass++){
            $width=$body.ClientSize.Width
            $body.SuspendLayout()
            try{Fit-CapriPageRows}finally{$body.ResumeLayout($true)}
            if($width -eq $body.ClientSize.Width){break}
        }
    }finally{
        $body.EndPageUpdate()
    }
}
function Fit-CapriPageRows {
    # Measure rows in unscrolled coordinates and apply only their final bounds.
    $scroll=$body.AutoScrollPosition
    foreach($control in $body.Controls){
        if(-not $control.Tag){$control.Tag=@{top=$control.Top-$scroll.Y;height=$control.Height;width=$control.Width}}
    }
    # A single viewport edge drives both the help column and the controls beside it.
    $helpRight=[Math]::Min((D 648),($body.ClientSize.Width-(D 28)))
    $helpGap=D 6
    $offset=0
    $pageBottom=0
    $diskWarning=$script:fields['diskWarning']
    $rows=@($body.Controls|Where-Object{$_ -ne $diskWarning -or $script:diskReviewBlocked}|Sort-Object {$_.Tag.top})
    for($index=0;$index -lt $rows.Count;){
        $top=$rows[$index].Tag.top;$group=@();$originalBottom=$top;$bottom=$top
        while($index -lt $rows.Count -and [Math]::Abs($rows[$index].Tag.top-$top) -le (D 4)){$group+=$rows[$index];$index++}
        $help=@($group|Where-Object{$_.Name -like 'info-*'})
        $button=if($help.Count -eq 1){$help[0]}else{$null}
        $helpLeft=if($button){$helpRight-$button.Width}else{0}
        foreach($control in $group){
            $base=$control.Tag
            $left=$control.Left-$scroll.X
            $width=$control.Width
            $height=$base.height
            if($control -eq $button){$left=$helpLeft}
            elseif($button){
                $control.Anchor='Top,Left'
                $width=[Math]::Max(1,[Math]::Min($base.width,($helpLeft-$helpGap-$left)))
            }
            if($control -eq $diskWarning){$width=[Math]::Max(1,($helpRight-$left))}
            if($control -is [Windows.Forms.Label] -or $control -is [Windows.Forms.CheckBox] -or $control -is [Windows.Forms.RadioButton]){
                if($script:page -eq 'review' -and $control -is [Windows.Forms.Label]){
                    # Use the Label's own wrapping and padding rules on the compact review page.
                    $needed=$control.GetPreferredSize([Drawing.Size]::new($width,0)).Height+(D 6)
                }else{
                    $inset=if($control -is [Windows.Forms.Label]){0}elseif($control -is [Capri.Setup.Cyberpunk.RadioButton] -and $control.SurveyAnswer){D 50}else{D 30}
                    $textWidth=[Math]::Max(1,($width-$inset))
                    $flags=[Windows.Forms.TextFormatFlags]::WordBreak -bor [Windows.Forms.TextFormatFlags]::NoPrefix
                    $needed=[Windows.Forms.TextRenderer]::MeasureText($control.Text,$control.Font,[Drawing.Size]::new($textWidth,10000),$flags).Height+(D 6)
                }
                if($script:page -eq 'progress' -and $script:fields.ContainsKey('progressText') -and $control -eq $script:fields.progressText){
                    $pauseText=((Text-Capri 'progressOverall') -f 100)+"`r`n"+(Text-Capri 'pauseHelp')
                    $pauseHeight=[Windows.Forms.TextRenderer]::MeasureText($pauseText,$control.Font,[Drawing.Size]::new($textWidth,10000),$flags).Height+(D 6)
                    $needed=[Math]::Max($needed,$pauseHeight)
                }
                $height=[Math]::Max($height,$needed)
            }
            $originalBottom=[Math]::Max($originalBottom,($base.top+$base.height))
            $bottom=[Math]::Max($bottom,($base.top+$height))
            $control.SetBounds(($left+$scroll.X),($base.top+$offset+$scroll.Y),$width,$height)
            if($control -is [Windows.Forms.TextBox]){$control.RightToLeft='No';$control.TextAlign='Left'}
        }
        $pageBottom=[Math]::Max($pageBottom,($bottom+$offset))
        $offset+=$bottom-$originalBottom
    }
    $body.AutoScrollMinSize=[Drawing.Size]::new(0,($pageBottom+(D 28)))
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
function Get-CapriConversationChoices {
    $catalog|ForEach-Object{$_.id+' | '+$_.label}
    if($script:customConversation){'custom | '+$script:customConversation}
}
function Format-CapriModelChoice($Profile,[bool]$Recommended) {
    $beta=if($Profile.PSObject.Properties['experimental'] -and $Profile.experimental){' (BETA)'}else{''}
    $estimate=$memoryEstimates.models.PSObject.Properties[$Profile.id]
    $vram=if((Get-CapriEffectiveLanguageDevice) -eq 'cpu'){'0'}elseif($estimate){$estimate.Value.vram -join '-'}else{'?'}
    $ram=if($estimate){[string](Get-CapriRequiredRam $Profile $hardware $memoryEstimates (Get-CapriEffectiveLanguageDevice))+'+'}else{'?'}
    $badge=if($Recommended){' | '+[char]0x2605+' '+(Text-Capri 'modelRecommended')}else{''}
    $alias=if($Profile.model -like 'qwen3.5:*'){'capri-'+$Profile.model}else{$Profile.model}
    $status=''
    if($Profile.id -eq $script:currentModelProfile){$status+=(Text-Capri 'modelCurrent')+' | '}
    if($script:installedModelNames.Contains($Profile.model) -or $script:installedModelNames.Contains($alias)){$status+=(Text-Capri 'modelInstalled')+' | '}
    return $Profile.id+' | '+$status+$Profile.model+$beta+' | VRAM ~'+$vram+' GiB | RAM '+$ram+' GiB'+$badge
}
function Update-CapriHardwareLabel {
    if(-not $script:fields.ContainsKey('modelHardware')){return}
    $gpuName=if($hardware.selectedGpu){$hardware.selectedGpu.name}elseif($hardware.gpu){$hardware.gpu}else{Text-Capri 'unknown'}
    $vram=if($hardware.vramGiB){[Math]::Round($hardware.vramGiB,1).ToString()+' GiB'}else{Text-Capri 'unknown'}
    $script:fields.modelHardware.Text=(Text-Capri 'ramLabel')+': '+$hardware.ramGiB+' GiB'+"`nGPU: "+$gpuName+"`n"+(Text-Capri 'vramLabel')+': '+$vram
}
function Update-CapriModelRecommendations {
    if($script:page -ne 'model' -or -not $script:fields.ContainsKey('profile')){return}
    $body.FinishQuestionReveal()
    $profile=$script:fields.profile
    $recommended=@(Get-CapriRecommendedLanguageProfiles $options.conversationLanguage $modelBenchmark $manifest.profiles $hardware $memoryEstimates $catalog (Get-CapriEffectiveLanguageDevice))
    $label=$script:fields.modelRecommendations
    $label.Text=if($recommended.Count){(Text-Capri 'modelRecommended')+': '+$recommended[0].model+"`n"+(Text-Capri 'survey.recommendation')}else{''}
    $label.Visible=$recommended.Count -gt 0
    $profileInfo=$body.Controls['info-profile']
    $profileTop=if($recommended.Count){145}else{84}
    $storageTop=$profileTop+64
    $rows=@(
        @($script:fields.profileLabel,$profileTop),@($profile,($profileTop+26)),@($profileInfo,($profileTop+26)),
        @($script:fields.storageEstimate,$storageTop),@($body.Controls['info-storage'],$storageTop),
        @($script:fields.modelHardware,($storageTop+59))
    )
    foreach($row in $rows){
        $control=$row[0]
        $top=D $row[1]
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
        if($recommended.Count -and -not $script:modelSelectionExplicit -and -not $script:currentModelProfile){
            $index=$profile.FindString($recommended[0].id+' |')
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
    if($script:page -ne 'review' -or -not $script:fields.ContainsKey('reviewSummary')){return}
    $body.FinishQuestionReveal()
    if(-not $PSBoundParameters.ContainsKey('Available')){$available=Get-CapriAvailableDiskBytes $options.target}
    $fits=$null -ne $available -and $available -ge $script:reviewStorage.requiredBytes
    $freeText=Format-CapriAvailableDisk $options.target $available
    $script:diskReviewBlocked=-not $fits
    $script:fields.diskWarning.Visible=$script:diskReviewBlocked
    $storage=Format-CapriStorageEstimate $script:reviewStorage
    if($fits){
        $storage+="`n"+$freeText
    }else{
        $storage=(Text-Capri 'download')+': ~'+(Format-CapriGiB $script:reviewStorage.downloadBytes)
        $required=(Text-Capri 'storage')+': '+(Format-CapriGiB $script:reviewStorage.requiredBytes)
        $title=if($null -eq $available){$freeText}else{Text-Capri 'diskSpaceError'}
        $script:fields.diskWarning.Text=if($null -eq $available){"$title`n$required"}else{"$title`n$required`n$freeText"}
    }
    $script:fields.reviewSummary.Text=$script:reviewSummary+"`n`n"+$storage+"`n"+(Text-Capri 'dataLabel')+': '+(Join-Path $options.target 'data')
    $next.Enabled=$script:fields.consent.Checked -and $fits
}
function Add-CapriInferenceChoice([string]$Mode,[string]$Key,[int]$Y){
    $control=New-Object Capri.Setup.Cyberpunk.RadioButton
    $control.Name='survey-answer-'+$Mode
    $control.SurveyAnswer=$true
    $control.Text=Text-Capri $Key
    if($Mode -eq 'api'){$control.Text+=' (BETA)'}
    $control.AccessibleDescription=Text-Capri ('info.'+$Mode)
    $control.Checked=if($Mode -eq 'huggingface'){$options.inferenceMode -eq 'local' -and $options.modelSource -eq 'huggingface'}elseif($Mode -eq 'local'){$options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface'}else{$options.inferenceMode -eq $Mode}
    Set-CapriBounds $control 28 $Y 588 36
    $control.Anchor='Top,Left,Right'
    $body.Controls.Add($control)
    $script:fields[$Mode]=$control
}
function Save-CapriPage{
    switch($script:page){
        'interface'{
            $options.interfaceLanguage=Selected-Capri 'interfaceLanguage'
        }
        'license'{$options.acceptLicense=$script:fields.accept.Checked}
        'location'{$options.target=$script:fields.target.Text.Trim()}
        'device'{
            $options.inferenceMode=if($script:fields.api.Checked){'api'}else{'local'}
            $options.modelSource=if($script:fields.huggingface.Checked){'huggingface'}else{'catalog'}
            if($options.inferenceMode -eq 'local'){
                $device=Selected-Capri 'languageDevice'
                $options.languageDevice=if($device -eq 'keep'){''}else{$device}
            }
        }
        'conversation'{
            $options.conversationLanguage=Selected-Capri 'conversationLanguage'
            if(-not (@(Get-CapriVoiceChoices) -match ('^'+[regex]::Escape($options.voiceMode)+' \| '))){
                $options.voiceMode='off'
                $options.voicePack=''
            }
        }
        'model'{
            $options.profile=Selected-Capri 'profile'
            $script:modelSelectionExplicit=$true
        }
        'voice'{
            $options.voiceMode=Selected-Capri 'voiceMode'
            $options.voicePack=switch($options.voiceMode){'bundled'{$options.bundledVoicePack};'custom'{$script:fields.voicePack.Text.Trim()};default{''}}
        }
        'components'{
            $options.recognition=$script:fields.recognition.Checked
            if($script:fields.models.Enabled){$options.downloadModels=$script:fields.models.Checked}
            $options.desktopShortcut=$script:fields.desktop.Checked
            $options.startMenuShortcut=$script:fields.startMenu.Checked
        }
        'review'{$options.acceptDownloads=$script:fields.consent.Checked}
        'finish'{if($script:result){
            $script:launchOnFinish=$script:fields.launch.Checked
            $script:preloadOnFirstLaunch=$options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface' -and $script:fields.preloadOnFirstLaunch.Checked
        }}
    }
}
function Find-CapriInstalledVoicePack([string]$Target) {
    foreach($relative in @('data/speech/bundled-voice','.runtime/installer/bundled-voice','data/voices/capri/en/exports/capri-en-v1')){
        try{
            $folder=Assert-CapriVoicePack (Join-Path $Target $relative)
            $profile=Read-CapriJson (Join-Path $folder 'voice-profile.json')
            if($profile.id -eq 'capri-en-v1'){return $folder}
        }catch{
            # An incomplete older pack cannot be offered as the bundled voice.
        }
    }
    return ''
}
function Load-CapriRepairSettings {
    if($script:settingsTarget -ieq $options.target){return}
    $script:settingsTarget=$options.target
    $options['repair']=$false
    $options.modelSource='catalog'
    $options.inferenceMode='local'
    $options.profile=$recommendation
    $options.languageDevice=''
    $script:currentLanguageDevice='auto'
    $script:modelSelectionExplicit=$false
    if(-not $script:interfaceLanguageChosen){$options.interfaceLanguage=$installerLanguage}
    $script:currentModelProfile=$null
    $manifest.profiles=@(Get-CapriSetupModels $options.target $script:catalogProfiles)
    $options.conversationLanguage='en'
    $script:customConversation=''
    $options.bundledVoicePack=[string]$BundledVoicePack
    $options.voiceMode=if($BundledVoicePack -and $voiceGpu){'bundled'}else{'off'}
    $options.voicePack=if($options.voiceMode -eq 'bundled'){$BundledVoicePack}else{''}
    $script:russianVoiceAvailable=($BundledVoicePack -and $script:bundledRussianVoiceAvailable) -or
        (Test-CapriRussianVoicePack (Join-Path $options.target $russianPack.directory))
    if(-not(Test-Path -LiteralPath (Join-Path $options.target '.capri-install.json'))){return}
    $script:currentLanguageDevice=Get-CapriSavedLanguageDevice $options.target
    if(-not $options.bundledVoicePack){$options.bundledVoicePack=Find-CapriInstalledVoicePack $options.target}
    $local=Join-Path $options.target 'config/core.local.json'
    $options['repair']=Test-Path -LiteralPath $local
    $journal=Join-Path $options.target '.runtime/installer/state.json'
    if(-not $options.repair -and (Test-Path -LiteralPath $journal)){
        Assert-CapriNoLinks $journal
        $previous=Read-CapriJson $journal
        $options.profile=$previous.plan.profile
        if($previous.plan.PSObject.Properties['modelSource']){$options.modelSource=$previous.plan.modelSource}
        if(-not $script:interfaceLanguageChosen){$options.interfaceLanguage=$previous.plan.languages.interface}
        $options.conversationLanguage=$previous.plan.languages.conversation
        if($previous.plan.PSObject.Properties['languageDevice']){$options.languageDevice=[string]$previous.plan.languageDevice}
    }
    if(Test-Path -LiteralPath $local){Assert-CapriNoLinks $local;
        $config=Read-CapriJson $local;
        $selected=Get-CapriSetupProfileForConfig $config $manifest.profiles
        if($selected){$options.profile=$selected;$script:currentModelProfile=$selected}
        if($config.PSObject.Properties['modelSetupRequired'] -and $config.modelSetupRequired){$options.modelSource='huggingface'}}
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
        if(-not $script:interfaceLanguageChosen){$options.interfaceLanguage=$saved.settings.interface}
        $options.conversationLanguage=$saved.settings.conversation
        if($options.conversationLanguage -eq 'custom' -and $saved.settings.PSObject.Properties['customConversation']){
            $script:customConversation=[string]$saved.settings.customConversation
        }
        $speech=if($saved.settings.PSObject.Properties['speech']){$saved.settings.speech}else{''}
        if($speech -eq 'off'){
            $options.voiceMode='off'
            $options.voicePack=''
        }elseif($speech -and $options.bundledVoicePack -and $voiceGpu){
            $options.voiceMode='bundled'
            $options.voicePack=$options.bundledVoicePack
        }}
    $voiceSelections=Join-Path $options.target 'data/speech/voice-selections.json'
    if(Test-Path -LiteralPath $voiceSelections){
        Assert-CapriNoLinks $voiceSelections
        try{
            $voices=Read-CapriJson $voiceSelections
            $savedVoice=$voices.languages.PSObject.Properties[$options.conversationLanguage]
            if($savedVoice -and $savedVoice.Value -eq $qwenVoice.id){
                $options.voiceMode='qwen'
                $options.voicePack=''
            }elseif($savedVoice -and $savedVoice.Value -eq $russianVoice.id -and $script:russianVoiceAvailable){
                $options.voiceMode='qwen-ru'
                $options.voicePack=''
            }
        }catch{}
    }
    # Component defaults belong to this wizard. Navigation keeps the user's current
    # selection; attaching to a running session restores its exact request separately.
}
function Get-CapriVoiceChoices {
    $language=$options.conversationLanguage
    $offLabel=if($options.repair){Survey-Capri 'voiceOffRepair' 'voiceOff'}else{Text-Capri 'voiceOff'}
    'off | '+$offLabel
    if($voiceGpu -and @($catalog|Where-Object{$_.id -eq $language -and $_.speech}).Count){
        if($options.bundledVoicePack){'bundled | Chatterbox / Capri / '+(Text-Capri 'conversationLanguage')}
        'custom | '+(Text-Capri 'voiceCustom')
    }
    if($language -in $qwenVoice.languages){'qwen | '+(Text-Capri 'voiceHuggingFace')}
    if($script:russianVoiceAvailable -and $language -in $russianVoice.languages){'qwen-ru | '+$russianVoiceLabel}
}
function Get-CapriAdjacentPage([int]$Direction){
    $order=@($script:surveyPages|Where-Object{$_ -ne 'model' -or ($options.inferenceMode -eq 'local' -and $options.modelSource -eq 'catalog')})
    $index=[Array]::IndexOf($order,$script:page)+$Direction
    if($index -ge 0 -and $index -lt $order.Count){return $order[$index]}
    return $script:page
}
function Start-CapriQuestionReveal {
    if($VerificationDirectory -or -not $form.Visible){return}
    $view=if($script:page -in $script:questionPages -or ($script:page -eq 'finish' -and $script:result)){
        [string]$script:page+'/'+$installerLanguage
    }else{''}
    if($view -eq $script:questionView){return}
    $script:questionView=$view
    if($view){$body.RevealQuestion()}
}
function Render-CapriPage{
    $body.BeginPageUpdate()
    try{Update-CapriPageControls}
    finally{$body.EndPageUpdate()}
}
function Update-CapriPageControls{
    if($script:fields.ContainsKey('stage')){
        $script:progressView=@{stage=$script:fields.stage.Text;style=$script:fields.progress.Style;value=$script:fields.progress.Value;text=$script:fields.progressText.Text;log=$script:fields.log.Text}
    }
    $body.CancelSmoothScroll()
    $body.SetQuestion($null)
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
    $back.Enabled=$script:page -notin @('interface','progress','finish');
    $next.Enabled=$true;
    $cancel.Enabled=$true
    $pause.Visible=$script:page -eq 'progress'
    $pause.Text=Text-Capri $(if($script:session -and (Test-Path -LiteralPath (Join-Path $script:session 'pause'))){'resume'}else{'pause'})
    $installationTitle=if($options.updating -eq $true){(Text-Capri 'updatingTo') -f ('v'+$version)}else{$translations.$installerLanguage.pages[6]}
    $labels=$translations.$installerLanguage.pages
    $stepLabels=@{interface=(Text-Capri 'uiLanguage');license=$labels[1];location=$labels[2];device=(Survey-Capri 'deviceLabel' 'hardware');
        conversation=(Text-Capri 'conversationLanguage');model=(Survey-Capri 'modelLabel' 'hardware');voice=(Text-Capri 'voiceChoice');components=$labels[4];review=$labels[5];progress=$installationTitle;finish=$labels[7]}
    Layout-CapriSidebarHeader
    $firstStep=$sidebar.SidebarDividerY+(D 14)
    $number=0
    for($i=0;$i -lt $steps.Count;$i++){
        $step=$script:surveyPages[$i]
        $skip=$step -eq 'model' -and ($options.inferenceMode -eq 'api' -or $options.modelSource -eq 'huggingface')
        $steps[$i].Visible=-not $skip
        if($skip){continue}
        $number++
        $steps[$i].Text=$number.ToString('00')+'  '+$stepLabels[$step]
        $steps[$i].SetBounds((D 24),($firstStep+(D (($number-1)*39))),(D 175),(D 36))
        $steps[$i].ForeColor=if($step -eq $script:page){[Drawing.Color]::FromArgb(67,225,225)}else{[Drawing.Color]::FromArgb(155,171,190)}
    }
    $question=$script:page -in $script:questionPages
    $title=if($question){Get-CapriQuestionTitle $script:page}else{$stepLabels[$script:page]}
    $heading=Add-CapriLabel $title 22 44;
    $heading.Width=D 588
    $heading.Font=New-CapriFont $(if($question){22}else{19}) 'Bold'
    $heading.UseMnemonic=$false
    if($question -or ($script:page -eq 'finish' -and $script:result)){$heading.TextAlign='MiddleCenter'}
    $script:fields.heading=$heading
    $helpTopics=@{interface='interfaceLanguage';device='hardware';conversation='conversationLanguage';model='profile';voice='voiceMode'}
    $topic=if($helpTopics.ContainsKey($script:page)){$helpTopics[$script:page]}else{$script:page}
    $null=Add-CapriInfo ('page-'+$script:page) 25 622 (Text-Capri ('info.'+$topic))
    switch($script:page){
        'interface'{
            $next.Text=Text-Capri 'survey.start'
            $body.LoadWelcomeArt((Join-Path $sourceRoot 'assets/capri/intro-v1/PNG/05-greeting.png'))
            $languageItems=@($locales|ForEach-Object{$_.id+' | '+$_.nativeName})
            $null=Add-CapriLabel (Text-Capri 'installerLanguage') 84 28
            $combo=Add-CapriCombo 'installerLanguage' 115 $languageItems $installerLanguage
            $null=Add-CapriInfo 'installerLanguage' 115 622 (Survey-Capri 'installerLanguageHelp' 'info.interfaceLanguage')
            $null=Add-CapriLabel (Text-Capri 'uiLanguage') 177 28
            $uiChoice=Add-CapriCombo 'interfaceLanguage' 208 $languageItems $options.interfaceLanguage
            $uiChoice.Add_SelectionChangeCommitted({$script:interfaceLanguageChosen=$true})
            $null=Add-CapriInfo 'interfaceLanguage' 208
            $combo.Add_SelectionChangeCommitted({
                Save-CapriPage
                $previous=$script:installerLanguage
                $script:installerLanguage=Selected-Capri 'installerLanguage'
                if(-not $script:interfaceLanguageChosen -and $options.interfaceLanguage -eq $previous){$options.interfaceLanguage=$script:installerLanguage}
                Render-CapriPage})
        }
        'license'{
            $null=Add-CapriLabel (Text-Capri 'license') 82 28;
            $license=New-Object Capri.Setup.Cyberpunk.TextBox;
            $license.Multiline=$true;
            $license.ReadOnly=$true;
            $license.ScrollBars='Vertical';
            $license.Text=[Regex]::Replace([IO.File]::ReadAllText((Join-Path $sourceRoot 'LICENSE')), '\r?\n', "`r`n");
            Set-CapriBounds $license (28) (118) (620) (315);
            $license.Anchor='Top,Left,Right';
            $body.Controls.Add($license)
            $accept=Add-CapriCheck 'accept' 447 $options.acceptLicense;
            $next.Enabled=$options.acceptLicense;
            $accept.Add_CheckedChanged({$next.Enabled=$script:fields.accept.Checked});
            $null=Add-CapriInfo 'accept' 447
        }
        'location'{
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
        'device'{
            Add-CapriInferenceChoice 'local' 'survey.local' 83
            Add-CapriInferenceChoice 'api' 'survey.api' 126
            Add-CapriInferenceChoice 'huggingface' 'survey.huggingFace' 169
            $null=Add-CapriInfo 'local' 83
            $null=Add-CapriInfo 'api' 126
            $null=Add-CapriInfo 'huggingface' 169
            $null=Add-CapriLabel (Survey-Capri 'deviceLabel' 'hardware') 226 25
            $deviceItems=@(
                if($options.repair){'keep | '+(Get-CapriDeviceChoiceLabel 'keep')}
                'auto | '+(Get-CapriDeviceChoiceLabel 'auto')
                'cpu | '+(Get-CapriDeviceChoiceLabel 'cpu')
            )
            $initialDevice=if($options.languageDevice){$options.languageDevice}elseif($options.repair){'keep'}else{'auto'}
            $device=Add-CapriCombo 'languageDevice' 258 $deviceItems $initialDevice
            $device.AccessibleName=Survey-Capri 'deviceLabel' 'hardware'
            $null=Add-CapriInfo 'languageDevice' 258 622 (Survey-Capri 'deviceHelp' 'info.hardware')
            $script:fields.modelHardware=Add-CapriLabel '' 311 65
            $script:fields.storageEstimate=Add-CapriLabel '' 391 50
            $null=Add-CapriInfo 'storage' 391
            Update-CapriHardwareLabel
            $updateInferenceChoice={
                param($sender)
                if($sender -and -not $sender.Checked){return}
                $script:fields.languageDevice.Enabled=-not $script:fields.api.Checked
                Update-CapriMemoryBudgetView
                Fit-CapriPage
            }
            foreach($mode in @('local','api','huggingface')){$script:fields[$mode].Add_CheckedChanged($updateInferenceChoice)}
            $device.Add_SelectedIndexChanged({Update-CapriMemoryBudgetView})
            & $updateInferenceChoice
        }
        'conversation'{
            $choice=Add-CapriCombo 'conversationLanguage' 93 @(Get-CapriConversationChoices) $options.conversationLanguage
            $choice.AccessibleName=Text-Capri 'conversationLanguage'
            $null=Add-CapriInfo 'conversationLanguage' 93
            $null=Add-CapriLabel (Text-Capri 'info.conversationLanguage') 146 42
        }
        'model'{
            $script:fields.modelRecommendations=Add-CapriLabel '' 84 46
            $script:fields.profileLabel=Add-CapriLabel (Text-Capri 'hardware') 145 24
            $items=@($manifest.profiles|ForEach-Object{Format-CapriModelChoice $_ $false})
            $profile=Add-CapriCombo 'profile' 171 $items $options.profile
            $profile.AccessibleName=$script:fields.profileLabel.Text
            $null=Add-CapriInfo 'profile' 171
            $script:fields.storageEstimate=Add-CapriLabel '' 209 48
            $null=Add-CapriInfo 'storage' 209
            $script:fields.modelHardware=Add-CapriLabel '' 268 65
            Update-CapriHardwareLabel
            $profile.Add_SelectionChangeCommitted({$script:modelSelectionExplicit=$true})
            $profile.Add_SelectedIndexChanged({
                if(-not $script:updatingModelRecommendations){Update-CapriMemoryBudgetView}
            })
            Update-CapriModelRecommendations
        }
        'voice'{
            $voiceItems=@(Get-CapriVoiceChoices)
            $choice=Add-CapriCombo 'voiceMode' 94 $voiceItems $options.voiceMode
            $choice.AccessibleName=Text-Capri 'voiceChoice'
            $choice.Enabled=$voiceItems.Count -gt 1
            $null=Add-CapriInfo 'voiceMode' 94
            $null=Add-CapriLabel (Survey-Capri 'voiceHelp' 'info.voiceMode') 141 51
            $box=New-Object Capri.Setup.Cyberpunk.TextBox
            $box.Text=if($options.voiceMode -eq 'custom'){$options.voicePack}else{''}
            $box.ReadOnly=$true
            Set-CapriBounds $box 28 208 510 29
            $box.AccessibleName=Text-Capri 'voiceCustom'
            $body.Controls.Add($box)
            $script:fields.voicePack=$box
            $browse=New-Object Capri.Setup.Cyberpunk.Button
            $browse.Text=Text-Capri 'browse'
            Set-CapriBounds $browse 548 206 100 32
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
                        Update-CapriMemoryBudgetView
                    }
                }catch{[Windows.Forms.MessageBox]::Show((Capri-SetupError $_.Exception.Message),(Text-Capri 'error'),'OK','Warning')|Out-Null}
                finally{$dialog.Dispose()}
            })
            $body.Controls.Add($browse)
            $script:fields.storageEstimate=Add-CapriLabel '' 261 55
            $null=Add-CapriInfo 'storage' 261
            $refreshVoiceChoice={
                $body.FinishQuestionReveal()
                $custom=(Selected-Capri 'voiceMode') -eq 'custom'
                $script:fields.voicePack.Enabled=$script:fields.voicePack.Visible=$custom
                $script:fields.voiceBrowse.Enabled=$script:fields.voiceBrowse.Visible=$custom
                Update-CapriMemoryBudgetView
                Fit-CapriPage
            }
            $choice.Add_SelectedIndexChanged($refreshVoiceChoice)
            & $refreshVoiceChoice
        }
        'components'{
            $null=Add-CapriCheck 'recognition' 84 $options.recognition
            $null=Add-CapriInfo 'recognition' 84
            $catalogMode=$options.inferenceMode -eq 'local' -and $options.modelSource -eq 'catalog'
            $downloadChoice=Add-CapriCheck 'models' 128 ($catalogMode -and $options.downloadModels)
            $downloadChoice.Enabled=$catalogMode
            $null=Add-CapriInfo 'models' 128
            $null=Add-CapriCheck 'desktop' 172 $options.desktopShortcut
            $null=Add-CapriInfo 'desktop' 172
            $null=Add-CapriCheck 'startMenu' 216 $options.startMenuShortcut
            $null=Add-CapriInfo 'startMenu' 216
            $script:fields.storageEstimate=Add-CapriLabel '' 267 56
            $null=Add-CapriInfo 'storage' 267
            foreach($key in @('recognition','models')){$script:fields[$key].Add_CheckedChanged({Update-CapriMemoryBudgetView})}
        }
        'review'{
            $selected=@($manifest.profiles|Where-Object{$_.id -eq $options.profile})[0];
            $modelSummary=if($options.inferenceMode -eq 'api'){Text-Capri 'inferenceApi'}elseif($options.modelSource -eq 'huggingface'){Text-Capri 'inferenceHuggingFace'}else{$selected.model}
            if($options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface' -and -not $options.downloadModels){
                $modelSummary+="`n"+(Text-Capri 'models')+': '+(Text-Capri 'off')
            }
            if($options.inferenceMode -eq 'local'){
                $modelSummary+="`n"+(Survey-Capri 'deviceLabel' 'hardware')+': '+(Get-CapriDeviceChoiceLabel $options.languageDevice)
            }
            $script:reviewStorage=Get-CapriStorageEstimate $options $manifest $storageCatalog $rocmVoice $hardware
            $voiceSummary=if($options.voiceMode -eq 'qwen-ru'){$russianVoiceLabel}elseif($options.voiceMode -eq 'qwen'){Text-Capri 'voiceHuggingFace'}elseif($options.voicePack){'Chatterbox / Capri / '+$options.conversationLanguage+' / '+(Text-Capri 'on')}elseif($options.repair){Survey-Capri 'voiceOffRepair' 'voiceOff'}else{Text-Capri 'voiceOff'}
            $summary=$options.target+"`n"+$modelSummary+"`n"+(Text-Capri 'uiLanguage')+': '+$options.interfaceLanguage+'  |  '+(Text-Capri 'conversationLanguage')+': '+$options.conversationLanguage+"`n"+(Text-Capri 'recognition')+': '+$(if($options.recognition){Text-Capri 'on'}else{Text-Capri 'off'})+'  |  '+(Text-Capri 'classifierIncluded')+"`n"+(Text-Capri 'voiceChoice')+': '+$voiceSummary
            $shortcuts=@(
                if($options.desktopShortcut){Text-Capri 'desktop'}
                if($options.startMenuShortcut){Text-Capri 'startMenu'}
            )
            if($shortcuts.Count){$summary+="`n"+($shortcuts -join '  |  ')}
            # Compact minimum rows. Fit-CapriPageRows grows each block to its
            # wrapped height and preserves the gap before the next one.
            $script:reviewSummary=$summary
            $warning=New-Object Capri.Setup.Cyberpunk.BlockingWarning
            $warning.Name='disk-space-warning'
            $warning.Font=New-CapriFont 11 'Bold'
            $warning.Padding=New-Object Windows.Forms.Padding((D 16),(D 9),(D 16),(D 9))
            $warning.Visible=$false
            Set-CapriBounds $warning 28 68 620 0
            $body.Controls.Add($warning)
            $script:fields.diskWarning=$warning
            $script:fields.reviewSummary=Add-CapriLabel $summary 76 24
            $consent=Add-CapriCheck 'consent' 108 $options.acceptDownloads
            $null=Add-CapriInfo 'consent' 108
            $consent.Anchor='Top,Left,Right'
            $consent.Add_CheckedChanged({Update-CapriDiskReview;Fit-CapriPage});
            Update-CapriDiskReview
            $next.Text=Text-Capri 'install'
        }
        'progress'{
            $script:fields.stage=Add-CapriLabel (Text-Capri 'working') 90 55;
            $bar=New-Object Capri.Setup.Cyberpunk.ProgressBar;
            $sleepSprite=Join-Path $sourceRoot 'assets/default/capri-installer-sleep.png'
            $progressOffset=0
            $logHeight=198
            if(Test-Path -LiteralPath $sleepSprite -PathType Leaf){
                # Visible bounds of the reviewed sleep-v2 export, with two pixels of padding.
                $bar.SetMarker($sleepSprite,[Drawing.Rectangle]::new(74,707,1106,461))
                Set-CapriBounds $bar 28 148 620 112
                $progressOffset=84
                $logHeight=148
            }else{
                Set-CapriBounds $bar 28 158 620 18
            }
            $bar.Style='Continuous';
            $bar.AnimateProgress=(-not $script:installProgress.pauseStarted -and -not $script:installProgress.complete -and -not $script:failure);
            $body.Controls.Add($bar);
            $script:fields.progress=$bar
            $script:fields.progressText=Add-CapriLabel (Format-CapriInstallProgress) (188+$progressOffset) 42;
            $script:fields.warning=Add-CapriLabel (Text-Capri 'installationWarning') (242+$progressOffset) 28;
            $box=New-Object Capri.Setup.Cyberpunk.LogTextBox;
            $box.Multiline=$true;
            $box.ReadOnly=$true;
            $box.ScrollBars='Vertical';
            Set-CapriBounds $box 28 (326+$progressOffset) 620 $logHeight;
            $box.Anchor='Top,Left,Right';
            $body.Controls.Add($box);
            $script:fields.log=$box;
            $script:fields.recovery=Add-CapriLabel $(if($script:recovered){Text-Capri 'recovered'}else{''}) (338+$progressOffset+$logHeight) 76
            Add-CapriReportButtons (278+$progressOffset)
            if($script:progressView){
                $script:fields.stage.Text=$script:progressView.stage;$script:fields.progress.Style=$script:progressView.style
                $script:fields.progress.Value=$script:progressView.value;$script:fields.progressText.Text=$script:progressView.text;$script:fields.log.Text=$script:progressView.log
            }
            $back.Enabled=$false;
            $next.Enabled=$false
        }
        'finish'{
            if($script:result){$heading.Text=Text-Capri 'complete';
                $null=Add-CapriLabel $(if($options.inferenceMode -eq 'api'){Text-Capri 'inferenceSetup'}elseif($options.modelSource -eq 'huggingface'){Text-Capri 'inferenceHuggingFaceSetup'}elseif($script:result.modelsReady){Text-Capri 'ready'}else{Text-Capri 'deferred'}) 95 90;
                $routerUnavailable=$script:result.PSObject.Properties['routerNativeLibraryUnavailable'] -and $script:result.routerNativeLibraryUnavailable
                if($routerUnavailable){
                    $routerWarning=if($language -eq 'ru'){'Классификатор запросов недоступен. Для его включения установите Microsoft Visual C++ Redistributable (x64) и повторите установку Capri. Чат доступен.'}else{'The request classifier is unavailable. Install Microsoft Visual C++ Redistributable (x64) and rerun Capri Setup to enable it. Chat is available.'}
                    $null=Add-CapriLabel $routerWarning 187 62
                }
                $pathsTop=if($routerUnavailable){254}else{215}
                $null=Add-CapriLabel ($options.target+"`n`n"+(Text-Capri 'dataLabel')+': '+(Join-Path $options.target 'data')+"`n"+(Text-Capri 'logsLabel')+': '+(Join-Path $options.target 'logs')) $pathsTop (360-$pathsTop);
                $launch=Add-CapriCheck 'launch' 389 $script:launchOnFinish
                $launch.Text=Text-Capri 'survey.launch'
                $null=Add-CapriInfo 'launch' 389
                $launch.Anchor='Top,Left,Right'
                if($options.inferenceMode -eq 'local' -and $options.modelSource -ne 'huggingface'){
                    $preload=Add-CapriCheck 'preloadOnFirstLaunch' 424 $script:preloadOnFirstLaunch
                    $preload.Text=Text-Capri 'survey.preload'
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
    $body.PreviewWelcome=$script:page -eq 'interface'
    Update-CapriCyberpunkTheme $form
    if($question -or ($script:page -eq 'finish' -and $script:result)){$body.SetQuestion($heading)}
    Start-CapriQuestionReveal
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
    Initialize-CapriProgramFilesTarget $options.target
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
    $script:page='progress';
    Render-CapriPage
}
function Show-CapriCompletionNotice {
    if(-not $script:result -or $script:failure -or -not $script:session -or $script:completionSession -eq $script:session){return}
    $script:completionSession=$script:session
    $script:completionNoticeCount++
    $script:uiDiagnostics.Record('installation-complete-notification','success')
    try{
        [Capri.Setup.Display]::PresentCompletion($form.Handle,(-not $VerificationDirectory))
        if(-not $VerificationDirectory){[Media.SystemSounds]::Asterisk.Play()}
    }catch{
        $script:uiDiagnostics.Record('completion-notification-unavailable',$_.Exception.GetType().Name)
    }
}
function Poll-CapriInstall{
    if(-not $script:session){return}
    try{
        if($script:uiLease.Superseded){$script:superseded=$true;$script:uiDiagnostics.ExitReason('superseded');$form.Close();return}
        if(([DateTime]::UtcNow-$script:lastHeartbeat).TotalSeconds -ge 1){$null=$script:uiLease.Heartbeat($form.Visible);$script:lastHeartbeat=[DateTime]::UtcNow}
        if($script:page -ne 'progress'){return}
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
        if($exited -and $script:eventsCursor.AtEnd){
            $exitCode=$null
            if($script:worker){$exitCode=$script:worker.ExitCode}
            else{
                $done=Join-Path $script:session 'worker.done.json'
                if(Test-Path -LiteralPath $done -PathType Leaf){Assert-CapriNoLinks $done;$exitCode=(Read-CapriJson $done).exitCode}
            }
            if($null -ne $exitCode -and $exitCode -ne 0){$script:result=$null}
            if(-not $script:result -and -not $script:failure){$script:failure=Text-Capri 'workerStopped'};
            if($script:worker){$script:worker.Dispose()}
            $script:worker=$null;
            $script:page='finish';
            Render-CapriPage
            if($null -ne $exitCode -and $exitCode -eq 0){Show-CapriCompletionNotice}
        }
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
    if($script:page -eq 'review'){$options.acceptDownloads=$false}
    $script:page=if($script:page -eq 'finish'){'review'}else{Get-CapriAdjacentPage -1};
    Render-CapriPage})
$next.Add_Click({try{
        Save-CapriPage
        if($script:page -eq 'license' -and -not $options.acceptLicense){throw 'Please accept the license to continue.'}
        if($script:page -eq 'location'){$options.target=Assert-CapriTarget $options.target $sourceRoot (Read-CapriJson (Join-Path $sourceRoot 'package.json')).version;
            Load-CapriRepairSettings}
        if($script:page -eq 'model'){$selected=@($manifest.profiles|Where-Object{$_.id -eq $options.profile})[0];
            if($memoryEstimates.models.PSObject.Properties[$selected.id] -and -not(Test-CapriProfileRam $hardware.ramGiB (Get-CapriRequiredRam $selected $hardware $memoryEstimates (Get-CapriEffectiveLanguageDevice)))){throw 'This profile requires more RAM.'}}
        if($script:page -eq 'voice' -and $options.voiceMode -in @('bundled','custom')){$options.voicePack=Assert-CapriVoicePack $options.voicePack}
        if($script:page -eq 'review' -or ($script:page -eq 'finish' -and -not $script:result)){Start-CapriInstall;
            return}
        if($script:page -eq 'finish'){
            Save-CapriFirstLaunchChoice $options.target $script:preloadOnFirstLaunch
            if($script:launchOnFinish){
                $next.Enabled=$false;$cancel.Enabled=$false;$form.UseWaitCursor=$true
                try{$script:uiDiagnostics.Record('launch-requested',$options.target)
                    $opened=Start-CapriInstalledApp $options.target
                    $script:uiDiagnostics.Record('launch-ready',([string]$opened.pid))
                }catch{
                    $script:uiDiagnostics.Record('launch-failed',$_.Exception.Message)
                    if(-not(Test-CapriAppControlBlock $_.Exception.Message $_.Exception)){throw}
                    $script:uiDiagnostics.Record('launch-policy-blocked','CAPRI_APP_CONTROL_BLOCKED')
                    $script:launchOnFinish=$false;$script:fields.launch.Checked=$false
                    [Windows.Forms.MessageBox]::Show((Capri-SetupError $_.Exception.Message 'CAPRI_APP_CONTROL_BLOCKED'),(Text-Capri 'complete'),'OK','Warning')|Out-Null
                    return
                }
                finally{$next.Enabled=$true;$cancel.Enabled=$true;$form.UseWaitCursor=$false}
            };
            Clear-CapriSession
            $form.Close();
            return}
        $script:page=Get-CapriAdjacentPage 1;
        Render-CapriPage
    }catch{[Windows.Forms.MessageBox]::Show((Capri-SetupError $_.Exception.Message),(Text-Capri 'error'),'OK','Warning')|Out-Null}})
$cancel.Add_Click({if($script:session -and $script:page -eq 'progress'){if([Windows.Forms.MessageBox]::Show((Text-Capri 'cancelQuestion'),(Text-Capri 'title'),'YesNo','Question') -eq 'Yes'){$script:uiLease.Control('cancel');
            $script:cancelRequested=$true;
            $cancel.Enabled=$false;
            $script:fields.stage.Text=Text-Capri 'cancelWait'}}else{$form.Close()}})
$form.Add_FormClosing({param($sender,$eventArgs)
    $script:uiDiagnostics.Record('form-closing',[string]$eventArgs.CloseReason)
    if($script:superseded){return}
    if($script:session -and $script:page -eq 'progress'){
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
    $form.Font=New-CapriFont 10;$brand.Font=New-CapriFont 19 'Bold';$releaseLabel.Font=New-CapriFont 13 'Bold';$authorLabel.Font=New-CapriFont 9
    foreach($step in $steps){$step.Font=New-CapriFont 9}
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
$form.Add_Shown({Update-CapriDisplay;Start-CapriQuestionReveal})
$form.Add_VisibleChanged({
    $script:uiDiagnostics.Record('ui-visibility',([string]$form.Visible))
    if($script:session -and $script:uiLease -and $script:uiLease.IsOwner()){
        $null=$script:uiLease.Heartbeat($form.Visible)
        if(-not $form.Visible -and (Test-CapriWorker $script:session)){[Capri.Setup.SessionIO]::Pause($script:session,'ui-window-hidden')}
    }
})
$form.Add_Activated({[Capri.Setup.Display]::CompletionAttention($form.Handle,$false)})
$form.Add_FormClosed({param($sender,$eventArgs)$script:uiDiagnostics.Record('form-closed',[string]$eventArgs.CloseReason)})
if(-not $VerificationDirectory){
    $area=[Windows.Forms.Screen]::FromPoint([Windows.Forms.Cursor]::Position).WorkingArea
    $form.MinimumSize=New-Object Drawing.Size(([Math]::Min((D 936),$area.Width)),([Math]::Min((D 719),$area.Height)))
    $form.Size=New-Object Drawing.Size(([Math]::Min($form.Width,$area.Width)),([Math]::Min($form.Height,$area.Height)))
}
Initialize-CapriCyberpunkTheme $form $sidebar $body $footer $brand $releaseLabel $steps $back $next $cancel $pause
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
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CapriSetupScrollVerification {
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
}
'@
    $form.Show();
    [Windows.Forms.Application]::DoEvents()
    if([Capri.Setup.Display]::AppId() -ne 'Capri.Setup'){throw 'The installer taskbar identity is not Capri.Setup.'}
    function Wait-CapriVerificationEvents([int]$Milliseconds){
        $clock=[Diagnostics.Stopwatch]::StartNew()
        do{[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 8}while($clock.ElapsedMilliseconds -lt $Milliseconds)
        [Windows.Forms.Application]::DoEvents()
    }
    function Assert-CapriVersionHeader {
        $preferred=$releaseLabel.GetPreferredSize([Drawing.Size]::new($releaseLabel.Width,0))
        if(-not $releaseLabel.Visible -or $releaseLabel.ForeColor -ne $brand.ForeColor -or
           $releaseLabel.Top -lt $brand.Bottom -or
           $preferred.Width -gt $releaseLabel.Width -or $preferred.Height -gt $releaseLabel.Height -or
           $releaseLabel.Bottom -gt $authorLabel.Top -or $authorLabel.Bottom -ge $sidebar.SidebarDividerY -or
           $sidebar.SidebarDividerY -ge $steps[0].Top -or $steps[0].Bottom -gt $sidebar.ClientSize.Height){
            throw 'The setup sidebar version has the wrong color, is clipped, or overlaps adjacent elements.'
        }
    }
    Assert-CapriVersionHeader
    $shortVersionHeight=$releaseLabel.Height
    try {
        $releaseLabel.Text='v1234567890123456.1234567890123456.1234567890123456E123456789012345'
        Render-CapriPage
        Assert-CapriVersionHeader
        if($releaseLabel.Height -le $shortVersionHeight){throw 'A long setup version must wrap.'}
        $headerCheck=Join-Path $check 'version-header'
        [IO.Directory]::CreateDirectory($headerCheck)|Out-Null
        $headerImage=New-Object Drawing.Bitmap($sidebar.Width,$steps[0].Bottom)
        try {
            $sidebar.DrawToBitmap($headerImage,[Drawing.Rectangle]::new(0,0,$headerImage.Width,$headerImage.Height))
            $headerImage.Save((Join-Path $headerCheck 'long.png'),[Drawing.Imaging.ImageFormat]::Png)
        } finally { $headerImage.Dispose() }
    } finally {
        $releaseLabel.Text='v'+$displayVersion
        Render-CapriPage
    }
    function Wait-CapriAnswerReveal {
        $clock=[Diagnostics.Stopwatch]::StartNew()
        while($body.QuestionRevealActive -and $body.AnswerRevealOpacity -le 0.05 -and $clock.ElapsedMilliseconds -lt 2200){
            Wait-CapriVerificationEvents 12
        }
    }
    function Save-CapriAnimationFrame([string]$Name){
        $folder=Join-Path $check 'animation'
        [IO.Directory]::CreateDirectory($folder)|Out-Null
        $frame=[Drawing.Bitmap]::new($form.Width,$form.Height)
        try{
            $form.DrawToBitmap($frame,[Drawing.Rectangle]::new(0,0,$form.Width,$form.Height))
            $frame.Save((Join-Path $folder ($Name+'.png')))
        }finally{$frame.Dispose()}
    }
    function Select-CapriFixtureConversation([string]$Id){
        $script:page='conversation';Render-CapriPage
        $choice=$script:fields.conversationLanguage
        $index=$choice.FindString($Id+' |')
        if($index -lt 0){throw ('Conversation language is missing: '+$Id)}
        $choice.SelectedIndex=$index
        Save-CapriPage
    }
    if($VerificationFault -eq 'russian-voice-selection'){
        if(-not $script:bundledRussianVoiceAvailable){throw 'Verification needs the Russian LoRA pack.'}
        $voiceGpu=$false
        $options.target=Join-Path $check 'fresh Capri'
        Load-CapriRepairSettings
        $script:page='voice';Render-CapriPage
        $voice=$script:fields.voiceMode
        if($voice.FindString('qwen-ru |') -ge 0){throw 'Russian LoRA was offered for English.'}
        Select-CapriFixtureConversation 'ru'
        $script:page='voice';Render-CapriPage
        $voice=$script:fields.voiceMode
        $russianIndex=$voice.FindString('qwen-ru |')
        if($russianIndex -lt 0 -or $voice.FindString('qwen |') -lt 0){throw 'Russian LoRA or the multilingual Qwen choice is missing.'}
        if(-not ([string]$voice.Items[$russianIndex]).EndsWith(' / CPU / NVIDIA CUDA')){throw 'Russian LoRA does not show both supported compute options.'}
        $voice.SelectedIndex=$voice.FindString('qwen |')
        $baseDisk=$script:fields.storageEstimate.Text
        $baseMemory=$script:memoryBudget
        $voice.SelectedIndex=$russianIndex
        Save-CapriPage
        if($options.voiceMode -ne 'qwen-ru' -or $options.voicePack -or $options.conversationLanguage -ne 'ru' -or
           $script:fields.storageEstimate.Text -eq $baseDisk -or $script:memoryBudget.ram.estimate[1] -le $baseMemory.ram.estimate[1] -or
           $script:memoryBudget.vram.estimate[1] -ne $baseMemory.vram.estimate[1]){throw 'The Russian voice choice was not saved or its budgets are incorrect.'}
        $script:page='review';Render-CapriPage
        if(-not $script:reviewSummary.Contains($russianVoiceLabel)){throw 'The Russian voice is missing from the review.'}
        $upgrade=Join-Path $check 'existing Capri'
        $cached=Join-Path $upgrade 'data/speech/bundled-voice'
        [IO.Directory]::CreateDirectory((Split-Path -Parent $cached))|Out-Null
        Copy-Item -LiteralPath $BundledVoicePack -Destination $cached -Recurse
        Write-CapriJson (Join-Path $upgrade '.capri-install.json') @{schemaVersion=1;productId='capri.desktop';root=$upgrade;version='1.1.0';installId=[Guid]::NewGuid().ToString()}
        Write-CapriJson (Join-Path $upgrade 'data/desktop/languages.json') @{schemaVersion=1;settings=@{interface='en';conversation='ru';speech='follow'}}
        Write-CapriJson (Join-Path $upgrade 'data/speech/voice-selections.json') @{schemaVersion=1;languages=@{ru=$russianVoice.id}}
        $BundledVoicePack='';$options.target=$upgrade;Load-CapriRepairSettings
        $script:page='voice';Render-CapriPage
        if((Selected-Capri 'voiceMode') -ne 'qwen-ru'){throw 'An update did not restore the installed Russian LoRA choice.'}
        Select-CapriFixtureConversation 'en'
        $script:page='voice';Render-CapriPage
        if((Selected-Capri 'voiceMode') -ne 'off' -or $script:fields.voiceMode.FindString('qwen-ru |') -ge 0){throw 'Switching languages left the Russian voice enabled.'}
        $options.target=Join-Path $check 'without LoRA';Load-CapriRepairSettings
        $options.conversationLanguage='ru';Render-CapriPage
        if($script:fields.voiceMode.FindString('qwen-ru |') -ge 0){throw 'The wizard offered an unavailable adapter.'}
        Write-CapriJson (Join-Path $check 'russian-voice.json') @{passed=$true;checks=@('language-filter','cpu-compatible','cuda-label','storage-and-memory','review','restore-on-upgrade','missing-pack')}
        $timer.Dispose();$form.Dispose();return
    }
    if($VerificationFault -eq 'update-voice-scroll'){
        if(-not $BundledVoicePack){throw 'Verification needs a compatible Capri voice pack.'}
        $voiceGpu=$true
        $upgrade=Join-Path $check 'voice-upgrade'
        $cached=Join-Path $upgrade 'data/speech/bundled-voice'
        [IO.Directory]::CreateDirectory((Split-Path -Parent $cached))|Out-Null
        Copy-Item -LiteralPath $BundledVoicePack -Destination $cached -Recurse
        Write-CapriJson (Join-Path $upgrade '.capri-install.json') @{schemaVersion=1;productId='capri.desktop';root=$upgrade;version='1.0.4';installId=[Guid]::NewGuid().ToString()}
        Write-CapriJson (Join-Path $upgrade 'config/core.local.json') @{model='gemma4:e2b';upstreamModel='gemma4:e2b';resourceProfile='balanced'}
        $languages=Join-Path $upgrade 'data/desktop/languages.json'
        $options.target=$upgrade
        foreach($scenario in @('embedded','cached','text-only')){
            if($scenario -eq 'cached'){$BundledVoicePack=''}
            $speech=if($scenario -eq 'text-only'){'off'}else{'follow'}
            Write-CapriJson $languages @{schemaVersion=1;settings=@{interface='en';conversation='en';speech=$speech}}
            $script:settingsTarget=$null
            Load-CapriRepairSettings
            $script:page='voice';Render-CapriPage
            $expected=if($speech -eq 'off'){'off'}else{'bundled'}
            if((Selected-Capri 'voiceMode') -ne $expected -or
               -not @($script:fields.voiceMode.Items|Where-Object{$_ -like 'bundled | Chatterbox*'}).Count){throw ('Chatterbox selection failed during update: '+$scenario)}
            if($scenario -eq 'text-only'){$script:fields.voiceMode.SelectedIndex=1}
            Save-CapriPage
            $pack=if($scenario -eq 'embedded'){$BundledVoicePack}else{$cached}
            if($options.voiceMode -ne 'bundled' -or $options.voicePack -ne $pack){throw ('Update request used the wrong voice pack: '+$scenario)}
        }
        $script:page='model';Render-CapriPage
        $combo=$script:fields.profile
        $combo.SelectedIndex=2
        $combo.Focus()|Out-Null
        $body.AutoScrollMinSize=[Drawing.Size]::new(0,$body.Height+300)
        $body.AutoScrollPosition=[Drawing.Point]::Empty
        $index=$combo.SelectedIndex
        $wheelDown=[IntPtr](-120 -shl 16)
        [CapriSetupScrollVerification]::SendMessage($combo.Handle,0x020A,$wheelDown,[IntPtr]::Zero)|Out-Null
        Wait-CapriVerificationEvents 240
        if($combo.SelectedIndex -ne $index -or $body.AutoScrollPosition.Y -ge 0){throw 'Wheel over a model picker must scroll the page without changing the model.'}
        $fullOffset=$body.AutoScrollPosition.Y
        $wheelPartial=[IntPtr](-20 -shl 16)
        for($notch=0;$notch -lt 3;$notch++){
            [CapriSetupScrollVerification]::SendMessage($body.Handle,0x020A,$wheelPartial,[IntPtr]::Zero)|Out-Null
        }
        Wait-CapriVerificationEvents 240
        $partialOffset=$body.AutoScrollPosition.Y-$fullOffset
        if([Math]::Abs(2*$partialOffset-$fullOffset) -gt 2){throw 'The smooth wheel path did not accumulate fine mouse-wheel deltas.'}
        $body.CancelSmoothScroll()
        $body.AutoScrollPosition=[Drawing.Point]::Empty
        $combo.DroppedDown=$true
        if(-not $combo.DroppedDown){throw 'The model list did not open for scroll verification.'}
        [CapriSetupScrollVerification]::SendMessage($body.Handle,0x020A,$wheelDown,[IntPtr]::Zero)|Out-Null
        Wait-CapriVerificationEvents 240
        if($combo.DroppedDown -or $combo.SelectedIndex -ne $index -or $body.AutoScrollPosition.Y -ge 0){throw 'Wheel scrolling left the model popup open or changed the model.'}
        $body.AutoScrollPosition=[Drawing.Point]::Empty
        $combo.DroppedDown=$true
        [CapriSetupScrollVerification]::SendMessage($body.Handle,0x0115,[IntPtr]1,[IntPtr]::Zero)|Out-Null
        if($combo.DroppedDown -or $combo.SelectedIndex -ne $index -or $body.AutoScrollPosition.Y -ge 0){throw 'Scrollbar scrolling left the model popup open or changed the model.'}
        [CapriSetupScrollVerification]::SendMessage($combo.Handle,0x0100,[IntPtr]0x28,[IntPtr]1)|Out-Null
        if($combo.SelectedIndex -ne $index+1){throw 'Keyboard model selection no longer works.'}
        Write-CapriJson (Join-Path $check 'update-voice-scroll.json') @{passed=$true;voice=@('embedded','cached','text-only');scroll=@('wheel over model','high-resolution deltas','wheel with popup open','scrollbar with popup open','keyboard selection');installationStarted=$false}
        $form.Close();$timer.Dispose();return
    }
    if($VerificationFault -eq 'completion'){
        $timer.Stop()
        $checks=@()
        foreach($case in @('complete','failed','cancelled','complete-then-failed')){
            $options.target=Join-Path $check ('fixture-'+$case)
            $folder=New-CapriSession;Open-CapriSession $folder;Render-CapriPage
            $events=if($case -eq 'complete-then-failed'){@(@{type='complete';modelsReady=$true})}else{@(@{type=$case;modelsReady=$true;message='Synthetic setup failure'})}
            [IO.File]::WriteAllLines((Join-Path $folder 'events.jsonl'),[string[]]@($events|ForEach-Object{$_|ConvertTo-Json -Compress}))
            Write-CapriJson (Join-Path $folder 'worker.done.json') @{exitCode=$(if($case -eq 'complete'){0}else{1})}
            $before=$script:completionNoticeCount
            $form.WindowState='Minimized'
            if($case -eq 'complete'){
                Write-CapriJson (Join-Path $folder 'worker.json') @{pid=$PID;stamp=[Capri.Setup.SessionIO]::Stamp($PID)}
                Poll-CapriInstall
                if($script:page -ne 'progress' -or $script:completionNoticeCount -ne $before -or $form.WindowState -ne 'Minimized'){throw 'Completion notice appeared before the worker exited.'}
                Remove-Item -LiteralPath (Join-Path $folder 'worker.json')
            }
            Poll-CapriInstall;Poll-CapriInstall;Show-CapriCompletionNotice
            $expected=if($case -eq 'complete'){1}else{0}
            if($script:page -ne 'finish' -or $script:completionNoticeCount-$before -ne $expected){throw ('Incorrect completion notice: '+$case)}
            if($case -eq 'complete' -and $script:fields.heading.Text -ne (Text-Capri 'complete')){throw 'Completion did not retain its localized finish page.'}
            $restored=$form.WindowState -ne 'Minimized'
            if($restored -ne ($case -eq 'complete')){throw ('Incorrect window restore: '+$case)}
            $checks+=@{case=$case;notifications=$expected;finishPage=$script:page;restored=$restored}
            $form.WindowState='Normal'
            Clear-CapriSession
        }
        Write-CapriJson (Join-Path $check 'completion.json') @{passed=$true;checks=$checks;noticeText=(Text-Capri 'complete');desktopAlertsSent=$false}
        $form.Close();$timer.Dispose();return
    }
    if($VerificationFault -eq 'report-export'){
        $script:page='progress';Render-CapriPage;Update-CapriDownloadProgress ([pscustomobject]@{received=1024;total=$null})
        if($script:fields.progress.Style -ne 'Continuous' -or $script:installProgress.value -ne 0 -or -not $script:installProgress.transfer){throw 'Unknown download size did not retain overall progress and transfer text.'}
        $script:failure='Injected installation failure before npm/Node is ready.';$script:page='finish';Render-CapriPage
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
        do{Poll-CapriInstall;[Windows.Forms.Application]::DoEvents();[Threading.Thread]::Sleep(50)}while($script:page -ne 'finish' -and [DateTime]::UtcNow -lt $deadline)
        if($script:page -ne 'finish'){throw 'Cancel did not finish the fixture worker.'}
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
            Select-CapriFixtureConversation 'en'
            $script:page='model';Render-CapriPage
            $script:fields.profile.SelectedIndex=1
            Save-CapriPage
            Update-CapriModelRecommendations
            $caption=(Text-Capri 'modelRecommended')+': '
            $reason="`n"+(Text-Capri 'survey.recommendation')
            $star=[string][char]0x2605
            $badges=@($script:fields.profile.Items|Where-Object{([string]$_).Contains($star)})
            if($script:fields.modelRecommendations.Text -cne ($caption+'gemma4:e2b'+$reason) -or
               $badges.Count -ne 2 -or -not ($badges|Where-Object{([string]$_).Contains('gemma4:e2b (BETA)')})){
                throw 'The installer must feature one compatible model and retain the two recommended choices in the picker.'
            }
            Select-CapriFixtureConversation 'ru'
            $script:page='model';Render-CapriPage
            if($script:fields.modelRecommendations.Text -cne ($caption+'ministral-3:3b'+$reason) -or
               (Selected-Capri 'profile') -ne 'balanced'){
                throw 'Changing the conversation language must refresh recommendations and retain the selected model.'
            }
            $hardware.ramGiB=16;$hardware.vramGiB=0
            Update-CapriModelRecommendations
            if($script:fields.modelRecommendations.Text -cne ($caption+'qwen3.5:2b'+$reason)){
                throw 'Model recommendations must fit CPU-only hardware.'
            }
            $script:page='conversation';Render-CapriPage
            if((Selected-Capri 'conversationLanguage') -ne 'ru'){throw 'Returning to the language question lost the chosen language.'}
            Select-CapriFixtureConversation 'tr'
            $script:page='model';Render-CapriPage
            if($options.conversationLanguage -ne 'tr' -or (Selected-Capri 'profile') -ne 'balanced' -or $script:fields.modelRecommendations.Visible){
                throw 'Returning to the model question must retain the new language and selected model without inventing recommendations.'
            }
        }finally{
            $script:modelBenchmark=$savedBenchmark
            $hardware.ramGiB=$savedRam;$hardware.vramGiB=$savedVram
            foreach($key in $savedOptions.Keys){$options[$key]=$savedOptions[$key]}
            $script:page='model'
            Render-CapriPage
        }
    }
    $script:page='license'
    Render-CapriPage
    $licenseEditor=$body.Controls | Where-Object {$_ -is [Windows.Forms.TextBox] -and $_.Multiline} | Select-Object -First 1
    if(-not $licenseEditor.Text.Contains("`r`n`r`n")){throw 'The native license editor must preserve paragraph breaks.'}
    $body.RevealQuestion()
    if($body.QuestionRevealActive){
        Wait-CapriVerificationEvents 215
        Save-CapriAnimationFrame 'license-question'
        Wait-CapriAnswerReveal
        Save-CapriAnimationFrame 'license-answers'
        $body.RevealQuestion()
        if($licenseEditor.Visible){throw 'The native license editor must wait for its own reveal.'}
        $script:retiredEditorShown=$false
        $licenseEditor.Add_VisibleChanged({param($sender,$eventArgs) if($sender.Visible){$script:retiredEditorShown=$true}})
        $script:page='interface'
        Render-CapriPage
        if($script:retiredEditorShown -or -not $licenseEditor.IsDisposed){
            throw 'Leaving an animated page briefly exposed the old native editor.'
        }
        $languagePicker=$script:fields.installerLanguage
        $languagePicker.DroppedDown=$true
        $body.RevealQuestion()
        if($languagePicker.DroppedDown -or $languagePicker.Visible){
            throw 'The language picker must close and wait for the page reveal.'
        }
        Wait-CapriAnswerReveal
        Save-CapriAnimationFrame 'interface-answers'
        $body.FinishQuestionReveal()
    }
    foreach($language in $verificationIds){
        if(-not @($locales|Where-Object{$_.id -eq $language}).Count){throw 'Unsupported verification language.'}
        $script:installerLanguage=$language;
        $script:result=$null
        $script:progressView=$null
        foreach($pageId in $script:surveyPages){
            $script:page=$pageId;
            if($pageId -eq 'finish'){$script:result=[PSCustomObject]@{modelsReady=$true}};
            Render-CapriPage;
            if($script:questionPages -contains $pageId -and $script:fields.heading.Text -cne (Get-CapriQuestionTitle $pageId)){
                throw ('Setup question is missing: '+$language+' / '+$pageId)
            }
            if($pageId -eq 'device' -and $language -eq $verificationIds[0]){
                $title=$script:fields.heading;$answer=$script:fields.local
                $titleHome=$title.Bounds;$answerHome=$answer.Bounds
                $body.RevealQuestion()
                if($body.QuestionRevealActive){
                    $stopwatch=[Diagnostics.Stopwatch]::StartNew()
                    $center=$title.Location
                    $middleX=$title.Left+$title.Width/2;$middleY=$title.Top+$title.Height/2
                    if($answer.Visible -or $body.QuestionTextOpacity -gt 0.1 -or
                       [Math]::Abs($middleX-$body.ClientSize.Width/2) -gt 1 -or [Math]::Abs($middleY-$body.ClientSize.Height/2) -gt 1){
                        throw 'Setup must reveal its question in the center before the answers.'
                    }
                    Wait-CapriVerificationEvents 115
                    $peakBloom=$body.QuestionBloom
                    if($body.QuestionTextOpacity -le 0.1 -or $peakBloom -le 0.1 -or $body.AnswerRevealOpacity -gt 0){
                        throw 'The question must fade in with bloom while the answers are hidden.'
                    }
                    Save-CapriAnimationFrame ($language+'-question')
                    Wait-CapriVerificationEvents 650
                    if($title.Location -ne $center -or $body.QuestionTextOpacity -lt 0.99 -or $answer.Visible -or $body.AnswerRevealOpacity -gt 0){
                        throw 'The fully visible question must pause in the center before it rises.'
                    }
                    Wait-CapriAnswerReveal
                    if($answer.Visible -or $body.AnswerRevealOpacity -ge 1 -or $body.AnswerRevealOffset -le 0 -or
                       $title.Top -ge ($middleY-$title.Height/2) -or $body.QuestionBloom -ge $peakBloom){
                        throw 'Answers must slide in from the right and fade in as the question rises and loses its bloom.'
                    }
                    do{Wait-CapriVerificationEvents 12}while($body.QuestionRevealActive -and $stopwatch.ElapsedMilliseconds -lt 2200)
                    if($title.Bounds -ne $titleHome -or $answer.Bounds -ne $answerHome -or -not $answer.Visible -or
                       $body.QuestionBloom -gt 0.01 -or $body.AnswerRevealOffset -ne 0){
                        throw 'Setup question animation moved the controls away from their final positions.'
                    }
                    $body.RevealQuestion()
                    Fit-CapriPage
                    if($title.Bounds -ne $titleHome -or $answer.Bounds -ne $answerHome -or -not $answer.Visible){
                        throw 'Refitting the page did not settle the question animation.'
                    }
                    if($answer.Checked){
                        $body.RevealQuestion()
                        $script:fields.api.Checked=$true
                        $body.FinishQuestionReveal()
                        if(-not $script:fields.api.Visible -or -not $script:fields.api.Checked -or $answer.Checked){
                            throw 'The device selection did not survive interrupting the animation.'
                        }
                        $answer.Checked=$true
                    }
                }
            }
            if($form.Text -cne $translations.$language.title){throw ('Installer title was not translated: '+$language)}
            if($pageId -eq 'license' -and $language -eq $verificationIds[0]){
                $licenseChoice=$script:fields.accept
                if(-not $licenseChoice){throw 'License acceptance is missing.'}
                $licenseChoice.Checked=$false
                if($next.Enabled){throw 'The wizard allowed choosing components without accepting the license.'}
                $licenseChoice.Checked=$true
                if(-not $next.Enabled){throw 'Accepting the license did not allow navigation.'}
                Save-CapriPage
            }
            if($pageId -eq 'location' -and $language -eq $verificationIds[0]){
                if($script:fields.target.Text -ne (Get-CapriDefaultTarget)){throw 'A new installation must default to the current user folder.'}
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
                $options.target=Get-CapriDefaultTarget
                $script:installations=@()
                Render-CapriPage
            }
            if($pageId -eq 'model' -and $language -eq $verificationIds[0]){
                $beforeModelOptions=$options.Clone();$beforeSettingsTarget=$script:settingsTarget;$beforeCustomConversation=$script:customConversation
                $upgrade=Join-Path $check 'model-upgrade'
                Write-CapriJson (Join-Path $upgrade '.capri-install.json') @{schemaVersion=1;productId='capri.desktop';root=$upgrade;version='1.0.0';installId=[Guid]::NewGuid().ToString()}
                Write-CapriJson (Join-Path $upgrade 'config/core.local.json') @{model='gemma4:e2b';upstreamModel='gemma4:e2b';resourceProfile='balanced'}
                Write-CapriJson (Join-Path $upgrade 'data/model-inventory.json') @{models=@(@{name='gemma4:e2b'},@{name='capri-qwen3.5:2b'},@{name='capri-embed:latest'})}
                Write-CapriJson (Join-Path $upgrade 'data/desktop/languages.json') @{schemaVersion=1;settings=@{interface='en';conversation='en';speech='off'}}
                try{
                    $options.target=$upgrade;Load-CapriRepairSettings;Render-CapriPage
                    if(-not $script:fields.profile.Enabled -or (Selected-Capri 'profile') -ne 'gemma4-e2b'){throw 'Update must select the actual current model and leave its picker enabled.'}
                    $downloaded=@($script:fields.profile.Items|Where-Object{([string]$_).Contains((Text-Capri 'modelInstalled'))})
                    if($downloaded.Count -ne 2 -or -not $script:fields.profile.Text.Contains((Text-Capri 'modelCurrent'))){throw 'Installed and current model badges are incomplete.'}
                    $script:fields.profile.DroppedDown=$true;[Windows.Forms.Application]::DoEvents();$script:fields.profile.DroppedDown=$false
                    $modelCheck=Join-Path $check 'update-models';[IO.Directory]::CreateDirectory($modelCheck)|Out-Null
                    $bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height)
                    try{$form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)));$bitmap.Save((Join-Path $modelCheck 'hardware.png'))}finally{$bitmap.Dispose()}
                    $script:fields.profile.SelectedIndex=3;Save-CapriPage
                    if($options.profile -ne 'quality'){throw 'Update did not retain the requested new model.'}
                    Render-CapriPage
                    if((Selected-Capri 'profile') -ne 'quality' -or -not $script:fields.profile.Enabled){throw 'Returning to the model question lost the new choice.'}
                    Write-CapriJson (Join-Path $modelCheck 'result.json') @{passed=$true;current='gemma4-e2b';selected=$options.profile;downloaded=$downloaded.Count}
                    $script:page='conversation';Render-CapriPage
                    if(-not $script:fields.conversationLanguage.Enabled -or (Selected-Capri 'conversationLanguage') -ne 'en'){throw 'Update must preselect the installed conversation language and leave it editable.'}
                    Select-CapriFixtureConversation 'ru'
                    $script:page='conversation';Render-CapriPage
                    if(-not $script:fields.conversationLanguage.Enabled -or (Selected-Capri 'conversationLanguage') -ne 'ru'){throw 'Going back lost the editable Russian language choice.'}
                    $script:page='interface';Render-CapriPage
                    if(-not $script:fields.interfaceLanguage.Enabled){throw 'The settings update cannot change the interface language.'}
                    $choice=$script:fields.interfaceLanguage
                    $choice.SelectedIndex=$choice.FindString('ru |')
                    Save-CapriPage
                    if($options.conversationLanguage -ne 'ru' -or $options.interfaceLanguage -ne 'ru'){throw 'Update request lost the selected language values.'}
                    $script:page='review';Render-CapriPage
                    if(-not $script:fields.reviewSummary.Text.Contains(': ru')){throw 'Review did not show the changed languages.'}
                    Write-CapriJson (Join-Path $modelCheck 'languages.json') @{passed=$true;interface=$options.interfaceLanguage;conversation=$options.conversationLanguage}
                }finally{
                    $script:page='model'
                    foreach($key in @($options.Keys)){if(-not $beforeModelOptions.ContainsKey($key)){$options.Remove($key)}}
                    foreach($key in $beforeModelOptions.Keys){$options[$key]=$beforeModelOptions[$key]}
                    $script:settingsTarget=$beforeSettingsTarget;$script:currentModelProfile=$null;$script:customConversation=$beforeCustomConversation
                    $manifest.profiles=@(Get-CapriSetupModels $options.target $script:catalogProfiles)
                    Render-CapriPage
                }
            }
            $helpButtons=@($body.Controls|Where-Object{$_.Name -like 'info-*'})
            if(-not $helpButtons.Count -or @($helpButtons|Where-Object{$_.AccessibleDescription.Length -lt 12}).Count){
                throw ('Wizard contextual help is missing on page '+$pageId)
            }
            Assert-CapriHelpLayout
            if($pageId -eq 'components'){
                $normalSize=$form.ClientSize
                $normalMinimum=$form.MinimumSize
                try{
                    $form.MinimumSize=[Drawing.Size]::Empty
                    $form.ClientSize=New-Object Drawing.Size((D 825),(D 560))
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
            if($pageId -in @('device','model','voice','components','review')){
                if(-not $budgetPanel.Visible -or $body.Bottom -gt $budgetPanel.Top -or $budgetPanel.Bottom -gt $footer.Top){throw 'Memory estimate overlaps navigation or component controls.'}
            }
            if($pageId -eq 'model'){
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
                        $script:page='review'
                        Render-CapriPage
                        Update-CapriDiskReview -Available $script:reviewStorage.requiredBytes
                        if(-not $script:fields.reviewSummary.Text.Contains($estimate) -or
                           -not $script:fields.reviewSummary.Text.Contains($model.model)){throw ('Review lost the selected model or disk estimate: '+$model.id)}
                        $script:page='model'
                        Render-CapriPage
                    }
                    $options.profile=$initialProfileId
                }
                $script:fields.profile.SelectedIndex=0
                $smallBudget=$script:memoryBudget
                $script:fields.profile.SelectedIndex=3
                if($script:memoryBudget.ram.estimate[1] -le $smallBudget.ram.estimate[1]){throw 'Selecting a larger model did not update memory.'}
                $ramDetails=$budgetRows.ram.detail.Text
                if(-not $ramDetails.Contains((Text-Capri 'budgetInUse')) -or
                   -not $ramDetails.Contains((Text-Capri 'budgetFree')) -or
                   -not $ramDetails.Contains((Text-Capri 'budgetAfter')) -or
                   $budgetPanel.Bottom -gt $footer.Top){
                    throw 'Model choices must show current and projected memory together above navigation.'
                }
                $options.profile=$initialProfileId
                $script:fields.profile.SelectedIndex=$initialProfile
            }
            if($pageId -eq 'device'){
                if(-not $script:fields.api.Text.EndsWith(' (BETA)')){throw 'The API installation option must be marked BETA.'}
                $savedDevice=$options.languageDevice
                $devicePicker=$script:fields.languageDevice
                $cpu=$devicePicker.FindString('cpu |')
                if($cpu -lt 0){throw 'The device question does not offer CPU mode.'}
                $devicePicker.SelectedIndex=$cpu
                Save-CapriPage
                if($options.languageDevice -ne 'cpu'){throw 'CPU device selection was not saved.'}
                $options.languageDevice=$savedDevice
                Render-CapriPage
                $localBudget=$script:memoryBudget
                $script:fields.api.Checked=$true
                if($script:fields.languageDevice.Enabled -or $script:memoryBudget.ram.estimate[1] -ge $localBudget.ram.estimate[1]){throw 'API mode must disable local device selection and remove the local model budget.'}
                $apiStorage=$script:fields.storageEstimate.Text
                Save-CapriPage
                if($options.inferenceMode -ne 'api'){throw 'API mode was not retained.'}
                $script:page='conversation'
                if((Get-CapriAdjacentPage 1) -ne 'voice'){throw 'API setup must skip the local-model question.'}
                $script:page='components'
                Render-CapriPage
                if($script:fields.models.Enabled -or $script:fields.models.Checked){throw 'API mode offered local model downloads.'}
                $script:page='device'
                Render-CapriPage
                $script:fields.huggingface.Checked=$true
                if($script:fields.storageEstimate.Text -ne $apiStorage){throw 'Hugging Face mode must defer the catalog model and retain the component estimate.'}
                foreach($kind in @('ram','vram')){
                    if($budgetRows[$kind].bar.Visible -or -not $budgetRows[$kind].label.Text.EndsWith('?')){throw 'An unselected Hugging Face model must have unknown memory use and no bar.'}
                }
                if($budgetInfo.AccessibleDescription -ne (Text-Capri 'budgetHuggingFaceUnknown')){throw 'Hugging Face memory help must explain why the estimate is unknown.'}
                Save-CapriPage
                if($options.inferenceMode -ne 'local' -or $options.modelSource -ne 'huggingface'){throw 'Hugging Face must remain a local-model choice.'}
                $script:page='conversation'
                if((Get-CapriAdjacentPage 1) -ne 'voice'){throw 'Hugging Face setup must skip the local-model question.'}
                $script:page='components'
                Render-CapriPage
                if($script:fields.models.Enabled -or $script:fields.models.Checked){throw 'Hugging Face mode offered catalog downloads.'}
                $options.inferenceMode='local'
                $options.modelSource='catalog'
                $options.languageDevice=$savedDevice
                $script:page='device'
                Render-CapriPage
            }
            if($pageId -eq 'components'){
                if(-not $options.router){throw 'The CPU classifier must be installed automatically.'}
                $classifierLabel=Text-Capri 'classifierIncluded'
                if(@($body.Controls|Where-Object{$_.Name -eq 'info-classifier' -or $_.Text -eq $classifierLabel}).Count -or
                    (Text-Capri 'info.components') -match '\bCPU\b'){
                    throw 'The optional components page mentions the mandatory CPU classifier.'
                }
                foreach($key in @('recognition','models','desktop','startMenu')){
                    if(-not $script:fields[$key].Checked){throw ('An installation component is not selected by default: '+$key)}
                }
                $initialBudget=$script:memoryBudget|ConvertTo-Json -Depth 8 -Compress
                foreach($key in @('recognition','models')){
                    $before=$script:memoryBudget
                    $script:fields[$key].Checked=$false
                    if($script:memoryBudget.ram.estimate[1] -ge $before.ram.estimate[1]){throw ('Memory estimate did not react to deselecting '+$key)}
                    if($key -eq 'recognition' -and $script:memoryBudget.vram.estimate[1] -ne $before.vram.estimate[1]){throw 'CPU recognition incorrectly changed VRAM.'}
                    $script:fields[$key].Checked=$true
                }
                $initialLanguage=$options.conversationLanguage
                $initialVoice=$options.voiceMode;$initialVoicePack=$options.voicePack
                Select-CapriFixtureConversation 'en'
                $script:page='components';Render-CapriPage
                $englishBudget=$script:memoryBudget
                Select-CapriFixtureConversation 'ru'
                $script:page='components';Render-CapriPage
                if($script:memoryBudget.ram.estimate[1] -le $englishBudget.ram.estimate[1]){throw 'Multilingual recognition did not update RAM.'}
                Select-CapriFixtureConversation $initialLanguage
                $options.voiceMode=$initialVoice;$options.voicePack=$initialVoicePack
                $script:page='components';Render-CapriPage
                if(($script:memoryBudget|ConvertTo-Json -Depth 8 -Compress) -ne $initialBudget){throw 'Memory estimate did not return to the original selection.'}
            }
            if($pageId -eq 'voice'){
                if(-not $script:fields.voicePack.ReadOnly -or $script:fields.voiceBrowse.Enabled){throw 'Voice source must be read-only and selected automatically or explicitly.'}
                $initialLanguage=$options.conversationLanguage
                $initialVoiceBudget=$script:memoryBudget
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
                if($initial -eq 'bundled' -and $script:memoryBudget.vram.estimate[1] -ge $initialVoiceBudget.vram.estimate[1]){throw 'Disabling voice did not lower the VRAM estimate.'}
                Save-CapriPage
                if($options.voicePack){throw 'Text mode retained a stale voice source.'}
                $offEstimate=$script:fields.storageEstimate.Text
                $offVram=$script:memoryBudget.vram.estimate[1]
                for($index=0;$index -lt $script:fields.voiceMode.Items.Count;$index++){
                    if(([string]$script:fields.voiceMode.Items[$index]).StartsWith('qwen |')){$script:fields.voiceMode.SelectedIndex=$index;break}
                }
                Save-CapriPage
                if($options.voiceMode -ne 'qwen' -or $options.voicePack -or $options.bundledVoicePack -ne $BundledVoicePack -or $script:fields.storageEstimate.Text -eq $offEstimate -or $script:memoryBudget.vram.estimate[1] -ne $offVram){throw 'Hugging Face CPU voice choice, included reference or budget is incorrect.'}
                Select-CapriFixtureConversation 'tr'
                $script:page='voice';Render-CapriPage
                if((Selected-Capri 'voiceMode') -ne 'off' -or @($script:fields.voiceMode.Items|Where-Object{$_ -like 'qwen |*'}).Count){throw 'Qwen was offered for an unsupported language.'}
                Select-CapriFixtureConversation $initialLanguage
                $script:page='voice';Render-CapriPage
                $script:fields.voicePack.Text=''
                for($index=0;$index -lt $script:fields.voiceMode.Items.Count;$index++){
                    if(([string]$script:fields.voiceMode.Items[$index]).StartsWith($initial+' |')){$script:fields.voiceMode.SelectedIndex=$index}
                }
                Save-CapriPage
                if($initial -eq 'bundled' -and $options.voicePack -ne $BundledVoicePack){throw 'Included voice was not selected for the installation request.'}
                Write-CapriJson (Join-Path $check ($language+'-voice.json')) @{mode=$options.voiceMode;source=$options.voicePack;gpu=$voiceGpu}
                $savedBudget=$script:memoryBudget|ConvertTo-Json -Depth 8 -Compress
                $script:page='review';Render-CapriPage
                if(($script:memoryBudget|ConvertTo-Json -Depth 8 -Compress) -ne $savedBudget){throw 'Review changed the memory estimate.'}
                $script:page='voice';Render-CapriPage
                if(($script:memoryBudget|ConvertTo-Json -Depth 8 -Compress) -ne $savedBudget){throw 'Returning to the voice question lost the memory estimate.'}
            }
            [Windows.Forms.Application]::DoEvents();
            if($pageId -eq 'review'){
                $script:fields.consent.Checked=$false
                Update-CapriDiskReview -Available $script:reviewStorage.requiredBytes
                if($next.Enabled){throw 'Setup must require explicit download and installation consent.'}
                $consentGap=$script:fields.consent.Top-$script:fields.reviewSummary.Bottom
                if($consentGap -lt (D 8) -or $consentGap -gt (D 16)){
                    throw ('Review rows overlap or have excessive spacing: '+$language)
                }
                $script:fields.consent.Checked=$true
                $lowSpace=[long]($script:reviewStorage.requiredBytes/3)
                Update-CapriDiskReview -Available $lowSpace
                Fit-CapriPage
                $warning=$script:fields.diskWarning
                if($next.Enabled -or -not $warning.Visible -or
                   -not $warning.Text.StartsWith((Text-Capri 'diskSpaceError')) -or
                   -not $warning.Text.Contains((Format-CapriAvailableDisk $options.target $lowSpace)) -or
                   -not $warning.Text.Contains((Format-CapriGiB $script:reviewStorage.requiredBytes)) -or
                   $warning.Top -lt $script:fields.heading.Bottom -or $warning.Bottom -gt $script:fields.reviewSummary.Top -or
                   $warning.Right -gt $body.ClientSize.Width -or $warning.Bottom -gt $body.ClientSize.Height){
                    throw ('Insufficient disk space must block installation and display a fully visible alert above the review details: '+$language)
                }
                if($language -eq $verificationIds[0]){
                    $alertCheck=Join-Path $check 'disk-space'
                    [IO.Directory]::CreateDirectory($alertCheck)|Out-Null
                    $image=New-Object Drawing.Bitmap($form.Width,$form.Height)
                    try{$form.DrawToBitmap($image,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)));$image.Save((Join-Path $alertCheck ($language+'.png')))}
                    finally{$image.Dispose()}
                }
                Update-CapriDiskReview -Available $null
                if($next.Enabled -or -not $warning.Text.StartsWith((Format-CapriAvailableDisk $options.target $null))){
                    throw ('An unavailable disk probe must keep installation blocked: '+$language)
                }
                Update-CapriDiskReview -Available $script:reviewStorage.requiredBytes
                Fit-CapriPage
                $headingGap=$script:fields.reviewSummary.Top-$script:fields.heading.Bottom
                if(-not $next.Enabled -or $warning.Visible -or $headingGap -lt (D 8) -or $headingGap -gt (D 16)){
                    throw ('Setup did not clear the warning and enable installation after space was freed: '+$language)
                }
                $script:fields.consent.Checked=$options.acceptDownloads
            }
            if($pageId -eq 'finish' -and $language -eq $verificationIds[0]){
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
            if($pageId -eq 'model'){Write-CapriJson (Join-Path $check ($language+'-models.json')) @{items=@($script:fields.profile.Items);index=$script:fields.profile.SelectedIndex;text=$script:fields.profile.Text}}
            if($pageId -eq 'interface'){
                Write-CapriJson (Join-Path $check ($language+'-selection.json')) @{
                    items=@($script:fields.installerLanguage.Items);index=$script:fields.installerLanguage.SelectedIndex;text=$script:fields.installerLanguage.Text
                    appItems=@($script:fields.interfaceLanguage.Items);appIndex=$script:fields.interfaceLanguage.SelectedIndex
                }
            }
            if($pageId -eq 'progress'){
                $script:fields.progress.Value=76
                $script:fields.progressText.Text=(Text-Capri 'progressOverall') -f 76
                Fit-CapriPage
            }
            $image=New-Object Drawing.Bitmap($form.Width,$form.Height)
            try{
                $form.DrawToBitmap($image,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
                $image.Save((Join-Path $check ($language+'-'+$pageId+'.png')))
            }finally{$image.Dispose()}
            if($body.VerticalScroll.Visible){
                $body.AutoScrollPosition=[Drawing.Point]::new(0,(D 32))
                $beforeFit=$body.AutoScrollPosition
                $headingBeforeFit=$script:fields.heading.Bounds
                Fit-CapriPage
                if($body.AutoScrollPosition -ne $beforeFit -or $script:fields.heading.Bounds -ne $headingBeforeFit){
                    throw ('Refitting a scrolled installer page moved its viewport: '+$language+' / '+$pageId)
                }
            }
        }
        # Exercise the real progress page and heading with a local fixture only.
        $progressTarget=Join-Path $check 'progress-target'
        [IO.Directory]::CreateDirectory($progressTarget)|Out-Null
        $progressIdentity=Join-Path $progressTarget '.capri-install.json'
        $progressRecord=@{schemaVersion=1;productId='capri.desktop';installId='11111111-1111-4111-8111-111111111111';root=$progressTarget;version='0.0.1'}
        Write-CapriJson $progressIdentity $progressRecord
        $options.updating=Test-CapriUpdateTarget (Assert-CapriTarget $progressTarget $sourceRoot $version) $version
        $script:page='progress';Render-CapriPage
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
        $script:page='progress';Render-CapriPage
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
        $fixtureEvents=Join-Path $check 'scroll-events.jsonl'
        [IO.File]::WriteAllText($fixtureEvents,'')
        $script:eventsCursor=New-Object Capri.Setup.EventCursor($fixtureEvents)
        $log=$script:fields.log
        for($batch=0;$batch -lt 2;$batch++){
            $messages=1..30|ForEach-Object{'{"type":"log","message":"Fixture log '+($batch*30+$_)+'"}'}
            [IO.File]::AppendAllLines($fixtureEvents,[string[]]$messages)
            Read-CapriInstallProgress $false
            $lastMessage=$log.Text.LastIndexOf('Fixture log ')
            $lastPosition=$log.GetPositionFromCharIndex($lastMessage)
            if($lastPosition.Y -lt 0 -or $lastPosition.Y -ge $log.ClientSize.Height){
                throw ('The installation log did not follow new entries from the bottom: '+$language)
            }
        }
        # Scroll with the caret still at the end, as when reviewing the log with the scrollbar.
        [CapriSetupScrollVerification]::SendMessage($log.Handle,0x0115,[IntPtr]6,[IntPtr]::Zero)|Out-Null
        $logTop=[Drawing.Point]::new(2,3)
        $readingPosition=$log.GetCharIndexFromPosition($logTop)
        if($readingPosition -ne 0){throw 'The installation log fixture must start at the oldest line.'}
        $body.AutoScrollPosition=[Drawing.Point]::new(0,(D 32))
        $scrollBefore=$body.AutoScrollPosition
        if($scrollBefore.Y -ge 0){throw 'The installation scroll fixture must start below the top.'}
        $script:progressScrollTrace=New-Object 'Collections.Generic.List[int]'
        $observeScroll=[EventHandler]{$script:progressScrollTrace.Add($body.AutoScrollPosition.Y)}
        $script:fields.heading.Add_LocationChanged($observeScroll)
        try{
            [IO.File]::AppendAllText($fixtureEvents,'{"type":"stage","step":"voice-runtime"}'+"`n"+'{"type":"log","message":"Installing voice packages"}'+"`n")
            Read-CapriInstallProgress $false
            if($body.AutoScrollPosition -ne $scrollBefore -or @($script:progressScrollTrace|Where-Object{$_ -ne $scrollBefore.Y}).Count){
                throw ('Live installation progress reset the viewport: '+$language+'; '+($script:progressScrollTrace -join ', '))
            }
            if($log.GetCharIndexFromPosition($logTop) -ne $readingPosition -or -not $log.Text.Contains('Installing voice packages')){
                throw ('New entries moved the installation log while reading old entries: '+$language)
            }
        }finally{$script:fields.heading.Remove_LocationChanged($observeScroll)}
        $fixtureLines=1..100|ForEach-Object{'History entry '+$_+' '+('x'*110)}
        $log.AppendLog(($fixtureLines -join "`r`n")+"`r`n")
        $retainedSelection='History entry 65 '
        $retainedIndex=$log.Text.IndexOf($retainedSelection)
        $log.Select($retainedIndex,$retainedSelection.Length)
        $retainedLine=$log.GetLineFromCharIndex($retainedIndex)
        $firstLine=[CapriSetupScrollVerification]::SendMessage($log.Handle,0x00CE,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()
        [CapriSetupScrollVerification]::SendMessage($log.Handle,0x00B6,[IntPtr]::Zero,[IntPtr]($retainedLine-$firstLine))|Out-Null
        if($log.GetCharIndexFromPosition($logTop) -ne $retainedIndex){throw 'The installation log fixture could not scroll to the retained line.'}
        $log.AppendLog(($fixtureLines[0..69] -join "`r`n")+"`r`n")
        if($log.TextLength -gt 16000 -or $log.SelectedText -cne $retainedSelection -or
            $log.GetCharIndexFromPosition($logTop) -ne $log.SelectionStart){
            throw ('Trimming the installation log moved the retained text or selection: '+$language)
        }
        $script:page='finish';$script:result=$null
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
