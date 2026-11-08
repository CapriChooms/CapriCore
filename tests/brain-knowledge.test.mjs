import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { BrainKnowledge } from '../apps/desktop/brain-knowledge.mjs';
const parent = path.resolve('.runtime/0.6.2/brain-tests');
mkdirSync(parent, { recursive: true });
test('offline indexing retrieves source fragments, never shares with an API by default and removes deleted sources', async () => {
  const data = mkdtempSync(path.join(parent, 'case-')),
    state = path.join(data, 'state');
  mkdirSync(state);
  const brain = new BrainKnowledge({ data, state });
  try {
    writeFileSync(
      path.join(brain.folder, 'Cake.txt'),
      'My cranberry cake recipe uses 220 grams of flour and 120 grams of sugar. Bake for thirty minutes.',
    );
    writeFileSync(path.join(brain.folder, 'bad.pdf'), 'not a PDF');
    await brain.refresh();
    const rows = brain.search('cranberry cake');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'Cake.txt');
    assert.match(rows[0].content, /220 grams/);
    assert.equal(brain.context('cake', { remote: true }), '');
    assert.match(brain.context('cake'), /untrusted reference data/);
    brain.configure({ enabled: true, shareWithApi: true });
    assert.match(brain.context('cake', { remote: true }), /Cake.txt/);
    assert.deepEqual(brain.search('" OR * UNION SELECT --'), []);
    unlinkSync(path.join(brain.folder, 'Cake.txt'));
    await brain.refresh();
    assert.deepEqual(brain.search('cake'), []);
    assert.equal(brain.snapshot().skipped, 1);
  } finally {
    brain.close();
  }
});
test('linked documents are not indexed', async () => {
  const data = mkdtempSync(path.join(parent, 'case-')),
    state = path.join(data, 'state');
  mkdirSync(state);
  const brain = new BrainKnowledge({ data, state });
  try {
    const outside = path.join(data, 'secret.txt');
    writeFileSync(outside, 'syntheticprivateword');
    try {
      symlinkSync(outside, path.join(brain.folder, 'linked.txt'));
    } catch (error) {
      if (error.code === 'EPERM') return;
      throw error;
    }
    await brain.refresh();
    assert.deepEqual(brain.search('syntheticprivateword'), []);
  } finally {
    brain.close();
  }
});
test('an unavailable knowledge database cannot break an ordinary reply', () => {
  const data = mkdtempSync(path.join(parent, 'case-')),
    state = path.join(data, 'state');
  mkdirSync(state);
  const brain = new BrainKnowledge({ data, state });
  try {
    mkdirSync(brain.database);
    assert.deepEqual(brain.search('cake'), []);
    assert.equal(brain.context('cake'), '');
  } finally {
    brain.close();
  }
});
