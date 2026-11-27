// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PatchNotes } from '../apps/desktop/patch-notes.mjs';
import { UpdateService } from '../apps/desktop/update-service.mjs';
import { temporaryFolders } from './temporary-folders.mjs';

const temporary = temporaryFolders('capri-patch-notes-');

test('patch notes open after an upgrade, persist on presentation and never open for a fresh install', (t) => {
  const root = temporary(t);
  const start = (current, previous) => new PatchNotes({ root, state: root, current, previous });
  assert.equal(start('v1.2.2').offer(), null);
  assert.equal(start('v1.2.2').offer(), null);
  assert.equal(start('v1.3.0-experimental.1').offer(), 'v1.3.0-experimental.1');
  const upgrade = start('v1.3.0-experimental.1');
  assert.equal(upgrade.shown('v1.3.0'), false);
  assert.equal(upgrade.shown('v1.3.0-experimental.1'), true);
  assert.equal(start('v1.3.0-experimental.1').offer(), null);
  assert.equal(start('v1.2.2').offer(), null);
  assert.equal(start('v1.3.0-experimental.1').offer(), null);
  assert.equal(start('v1.3.0').offer(), 'v1.3.0');
});

test('a first launch with an upgraded installer receipt can retry until the notes appear', (t) => {
  const root = temporary(t);
  const start = () => new PatchNotes({ root, state: root, current: 'v1.3.0', previous: '1.2.2' });
  assert.equal(start().offer(), 'v1.3.0');
  assert.equal(start().offer(), 'v1.3.0');
  assert.equal(start().shown('v1.3.0'), true);
  assert.equal(start().offer(), null);
});

test('only cached or bundled notes for the installed version are used offline', (t) => {
  const root = temporary(t);
  const start = (current) => new PatchNotes({ root, state: root, current });
  const directory = path.join(root, 'docs', 'releases');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, '1.3.0.md'), '## Stable notes');
  start('v1.2.2').remember({ tag_name: 'v1.3.0-experimental.4', body: '## Experimental notes' });
  assert.equal(start('v1.3.0-experimental.3').localBody(), '');
  assert.equal(start('v1.3.0-experimental.4').localBody(), '## Experimental notes');
  assert.equal(start('v1.3.0').localBody(), '## Stable notes');
});

test('release lookup only returns the installed version, preferring a matching private preview', async (t) => {
  const root = temporary(t);
  mkdirSync(path.join(root, 'config'));
  writeFileSync(path.join(root, 'config', 'release.json'), '{"tag":"v1.3.0-experimental.4"}');
  const requests = [];
  const service = new UpdateService({
    root,
    state: root,
    credential: async () => 'fixture',
    releases: async ({ repository, signal }) => {
      assert.ok(signal instanceof AbortSignal);
      requests.push(repository);
      return [
        { tag_name: 'v1.3.0-experimental.5', body: 'Newer notes' },
        { tag_name: 'v1.3.0-experimental.4', body: 'Draft notes', draft: true },
        { tag_name: 'v1.3.0-experimental.4', body: 'Notes from ' + repository },
      ];
    },
  });
  t.after(() => service.close());
  assert.equal(await service.currentPatchNotes({ network: false }), '');
  assert.equal(await service.currentPatchNotes(), 'Notes from CapriChooms/Capri');
  assert.deepEqual(requests, ['CapriChooms/Capri', 'CapriChooms/CapriCore']);
});
