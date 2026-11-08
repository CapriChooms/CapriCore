// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EMPTY_OWNER_MEMORY,
  initializeOwnerMemory,
  removeShippedOwnerPrefix,
  assertEmptyOwnerTemplates,
} from '../packages/runtime/src/owner-memory.mjs';

test('fresh user memory is independent of source templates; existing personal notes survive startup', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-memory-'));
  try {
    initializeOwnerMemory(root);
    for (const [name, expected] of Object.entries(EMPTY_OWNER_MEMORY))
      assert.equal(readFileSync(path.join(root, name), 'utf8'), expected);
    writeFileSync(path.join(root, 'USER.md'), 'My own preference');
    initializeOwnerMemory(root, { repairShippedDefaults: true });
    assert.equal(readFileSync(path.join(root, 'USER.md'), 'utf8'), 'My own preference');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('privacy repair removes only an exact known prefix and keeps user additions, including CRLF', () => {
  const old = '# Synthetic fixture\n\nAccidentally shipped fixture data.';
  const records = {
    'USER.md': { length: old.length, sha256: createHash('sha256').update(old).digest('hex') },
  };
  assert.equal(removeShippedOwnerPrefix('USER.md', old, records), EMPTY_OWNER_MEMORY['USER.md']);
  assert.equal(
    removeShippedOwnerPrefix(
      'USER.md',
      (old + '\n\nMy own notes.\n').replaceAll('\n', '\r\n'),
      records,
    ),
    EMPTY_OWNER_MEMORY['USER.md'] + '\nMy own notes.\n',
  );
  assert.equal(removeShippedOwnerPrefix('USER.md', old + 'changed', records), old + 'changed');
  const edited = old.replace('fixture data', 'user-authored data');
  assert.equal(removeShippedOwnerPrefix('USER.md', edited, records), edited);
});
test('release guard rejects any personal content in owner-memory templates', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-memory-export-'));
  try {
    const dir = path.join(root, 'config/workspace');
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(EMPTY_OWNER_MEMORY))
      writeFileSync(path.join(dir, name), text);
    assert.doesNotThrow(() => assertEmptyOwnerTemplates(root));
    writeFileSync(path.join(dir, 'USER.md'), '# User\n\nPrivate preferences');
    assert.throws(() => assertEmptyOwnerTemplates(root), /Release blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
