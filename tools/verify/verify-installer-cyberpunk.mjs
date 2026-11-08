// SPDX-License-Identifier: GPL-3.0-only
// Disposable staged/extracted skin verification. Never starts an installer worker.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { transformPreviewSource } from '../preview/build-installer-cyberpunk.mjs';

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = (file) => readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
export function installerPreviewMatrix(quick = false) {
  return quick
    ? [{ dpi: 96, languages: ['en', 'ru'] }]
    : [
        { dpi: 96, languages: ['en', 'ru', 'ar'] },
        { dpi: 144, languages: ['en', 'ru'] },
        { dpi: 192, languages: ['en', 'ru'] },
        { dpi: 144, languages: ['de'] },
      ];
}
export function assertPreviewLocation(source) {
  source = path.resolve(source);
  const relative = path.relative(root, source).replaceAll('\\', '/');
  assert(
    relative && !relative.startsWith('../') && !path.isAbsolute(relative),
    'Use a disposable preview inside the workspace.',
  );
  assert(
    relative.startsWith('.runtime/') || relative.startsWith('release/previews/'),
    'A real Capri installation cannot be used for UI verification.',
  );
  assert(
    !existsSync(path.join(source, '.capri-install.json')),
    'Do not run preview QA in an installed Capri.',
  );
  for (let current = source; current !== root; current = path.dirname(current))
    if (existsSync(current))
      assert(!lstatSync(current).isSymbolicLink(), 'Preview QA cannot follow a source link.');
  return source;
}
export function auditInstallerPreview(source) {
  source = assertPreviewLocation(source);
  const windows = 'packages/installer/windows/';
  const records = [];
  const production = read(path.join(source, windows, 'wizard-ui.ps1')).includes(
    'New-Object Capri.Setup.Cyberpunk.',
  );
  for (const [name, options] of [
    ['wizard-ui.ps1', { wizard: true }],
    ['memory-budget-ui.ps1', { budget: true }],
  ]) {
    const original = read(path.join(root, windows, name));
    const expected = production ? original : transformPreviewSource(original, options).text;
    assert.equal(
      read(path.join(source, windows, name)),
      expected,
      'Non-visual wizard change: ' + name,
    );
    records.push({
      file: name,
      visualOnly: true,
      production,
      sha256: digest(path.join(source, windows, name)),
    });
  }
  for (const name of [
    'wizard.ps1',
    'install-progress.ps1',
    'install-progress-ui.ps1',
    'memory-budget.ps1',
    'common.ps1',
    'sessions.ps1',
  ]) {
    assert.equal(
      read(path.join(source, windows, name)),
      read(path.join(root, windows, name)),
      'Installer logic changed: ' + name,
    );
    records.push({ file: name, unchanged: true });
  }
  for (const name of [
    'cyberpunk-theme.cs',
    'cyberpunk-theme.ps1',
    'cyberpunk-preview.cs',
    'cyberpunk-preview.ps1',
  ]) {
    assert(existsSync(path.join(source, windows, name)), 'Missing preview skin: ' + name);
    records.push({ file: name, sha256: digest(path.join(source, windows, name)) });
  }
  return records;
}

