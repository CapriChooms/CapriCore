// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  AvatarComposer,
  avatarComposerBounds,
  avatarComposerProximity,
  avatarComposerStateChannel,
  avatarComposerUrl,
} from '../apps/desktop/main/avatar-composer.mjs';

const workArea = { x: -1600, y: -180, width: 1600, height: 900 };
const body = { x: -920, y: 80, width: 140, height: 210 };

function fixture({ load, screenArea = workArea, mode = 'text' } = {}) {
  const views = [];
  const errors = [];
  const closes = [];
  const screen = new EventEmitter();
  screen.area = screenArea;
  screen.matches = 0;
  screen.getDisplayMatching = () => {
    screen.matches++;
    return { workArea: screen.area };
  };
  screen.pointer = { x: -900, y: 320 };
  screen.getCursorScreenPoint = () => screen.pointer;
  class View extends EventEmitter {
    constructor(options) {
      super();
      views.push(this);
      this.options = options;
      this.bounds = Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((key) => [key, options[key]]),
      );
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: '' };
      this.webContents.getURL = () => this.url ?? '';
      this.webContents.send = (...args) => this.messages.push(args);
      this.webContents.setWindowOpenHandler = (handler) => (this.openHandler = handler);
      this.messages = [];
      this.levels = [];
      this.lifts = 0;
      this.moves = [];
      this.positions = [];
      this.sizes = [];
      this.boundsReads = 0;
      this.mouseModes = [];
    }
    setMenu() {}
    setAlwaysOnTop(...value) {
      this.levels.push(value);
    }
    moveTop() {
      this.lifts++;
    }
    getBounds() {
      this.boundsReads++;
      return { ...this.bounds };
    }
    setBounds(value) {
      this.sizes.push({ ...value });
      this.moves.push({ ...value });
      this.bounds = { ...value };
    }
    setPosition(x, y) {
      this.positions.push({ x, y });
      this.bounds = { ...this.bounds, x, y };
      this.moves.push({ ...this.bounds });
      this.emit('move');
    }
    setIgnoreMouseEvents(...args) {
      this.mouseModes.push(args);
    }
    isDestroyed() {
      return this.destroyed === true;
    }
    isVisible() {
      return this.visible === true;
    }
    showInactive() {
      this.visible = true;
      this.emit('show');
    }
    show() {
      assert.fail('Showing the composer must preserve keyboard focus');
    }
    focus() {
      assert.fail('Only a user click may focus the composer');
    }
    hide() {
      this.visible = false;
      this.emit('hide');
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    async loadURL(url) {
      this.url = url;
      this.webContents.mainFrame.url = url;
      await load?.();
    }
  }
  const controller = new AvatarComposer({
    BrowserWindow: View,
    screen,
    onClose: (reason) => closes.push(reason),
    onError: (error) => errors.push(error),
  });
  controller.setMode(mode);
  if (mode === 'text') controller.setHeight(60);
  return { controller, views, screen, errors, closes };
}

test('the small composer follows visible body bounds on negative-coordinate displays', () => {
  assert.deepEqual(avatarComposerBounds({ body, workArea }), {
    x: -1022,
    y: 298,
    width: 344,
    height: 60,
  });
  assert.equal(avatarComposerBounds({ body, face: { x: -900, y: 100 }, workArea }).x, -1072);
  assert.equal(avatarComposerBounds({ body: { ...body, x: -1700 }, workArea }).x, -1600);
  assert.equal(avatarComposerBounds({ body: { ...body, x: -20 }, workArea }).x, -344);
  assert.deepEqual(
    avatarComposerBounds({ body: { ...body, y: 500 }, workArea }),
    {
      x: -772,
      y: 660,
      width: 344,
      height: 60,
    },
    'A low perch uses the right side and preserves the reply bubble above the body',
  );
});

