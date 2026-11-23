// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
const uv = path.join(root, '.runtime/uv/uv.exe'),
  python = path.join(root, '.runtime/voice-training-venv/Scripts/python.exe');
test(
  'an interrupted managed venv is preserved and recreated; a healthy retry reuses it',
  { skip: process.platform !== 'win32' || !existsSync(uv) || !existsSync(python), timeout: 30000 },
  () => {
    const parent = path.join(root, '.runtime/venv-repair-unit');
    mkdirSync(parent, { recursive: true });
    const base = mkdtempSync(path.join(parent, 'Капри-'));
    const broken = path.join(base, '.runtime/asr-venv');
    mkdirSync(path.join(broken, 'Lib/site-packages'), { recursive: true });
    writeFileSync(path.join(broken, 'Lib/site-packages/canary.txt'), 'retained interrupted files');
    const script = path.join(base, 'verify.ps1');
    writeFileSync(
      script,
      `param($Helper,$Root,$Uv,$Python)
$ErrorActionPreference='Stop'
. $Helper
$env:UV_OFFLINE='1';$env:UV_CACHE_DIR=Join-Path $Root '.runtime/uv-cache'
$runtime=@{Uv=$Uv;Python=$Python}
$first=Ensure-CapriVirtualEnvironment -ProjectRoot $Root -Name 'asr-venv' -Runtime $runtime
if(-not(Test-Path -LiteralPath $first)){throw 'Interpreter was not recreated'}
$cfg=Get-Item -LiteralPath (Join-Path $Root '.runtime/asr-venv/pyvenv.cfg')
$stamp=$cfg.LastWriteTimeUtc.Ticks
$second=Ensure-CapriVirtualEnvironment -ProjectRoot $Root -Name 'asr-venv' -Runtime $runtime
if($first -ne $second -or (Get-Item -LiteralPath $cfg.FullName).LastWriteTimeUtc.Ticks -ne $stamp){throw 'Healthy retry replaced the environment'}
$backups=@(Get-ChildItem -LiteralPath (Join-Path $Root '.runtime/venv-recovery') -Directory)
if($backups.Count -ne 1){throw 'Unexpected recovery copies'}
if((Get-Content -LiteralPath (Join-Path $backups[0].FullName 'Lib/site-packages/canary.txt') -Raw) -ne 'retained interrupted files'){throw 'Old files were lost'}
[IO.File]::WriteAllText((Join-Path $Root 'result.json'),'{"repaired":true,"reused":true,"backupRetained":true}')
`,
      'utf8',
    );
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        path.join(root, 'tools/setup/python-runtime.ps1'),
        base,
        uv,
        python,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 25000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(base, 'result.json'), 'utf8')), {
      repaired: true,
      reused: true,
      backupRetained: true,
    });
  },
);
