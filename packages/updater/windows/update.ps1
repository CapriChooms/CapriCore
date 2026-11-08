param([Parameter(Mandatory=$true)][string]$Request,[switch]$Verification)
# SPDX-License-Identifier: GPL-3.0-only
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$job=Get-Content -LiteralPath $Request -Raw -Encoding UTF8|ConvertFrom-Json
. (Join-Path $PSScriptRoot '../../installer/windows/localization.ps1')
$translations=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../../config/installer-shell-text.json') -Raw -Encoding UTF8|ConvertFrom-Json
$language=Get-CapriInstallerCulture $job.language (Get-CapriCatalogLanguages $translations)
function Text-Capri([string]$Key){Get-CapriInstallerText $translations $language $Key}
$form=New-Object Windows.Forms.Form
$form.Text=Text-Capri 'updateTitle';$form.Size=New-Object Drawing.Size(540,310)
$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false;$form.MinimizeBox=$false
$form.RightToLeft=if($language -in @('ar','fa','he','ur')){'Yes'}else{'No'}
$form.RightToLeftLayout=$form.RightToLeft -eq 'Yes'
$form.BackColor=[Drawing.Color]::FromArgb(9,18,28);$form.ForeColor=[Drawing.Color]::FromArgb(106,239,235)
$form.Font=New-Object Drawing.Font('Segoe UI',10)
$title=New-Object Windows.Forms.Label;$title.SetBounds(24,20,480,36)
$title.Font=New-Object Drawing.Font('Segoe UI',19,[Drawing.FontStyle]::Bold);$title.Text=$form.Text
$status=New-Object Windows.Forms.Label;$status.SetBounds(24,70,474,50)
$status.Text=Text-Capri 'updatePreparing'
$bar=New-Object Windows.Forms.ProgressBar;$bar.SetBounds(24,126,474,16);$bar.Style='Marquee'
$hint=New-Object Windows.Forms.Label;$hint.SetBounds(24,156,474,62);$hint.ForeColor=[Drawing.Color]::FromArgb(159,175,190)
$hint.Text=Text-Capri 'updateHint'
$close=New-Object Windows.Forms.Button;$close.SetBounds(350,227,148,30);$close.Enabled=$false;$close.Text=Text-Capri 'updateClose'
$form.Controls.AddRange(@($title,$status,$bar,$hint,$close))
$script:finished=$false;$script:worker=$null;$script:lines=0
$close.Add_Click({$form.Close()})
$form.Add_FormClosing({param($sender,$event) if(-not $script:finished){$event.Cancel=$true}})
$labels=@{waiting='updateWaiting';installing='updateInstalling';dependencies='updateDependencies';registering='updateRegistering';recovering='updateRecovering';complete='updateComplete'}
function Show-CapriUpdateFailure {
    $status.Text=Text-Capri 'updateFailed'
    $status.ForeColor=[Drawing.Color]::Salmon
    $hint.Text=Text-Capri 'updateDetails'
}
$timer=New-Object Windows.Forms.Timer;$timer.Interval=250
$timer.Add_Tick({
  try {
    if(Test-Path -LiteralPath $job.events){
      $events=@(Get-Content -LiteralPath $job.events -Encoding UTF8)
      for($i=$script:lines;$i -lt $events.Count;$i++){
        try{$record=$events[$i]|ConvertFrom-Json}catch{break}
        $script:lines=$i+1
        if($labels.ContainsKey($record.phase)){$status.Text=Text-Capri $labels[$record.phase]}
        if($record.phase -eq 'failed'){Show-CapriUpdateFailure}
      }
    }
    if($script:worker -and $script:worker.HasExited){
      [Console]::WriteLine((@{phase='worker-exited';exitCode=$script:worker.ExitCode}|ConvertTo-Json -Compress))
      $timer.Stop();$script:finished=$true;$close.Enabled=$true;$bar.Style='Blocks';$bar.Value=100
      if($script:worker.ExitCode -eq 0){
        Start-Process -FilePath (Join-Path $job.root 'Capri.exe') -WorkingDirectory $job.root -WindowStyle Hidden
        $form.Close()
      }else{Show-CapriUpdateFailure}
    }
  }catch{[Console]::Error.WriteLine($_.Exception.ToString());$timer.Stop();$script:finished=$true;$close.Enabled=$true;Show-CapriUpdateFailure}
})
$form.Add_Shown({
  try {
    [Console]::WriteLine((@{phase='ui-shown';language=$language;rtl=$form.RightToLeftLayout}|ConvertTo-Json -Compress))
    if($Verification){$script:finished=$true;$form.Close();return}
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$job.node
    $start.Arguments='"'+(Join-Path $job.source 'packages/updater/bin/apply.mjs')+'" "'+$Request+'"'
    $start.WorkingDirectory=$job.root;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $script:worker=[Diagnostics.Process]::Start($start)
    [Console]::WriteLine((@{phase='worker-started';pid=$script:worker.Id}|ConvertTo-Json -Compress))
    [IO.File]::WriteAllText($job.ready,'ready')
    $timer.Start()
  }catch{[Console]::Error.WriteLine($_.Exception.ToString());$script:finished=$true;$close.Enabled=$true;Show-CapriUpdateFailure}
})
[Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog();$timer.Dispose();$form.Dispose()
