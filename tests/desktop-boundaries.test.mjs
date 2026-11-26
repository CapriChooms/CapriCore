import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { paths } from '../packages/runtime/src/host/paths.mjs';
import { resourceResponse } from '../apps/desktop/main/protocol.mjs';
import { createDesktopResources } from '../apps/desktop/main/resources.mjs';
import { createIpcHandler } from '../apps/desktop/main/ipc.mjs';
import { SETTINGS_CHANNELS } from '../apps/desktop/main/settings-channels.mjs';
import { PointerController } from '../apps/desktop/main/pointer-controller.mjs';
import { resizeWindowBounds, WINDOW_RESIZE_EDGES } from '../apps/desktop/geometry.mjs';
import { resizeWorkspace } from '../apps/desktop/main/window-resize-surface.mjs';

test('holding a transparent window does not repeatedly move it or accumulate fractional-DPI size drift', () => {
  let bounds = { x: 0, y: 0, width: 480, height: 660 },
    cursor = { x: 10, y: 10 };
  const calls = [];
  const pointer = new PointerController({
    window: {
      isDestroyed: () => false,
      isVisible: () => true,
      getBounds: () => ({ ...bounds }),
      setBounds: (value) => {
        calls.push(value);
        bounds = { ...value, width: value.width + 1 };
      },
    },
    screen: { getCursorScreenPoint: () => cursor },
    getRegions: () => null,
  });
  pointer.beginWindow();
  for (let i = 0; i < 100; i++) pointer.tick();
  assert.equal(calls.length, 0);
  cursor = { x: 110, y: 30 };
  pointer.tick();
  for (let i = 0; i < 100; i++) pointer.tick();
  assert.equal(calls.length, 1);
  cursor = { x: 210, y: 40 };
  pointer.tick();
  assert.equal(calls.length, 2);
  assert.ok(calls.every((value) => value.width === 480 && value.height === 660));
  assert.deepEqual([calls[1].x, calls[1].y], [200, 30]);
});

test('resizing a transparent window by its corner holds the opposite edges and respects the work area', () => {
  let bounds = { x: 120, y: 80, width: 480, height: 600 };
  let cursor = { x: 125, y: 85 };
  const calls = [];
  const pointer = new PointerController({
    window: {
      isDestroyed: () => false,
      isVisible: () => true,
      getBounds: () => bounds,
      setBounds: (value) => {
        calls.push(value);
        bounds = value;
      },
    },
    screen: { getCursorScreenPoint: () => cursor },
    getRegions: () => null,
  });
  const area = { x: -40, y: -20, width: 1000, height: 840 };
  const minimum = { width: 380, height: 520 };
  pointer.beginWindow({ edge: 'nw', workArea: area, minimum });
  cursor = { x: 375, y: 300 };
  pointer.tick();
  assert.deepEqual(bounds, { x: 220, y: 160, width: 380, height: 520 });
  cursor = { x: -200, y: -200 };
  pointer.tick();
  assert.deepEqual(bounds, { x: -40, y: -20, width: 640, height: 700 });
  pointer.endWindow();
  pointer.beginWindow({ edge: 'e', workArea: area, minimum });
  cursor = { x: 1500, y: 100 };
  pointer.tick();
  pointer.tick();
  assert.deepEqual(bounds, { x: -40, y: -20, width: 1000, height: 700 });
  assert.equal(calls.length, 3);
});

test('resizing preserves the initial bounds and untouched edges of a partly off-screen window', () => {
  const start = { x: -12, y: 20, width: 480, height: 660 };
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  const minimum = { width: 380, height: 520 };
  assert.deepEqual(resizeWindowBounds(start, 'e', { x: 0, y: 0 }, area, minimum), start);
  assert.deepEqual(resizeWindowBounds(start, 's', { x: 25, y: 15 }, area, minimum), {
    ...start,
    height: 675,
  });
  assert.deepEqual(resizeWindowBounds(start, 'nw', { x: 8, y: 12 }, area, minimum), {
    x: -4,
    y: 32,
    width: 472,
    height: 648,
  });
});

