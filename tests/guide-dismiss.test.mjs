// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GuideOverlay } from '../apps/desktop/renderer/guide-overlay.mjs';

const KEY = 'capri.guide.beginner.v1';

function storage({ throws = false } = {}) {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      if (throws) throw new Error('blocked');
      values.set(key, String(value));
    },
  };
}

function fixture({ active = true, notesShowing = false, steps = 3, index = 0 } = {}) {
  const guide = Object.create(GuideOverlay.prototype);
  Object.assign(guide, {
    root: { hidden: !active },
    notesShowing,
    index,
    content: { steps: Array.from({ length: steps }, (_, i) => ({ id: i })) },
  });
  guide.calls = 0;
  guide.close = () => {
    guide.calls++;
    guide.root.hidden = true;
  };
  return guide;
}

test('X on the tour records the same seen flag as Finish', () => {
  const local = storage();
  globalThis.localStorage = local;
  try {
    const dismissed = fixture();
    dismissed.dismiss();
    assert.equal(local.values.get(KEY), '1');
    assert.equal(dismissed.calls, 1);

    const finished = fixture({ steps: 1, index: 0 });
    local.values.clear();
    finished.advance();
    assert.equal(local.values.get(KEY), '1', 'Finish writes the flag');
    assert.equal(finished.calls, 1);
  } finally {
    delete globalThis.localStorage;
  }
});

test('X while patch notes are showing closes without marking the tour seen', () => {
  const local = storage();
  globalThis.localStorage = local;
  try {
    const notes = fixture({ notesShowing: true });
    notes.dismiss();
    assert.equal(local.values.has(KEY), false);
    assert.equal(notes.calls, 1);
  } finally {
    delete globalThis.localStorage;
  }
});

test('X on an inactive guide does nothing and writes nothing', () => {
  const local = storage();
  globalThis.localStorage = local;
  try {
    const idle = fixture({ active: false });
    idle.dismiss();
    assert.equal(local.values.has(KEY), false);
    assert.equal(idle.calls, 1, 'close() itself returns early when inactive');
  } finally {
    delete globalThis.localStorage;
  }
});

test('X still closes when browser storage refuses the write', () => {
  globalThis.localStorage = storage({ throws: true });
  try {
    const guide = fixture();
    assert.doesNotThrow(() => guide.dismiss());
    assert.equal(guide.calls, 1);
  } finally {
    delete globalThis.localStorage;
  }
});

test('the close button is wired to dismiss, not the bare close', () => {
  const text = readFileSync(
    new URL('../apps/desktop/renderer/guide-overlay.mjs', import.meta.url),
    'utf8',
  );
  assert.match(text, /this\.closeButton\.onclick = \(\) => this\.dismiss\(\);/);
});
