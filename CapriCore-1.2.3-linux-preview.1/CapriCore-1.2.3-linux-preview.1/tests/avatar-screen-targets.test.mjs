import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarScreenTargetDetector } from '../apps/desktop/main/avatar-screen-targets.mjs';

const leftDip = { x: -1280, y: -160, width: 1280, height: 900 };
const leftPhysical = { x: -1920, y: -240, width: 1920, height: 1350 };
const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const record = {
  windowId: '31224',
  processId: '998',
  startedAtTicks: '638095968000000000',
  x: -1880,
  y: -180,
  width: 1590,
  height: 1200,
};
const search = {
  kind: 'search-field',
  searchKind: 'search',
  controlId: '42.31224.-4',
  window: record,
  clipIndex: 0,
  bounds: { x: -1500, y: 150, width: 600, height: 60 },
  point: { x: -1200, y: 180 },
};
const edge = {
  kind: 'window-top',
  window: record,
  clipIndex: 0,
  bounds: { x: -1090, y: -180, width: 61, height: 1 },
  point: { x: -1060, y: -180 },
};

function fixture(override = {}) {
  const calls = [];
  const capture = {
    id: 'selected-observation',
    mode: 'watch',
    phase: 'capturing',
    nativeId: 'screen:1:0',
    displayId: '17',
    expiresAt: 1500,
    ...override.capture,
  };
  const capturePolicy = {
    capture,
    async checkActive(id) {
      calls.push(['check', id]);
      return capturePolicy.capture?.id === id;
    },
  };
  const screen = {
    getAllDisplays() {
      return [
        { id: 17, bounds: leftDip },
        { id: 23, bounds: primary },
      ];
    },
    dipToScreenRect(_, bounds) {
      return bounds.x < 0 ? leftPhysical : primary;
    },
  };
  const detector = createAvatarScreenTargetDetector({
    capturePolicy,
    screen,
    now: () => 1000,
    permitted: override.permitted ?? (() => true),
    ignoreProcessId: 40300,
    ownedOverlayWindowIds: override.ownedOverlayWindowIds,
    async avatarWindow(query) {
      calls.push(['window', query]);
      return record;
    },
    async callApplicationBridge(command, options) {
      calls.push(['native', command]);
      assert.equal(options.stillAllowed(), true);
      return override.native
        ? override.native(capturePolicy, screen, options)
        : { targets: override.targets ?? [search, edge] };
    },
  });
  return { detector, calls };
}

test('maps negative physical coordinates through the selected monitor DPI and returns geometry only', async () => {
  const { detector, calls } = fixture({
    targets: [
      { ...search, name: 'private label', value: 'private value' },
      edge,
      { ...search, controlId: '42.19', point: { x: 10, y: 180 } },
      { ...search, controlId: '42.20', clipIndex: 1 },
      { ...search, controlId: '42.21', window: { ...record, processId: '40300' } },
    ],
    ownedOverlayWindowIds: () => [null, '451', '451', '1 bad'],
  });
  const result = await detector.detect();
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    id: `${record.windowId}:${record.processId}:${record.startedAtTicks}:${search.controlId}`,
    kind: 'search-field',
    searchKind: 'search',
    windowId: record.windowId,
    window: record,
    point: { x: -800, y: 120 },
    bounds: { x: -1000, y: 100, width: 400, height: 40 },
    displayId: 17,
  });
  assert.equal(result[1].id.endsWith(':top'), true);
  assert.deepEqual(result[1].point, { x: -707, y: -120 });
  assert.equal(result[1].bounds.height, 1);
  assert.deepEqual(calls[1][1].clips, [leftPhysical]);
  assert.deepEqual(calls[1][1].overlays, ['451']);
  assert.equal(calls.filter(([kind]) => kind === 'check').length, 2);
});

test('a selected window binds its exact handle, process and creation time', async () => {
  const capture = { nativeId: `window:${record.windowId}:0`, displayId: '' };
  const { detector, calls } = fixture({
    capture,
    targets: [{ ...search, window: { ...record, startedAtTicks: '638095988000000000' } }, edge],
  });
  assert.deepEqual(await detector.detect({ windowId: '14003' }), []);
  assert.deepEqual(calls, []);
  const targets = await detector.detect();
  assert.deepEqual(
    targets.map((target) => target.kind),
    ['window-top'],
  );
  assert.deepEqual(calls[1], ['window', { windowId: record.windowId }]);
  assert.equal(calls[2][1].startedAtTicks, record.startedAtTicks);
});

test('does not query a one-shot, expired, disabled or unknown-monitor grant', async () => {
  for (const options of [
    { capture: { mode: 'one-shot' } },
    { capture: { expiresAt: 1000 } },
    { permitted: () => false },
    { capture: { displayId: '' } },
  ]) {
    const { detector, calls } = fixture(options);
    assert.deepEqual(await detector.detect(), []);
    assert.equal(
      calls.some(([kind]) => kind === 'native'),
      false,
    );
  }
});

test('drops native targets after lease or display geometry changes', async () => {
  const revoked = fixture({
    native(capturePolicy, _, options) {
      capturePolicy.capture = null;
      assert.equal(options.stillAllowed(), false);
      return { targets: [search] };
    },
  });
  assert.deepEqual(await revoked.detector.detect(), []);
  const resized = fixture({
    native(_, screen) {
      screen.dipToScreenRect = () => ({ ...leftPhysical, height: 1390 });
      return { targets: [search] };
    },
  });
  assert.deepEqual(await resized.detector.detect(), []);
});

test('keeps field and window-top identity when the scoped window moves', async () => {
  const first = fixture();
  const moved = fixture({
    targets: [search, edge].map((target) => ({
      ...target,
      window: { ...record, x: record.x + 72 },
      bounds: { ...target.bounds, x: target.bounds.x + 72 },
      point: { ...target.point, x: target.point.x + 72 },
    })),
  });
  const initial = await first.detector.detect();
  const following = await moved.detector.detect();
  assert.deepEqual(
    following.map((target) => target.id),
    initial.map((target) => target.id),
  );
  assert.equal(following[0].point.x - initial[0].point.x, 48);
});
