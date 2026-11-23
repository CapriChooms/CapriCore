// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, stat } from 'node:fs/promises';
import { openLocalModelFolder } from '../apps/desktop/local-model-folder.mjs';

test('opening an empty model store works before any model is installed and separates HF downloads', async () => {
  const parent = path.resolve('.runtime/model-folder-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  const opened = [];
  for (const [kind, subfolder] of [
    ['ollama', 'models'],
    ['huggingface', 'huggingface'],
  ]) {
    assert.equal(
      await openLocalModelFolder(root, kind, async (folder) => {
        opened.push(folder);
        return '';
      }),
      true,
    );
    assert.equal(opened.at(-1), path.join(root, 'data', subfolder));
    assert.equal((await stat(opened.at(-1))).isDirectory(), true);
  }
  // Arbitrary paths and non-string values never reach the OS folder opener.
  for (const invalid of ['../workspace', 'C:/', '', null, {}, ['ollama']])
    await assert.rejects(
      openLocalModelFolder(root, invalid, async () => assert.fail('Untrusted path opened')),
      /Invalid model storage/,
    );
  assert.equal(opened.length, 2);
});

test('OS failures show a safe localized message instead of paths or OS diagnostics', async () => {
  await assert.rejects(
    openLocalModelFolder(
      path.resolve('.runtime/model-folder-tests'),
      'ollama',
      async () => 'private OS path',
    ),
    {
      message: 'The models folder could not be opened.',
    },
  );
});