test('the compact panel expands for typing and shrinks again without replacing its window or draft', async (t) => {
  const { controller, views } = fixture({ mode: 'compact' });
  t.after(() => controller.destroy());
  assert.equal(controller.mode, 'compact');
  controller.sendState({
    draft: 'Keep this draft',
    attachments: [{ id: 'f', name: 'sample.txt' }],
  });
  controller.sync({ visible: true, body, workArea, keepVisible: true });
  await controller.ready;
  assert.equal(controller.bounds.width, 124);
  assert.equal(controller.bounds.height, 44);
  controller.setMode('text');
  assert.equal(controller.bounds.width, 344);
  assert.equal(controller.state.draft, 'Keep this draft');
  assert.equal(views.length, 1);
  assert.equal(views[0].messages.at(-1)[1].mode, 'text');
  controller.setMode('expanded');
  assert.equal(controller.bounds.width, 124);
  assert.equal(controller.bounds.height, 44);
  assert.equal(controller.state.attachments.length, 1);
  assert.throws(() => controller.setMode('arbitrary'), /Invalid panel/);
  assert.equal(controller.mode, 'expanded');
});

test('floor perches prefer either empty side before the space above the avatar', () => {
  const lowBody = { ...body, x: -250, y: 500 };
  assert.deepEqual(
    avatarComposerBounds({ body: lowBody, workArea }),
    {
      x: -602,
      y: 660,
      width: 344,
      height: 60,
    },
    'Use the left side when the right side has no room',
  );
  assert.deepEqual(
    avatarComposerBounds({ body: lowBody, workArea, height: 140 }),
    {
      x: -602,
      y: 580,
      width: 344,
      height: 140,
    },
    'Attachment growth keeps the side composer above the taskbar',
  );
  assert.deepEqual(
    avatarComposerBounds({
      body: { x: 280, y: 500, width: 40, height: 210 },
      workArea: { x: 0, y: 0, width: 600, height: 720 },
    }),
    {
      x: 128,
      y: 432,
      width: 344,
      height: 60,
    },
    'Only use the area above the body when neither side can fit the input',
  );
});

test('ceiling input reserves the visible status, reply tab and expanded bubble', () => {
  const area = { x: -1920, y: -100, width: 1920, height: 1080 };
  const avatar = { x: -1000, y: -92, width: 150, height: 200 };
  for (const height of [44, 60, 160])
    for (const hud of [
      { x: -960, y: 107, width: 90, height: 58 },
      { x: -1090, y: 107, width: 344, height: 190 },
    ]) {
      const actual = avatarComposerBounds({
        body: avatar,
        workArea: area,
        hud,
        width: height === 44 ? 124 : 344,
        height,
      });
      assert(
        actual.y >= hud.y + hud.height + 8,
        'Ceiling input must sit below the complete HUD with a gap',
      );
      assert(actual.y + actual.height <= area.y + area.height);
    }
  const normal = avatarComposerBounds({ body, workArea });
  assert.deepEqual(
    avatarComposerBounds({ body, workArea, hud: { x: -1100, y: -100, width: 340, height: 70 } }),
    normal,
    'An unrelated HUD must not move an already clear input',
  );
});

test('attachment growth and small work areas stay strictly within the display work area', () => {
  for (const height of [1, 60, 115, 1000]) {
    const bounds = avatarComposerBounds({ body, workArea, height });
    assert.equal(bounds.height, Math.max(44, Math.min(240, height)));
  }
  const area = { x: -20.4, y: -5.2, width: 250.8, height: 40.8 };
  const bounds = avatarComposerBounds({ body, workArea: area, height: 140 });
  assert.deepEqual(bounds, { x: -20, y: -5, width: 250, height: 40 });
  assert.equal(avatarComposerBounds({ body: { ...body, x: NaN }, workArea }), null);
  assert.equal(avatarComposerBounds({ body, workArea: { ...workArea, width: 0 } }), null);
  assert.equal(avatarComposerBounds({ body, workArea, height: Infinity }), null);
});

