import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerScreenIpc } from '../apps/desktop/main/screen-ipc.mjs';
import { createIpcHandler } from '../apps/desktop/main/ipc.mjs';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';

test('a delayed observation stop remains bound to its own capture ID', () => {
  const handlers = new Map(),
    released = [];
  registerScreenIpc((name, fn) => handlers.set(name, fn), {
    capturePolicy: { capture: { mode: 'watch', id: 'new' }, release: (id) => released.push(id) },
  });
  handlers.get('capri:screen-watch-stop')('old');
  assert.deepEqual(released, ['old']);
});

test('all-monitor frames are available only to the exact companion main frame', () => {
  const handlers = new Map();
  const mainFrame = { url: 'capri://desktop/index.html' };
  const settingsFrame = { url: 'capri://desktop/settings.html' };
  const owner = { isDestroyed: () => false, webContents: { mainFrame } };
  const settings = { isDestroyed: () => false, webContents: { mainFrame: settingsFrame } };
  const handle = createIpcHandler(
    { handle: (name, fn) => handlers.set(name, fn) },
    {
      getWindow: () => owner,
      url: mainFrame.url,
      getSettingsWindow: () => settings,
      settingsUrl: settingsFrame.url,
    },
  );
  const requests = [];
  registerScreenIpc(handle, {
    capturePolicy: { monitorFrames: (id, frame) => requests.push({ id, frame }) },
  });
  const read = handlers.get('capri:screen-monitor-frames');
  assert.throws(
    () => read({ sender: owner.webContents, senderFrame: { ...mainFrame } }, 'lease'),
    /Untrusted IPC sender/,
  );
  assert.throws(
    () => read({ sender: settings.webContents, senderFrame: settingsFrame }, 'lease'),
    /unavailable to settings/,
  );
  read({ sender: owner.webContents, senderFrame: mainFrame }, 'lease');
  assert.deepEqual(requests, [{ id: 'lease', frame: mainFrame }]);
});

test('a clean installation supplies the bundled screenshot cue without a private data/sounds folder', () => {
  const parent = path.join(root, '.runtime/test-data/sound');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'fixture-'));
  mkdirSync(path.join(folder, 'assets/default'), { recursive: true });
  const bundled = path.join(folder, 'assets/default/screenshot-capture.mp3');
  copyFileSync(path.join(root, 'assets/default/screenshot-capture.mp3'), bundled);
  const handlers = new Map();
  registerScreenIpc((name, handler) => handlers.set(name, handler), { root: folder });
  assert.deepEqual(Buffer.from(handlers.get('capri:clip-sound')()), readFileSync(bundled));
});

test('screen IPC checks the current capture lease and conversation availability on every request', () => {
  const handlers = new Map();
  let available = true;
  const capturePolicy = {
    capture: {
      id: 'lease',
      mode: 'watch',
      phase: 'capturing',
      expiresAt: Date.now() + 60000,
      nativeId: 'window:1',
      label: 'Fixture',
    },
  };
  const previews = new Map();
  registerScreenIpc((name, fn) => handlers.set(name, fn), {
    capturePolicy,
    screenPreviews: previews,
    canSubmit: () => available,
    submitSnapshot: (value) => value,
  });
  const ask = handlers.get('capri:screen-watch-ask');
  const input = { captureId: 'lease', id: randomUUID(), text: 'Describe this.' };
  const accepted = ask(input);
  assert.equal(previews.get(accepted.previewId).source.kind, 'window');
  Object.assign(capturePolicy.capture, {
    allMonitors: true,
    nativeId: 'screen:0:0',
    label: 'All monitors',
  });
  const mosaic = ask({ ...input, id: randomUUID() });
  assert.equal(previews.get(mosaic.previewId).source.kind, 'monitors');
  assert.equal(previews.get(mosaic.previewId).source.label, 'All monitors');
  available = false;
  assert.throws(() => ask(input), /conversation is busy/);
  available = true;
  capturePolicy.capture.expiresAt = Date.now() - 1;
  assert.throws(() => ask(input), /Screen access is off/);
  capturePolicy.capture = null;
  assert.throws(() => ask(input), /Screen access is off/);
  assert.equal(previews.size, 2);
});
