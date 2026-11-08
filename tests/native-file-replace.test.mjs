// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from '../packages/runtime/src/index.mjs';
import { ensureDesktopActions } from '../integrations/desktop-actions/provision.mjs';
import { callApplicationBridge } from '../integrations/desktop-actions/service.mjs';
test(
  'real Windows file replacement preserves an existing path and rejects a stale source hash',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const parent = path.join(root, '.runtime/test-data');
    await fs.mkdir(parent, { recursive: true });
    const folder = await fs.mkdtemp(path.join(parent, 'native-replace-'));
    const target = path.join(folder, 'Текст с пробелами.txt'),
      source = path.join(folder, '.capri-fixture.tmp');
    t.after(async () => {
      if (!path.resolve(folder).startsWith(path.resolve(parent) + path.sep))
        throw new Error('Invalid fixture path');
      await fs.rm(folder, { recursive: true, force: true });
    });
    await fs.writeFile(target, 'Original');
    await fs.writeFile(source, 'Updated');
    ensureDesktopActions(root);
    const expectedHash = createHash('sha256').update('Original').digest('hex');
    const value = await callApplicationBridge(
      root,
      { action: 'file_replace', source, target, expectedHash },
      { stillAllowed: () => true },
    );
    assert.equal(value.ok, true);
    assert.equal(await fs.readFile(target, 'utf8'), 'Updated');
    await assert.rejects(fs.stat(source), { code: 'ENOENT' });
    await fs.writeFile(source, 'Must not replace');
    await assert.rejects(
      callApplicationBridge(
        root,
        { action: 'file_replace', source, target, expectedHash },
        { stillAllowed: () => true },
      ),
    );
    assert.equal(await fs.readFile(target, 'utf8'), 'Updated');
  },
);
