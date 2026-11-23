// SPDX-License-Identifier: GPL-3.0-only
// Verify official download/hash, Windows preparation and elevated-script syntax.
// The elevation boundary is replaced: this verifier NEVER launches a driver installer.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { cableInstallScript } from '../../apps/desktop/virtual-cable-installer.mjs';

if (process.platform !== 'win32') throw new Error('Windows is required.');
const fixture = `
function Start-Process {
  param([string]$FilePath,[string]$Verb,[string[]]$ArgumentList,[string]$WindowStyle,[switch]$PassThru,[switch]$Wait)
  if ($Verb -ne 'RunAs' -or $WindowStyle -ne 'Hidden' -or -not $Wait) { throw 'Invalid elevation request' }
  $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($ArgumentList[-1]))
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -or $text -notmatch 'Get-AuthenticodeSignature' -or $text -notmatch 'SetAccessRuleProtection') { throw 'Invalid privileged script' }
  Write-Output 'CAPRI_CABLE:verified-preparation'
  return [PSCustomObject]@{ ExitCode = 0 }
}
`;
// Write-Output in the mocked function is captured by $child; use a separate marker
// on stderr so the fixture result remains a single object with ExitCode.
const script =
  fixture.replace(
    "Write-Output 'CAPRI_CABLE:verified-preparation'",
    "[Console]::Error.WriteLine('CAPRI_CABLE:verified-preparation')",
  ) + cableInstallScript();
const { stdout, stderr } = await promisify(execFile)(
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
    Buffer.from(script, 'utf16le').toString('base64'),
  ],
  { windowsHide: true, timeout: 120000, maxBuffer: 32768 },
).catch((error) => {
  throw new Error(
    'Cable preparation failed (code ' +
      error.code +
      '): ' +
      error.stdout.trim() +
      ' ' +
      error.stderr.trim(),
  );
});
assert.match(stdout, /CAPRI_CABLE:downloading/);
assert.match(stdout, /CAPRI_CABLE:installing/);
assert.match(stderr, /CAPRI_CABLE:verified-preparation/);
assert.doesNotMatch(stdout, /defaults-warning/);
console.log(
  'PASS official pinned download and both PowerShell stages; elevation mocked, no driver installed.',
);
