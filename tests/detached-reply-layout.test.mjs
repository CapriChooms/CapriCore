// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { detachedReplyLayout } from '../apps/desktop/renderer/detached-reply-layout.mjs';
const base = {
  width: 1000,
  height: 760,
  faceX: 500,
  faceY: 420,
  crownY: 350,
  scale: 240,
  badge: { width: 100, height: 20 },
  reply: { width: 344, height: 100 },
};
const scenarios = [
  { side: 'above', patch: {} },
  { side: 'right', patch: { faceX: 150, faceY: 100, crownY: 20 } },
  { side: 'left', patch: { faceX: 850, faceY: 100, crownY: 20 } },
  { side: 'below', patch: { faceY: 200, crownY: 100, inverted: true } },
];
test('reply tabs share a badge border and point towards the actual opening on all four sides', () => {
  for (const { side, patch } of scenarios) {
    const value = detachedReplyLayout({ ...base, ...patch }),
      { badge, reply, tab, hud } = value;
    assert.equal(value.side, side);
    if (side === 'above') {
      assert(reply.y + reply.height < badge.y);
      assert.equal(tab.y + tab.height, badge.y + 1);
    }
    if (side === 'below') {
      assert(reply.y > badge.y + badge.height);
      assert.equal(tab.y, badge.y + badge.height - 1);
    }
    if (side === 'right') {
      assert(reply.x > badge.x + badge.width);
      assert.equal(tab.x, badge.x + badge.width - 1);
    }
    if (side === 'left') {
      assert(reply.x + reply.width < badge.x);
      assert.equal(tab.x + tab.width, badge.x + 1);
    }
    assert(
      hud.x >= 8 &&
        hud.y >= 8 &&
        hud.x + hud.width <= base.width - 8 &&
        hud.y + hud.height <= base.height - 8,
    );
    assert(
      tab.width <= 30 && tab.height <= 32,
      'Native click-through hit-region limits are retained',
    );
  }
});
test('collapsing preserves the tab direction and position without reserving the hidden bubble', () => {
  for (const { patch } of scenarios) {
    const expanded = detachedReplyLayout({ ...base, ...patch }),
      collapsed = detachedReplyLayout({ ...base, ...patch, collapsed: true });
    assert.equal(expanded.side, collapsed.side);
    assert.deepEqual(expanded.tab, collapsed.tab);
    assert.deepEqual(expanded.badge, collapsed.badge);
    assert(collapsed.hud.width * collapsed.hud.height < expanded.hud.width * expanded.hud.height);
  }
});
test('narrow displays and long status labels keep the tab and reply within the screen', () => {
  for (const width of [360, 640])
    for (const faceX of [15, width - 15])
      for (const faceY of [50, 700]) {
        const value = detachedReplyLayout({
          ...base,
          width,
          faceX,
          faceY,
          crownY: faceY - 40,
          badge: { width: 200, height: 30 },
          reply: { width: 344, height: 170 },
        });
        assert(value.hud.x >= 8 && value.hud.y >= 8);
        assert(value.hud.x + value.hud.width <= width - 8);
        assert(value.hud.y + value.hud.height <= base.height - 8);
      }
});