test('proximity uses only the candidate input rectangle and a bounded DIP radius', () => {
  const bounds = avatarComposerBounds({ body, workArea });
  assert.equal(avatarComposerProximity({ x: bounds.x - 90, y: bounds.y }, bounds), true);
  assert.equal(avatarComposerProximity({ x: bounds.x - 91, y: bounds.y }, bounds), false);
  assert.equal(avatarComposerProximity({ x: bounds.x - 70, y: bounds.y - 70 }, bounds), false);
  assert.equal(avatarComposerProximity({ x: body.x + 10, y: body.y }, bounds), false);
  assert.equal(avatarComposerProximity({ x: bounds.x + 10, y: bounds.y + 10 }, bounds), true);
  assert.equal(avatarComposerProximity(null, bounds), false);
  assert.equal(avatarComposerProximity({ x: 0, y: 0 }, bounds, Infinity), false);
});

test('the mini input appears near its target, fades away and immediately passes clicks through', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, views, screen } = fixture();
  context.after(() => controller.destroy());
  screen.pointer = { x: -1500, y: -100 };
  assert.equal(controller.sync({ visible: true, body, workArea }), false);
  assert.equal(views.length, 0);
  const target = avatarComposerBounds({ body, workArea });
  screen.pointer = { x: target.x - 80, y: target.y + 10 };
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  const view = controller.window;
  assert.equal(controller.presentationVisible, true);
  assert.equal(view.isVisible(), true);
  assert.deepEqual(view.mouseModes.at(-1), [false, { forward: true }]);
  screen.pointer = { x: target.x - 91, y: target.y };
  controller.sync({ visible: true, body, workArea });
  assert.equal(controller.presentationVisible, false);
  assert.equal(view.isVisible(), true, 'The native surface remains only for the CSS fade.');
  assert.deepEqual(view.mouseModes.at(-1), [true, { forward: true }]);
  assert.equal(view.messages.at(-1)[1].composerVisible, false);
  context.mock.timers.tick(180);
  assert.equal(view.isVisible(), false);
  screen.pointer = { x: target.x, y: target.y };
  controller.sync({ visible: true, body, workArea });
  assert.equal(view.isVisible(), true);
  assert.equal(views.length, 1);
});

test('focus, drafts, attachments, microphone and an open picker pin the input without overriding privacy gates', async (context) => {
  const { controller, screen } = fixture();
  context.after(() => controller.destroy());
  screen.pointer = { x: -1500, y: -100 };
  for (const state of [
    { draft: 'typing', attachments: [], microphone: {} },
    { draft: '', attachments: [{ id: 'fixture', name: 'notes.txt' }], microphone: {} },
    { draft: '', attachments: [], microphone: { listening: true } },
    { draft: '', attachments: [], microphone: { loading: true } },
  ]) {
    controller.sendState(state);
    controller.sync({ visible: true, body, workArea });
    await controller.ready;
    assert.equal(controller.presentationVisible, true);
    assert.equal(controller.window.isVisible(), true);
    controller.sync({ visible: true, body, workArea, sessionLocked: true });
    assert.equal(controller.window.isVisible(), false);
    controller.sync({ visible: true, body, workArea, focusMode: true });
    assert.equal(controller.window.isVisible(), false);
  }
  controller.sendState({ draft: '', attachments: [], microphone: {} });
  controller.sync({ visible: true, body, workArea, keepVisible: true });
  assert.equal(controller.presentationVisible, true);
  controller.window.emit('focus');
  controller.sync({ visible: true, body, workArea });
  assert.equal(controller.presentationVisible, true);
  controller.window.emit('blur');
  assert.equal(controller.presentationVisible, false);
  controller.sync({ visible: true, phase: 'attached', body, workArea, keepVisible: true });
  assert.equal(controller.window.isVisible(), false);
});

test('frame-rate tracking uses current body coordinates without repeated stacking or renderer state traffic', async (context) => {
  const { controller } = fixture();
  context.after(() => controller.destroy());
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  const view = controller.window;
  const lifts = view.lifts;
  const messages = view.messages.length;
  const moves = view.moves.length;
  for (let frame = 1; frame <= 30; frame++) {
    const moved = { ...body, x: body.x + frame, y: body.y + frame };
    controller.sync({ visible: true, body: moved, workArea, pointer: { x: -900, y: 350 } });
    assert.deepEqual(view.getBounds(), avatarComposerBounds({ body: moved, workArea }));
  }
  assert.equal(view.moves.length - moves, 30);
  assert.equal(view.lifts, lifts);
  assert.equal(view.messages.length, messages);
});