const driverSource = String.raw`param([string]$Source,[string]$Output,[string]$Languages,[int]$Dpi,[string]$VoicePack)
$ErrorActionPreference='Stop'
# Only synthetic leaf readers are replaced. Product selection, budgeting,
# persistence, rendering and built-in verification functions are unchanged.
function Get-CimInstance {
    param([string]$ClassName)
    switch($ClassName){
      'Win32_ComputerSystem'{return [pscustomobject]@{TotalPhysicalMemory=32GB}}
      'Win32_VideoController'{return [pscustomobject]@{Name='AMD Radeon RX 9060 XT (QA fixture)'}}
      'Win32_OperatingSystem'{return [pscustomobject]@{FreePhysicalMemory=24MB}}
      default{throw ('Unexpected preview fixture hardware query: '+$ClassName)}
    }
}
function New-Object {
    [CmdletBinding()]param([Parameter(Position=0)][string]$TypeName,[Parameter(Position=1)][object[]]$ArgumentList,[hashtable]$Property)
    if($TypeName -eq 'Microsoft.VisualBasic.Devices.ComputerInfo'){
      return [pscustomobject]@{AvailablePhysicalMemory=24GB;TotalPhysicalMemory=32GB}
    }
    return Microsoft.PowerShell.Utility\New-Object @PSBoundParameters
}
Add-Type -TypeDefinition @'
using System;
namespace Capri.Setup {
 public sealed class QaAdapter {
  public string name="AMD Radeon RX 9060 XT (QA fixture)",vendor="amd",memoryKind="dedicated";
  public long vramMiB=8192;
  public long? freeVramMiB=6144;
 }
 public static class GpuInventory {
  public static QaAdapter[] Read(int timeout){return new QaAdapter[]{new QaAdapter()};}
 }
}
'@
. (Join-Path $Source 'packages/installer/windows/common.ps1')
. (Join-Path $Source 'packages/installer/windows/sessions.ps1')
[Capri.Setup.Display]::Enable()|Out-Null
$script:qaObserved=@{}
$script:qaObserverErrors=New-Object 'Collections.Generic.List[string]'
$script:qaCapturing=$false
$script:qaNativeCapture=@{}
Add-Type -TypeDefinition @'
using System;using System.Drawing;using System.Runtime.InteropServices;using System.Windows.Forms;
public static class CapriQaCapture {
 [StructLayout(LayoutKind.Sequential)]struct Rect {public int L,T,R,B;}
 [StructLayout(LayoutKind.Sequential)]struct Point {public int X,Y;}
 [StructLayout(LayoutKind.Sequential)]struct ComboInfo {public int size;public Rect item,button;public int state;public IntPtr combo,edit,list;}
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")]static extern bool GetComboBoxInfo(IntPtr w,ref ComboInfo i);
 static bool Owned(Point point){uint pid;GetWindowThreadProcessId(WindowFromPoint(point),out pid);return pid==(uint)System.Diagnostics.Process.GetCurrentProcess().Id;}
 public static bool Save(IntPtr window,string file){
  uint pid;GetWindowThreadProcessId(window,out pid);if(pid!=(uint)System.Diagnostics.Process.GetCurrentProcess().Id)return false;
  Rect r;if(!GetWindowRect(window,out r))return false;Rectangle area=Rectangle.FromLTRB(r.L,r.T,r.R,r.B);
  if(area.Width<1||area.Height<1||!Screen.FromRectangle(area).Bounds.Contains(area))return false;
  for(int y=3;y<area.Height;y+=12)for(int x=3;x<area.Width;x+=12)if(!Owned(new Point{X=area.X+x,Y=area.Y+y}))return false;
  using(Bitmap bitmap=new Bitmap(area.Width,area.Height))using(Graphics graphics=Graphics.FromImage(bitmap)){
   graphics.CopyFromScreen(area.Location,System.Drawing.Point.Empty,area.Size);
   for(int y=3;y<area.Height;y+=12)for(int x=3;x<area.Width;x+=12)if(!Owned(new Point{X=area.X+x,Y=area.Y+y}))return false;
   bitmap.Save(file);
  }return true;
 }
 public static bool SaveList(ComboBox box,string file){ComboInfo info=new ComboInfo();info.size=Marshal.SizeOf(typeof(ComboInfo));return GetComboBoxInfo(box.Handle,ref info)&&info.list!=IntPtr.Zero&&Save(info.list,file);}
}
'@ -ReferencedAssemblies System.Drawing,System.Windows.Forms
$observer=[EventHandler]{
 if($script:qaCapturing){return}
 $fields=Get-Variable fields -Scope Script -ValueOnly -ErrorAction SilentlyContinue
 if(-not $fields -or -not $fields.ContainsKey('heading')){return}
 $number=Get-Variable page -Scope Script -ValueOnly -ErrorAction SilentlyContinue
 $lang=Get-Variable installerLanguage -Scope Script -ValueOnly -ErrorAction SilentlyContinue
 $key=[string]$lang+'-'+[string]$number
 try{
  $counts=@{};$native=New-Object 'Collections.Generic.List[string]'
  $queue=New-Object Collections.Stack;$queue.Push($form)
  while($queue.Count){$control=$queue.Pop();$type=$control.GetType();$name=$type.FullName
   if(-not $counts.ContainsKey($name)){$counts[$name]=0};$counts[$name]++
   if($type.Namespace -eq 'System.Windows.Forms' -and $type.Name -in @('Button','CheckBox','RadioButton','ComboBox','ProgressBar','Panel','Label','TextBox')){$native.Add($type.Name)}
   foreach($child in $control.Controls){$queue.Push($child)}
  }
  $previewBadge=[Capri.Setup.Cyberpunk.Theme].GetProperty('DesignPreview',[Reflection.BindingFlags]'NonPublic,Static').GetValue($null,$null)
  $script:qaObserved[$key]=@{language=$lang;page=$number;classes=$counts;unthemedNative=@($native.ToArray());formArgb=$form.BackColor.ToArgb();fontUnit=[string]$form.Font.Unit;previewBadge=[bool]$previewBadge}
  if($Dpi -eq 96 -and $lang -eq 'en' -and $number -in @(0,3,4) -and -not $script:qaNativeCapture.ContainsKey($key)){
   $script:qaCapturing=$true
   try{
    $form.TopMost=$true;$form.Refresh();[Windows.Forms.Application]::DoEvents()
    $closed=[CapriQaCapture]::Save($form.Handle,(Join-Path $Output ($key+'-live.png')))
    $field=if($number -eq 0){'installerLanguage'}elseif($number -eq 3){'profile'}else{'voiceMode'}
    $combo=$fields[$field];$selected=$combo.SelectedIndex;$text=[string]$combo.SelectedItem
    $combo.DroppedDown=$true;[Windows.Forms.Application]::DoEvents()
    $popup=[CapriQaCapture]::SaveList($combo,(Join-Path $Output ($key+'-popup-live.png')))
    $combo.DroppedDown=$false
    if($combo.SelectedIndex -ne $selected){throw 'Opening the native popup changed the selected option.'}
    $script:qaNativeCapture[$key]=@{closed=$closed;popup=$popup;selectedItem=$text;selectedIndex=$selected;drawMode=[string]$combo.DrawMode;controlType=$combo.GetType().FullName;onlyOwnedPixels=$true}
   }finally{$form.TopMost=$false;$script:qaCapturing=$false}
  }
 }catch{$script:qaObserverErrors.Add($_.Exception.Message)}
}
[Windows.Forms.Application]::add_Idle($observer)
try {
 . (Join-Path $Source 'packages/installer/windows/wizard.ps1') -VerificationDirectory $Output -VerificationLanguages $Languages -VerificationDpi $Dpi -BundledVoicePack $VoicePack
}finally{
 [Windows.Forms.Application]::remove_Idle($observer)
 @{pages=@($script:qaObserved.Values);capture=$script:qaNativeCapture;errors=@($script:qaObserverErrors.ToArray());syntheticHardware=$true;installerStarted=$false}|ConvertTo-Json -Depth 15|Set-Content -LiteralPath (Join-Path $Output 'skin-controls.json') -Encoding UTF8
}
`;

