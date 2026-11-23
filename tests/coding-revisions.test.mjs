// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CodingService } from '../apps/desktop/coding-service.mjs';
import { CodingRevisions, applyCodingEdits } from '../apps/desktop/coding-revisions.mjs';
import { temporaryFolders } from './temporary-folders.mjs';

const temporary = temporaryFolders('capri-coding-revisions-');

function fixture(t, reviewWrites = false) {
  const workspace = temporary(),
    root = temporary();
  const service = new CodingService({ root });
  t.after(() => service.setMonitoring(false));
  service.save({ workspace, editor: null, tasks: [], reviewWrites });
  const file = path.join(workspace, 'main.js');
  writeFileSync(file, 'const x = 1;\n');
  const edit = {
    kind: 'edit',
    path: 'main.js',
    text: 'const x = 2;\n',
    hash: service.read('main.js').hash,
  };
  return { service, workspace, file, edit };
}

test('a reviewed batch reports diff before applying and creates files with missing parent folders', async (t) => {
  const { service, workspace, file, edit } = fixture(t, true);
  const waiting = Promise.withResolvers();
  const revisions = new CodingRevisions(service, { review: waiting.resolve });
  const run = revisions.apply([
    edit,
    { kind: 'create', path: 'src/math.mjs', text: 'export const twice = n => n * 2;\n' },
  ]);
  await waiting.promise;
  assert.equal(readFileSync(file, 'utf8'), 'const x = 1;\n');
  assert.equal(existsSync(path.join(workspace, 'src')), false);
  const { pending } = revisions.snapshot();
  assert.equal(pending.files.length, 2);
  assert.deepEqual(revisions.diff(pending.id, 'main.js').lines, [
    { type: 'removed', text: 'const x = 1;', oldLine: 1 },
    { type: 'added', text: 'const x = 2;', newLine: 1 },
  ]);
  revisions.decide(pending.id, true);
  const result = await run;
  assert.equal(result.files.length, 2);
  assert.equal(readFileSync(file, 'utf8'), 'const x = 2;\n');
  assert.match(readFileSync(path.join(workspace, 'src/math.mjs'), 'utf8'), /twice/);
  assert.equal(revisions.snapshot().recent[0].state, 'applied');
});

test('discard and changes made in the editor before approval both leave the batch unapplied', async (t) => {
  const { service, workspace, file, edit } = fixture(t, true);
  let waiting = Promise.withResolvers();
  const revisions = new CodingRevisions(service, { review: () => waiting.resolve() });
  const edits = [{ kind: 'create', path: 'new.js', text: 'new' }, edit];
  const discard = revisions.apply(edits);
  await waiting.promise;
  revisions.decide(revisions.snapshot().pending.id, false);
  await assert.rejects(discard, { code: 'CAPRI_CODING_REVIEW_DECLINED' });
  waiting = Promise.withResolvers();
  const conflict = revisions.apply(edits);
  await waiting.promise;
  writeFileSync(file, 'newer editor content');
  revisions.decide(revisions.snapshot().pending.id, true);
  await assert.rejects(conflict, /file changed/);
  assert.equal(readFileSync(file, 'utf8'), 'newer editor content');
  assert.equal(existsSync(path.join(workspace, 'new.js')), false);
});

test('invalid workspace paths and conflicting creates fail before any writes', async (t) => {
  const { service, workspace, file, edit } = fixture(t);
  mkdirSync(path.join(workspace, 'src'));
  for (const relative of ['../outside.js', '.env', 'src']) {
    await assert.rejects(
      applyCodingEdits(service, [edit, { kind: 'create', path: relative, text: 'x' }]),
    );
    assert.equal(readFileSync(file, 'utf8'), 'const x = 1;\n');
  }
});