test('the temporary resize workspace contains all positions without moving the anchored edges', () => {
  const start = { x: -1100, y: -100, width: 690, height: 550 };
  const workArea = { x: -1280, y: -260, width: 1280, height: 950 };
  const minimum = { width: 525, height: 235 };
  for (const edge of WINDOW_RESIZE_EDGES) {
    const workspace = resizeWorkspace(start, { edge, workArea, minimum });
    for (const offset of [-1400, -1, 0, 1, 1400]) {
      const next = resizeWindowBounds(start, edge, { x: offset, y: offset }, workArea, minimum);
      assert.ok(next.x >= workspace.x && next.y >= workspace.y, edge);
      assert.ok(next.x + next.width <= workspace.x + workspace.width, edge);
      assert.ok(next.y + next.height <= workspace.y + workspace.height, edge);
      if (!edge.includes('w')) assert.equal(next.x, start.x, edge);
      if (!edge.includes('n')) assert.equal(next.y, start.y, edge);
      if (!edge.includes('e')) assert.equal(next.x + next.width, start.x + start.width, edge);
      if (!edge.includes('s')) assert.equal(next.y + next.height, start.y + start.height, edge);
    }
  }
});

test('a frame-driven drag applies one current cursor sample and the final release point', () => {
  let cursor = { x: -300, y: 12 };
  const bounds = { x: -300, y: 0, width: 600, height: 720 };
  const frames = [];
  const pointer = new PointerController({
    window: { getBounds: () => bounds, isDestroyed: () => false, isVisible: () => true },
    screen: { getCursorScreenPoint: () => cursor },
    getRegions: () => null,
    applyWindowBounds: (next) => frames.push(next),
  });
  pointer.beginWindow(undefined, true);
  cursor = { x: -320, y: 22 };
  pointer.tick();
  assert.equal(frames.length, 0);
  assert.equal(pointer.sampleWindow(), true);
  pointer.sampleWindow();
  assert.deepEqual(frames, [{ ...bounds, x: -320, y: 10 }]);
  cursor = { x: -325, y: 25 };
  pointer.endWindow(true);
  assert.deepEqual(frames[1], { ...bounds, x: -325, y: 13 });
  assert.equal(pointer.sampleWindow(), false);
});

test('pointer release commits the last resize sample and a stationary pointer reuses its hit test', () => {
  let bounds = { x: 100, y: 100, width: 480, height: 600 };
  let cursor = { x: 103, y: 105 };
  let contentReads = 0;
  let released;
  const regions = {
    controls: [{ x: 0, y: 0, width: 20, height: 20 }],
    sprite: { x: 0, y: 0, width: 100, height: 100, enabled: false },
  };
  const pointer = new PointerController({
    window: {
      isDestroyed: () => false,
      isVisible: () => true,
      getBounds: () => bounds,
      getContentBounds: () => {
        contentReads++;
        return bounds;
      },
      setBounds: (value) => {
        bounds = value;
      },
      setIgnoreMouseEvents: () => {},
    },
    screen: { getCursorScreenPoint: () => cursor },
    getRegions: () => regions,
    getMask: () => null,
    onEnd: (drag) => {
      released = drag.last;
    },
  });
  pointer.tick();
  pointer.tick();
  assert.equal(contentReads, 1);
  pointer.invalidateHitTest();
  pointer.tick();
  assert.equal(contentReads, 2);
  // A quick first movement may already be visible to Electron when IPC starts the resize.
  cursor = { x: 114, y: 112 };
  pointer.beginWindow(
    {
      edge: 'nw',
      workArea: { x: 0, y: 0, width: 1000, height: 800 },
      minimum: { width: 380, height: 520 },
    },
    false,
    { x: 103, y: 105 },
  );
  pointer.tick();
  assert.deepEqual(bounds, { x: 111, y: 107, width: 469, height: 593 });
  cursor = { x: 124, y: 119 };
  pointer.endWindow(true);
  assert.deepEqual(bounds, { x: 121, y: 114, width: 459, height: 586 });
  assert.deepEqual(released, bounds);
});

