// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempDisposableSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

if (process.platform !== 'win32') throw Error('Windows is required.');
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
using fixture = mkdtempDisposableSync(path.join(parent, 'audio-routing-'));
const server = createServer((_, response) => response.end('{"data":[]}'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: fixture.path,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;

async function open() {
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const owner = await app.firstWindow();
  owner.on('pageerror', (error) => errors.push(error.message));
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  const audio = await settingsView(app, 'audio');
  audio.on('pageerror', (error) => errors.push(error.message));
  return { owner, audio };
}

try {
  const { owner, audio } = await open();
  const { devices } = await audio.evaluate(() => window.capri.audioRouting());
  const preferCable = (items) => items.find(({ label }) => /cable/i.test(label)) ?? items[0];
  const selected = {
    speaker: preferCable(devices.outputs),
    music: preferCable(devices.endpoints.filter(({ kind }) => kind === 'output')),
    system: preferCable(devices.endpoints.filter(({ kind }) => kind === 'input')),
    call: preferCable(devices.callOutputs),
    microphone: devices.inputs[0],
  };
  for (const [route, device] of Object.entries(selected)) {
    assert.ok(device, `The test needs an available ${route} device.`);
    const selector = '#audio-route-' + route;
    await audio.locator(selector).selectOption(device.id);
    await audio.waitForFunction((selector) => !document.querySelector(selector).disabled, selector);
    assert.equal(await audio.locator(selector).inputValue(), device.id);
  }
  const saved = JSON.parse(
    readFileSync(path.join(fixture.path, 'desktop/audio-routing.json'), 'utf8'),
  ).settings;
  for (const route of ['speaker', 'music', 'system', 'call'])
    assert.equal(saved.routes[route], selected[route].id);
  const sink = await audio.evaluate(async (id) => {
    const context = new AudioContext({ sinkId: id });
    try {
      await context.setSinkId(id);
      return context.sinkId;
    } finally {
      await context.close();
    }
  }, selected.speaker.id);
  assert.equal(sink, selected.speaker.id);
  await assert.rejects(
    owner.evaluate(() => window.capri.audioRouting()),
    /unavailable/,
  );
  const runtime = await owner.evaluate(() => window.capri.bootstrap());
  assert.equal(runtime.microphone.enabled, false);
  assert.equal(runtime.musicListening.enabled, false);
  await audio.evaluate(() => window.capri.setSkill({ id: 'capri.voice-calls', enabled: true }));
  const calls = await settingsView(app, 'calls');
  await calls.locator('#call-output-device option').nth(1).waitFor({ state: 'attached' });
  assert.equal(await calls.locator('#call-output-device').inputValue(), selected.call.id);
  assert.equal(await calls.locator('#call-output-enable').isEnabled(), true);
  await app.close();
  const relaunched = await open();
  for (const [route, device] of Object.entries(selected))
    assert.equal(await relaunched.audio.locator('#audio-route-' + route).inputValue(), device.id);
  assert.deepEqual(errors, []);
  console.log(
    'PASS real Windows endpoints, exact playback, separate saved routes, no automatic capture.',
  );
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
