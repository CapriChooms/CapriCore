param([Parameter(Mandatory=$true)][string]$Request,[switch]$Verification,[string]$VerificationImage)
# SPDX-License-Identifier: GPL-3.0-only
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$job=Get-Content -LiteralPath $Request -Raw -Encoding UTF8|ConvertFrom-Json
. (Join-Path $PSScriptRoot '../../installer/windows/localization.ps1')
. (Join-Path $PSScriptRoot '../../installer/windows/cyberpunk-theme.ps1')
[Capri.Setup.Cyberpunk.Theme]::EnableWindowDpi()
[Windows.Forms.Application]::EnableVisualStyles()
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$translations=Get-Content -LiteralPath (Join-Path $sourceRoot 'config/installer-shell-text.json') -Raw -Encoding UTF8|ConvertFrom-Json
$language=Get-CapriInstallerCulture $job.language (Get-CapriCatalogLanguages $translations)
function Text-Capri([string]$Key){Get-CapriInstallerText $translations $language $Key}
$form=New-Object Windows.Forms.Form
$form.Name='capri-update'
$form.Text=Text-Capri 'updateTitle'
$form.Font=[Drawing.Font]::new('Segoe UI',10)
$form.AutoScaleDimensions=[Drawing.SizeF]::new(96,96)
$form.AutoScaleMode='Dpi'
$form.ClientSize=[Drawing.Size]::new(656,352)
$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false;$form.MinimizeBox=$false
$form.RightToLeft=if($language -in @('ar','fa','he','ur')){'Yes'}else{'No'}
$form.RightToLeftLayout=$form.RightToLeft -eq 'Yes'
$iconFile=Join-Path $sourceRoot 'assets/default/app.ico'
$icon=if(Test-Path -LiteralPath $iconFile -PathType Leaf){[Drawing.Icon]::new($iconFile)}else{$null}
if($icon){$form.Icon=$icon}

$sidebar=New-Object Capri.Setup.Cyberpunk.Panel
$sidebar.Dock='Left';$sidebar.Width=152;$sidebar.PreviewRole='sidebar'
$sidebar.SidebarDividerY=108
$body=New-Object Capri.Setup.Cyberpunk.Panel
$body.Dock='Fill';$body.PreviewRole='body'
$footer=New-Object Capri.Setup.Cyberpunk.Panel
$footer.Dock='Bottom';$footer.Height=54;$footer.PreviewRole='footer'
$form.Controls.AddRange(@($body,$sidebar))
$body.Controls.Add($footer)

$cyan=[Drawing.Color]::FromArgb(109,247,242)
$muted=[Drawing.Color]::FromArgb(142,172,186)
$red=[Drawing.Color]::FromArgb(255,69,108)
$yellow=[Drawing.Color]::FromArgb(255,196,94)
$brand=New-Object Capri.Setup.Cyberpunk.Label
$brand.Text='CAPRI';$brand.Font=[Drawing.Font]::new('Segoe UI',19,[Drawing.FontStyle]::Bold)
$brand.ForeColor=$cyan;$brand.RightToLeft='No'
$brand.SetBounds(24,26,108,36)
$version=New-Object Capri.Setup.Cyberpunk.Label
$version.Font=[Drawing.Font]::new('Segoe UI',11,[Drawing.FontStyle]::Bold)
$version.ForeColor=$cyan;$version.RightToLeft='No'
$version.SetBounds(24,65,108,34)
if($job.tag -cmatch '^v(\d+\.\d+\.\d+)-experimental\.(\d+)$'){$version.Text='v'+$Matches[1]+'E'+$Matches[2]}
elseif($job.tag -cmatch '^v\d+\.\d+\.\d+$'){$version.Text=$job.tag}
$sidebar.Controls.AddRange(@($brand,$version))

$title=New-Object Capri.Setup.Cyberpunk.Label
$title.Font=[Drawing.Font]::new('Segoe UI',18,[Drawing.FontStyle]::Bold)
$title.Text=$form.Text;$title.SetBounds(26,17,452,48)
$status=New-Object Capri.Setup.Cyberpunk.Label
$status.Text=Text-Capri 'updatePreparing';$status.ForeColor=$cyan
$status.Font=[Drawing.Font]::new('Segoe UI',10,[Drawing.FontStyle]::Bold)
$status.SetBounds(26,70,452,42)
$bar=New-Object Capri.Setup.Cyberpunk.ProgressBar
$bar.Style='Marquee';$bar.MarqueeAnimationSpeed=0;$bar.AccessibleName=$status.Text
$sprite=Join-Path $sourceRoot 'assets/default/capri-installer-sleep.png'
$hasSprite=Test-Path -LiteralPath $sprite -PathType Leaf
if($hasSprite){
  $bar.SetMarker($sprite,[Drawing.Rectangle]::new(74,707,1106,461))
  $bar.SetBounds(26,116,452,108)
}else{$bar.SetBounds(26,184,452,18)}
$hint=New-Object Capri.Setup.Cyberpunk.Label
$hint.Text=Text-Capri 'updateHint';$hint.ForeColor=$muted
$hint.SetBounds(26,240,452,52)
$close=New-Object Capri.Setup.Cyberpunk.Button
$close.SetBounds(332,11,146,32);$close.Anchor='Top,Right'
$close.Enabled=$false;$close.Text=Text-Capri 'updateClose'
$footer.Controls.Add($close)
$body.Controls.AddRange(@($title,$status,$bar,$hint))
[Capri.Setup.Cyberpunk.Theme]::AttachWindow($form)
$bar.AnimateProgress=$true

