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

test('allowlisted renderer modules serve every literal local module import', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const resources = createDesktopResources({
    root,
    directory: path.join(root, 'apps/desktop'),
    catalog: { portraitFrames: [] },
    spriteFile: '',
    startupIntro: null,
  });
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