export function verifyInstallerCyberpunk({ source, voicePack = '', quick = false }) {
  assert.equal(process.platform, 'win32', 'Native installer verification requires Windows.');
  source = assertPreviewLocation(source);
  const before = auditInstallerPreview(source);
  const production = before.find((item) => item.file === 'wizard-ui.ps1').production;
  const parent = path.join(source, '.runtime/cyberpunk-ui-verification');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'run-'));
  const driver = path.join(folder, 'native-preview-driver.ps1');
  writeFileSync(driver, '\uFEFF' + driverSource);
  const report = {
    passed: false,
    folder,
    syntheticHardware: { ramGiB: 32, availableRamGiB: 24, vramGiB: 8, availableVramGiB: 6 },
    installsStarted: false,
    modelRequests: false,
    networkDownloads: false,
    scripts: before,
    runs: [],
    limitations: [
      'DrawToBitmap cannot capture OS-native popups; owned live captures are attempted separately at96DPI and never replaced by fake text.',
      'VerificationDpi tests static layout scaling, not a physical move between monitors.',
      'OS file pickers and message boxes keep their native Windows appearance.',
    ],
  };
  try {
    for (const entry of installerPreviewMatrix(quick)) {
      const output = path.join(folder, 'dpi-' + entry.dpi + '-' + entry.languages.join('-'));
      mkdirSync(output, { recursive: true });
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          driver,
          '-Source',
          source,
          '-Output',
          output,
          '-Languages',
          entry.languages.join(','),
          '-Dpi',
          String(entry.dpi),
          '-VoicePack',
          voicePack,
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
      );
      writeFileSync(
        path.join(output, 'driver-output.log'),
        (result.stdout ?? '') + (result.stderr ?? ''),
      );
      assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
      const controls = JSON.parse(read(path.join(output, 'skin-controls.json')));
      assert.deepEqual(controls.errors, []);
      for (const language of entry.languages) {
        for (let page = 0; page < 8; page++) {
          const file = path.join(output, `${language}-${page}.png`);
          const bytes = readFileSync(file);
          assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
          assert(bytes.readUInt32BE(16) > 500 && bytes.readUInt32BE(20) > 400);
          const state = controls.pages.find(
            (value) => value.language === language && value.page === page,
          );
          if (state) {
            assert.equal(
              state.previewBadge,
              !production,
              'Production setup must not show the design-preview badge.',
            );
            assert.deepEqual(
              state.unthemedNative,
              [],
              `Unthemed controls on ${language}/${entry.dpi}/${page}`,
            );
          }
        }
        const layout = JSON.parse(read(path.join(output, language + '-layout.json')));
        assert.equal(layout.dpi, entry.dpi);
        assert.equal(layout.rtl, language === 'ar');
        assert.equal(layout.fontUnit, 'Pixel');
        assert(layout.footerBottom <= layout.clientHeight);
      }
      report.runs.push({
        ...entry,
        pages: entry.languages.length * 8,
        nativeCapture: controls.capture,
        builtInAssertionsPassed: true,
        liveControlAuditObserved: controls.pages.length > 0,
      });
      console.log(
        JSON.stringify({ dpi: entry.dpi, languages: entry.languages, passed: true, output }),
      );
    }
    assert.deepEqual(
      auditInstallerPreview(source),
      before,
      'Preview source changed while native QA was running.',
    );
    report.passed = true;
  } catch (error) {
    report.error = error.stack ?? String(error);
    throw error;
  } finally {
    report.pages = report.runs.reduce((sum, entry) => sum + entry.pages, 0);
    writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, pages: report.pages, folder }));
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    options = {};
  for (const arg of args) {
    if (arg === '--quick') options.quick = true;
    else if (arg.startsWith('--source=')) options.source = arg.slice(9);
    else if (arg.startsWith('--voice-pack=')) options.voicePack = arg.slice(13);
    else throw new Error('Use --source=DISPOSABLE_PREVIEW [--voice-pack=APPROVED_PACK] [--quick].');
  }
  assert(options.source, 'An explicit disposable --source is required.');
  verifyInstallerCyberpunk(options);
}