test('desktop resources admit only exact local allowlisted GET requests', async () => {
  const parent = path.join(paths.cache, 'test-data/protocol');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'fixture-')),
    file = path.join(folder, 'safe.txt');
  writeFileSync(file, 'safe');
  const resources = new Map([['/safe', { file, type: 'text/plain' }]]);
  for (const url of [
    'capri://other/safe',
    'https://desktop/safe',
    'capri://desktop/safe?path=secret',
    'capri://desktop/data/openclaw/gateway-token',
    'capri://desktop/%2e%2e/secret',
  ])
    assert.equal(resourceResponse({ url, method: 'GET' }, resources).status, 404);
  assert.equal(
    resourceResponse({ url: 'capri://desktop/safe', method: 'POST' }, resources).status,
    404,
  );
  const response = resourceResponse({ url: 'capri://desktop/safe', method: 'GET' }, resources);
  assert.equal(await response.text(), 'safe');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  resources.set('/settings.html', { file, type: 'text/html' });
  const settings = resourceResponse(
    { url: 'capri://desktop/settings.html', method: 'GET' },
    resources,
  );
  const settingsPolicy = settings.headers.get('content-security-policy');
  assert(settingsPolicy.includes('capri://desktop/hall-of-fame.json'));
  assert(!response.headers.get('content-security-policy').includes('hall-of-fame.json'));
  assert(!settingsPolicy.includes('https:'));
});

test('allowlisted renderer modules and locale catalogs serve only shipped resources', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const resources = createDesktopResources({
    root,
    directory: path.join(root, 'apps/desktop'),
    catalog: { portraitFrames: [] },
    spriteFile: '',
    startupIntro: null,
  });
  for (const name of ['en', 'ru', 'ar'])
    assert.equal(
      resourceResponse({ url: `capri://desktop/locales/${name}.json`, method: 'GET' }, resources)
        .status,
      200,
    );
  for (const name of ['unknown.json', '%2e%2e/locales/ru.json?source=external'])
    assert.equal(
      resourceResponse({ url: `capri://desktop/locales/${name}`, method: 'GET' }, resources).status,
      404,
    );
  for (const [pathname, resource] of resources) {
    if (!resource.type?.startsWith('text/javascript')) continue;
    const source = readFileSync(resource.file, 'utf8');
    const imports = source.matchAll(
      /\b(?:import\s*(?:\(\s*)?|export\s+)(?:[^'";]*?\bfrom\s*)?['"]((?:\.\.?\/|capri:\/\/desktop\/)[^'"]+)['"]/gu,
    );
    for (const [, target] of imports) {
      const url = new URL(target, 'capri://desktop' + pathname);
      assert.equal(
        resourceResponse({ url: url.href, method: 'GET' }, resources).status,
        200,
        `${pathname} imports unserved renderer module ${url.pathname}`,
      );
    }
  }
});
test('IPC rejects subframes, old windows and foreign senders', () => {
  const handlers = new Map(),
    ipc = { handle: (name, callback) => handlers.set(name, callback) },
    frame = { url: 'capri://desktop/index.html' };
  let window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  createIpcHandler(ipc, { getWindow: () => window, url: frame.url })(
    'capri:test',
    (value) => value,
  );
  const event = { sender: window.webContents, senderFrame: frame },
    invoke = handlers.get('capri:test');
  assert.equal(invoke(event, 42), 42);
  assert.throws(() => invoke({ ...event, senderFrame: { url: frame.url } }, 42), /Untrusted/);
  window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  assert.throws(() => invoke(event, 42), /Untrusted/);
});
test('API settings and the credential cross the restricted settings IPC in one payload', () => {
  const handlers = new Map();
  const frame = { url: 'capri://desktop/settings.html' };
  const settingsWindow = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: settingsWindow.webContents, senderFrame: frame };
  const handle = createIpcHandler(
    { handle: (name, callback) => handlers.set(name, callback) },
    {
      getWindow: () => null,
      getSettingsWindow: () => settingsWindow,
      settingsUrl: frame.url,
      settingsChannels: SETTINGS_CHANNELS,
    },
  );
  handle('capri:inference-api-save', ({ settings, key }, { role }) => ({ settings, key, role }));
  let preloadApi;
  runInNewContext(readFileSync(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, api) => (preloadApi = api) },
      ipcRenderer: { invoke: (channel, ...args) => handlers.get(channel)(event, ...args) },
    }),
  });
  const settings = { enabled: true, model: 'vendor/model' };
  const key = 'test-only-credential';
  assert.deepEqual(preloadApi.saveInferenceApi({ settings, key }), {
    settings,
    key,
    role: 'settings',
  });
  assert.deepEqual(preloadApi.saveInferenceApi({ settings }), {
    settings,
    key: undefined,
    role: 'settings',
  });
});

