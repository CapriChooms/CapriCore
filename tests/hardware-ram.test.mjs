// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  meetsProfileRam,
  recommendProfile,
  selectProfile,
} from '../packages/runtime/src/hardware/profiles.mjs';

test('nominal RAM reservations use the same bounded policy for recommendation, selection and native setup', () => {
  const host = {
    ramBytes: 31.4 * 2 ** 30,
    cpuThreads: 16,
    gpus: [{ memoryKind: 'dedicated', vramMiB: 11.9 * 1024 }],
  };
  assert.equal(recommendProfile(host).profile.id, 'quality');
  assert.equal(selectProfile('quality', host).id, 'quality');
  const cases = [
    [31.4, 32, true],
    [30, 32, true],
    [29.99, 32, false],
    [24, 32, false],
    [22.5, 24, true],
    [22.49, 24, false],
    [15, 16, true],
    [14.99, 16, false],
    [7.5, 8, true],
    [7.49, 8, false],
    [0, 32, false],
    [NaN, 32, false],
    [Infinity, 32, false],
  ];
  for (const [ram, required, expected] of cases)
    assert.equal(meetsProfileRam(ram, required), expected);
  if (process.platform !== 'win32') return;
  const code = `. './packages/installer/windows/common.ps1'; @(${cases
    .slice(0, 11)
    .map(([ram, required]) => `(Test-CapriProfileRam ${ram} ${required})`)
    .join(',')}) | ConvertTo-Json -Compress`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout.trim()),
    cases.slice(0, 11).map((row) => row[2]),
  );
});
