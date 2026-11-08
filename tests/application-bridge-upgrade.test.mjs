// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { callApplicationBridge } from '../integrations/desktop-actions/service.mjs';
const parent = path.resolve('.runtime/bridge-upgrade-unit');
mkdirSync(parent, { recursive: true });
test(
  'first action builds a missing/upgraded helper but rejects tampering with its current executable',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = mkdtempSync(path.join(parent, 'fixture-')),
      native = path.join(root, 'integrations/desktop-actions/native');
    mkdirSync(native, { recursive: true });
    mkdirSync(path.join(root, '.runtime/tmp'), { recursive: true });
    copyFileSync(
      path.resolve('integrations/desktop-actions/native/DesktopActions.cs'),
      path.join(native, 'DesktopActions.cs'),
    );
    await assert.rejects(
      callApplicationBridge(root, { action: 'status', app: 'unavailable-fixture' }),
      /Unsupported application/,
    );
    const metadata = path.join(root, '.runtime/desktop-actions/build.json');
    assert.ok(existsSync(metadata));
    let build = JSON.parse(readFileSync(metadata));
    build.sourceSha256 = '0'.repeat(64);
    writeFileSync(metadata, JSON.stringify(build));
    await assert.rejects(
      callApplicationBridge(root, { action: 'status', app: 'unavailable-fixture' }),
      /Unsupported application/,
    );
    build = JSON.parse(readFileSync(metadata));
    const exe = path.join(root, '.runtime/desktop-actions', build.artifact);
    unlinkSync(exe);
    await assert.rejects(
      callApplicationBridge(root, { action: 'status', app: 'unavailable-fixture' }),
      /Unsupported application/,
    );
    // Windows scanners can briefly retain a newly executed image after its
    // process has closed. Wait only for sharing violations, never other errors.
    for (let attempt = 0; ; attempt++) {
      try {
        writeFileSync(exe, 'modified executable');
        break;
      } catch (error) {
        if (!['EBUSY', 'EPERM'].includes(error.code) || attempt >= 20) throw error;
        await delay(100);
      }
    }
    assert.throws(
      () => callApplicationBridge(root, { action: 'status', app: 'unavailable-fixture' }),
      /integrity/,
    );
  },
);
