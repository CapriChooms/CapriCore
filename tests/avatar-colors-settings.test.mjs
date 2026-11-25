// SPDX-License-Identifier: GPL-3.0-only
// Every companion settings card must be placed in a settings section, or the
// settings window never shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) =>
  readFileSync(new URL('../apps/desktop/renderer/' + file, import.meta.url), 'utf8');
const panel = read('companion-panel.mjs'),
  app = read('settings-app.mjs');
const groups = [...panel.matchAll(/data-companion-group="([^"]+)"/g)].map((m) => m[1]);
const placed =
  app.match(/const companionSections = new Map\(\s*Object\.entries\(([\s\S]*?)\)\.map/)?.[1] ?? '';
const headings = [...placed.matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('the Capri colors card exists and sits in Appearance', () => {
  assert.ok(groups.includes('Capri colors'));
  const appearance = placed.match(/appearance:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  assert.match(appearance, /'Capri colors'/);
});

test('every companion card is placed in some settings section', () => {
  assert.ok(headings.length > 10, 'section list parsed');
  const moved = ['Reminders']; // settings-app moves this one to the Time panel
  const upstreamHidden = ['Qwen model', 'Updates']; // unplaced in stock Capri too
  const orphans = groups.filter(
    (g) =>
      !moved.includes(g) && !upstreamHidden.includes(g) && !headings.some((h) => g.startsWith(h)),
  );
  assert.deepEqual(orphans, []);
});
