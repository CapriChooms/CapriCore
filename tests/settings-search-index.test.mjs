// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(
  new URL('../apps/desktop/renderer/settings-app.mjs', import.meta.url),
  'utf8',
);
const models = readFileSync(
  new URL('../apps/desktop/renderer/models-panel.mjs', import.meta.url),
  'utf8',
);

test('the idle-unload control is bound before the search index captures the panels', () => {
  const bind = app.indexOf('models.bindIdleUnload(raw);');
  const index = app.indexOf('const searchIndex = indexSettings(');
  assert.ok(bind > 0, 'binding call exists');
  assert.ok(index > 0, 'search index exists');
  assert.ok(bind < index, 'binding happens before indexing');
});

test('show() no longer injects the idle-unload control after the index exists', () => {
  const show = app.slice(app.indexOf('function show(snapshot) {'));
  const body = show.slice(0, show.indexOf('\n}\n'));
  assert.doesNotMatch(body, /bindIdleUnload/);
  assert.equal(app.match(/bindIdleUnload\(/g).length, 1, 'bound exactly once');
});

test('the idle control carries the words users search for', () => {
  assert.match(
    models,
    /<input id="models-idle-unload" type="checkbox" \/> Unload models when idle/,
  );
  assert.match(models, /<label for="models-idle-timeout">Idle timeout \(minutes\)<\/label>/);
});