test('following writes canonical bounds once per move without idle native queries or mutations', async (context) => {
  const { controller, screen } = fixture();
  context.after(() => controller.destroy());
  const placement = { visible: true, body, displayId: 'first', keepVisible: true };
  controller.sync(placement);
  await controller.ready;
  const view = controller.window;
  const reads = view.boundsReads,
    matches = screen.matches,
    sizes = view.sizes.length;
  for (let frame = 0; frame < 120; frame++) controller.sync(placement);
  assert.equal(view.boundsReads, reads);
  assert.equal(screen.matches, matches);
  assert.equal(view.sizes.length, sizes);
  for (let frame = 1; frame <= 120; frame++)
    controller.sync({ ...placement, body: { ...body, x: body.x + frame } });
  assert.equal(view.positions.length, 0, 'Position-only APIs reuse rounded native dimensions.');
  assert.equal(view.sizes.length, sizes + 120, 'Each moving frame has one native bounds write.');
  for (const bounds of view.sizes.slice(sizes)) {
    assert.equal(bounds.width, 344);
    assert.equal(bounds.height, 60);
  }
  assert.equal(view.boundsReads, reads);
  assert.equal(screen.matches, matches);
  controller.sync({ ...placement, displayId: 'second' });
  assert.equal(screen.matches, matches + 1);
  screen.emit('display-metrics-changed');
  assert.equal(screen.matches, matches + 2);
});

test('external native moves invalidate the cache and content growth resizes only when needed', async (context) => {
  const { controller } = fixture();
  context.after(() => controller.destroy());
  const placement = { visible: true, body, workArea, keepVisible: true };
  controller.sync(placement);
  await controller.ready;
  const view = controller.window;
  view.bounds.x += 80;
  view.emit('move');
  controller.sync(placement);
  assert.deepEqual(view.getBounds(), avatarComposerBounds({ body, workArea }));
  const sizes = view.sizes.length;
  controller.setHeight(100);
  assert.equal(view.sizes.length, sizes + 1);
  for (let frame = 0; frame < 60; frame++) controller.sync(placement);
  assert.equal(view.sizes.length, sizes + 1);
});

test('a native resize during a bounds write is reconciled without polling every frame', async (context) => {
  const { controller } = fixture();
  context.after(() => controller.destroy());
  const placement = { visible: true, body, workArea, keepVisible: true };
  controller.sync(placement);
  await controller.ready;
  const view = controller.window;
  const setBounds = view.setBounds.bind(view);
  let adjusted = false;
  view.setBounds = (bounds) => {
    setBounds(bounds);
    // A synchronous native/DPI adjustment can disagree with the requested size.
    if (!adjusted) {
      adjusted = true;
      view.bounds.width = workArea.width;
      view.emit('resize');
    }
  };
  const moved = { ...placement, body: { ...body, x: body.x + 12 } };
  const reads = view.boundsReads;
  const sizes = view.sizes.length;
  controller.sync(moved);
  assert.equal(view.bounds.width, workArea.width);
  assert.equal(view.boundsReads, reads, 'Movement does not separately read native bounds.');
  controller.sync(moved);
  assert.deepEqual(view.bounds, avatarComposerBounds(moved));
  assert.equal(view.sizes.length, sizes + 2, 'One move write and one native size correction.');
  assert.equal(view.boundsReads, reads + 1, 'Only reconciliation needs a native bounds read.');
  for (let frame = 0; frame < 120; frame++) controller.sync(moved);
  assert.equal(view.boundsReads, reads + 1);
  assert.equal(view.sizes.length, sizes + 2);
});