test('model folder and device controls are admitted from the actual Settings frame', () => {
  const handlers = new Map(),
    frame = { url: 'capri://desktop/settings.html' };
  const settings = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: settings.webContents, senderFrame: frame };
  const handle = createIpcHandler(
    { handle: (name, callback) => handlers.set(name, callback) },
    {
      getWindow: () => null,
      getSettingsWindow: () => settings,
      settingsUrl: frame.url,
      settingsChannels: SETTINGS_CHANNELS,
    },
  );
  for (const channel of [
    'capri:models-folder',
    'capri:model-devices',
    'capri:model-devices-apply',
  ]) {
    handle(channel, (value, { role }) => ({ value, role }));
    assert.deepEqual(handlers.get(channel)(event, 'fixture'), {
      value: 'fixture',
      role: 'settings',
    });
    assert.throws(
      () => handlers.get(channel)({ ...event, senderFrame: { url: frame.url } }),
      /Untrusted/,
    );
  }
});
test('opaque decoration never affects native hit testing, and drag gestures expire', () => {
  let cursor = { x: 10, y: 10 },
    time = 100,
    ended = 0,
    bounds = { x: 0, y: 0, width: 480, height: 660 };
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ ...bounds }),
    getContentBounds: () => bounds,
    setBounds: (value) => {
      bounds = { ...value };
    },
    setIgnoreMouseEvents: (value) => calls.push(value),
  };
  const pointer = new PointerController({
    window,
    screen: { getCursorScreenPoint: () => cursor },
    getRegions: () => ({
      controls: [{ x: 20, y: 20, width: 50, height: 50 }],
      sprite: { x: 0, y: 0, width: 100, height: 100, enabled: false },
    }),
    getMask: () => ({ alpha: new Uint8Array([255]), imageSize: { width: 1, height: 1 } }),
    onEnd: () => ended++,
    now: () => time,
  });
  pointer.tick();
  assert.deepEqual(calls, []);
  cursor = { x: 30, y: 30 };
  pointer.tick();
  assert.deepEqual(calls, [false]);
  cursor = { x: 10, y: 10 };
  pointer.tick();
  assert.deepEqual(calls, [false, true]);
  pointer.beginWindow();
  cursor = { x: 110, y: 60 };
  pointer.tick();
  assert.deepEqual([bounds.x, bounds.y], [100, 50]);
  time += 31000;
  pointer.tick();
  assert.equal(pointer.drag, null);
  assert.equal(ended, 1);
});

test('only an opaque sprite press can begin a gesture and be acknowledged on release', () => {
  let time = 0;
  const pointer = new PointerController({ now: () => time });
  const sprite = { x: 0, y: 0, width: 90, height: 90 };
  const mask = {
    alpha: new Uint8Array([255, 255, 255, 255, 0, 255, 255, 255, 255]),
    imageSize: { width: 3, height: 3 },
  };
  const gap = { x: 45, y: 45 };
  const hair = { x: 45, y: 15 };
  const taps = [];
  const record = (kind) => taps.push(kind);
  assert.equal(pointer.beginAvatar(gap, sprite, mask), false);
  assert.equal(pointer.endAvatar(), false);
  assert.equal(pointer.beginAvatar(hair, { ...sprite, enabled: false }, mask), false);
  assert.equal(pointer.beginAvatar(hair, sprite, mask), true);
  assert.equal(pointer.endAvatar(hair, record), true);
  assert.deepEqual(taps, ['head']);
  assert.equal(pointer.endAvatar(), false);
  assert.equal(pointer.beginAvatar(hair, sprite, mask), true);
  time += 31_000;
  assert.equal(pointer.endAvatar(), false);
  assert.equal(pointer.beginAvatar(hair, sprite, mask, false), true);
  assert.equal(pointer.endAvatar(hair, record), true);
  assert.equal(pointer.beginAvatar(hair, sprite, mask), true);
  assert.equal(pointer.endAvatar({ x: 51, y: 15 }, record), true);
  assert.equal(pointer.beginAvatar(hair, sprite, mask), true);
  time += 800;
  assert.equal(pointer.endAvatar(hair, record), true);
  assert.deepEqual(taps, ['head', 'body']);
});
