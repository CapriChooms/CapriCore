// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const VB_CABLE = Object.freeze({
  url: 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip',
  sha256: 'b950e39f01af1d04ea623c8f6d8eb9b6ea5c477c637295fabf20631c85116bfb',
});
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');

export function cableInstallScript() {
  const defaults = readFileSync(
    new URL('../../integrations/call-audio/CableDefaults.cs', import.meta.url),
    'utf8',
  );
  // Elevated extraction happens in a private administrator-owned directory. The copied
  // archive is checked again there; user-writable extracted executables are never elevated.
  const elevated = `
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\\v1.0\\Modules'
$stage = $null
try {
  $stage = Join-Path ([Environment]::GetFolderPath('Windows')) ('Temp\\CapriCable-' + [Guid]::NewGuid().ToString('N'))
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  foreach ($sid in @('S-1-5-32-544','S-1-5-18')) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $security.AddAccessRule($rule)
  }
  [IO.Directory]::CreateDirectory($stage, $security) | Out-Null
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage 'cable.zip')
  $archive = Join-Path $stage 'cable.zip'
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '${VB_CABLE.sha256}') { exit 22 }
  Expand-Archive -LiteralPath $archive -DestinationPath $stage
  $setup = Join-Path $stage 'VBCABLE_Setup_x64.exe'
  $signature = Get-AuthenticodeSignature -LiteralPath $setup
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'BUREL VINCENT') { exit 23 }
  $process = Start-Process -FilePath $setup -ArgumentList '-i','-h' -WorkingDirectory $stage -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -notin @(0,3010)) { exit 24 }
} catch { exit 24 }
finally {
  if ($stage -and [IO.Path]::GetFullPath($stage).StartsWith([IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('Windows')) 'Temp\\CapriCable-')), [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
exit 0
`;
  return `
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\\v1.0\\Modules'
$ProgressPreference = 'SilentlyContinue'
$scratch = $null
$saved = $null
$result = 24
try {
  Add-Type -TypeDefinition ${quote(defaults)}
  $saved = [Capri.CallAudio.Defaults]::Capture()
  $scratch = Join-Path ([IO.Path]::GetTempPath()) ('CapriCable-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $scratch | Out-Null
  $archive = Join-Path $scratch 'cable.zip'
  Write-Output 'CAPRI_CABLE:downloading'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $response = $null
  $download = $null
  $file = $null
  try {
    $request = [Net.HttpWebRequest]::Create('${VB_CABLE.url}')
    $request.AllowAutoRedirect = $false
    $request.Timeout = 90000
    $request.ReadWriteTimeout = 90000
    $response = $request.GetResponse()
    if ($response.ContentLength -gt 2097152) { throw 'Download too large' }
    $download = $response.GetResponseStream()
    $file = [IO.File]::Create($archive)
    $buffer = New-Object byte[] 65536
    $size = 0
    while (($count = $download.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $size += $count
      if ($size -gt 2097152) { throw 'Download too large' }
      $file.Write($buffer, 0, $count)
    }
  } catch { exit 21 }
  finally { if ($file) { $file.Dispose() }; if ($download) { $download.Dispose() }; if ($response) { $response.Dispose() } }
  if ((Get-Item -LiteralPath $archive).Length -gt 2097152 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '${VB_CABLE.sha256}') { exit 22 }
  $escaped = $archive.Replace("'", "''")
  $inner = '$source = ' + "'" + $escaped + "'" + [Environment]::NewLine + ${quote(elevated)}
  $command = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
  Write-Output 'CAPRI_CABLE:installing'
  try {
    $child = Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$command -WindowStyle Hidden -PassThru -Wait
    $result = $child.ExitCode
  } catch { if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { $result = 20 } else { $result = 24 } }
} catch { $result = 24 }
finally {
  if ($saved) { try { if (-not [Capri.CallAudio.Defaults]::Restore($saved)) { Write-Output 'CAPRI_CABLE:defaults-warning' } } catch { Write-Output 'CAPRI_CABLE:defaults-warning' } }
  if ($scratch -and [IO.Path]::GetFullPath($scratch).StartsWith([IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'CapriCable-')), [StringComparison]::OrdinalIgnoreCase)) {
    # Only one known file lives here. Never recursively follow a user-writable temp directory.
    try { [IO.File]::Delete((Join-Path $scratch 'cable.zip')); [IO.Directory]::Delete($scratch, $false) } catch { }
  }
}
exit $result
`;
}
function runInstaller(script, progress) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encoded(script),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let buffer = '',
      warning = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let index; (index = buffer.indexOf('\n')) >= 0; ) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line === 'CAPRI_CABLE:defaults-warning') warning = true;
        if (['CAPRI_CABLE:downloading', 'CAPRI_CABLE:installing'].includes(line))
          progress(line.split(':')[1]);
      }
      if (buffer.length > 2048) buffer = '';
    });
    child.once('error', () => reject(new Error('Windows could not start VB-CABLE setup.')));
    child.once('exit', (code) => resolve({ code, defaultsWarning: warning }));
  });
}
export class VirtualCableInstaller {
  constructor({ emit = () => {}, run = runInstaller, platform = process.platform } = {}) {
    Object.assign(this, { emit, run, platform });
    this.state = { phase: 'idle', busy: false };
  }
  snapshot() {
    return { ...this.state };
  }
  whenSettled() {
    return this.pending ?? Promise.resolve();
  }
  publish(value) {
    Object.assign(this.state, value);
    this.emit(this.snapshot());
  }
  async install() {
    if (this.platform !== 'win32') throw new Error('Call audio is available on Windows.');
    if (this.state.busy) throw new Error('VB-CABLE setup is already running.');
    let finish;
    this.pending = new Promise((resolve) => {
      finish = resolve;
    });
    this.state = { phase: 'downloading', busy: true };
    this.emit(this.snapshot());
    try {
      const result = await this.run(cableInstallScript(), (phase) => this.publish({ phase }));
      const errors = {
        20: 'Windows permission was cancelled. No call connection was enabled.',
        21: 'VB-CABLE could not be downloaded. Check your connection and try again.',
        22: 'VB-CABLE verification failed. Nothing was installed.',
        23: 'VB-CABLE publisher verification failed. Nothing was installed.',
      };
      if (result.code !== 0)
        throw new Error(
          errors[result.code] || 'VB-CABLE setup could not finish. Restart Windows and try again.',
        );
      this.publish({ phase: 'reboot', defaultsWarning: result.defaultsWarning === true });
    } catch (error) {
      this.publish({ phase: 'error', error: error.message });
    } finally {
      this.publish({ busy: false });
      finish();
      this.pending = null;
    }
    return this.snapshot();
  }
}
