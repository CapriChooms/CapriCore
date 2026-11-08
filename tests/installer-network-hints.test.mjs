import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';

test(
  'installer network advice covers real transports and all locales without masking other failures',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.join(root, '.runtime/installer-network-hints');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const cases = [
      ['npm connection interrupted (ECONNRESET). Retrying dependencies 2/4', true],
      ['Request failed after 3 retries: tls handshake eof', true],
      ['HTTPSConnectionPool: Read timed out', true],
      ['fetch failed', true],
      ['Failed to fetch https://fixture.invalid/weights', true],
      ['The download stopped responding. Retry the installation.', true],
      ['Dependency download failed: HTTP 503', true],
      ['HTTP 429', true],
      ['lookup registry.ollama.ai: no such host', true],
      ['dial tcp: connectex: A connection attempt failed', true],
      ['Could not resolve host: huggingface.co', true],
      ['The remote name could not be resolved', true],
      ['The underlying connection was closed', true],
      ['Component exited 1: ConnectTimeout', true],
      ['UND_ERR_CONNECT_TIMEOUT', true],
      ['The network is unreachable', true],
      ['Dependency download failed: HTTP 403', false],
      ['HTTP 404: failed to fetch model', false],
      ['HTTP 401: unauthorized', false],
      ['Installation cancelled.', false],
      ['Access denied to destination folder', false],
      ['Not enough disk space', false],
      ['Archive hash mismatch', false],
      ['Voice dependencies could not be installed', false],
      ['Unsupported model architecture', false],
      ['Failed to build wheel', false],
    ];
    const casesFile = path.join(folder, 'cases.json');
    writeFileSync(casesFile, JSON.stringify(cases.map(([message]) => ({ message }))));
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    const script = path.join(folder, 'verify.ps1');
    writeFileSync(
      script,
      '\uFEFF' +
        [
          "$ErrorActionPreference='Stop'",
          '[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)',
          '. ' + literal(path.join(root, 'packages/installer/windows/localization.ps1')),
          '$cases=[IO.File]::ReadAllText(' + literal(casesFile) + ')|ConvertFrom-Json',
          '$catalog=[IO.File]::ReadAllText(' +
            literal(path.join(root, 'config/installer-text.json')) +
            ')|ConvertFrom-Json',
          '$results=@(foreach($item in $cases){Test-CapriSetupNetworkError $item.message})',
          "$transport=[Net.WebException]::new('Localized transport failure',[Net.WebExceptionStatus]::NameResolutionFailure)",
          "$outer=[Exception]::new('Outer exception',$transport)",
          '$localized=@(foreach($id in $catalog.PSObject.Properties.Name){',
          "  $message=Get-CapriSetupError $catalog $id 'tls handshake eof'",
          "  @{id=$id;hint=$message.Contains($catalog.$id.networkHelp);details=$message.Contains('tls handshake eof');tools=($catalog.$id.networkHelp -cmatch 'VPN' -and $catalog.$id.networkHelp -cmatch 'zapret')}",
          '})',
          "$voice=Get-CapriSetupError $catalog 'en' 'VOICE_PACK_PROFILE_MISSING'",
          "$disk=Get-CapriSetupError $catalog 'en' 'Disk full' 'CAPRI_DISK_SPACE'",
          "[ordered]@{results=$results;typed=(Test-CapriSetupNetworkError '' -Exception $outer);localized=$localized;voiceUnchanged=($voice -ceq $catalog.en.voiceProfileMissing);diskHint=$disk.Contains($catalog.en.networkHelp)}|ConvertTo-Json -Depth 6 -Compress",
        ].join('\n'),
    );
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.deepEqual(
      report.results,
      cases.map(([, expected]) => expected),
    );
    assert.equal(
      report.typed,
      true,
      'Localized Windows transport exceptions keep their network classification',
    );
    assert.equal(report.localized.length, 50);
    assert.ok(report.localized.every(({ hint, details, tools }) => hint && details && tools));
    assert.equal(report.voiceUnchanged, true);
    assert.equal(report.diskHint, false);
  },
);