$script:finished=$false;$script:worker=$null;$script:lines=0
$script:terminalPhase=''
$close.Add_Click({$form.Close()})
$form.Add_FormClosing({param($sender,$event) if(-not $script:finished){$event.Cancel=$true}})
$labels=@{waiting='updateWaiting';installing='updateInstalling';dependencies='updateDependencies';registering='updateRegistering';recovering='updateRecovering';complete='updateComplete'}
function Show-CapriUpdateFailure {
  $script:terminalPhase='failed'
  $status.Text=Text-Capri 'updateFailed'
  $status.ForeColor=$red;$bar.AccessibleName=$status.Text
  $hint.Text=Text-Capri 'updateDetails'
  $bar.AnimateProgress=$false
}
function Read-CapriUpdateEvents {
  if(-not $job.events -or -not (Test-Path -LiteralPath $job.events)){return}
  $events=@(Get-Content -LiteralPath $job.events -Encoding UTF8)
  for($i=$script:lines;$i -lt $events.Count;$i++){
    try{$record=$events[$i]|ConvertFrom-Json}catch{break}
    $script:lines=$i+1
    $phase=[string]$record.phase
    if($phase -in @('failed','operation-failed')){
      # Keep actionable diagnostics in the exported log without copying command output.
      $failure=@{schemaVersion=1;event='failure';phase=$phase}
      if([string]$record.stage -cmatch '^[a-z-]{1,32}$'){$failure.stage=[string]$record.stage}
      if([string]$record.code -cmatch '^[A-Z][A-Z0-9_]{2,63}$'){$failure.code=[string]$record.code}
      if($record.exitCode -is [int] -or $record.exitCode -is [long]){$failure.exitCode=$record.exitCode}
      [Console]::WriteLine(($failure|ConvertTo-Json -Compress))
      if($phase -eq 'failed'){Show-CapriUpdateFailure}
      continue
    }
    if(-not $labels.ContainsKey($phase) -or $script:terminalPhase -eq 'failed'){continue}
    $status.Text=Text-Capri $labels[$phase]
    $status.ForeColor=if($phase -eq 'recovering'){$yellow}else{$cyan}
    $bar.AccessibleName=$status.Text
    if($phase -eq 'complete'){
      $script:terminalPhase='complete'
      $bar.AnimateProgress=$false
      $bar.Style='Continuous';$bar.Value=100
    }
  }
}
$timer=New-Object Windows.Forms.Timer;$timer.Interval=250
$timer.Add_Tick({
  try {
    Read-CapriUpdateEvents
    if($script:worker -and $script:worker.HasExited){
      [Console]::WriteLine((@{phase='worker-exited';exitCode=$script:worker.ExitCode}|ConvertTo-Json -Compress))
      $timer.Stop();$script:finished=$true;$close.Enabled=$true
      if($script:worker.ExitCode -eq 0){
        Start-Process -FilePath (Join-Path $job.root 'Capri.exe') -WorkingDirectory $job.root -WindowStyle Hidden
        $form.Close()
      }else{Show-CapriUpdateFailure}
    }
  }catch{[Console]::Error.WriteLine($_.Exception.ToString());$timer.Stop();$script:finished=$true;$close.Enabled=$true;Show-CapriUpdateFailure}
})
$form.Add_Shown({
  try {
    [Console]::WriteLine((@{phase='ui-shown';language=$language;rtl=$form.RightToLeftLayout;sprite=$hasSprite}|ConvertTo-Json -Compress))
    if($Verification){
      Read-CapriUpdateEvents
      $script:finished=$true
      $close.Enabled=$script:terminalPhase -eq 'failed'
      if($VerificationImage){
        $image=[Drawing.Bitmap]::new($form.Width,$form.Height)
        try{$form.DrawToBitmap($image,[Drawing.Rectangle]::new(0,0,$image.Width,$image.Height));$image.Save($VerificationImage,[Drawing.Imaging.ImageFormat]::Png)}
        finally{$image.Dispose()}
      }
      $form.Close();return
    }
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$job.node
    $start.Arguments='"'+(Join-Path $job.source 'packages/updater/bin/apply.mjs')+'" "'+$Request+'"'
    $start.WorkingDirectory=$job.root;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $script:worker=[Diagnostics.Process]::Start($start)
    [Console]::WriteLine((@{phase='worker-started';pid=$script:worker.Id}|ConvertTo-Json -Compress))
    [IO.File]::WriteAllText($job.ready,'ready')
    $timer.Start()
  }catch{
    [Console]::Error.WriteLine($_.Exception.ToString())
    $script:finished=$true;$close.Enabled=$true
    if($Verification){$script:verificationFailed=$true;$form.Close()}else{Show-CapriUpdateFailure}
  }
})
try{[void]$form.ShowDialog()}finally{$timer.Dispose();$form.Dispose();if($icon){$icon.Dispose()}}
if($script:verificationFailed -or $script:terminalPhase -eq 'failed'){exit 1}
