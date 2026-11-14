// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';

test(
  'native installer notifies once after confirmed success, never on failure/cancel/nonzero worker exit',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.join(root, '.runtime/installer-completion');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'notice-'));
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'packages/installer/windows/wizard.ps1'),
        '-VerificationDirectory',
        folder,
        '-VerificationFault',
        'completion',
        '-Language',
        'ru',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 45000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(path.join(folder, 'completion.json'), 'utf8'));
    assert.equal(report.passed, true);
    assert.equal(report.desktopAlertsSent, false);
    assert.deepEqual(
      report.checks.map((item) => [item.case, item.notifications, item.finishPage]),
      [
        ['complete', 1, 7],
        ['failed', 0, 7],
        ['cancelled', 0, 7],
        ['complete-then-failed', 0, 7],
      ],
    );
    assert.equal(
      report.noticeText,
      JSON.parse(readFileSync(path.join(root, 'config/installer-text.json'), 'utf8')).ru.complete,
    );
  },
);