test('fractional physical-pixel enclosure never accumulates into the next requested size', async (context) => {
  const { controller } = fixture();
  context.after(() => controller.destroy());
  const placement = { visible: true, body, workArea, keepVisible: true };
  controller.sync(placement);
  await controller.ready;
  const view = controller.window;
  // Model native physical-pixel rounding followed by an enclosing DIP read at
  // 125% scale. Reusing that read as the next size compounds the rounding.
  const enclose = (bounds) => {
    const start = (value) => Math.floor(Math.round(value * 1.25) / 1.25);
    const end = (value) => Math.ceil(Math.round(value * 1.25) / 1.25);
    return {
      x: start(bounds.x),
      y: start(bounds.y),
      width: end(bounds.x + bounds.width) - start(bounds.x),
      height: end(bounds.y + bounds.height) - start(bounds.y),
    };
  };
  const setBounds = view.setBounds.bind(view);
  view.setBounds = (bounds) => setBounds(enclose(bounds));
  const reads = view.boundsReads;
  const writes = view.sizes.length;
  let legacy = { ...view.bounds };
  for (let frame = 1; frame <= 240; frame++) {
    const moved = { ...placement, body: { ...body, x: body.x + frame } };
    const target = avatarComposerBounds(moved);
    legacy = enclose({ ...legacy, x: target.x, y: target.y });
    controller.sync(moved);
    assert.equal(view.sizes.length, writes + frame);
    assert.ok(Math.abs(view.bounds.width - target.width) <= 1);
    assert.ok(Math.abs(view.bounds.height - target.height) <= 1);
    assert.equal(controller.appliedBounds.width, 344);
  }
  assert.ok(legacy.width > 400, 'A rounded-size round trip reproduces cumulative width growth.');
  assert.equal(view.boundsReads, reads);
  assert.equal(view.positions.length, 0);
  const last = { ...placement, body: { ...body, x: body.x + 240 } };
  for (let frame = 0; frame < 120; frame++) controller.sync(last);
  assert.equal(view.sizes.length, writes + 240);
  assert.equal(view.boundsReads, reads);
});

test('expected height changes and deferred native resizes reconcile once then retain cached geometry', async (context) => {
  const { controller } = fixture();
  context.after(() => controller.destroy());
  const placement = { visible: true, body, workArea, keepVisible: true };
  controller.sync(placement);
  await controller.ready;
  const view = controller.window;
  const setBounds = view.setBounds.bind(view);
  view.setBounds = (bounds) => {
    setBounds(bounds);
    view.emit('resize');
  };
  const reads = view.boundsReads;
  const sizes = view.sizes.length;
  controller.setHeight(120);
  assert.equal(view.bounds.height, 120);
  controller.sync(placement);
  assert.equal(view.boundsReads, reads + 1);
  assert.equal(view.sizes.length, sizes + 1, 'An expected resize must not trigger another resize.');
  for (let frame = 0; frame < 120; frame++) controller.sync(placement);
  assert.equal(view.boundsReads, reads + 1);

  await Promise.resolve();
  view.bounds.width = workArea.width;
  view.bounds.height = 300;
  view.emit('resize');
  controller.sync(placement);
  assert.deepEqual(view.bounds, avatarComposerBounds({ ...placement, height: 120 }));
  controller.sync(placement);
  const reconciledReads = view.boundsReads;
  assert.equal(reconciledReads, reads + 3);
  assert.equal(view.sizes.length, sizes + 2);
  for (let frame = 0; frame < 120; frame++) controller.sync(placement);
  assert.equal(view.boundsReads, reconciledReads);
  assert.equal(view.sizes.length, sizes + 2);
});

