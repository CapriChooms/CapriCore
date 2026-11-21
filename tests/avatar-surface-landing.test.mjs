import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  ambientSurfaceClip,
  nextSurfaceActions,
  surfaceLanding,
} from '../apps/desktop/main/avatar-surface-landing.mjs';
import { desktopAvatarCommand } from '../apps/desktop/desktop-avatar-commands.mjs';
import { createScreenInteractionClip } from '../apps/desktop/renderer/screen-interaction-motion.mjs';
import celBounds from '../assets/default/hanging-cels/geometry.json' with { type: 'json' };

const art = JSON.parse(
  readFileSync(new URL('../assets/capri/sprites/poses-v2/runtime-poses.json', import.meta.url)),
);
const frames = new Map(art.sprites.map((frame) => [frame.id, frame]));
const options = {
  area: { x: -1600, y: 0, width: 1600, height: 900 },
  scale: 240,
  canvas: { width: 1254, height: 1254 },
  frames,
};
function field(y) {
  return {
    kind: 'search-field',
    id: 'field',
    windowId: '1',
    bounds: { x: -1230, y, width: 800, height: 32 },
    point: { x: -935, y: y + 16 },
  };
}

test('a search bar supports a seated search or a lower-rim grip at the actual global contact', () => {
  for (const [y, id, contactY] of [
    [320, 'bar-search', 320],
    [40, 'bar-search-below', 72],
  ]) {
    const p = surfaceLanding(field(y), 'search', options);
    assert.equal(p.clipId, id);
    assert.deepEqual(p.point, { x: -935, y: contactY });
    assert.ok(createScreenInteractionClip(id, { frameId: p.frame.id }).durationMs > 0);
  }
  assert.equal(surfaceLanding(field(40), 'window-perch', options), null);
  const windowTop = { ...field(340), kind: 'window-top' };
  assert.equal(surfaceLanding(windowTop, 'lean', options).clipId, 'ledge-lean');
  assert.equal(surfaceLanding(field(320), 'field-lean', options).clipId, 'ledge-lean');
});

test('redrawn gestures retain the grip and reserve room for the entire drawing', () => {
  const area = options.area;
  const top = {
    kind: 'desktop-edge',
    id: 'display:123',
    bounds: { ...area, height: 1 },
    point: { x: -1, y: area.y },
  };
  const contacts = new Set();
  const grips = new Set();
  for (const [action, art] of Object.entries(celBounds)) {
    if (action === 'ledge-keytar') continue;
    const plan = surfaceLanding(top, action, options);
    assert.equal(plan.frame.id, 'pose-ceiling');
    assert.ok(plan.point.y >= area.y);
    contacts.add(plan.point.x);
    grips.add(plan.point.y);
    assert.ok(
      plan.point.y - ((plan.frame.anchor.y - art.y) * options.scale) / options.canvas.height >=
        area.y,
    );
    assert.ok(
      plan.point.x +
        ((art.x + art.width - plan.frame.anchor.x) * options.scale) / options.canvas.width <=
        area.x + area.width + 1,
    );
    assert.equal(
      createScreenInteractionClip(action, { frameId: plan.frame.id }).kind,
      'registered-cels',
    );
  }
  assert.equal(contacts.size, 1);
  assert.equal(grips.size, 1);
  const seated = surfaceLanding(top, 'ledge-keytar', options);
  const instrumentBottom = celBounds['ledge-keytar'].y + celBounds['ledge-keytar'].height;
  assert.equal(seated.frame.id, 'pose-sit-edge');
  assert.ok(
    seated.point.y +
      ((instrumentBottom - seated.frame.anchor.y) * options.scale) / options.canvas.height <=
      area.y + area.height,
  );
  assert.equal(surfaceLanding(top, 'search', options), null);
  assert.equal(
    surfaceLanding({ ...field(350), kind: 'window-top' }, 'ledge-keytar', options).frame.id,
    'pose-sit-edge',
  );
});