test('the composer is a focusable isolated small window and state arrives after load without activation', async (context) => {
  const { controller, views } = fixture();
  context.after(() => controller.destroy());
  const state = { draft: 'hello', attachments: [] };
  controller.sendState(state);
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  const view = views[0];
  assert.equal(views.length, 1);
  assert.deepEqual(view.getBounds(), { x: -1022, y: 298, width: 344, height: 60 });
  assert.equal(view.options.focusable, true);
  assert.equal(view.options.transparent, true);
  assert.equal(view.options.frame, false);
  assert.equal(view.options.parent, undefined);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal(view.options.webPreferences.contextIsolation, true);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.match(view.options.webPreferences.preload, /avatar-composer-preload\.cjs$/);
  assert.deepEqual(view.messages, [
    [avatarComposerStateChannel, { ...state, mode: 'text', composerVisible: true }],
  ]);
  assert.ok(view.isVisible());
  assert.ok(view.levels.every((value) => value[0] === true && value[1] === 'screen-saver'));
  controller.setHeight(120);
  assert.equal(controller.bounds.height, 120);
  assert.equal(controller.setHeight(NaN), false);
  assert.deepEqual(view.openHandler(), { action: 'deny' });
  for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    view.webContents.emit(event, { preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
  }
});

test('teleport, returning home, focus mode and session lock hide the same reusable surface', async (context) => {
  const { controller, views } = fixture();
  context.after(() => controller.destroy());
  for (const hidden of [
    { visible: false },
    { phase: 'leaving' },
    { phase: 'returning' },
    { phase: 'attached' },
    { focusMode: true },
    { sessionLocked: true },
  ]) {
    controller.sync({ visible: true, body, workArea });
    await controller.ready;
    assert.equal(controller.window.isVisible(), true);
    controller.sync({ visible: true, body, workArea, ...hidden });
    assert.equal(controller.window.isVisible(), false);
    assert.equal(controller.window.isDestroyed(), false);
  }
  assert.equal(views.length, 1);
});

test('hiding during page load cannot show a stale composer or allocate a fullscreen layer', async (context) => {
  let finish;
  const { controller, views } = fixture({
    load: () => new Promise((resolve) => (finish = resolve)),
  });
  context.after(() => controller.destroy());
  controller.sync({ visible: false, body, workArea });
  assert.equal(views.length, 0);
  controller.sync({ visible: true, body, workArea });
  controller.hide();
  finish();
  await controller.ready;
  assert.equal(views.length, 1);
  assert.equal(views[0].isVisible(), false);
  assert.equal(views[0].options.width, 344);
  assert.equal(views[0].options.height, 60);
});

test('exact sender identity and the top frame are required for mini IPC', async (context) => {
  const { controller } = fixture();
  context.after(() => controller.destroy());
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  const contents = controller.window.webContents;
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(controller.owns(event), true);
  assert.equal(controller.owns({ ...event, sender: {} }), false);
  assert.equal(controller.owns({ ...event, senderFrame: { url: avatarComposerUrl } }), false);
  assert.equal(controller.owns({ ...event, senderFrame: null }), false);
  contents.mainFrame.url = 'capri://desktop/index.html';
  assert.equal(controller.owns(event), false);
  contents.mainFrame.url = avatarComposerUrl;
  controller.window.url = 'https://example.com';
  assert.equal(controller.owns(event), false);
});

test('user close and minimize hide; only app shutdown destroys and removes tracking', async () => {
  const { controller, closes, screen } = fixture();
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  const view = controller.window;
  let prevented = false;
  view.emit('close', { preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.equal(view.isDestroyed(), false);
  assert.equal(view.isVisible(), false);
  controller.sync({ visible: true, body, workArea });
  view.emit('minimize');
  assert.equal(view.isVisible(), false);
  assert.deepEqual(closes, ['close', 'minimize']);
  assert.equal(view.isDestroyed(), false);
  controller.destroy();
  assert.equal(view.isDestroyed(), true);
  assert.deepEqual(screen.eventNames(), []);
  assert.equal(controller.sync({ visible: true, body, workArea }), false);
  assert.equal(controller.setHeight(100), false);
});

test('a crashed renderer is released and the next deliberate open creates a working surface', async (context) => {
  const { controller, views, closes } = fixture();
  context.after(() => controller.destroy());
  const state = { draft: 'keep this draft' };
  controller.sendState(state);
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  const crashed = controller.window;
  crashed.webContents.emit('render-process-gone');
  assert.equal(crashed.isDestroyed(), true);
  assert.equal(controller.window, null);
  assert.equal(controller.visibleWanted, false);
  assert.equal(controller.loaded, false);
  assert.deepEqual(closes, ['renderer-lost']);
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  assert.equal(views.length, 2);
  assert.equal(controller.window.isVisible(), true);
  assert.deepEqual(controller.window.messages, [
    [avatarComposerStateChannel, { ...state, mode: 'text', composerVisible: true }],
  ]);
  assert.equal(
    controller.owns({ sender: crashed.webContents, senderFrame: crashed.webContents.mainFrame }),
    false,
  );
});

test('a failed initial load is released without leaving an unusable window cached', async (context) => {
  let fail = true;
  const { controller, views, closes, errors } = fixture({
    load: () => {
      if (fail) throw new Error('Page failed');
    },
  });
  context.after(() => controller.destroy());
  controller.sync({ visible: true, body, workArea });
  assert.equal(await controller.ready, false);
  assert.equal(views[0].isDestroyed(), true);
  assert.equal(controller.window, null);
  assert.deepEqual(closes, ['load-failed']);
  assert.equal(errors[0].message, 'Page failed');
  fail = false;
  controller.sync({ visible: true, body, workArea });
  assert.equal(await controller.ready, true);
  assert.equal(views.length, 2);
  assert.equal(controller.window.isVisible(), true);
});

test('topmost recovery preserves focus and pauses while hidden', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const { controller } = fixture();
  context.after(() => controller.destroy());
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  const view = controller.window;
  const lifts = view.lifts;
  context.mock.timers.tick(750);
  assert.equal(view.lifts, lifts + 1);
  controller.hide();
  context.mock.timers.tick(3000);
  assert.equal(view.lifts, lifts + 1);
});

test('monitor changes refresh cached work areas before showing the composer', async (context) => {
  const { controller, screen } = fixture();
  context.after(() => controller.destroy());
  controller.sync({ visible: true, body, workArea });
  await controller.ready;
  screen.area = { x: -800, y: 0, width: 800, height: 600 };
  screen.emit('display-metrics-changed');
  assert.ok(controller.bounds.x >= -800);
  assert.ok(controller.bounds.x + controller.bounds.width <= 0);
  assert.ok(controller.bounds.y >= 0);
  assert.ok(controller.bounds.y + controller.bounds.height <= 600);
});

test('the isolated preload exposes only composer channels and strips Electron event objects', async () => {
  const invocations = [];
  const listeners = new Map();
  let exposed;
  const ipcRenderer = {
    invoke: (...args) => {
      invocations.push(args);
      return Promise.resolve();
    },
    on: (name, listener) => listeners.set(name, listener),
    removeListener: (name, listener) => {
      assert.equal(listeners.get(name), listener);
      listeners.delete(name);
    },
  };
  runInNewContext(
    readFileSync(new URL('../apps/desktop/avatar-composer-preload.cjs', import.meta.url), 'utf8'),
    {
      require: (name) => {
        assert.equal(name, 'electron');
        return {
          contextBridge: { exposeInMainWorld: (name, api) => (exposed = { name, api }) },
          ipcRenderer,
        };
      },
    },
  );
  assert.equal(exposed.name, 'capriMini');
  const api = exposed.api;
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api).sort(), ['action', 'bootstrap', 'hide', 'onState', 'resize']);
  await api.bootstrap();
  await api.action({ type: 'submit' });
  await api.resize(120);
  await api.hide();
  assert.deepEqual(
    invocations.map(([name]) => name),
    [
      'capri:avatar-composer-bootstrap',
      'capri:avatar-composer-action',
      'capri:avatar-composer-resize',
      'capri:avatar-composer-hide',
    ],
  );
  const state = { draft: 'shared' };
  let received;
  const unsubscribe = api.onState((...args) => (received = args));
  listeners.get(avatarComposerStateChannel)({ privileged: true }, state);
  assert.deepEqual(received, [state]);
  unsubscribe();
  assert.equal(listeners.size, 0);
  assert.throws(() => api.onState(undefined), /state callback/);
});