test('reading, tapping and peeking use a valid clip on either side of the surface', () => {
  for (const [action, kind, seated, hanging] of [
    ['read', 'search-field', 'bar-read', 'bar-read-below'],
    ['tap', 'search-field', 'bar-tap', 'bar-tap-below'],
    ['peek', 'window-top', 'ledge-peek', 'ledge-peek-below'],
  ]) {
    for (const [y, clip] of [
      [350, seated],
      [12, hanging],
    ]) {
      const target = { ...field(y), kind };
      const plan = surfaceLanding(target, action, options);
      assert.equal(plan.clipId, clip);
      assert.ok(createScreenInteractionClip(clip, { frameId: plan.frame.id, side: plan.side }));
      assert.equal(
        surfaceLanding(
          { ...target, kind: kind === 'window-top' ? 'search-field' : 'window-top' },
          action,
          options,
        ),
        null,
      );
    }
  }
});

test('roaming varies its preferred action and finds a valid clip for the available surface', () => {
  for (const kind of ['search-field', 'window-top']) {
    const target = { ...field(350), kind };
    const first = nextSurfaceActions(undefined, () => 0).find((candidate) =>
      surfaceLanding(target, candidate, options),
    );
    const second = nextSurfaceActions(first, () => 0.8).find((candidate) =>
      surfaceLanding(target, candidate, options),
    );
    assert.ok(first && second && second !== first);
  }
  for (const action of ['hang-pullup', 'hang-catch', 'hang-wrist-scan', 'ledge-keytar'])
    assert.ok(nextSurfaceActions(undefined).includes(action));
});

test('ambient performances match the actual pose and skip the immediately previous clip', () => {
  for (const frameId of ['pose-ceiling', 'pose-sit-edge', 'pose-dock-left', 'pose-dock-right']) {
    const first = ambientSurfaceClip(frameId, undefined, () => 0);
    assert.ok(createScreenInteractionClip(first, { frameId }));
    const next = ambientSurfaceClip(frameId, first, () => 0);
    assert.ok(createScreenInteractionClip(next, { frameId }));
    if (!frameId.includes('dock')) assert.notEqual(next, first);
  }
  assert.equal(ambientSurfaceClip('pose-sleep'), null);
  assert.equal(ambientSurfaceClip('neutral'), null);
});

test('visual search commands have their own path and leave real search requests alone', () => {
  for (const [text, performance] of [
    ['Pretend to search in the search bar', 'search'],
    ['Lean on the search field', 'field-lean'],
    ['Perch on the address bar', 'field-perch'],
    ['Lean on the active window', 'lean'],
    ['Pretend to tap the search bar', 'tap'],
    ['Mime tapping on the address field', 'tap'],
    ['Mime reading the search bar', 'read'],
    ['Peek over the window edge', 'peek'],
    ['Do a pull-up', 'hang-pullup'],
    ['Hey Capri, can you show me a pull‑up?', 'hang-pullup'],
    ['How about some pull ups?', 'hang-pullup'],
    ['Pull-ups?', 'hang-pullup'],
    ['Could you do another chin-up while hanging?', 'hang-pullup'],
    ['Catch the data chip', 'hang-catch'],
    ['Use your wrist scanner', 'hang-wrist-scan'],
    ['Show me another hanging trick', 'hang-next'],
    ['Play a keytar riff', 'ledge-keytar'],
    ['Капри, подтянись!', 'hang-pullup'],
    ['Капри, можешь показать подтягивание?', 'hang-pullup'],
    ['Ты можешь подтянуться, пожалуйста?', 'hang-pullup'],
    ['Можешь, пожалуйста, подтянуться?', 'hang-pullup'],
    ['Поиграй соло на кейтаре, Капри!', 'ledge-keytar'],
    ['Покажи жестом на строку поиска', 'present'],
  ]) {
    assert.deepEqual(desktopAvatarCommand(text), { action: 'performance', performance }, text);
  }
  assert.equal(desktopAvatarCommand('Search for Capri animation references'), null);
  assert.equal(desktopAvatarCommand('Tap the search bar'), null);
  assert.equal(desktopAvatarCommand('Read the search bar aloud'), null);
  assert.equal(desktopAvatarCommand('How do I do a pull-up?'), null);
  assert.equal(desktopAvatarCommand('Find a video of someone doing pull-ups'), null);
});
