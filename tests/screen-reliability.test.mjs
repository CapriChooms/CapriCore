// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenWatch, waitForScreenFrame } from '../apps/desktop/renderer/screen-watch.mjs';
import { screenFrameCanvas, screenPng } from '../apps/desktop/renderer/screen-mosaic.mjs';
import { registerScreenIpc } from '../apps/desktop/main/screen-ipc.mjs';
import { CompanionActions } from '../apps/desktop/companion-actions.mjs';
import {
  ScreenPanel,
  screenImageWarning,
  screenObservationText,
} from '../apps/desktop/renderer/screen-panel.mjs';
import { screenFormState } from '../apps/desktop/main/screen-form-state.mjs';

test('detailed screen frames keep 1080p and oversized PNGs fall back to the background size', async (t) => {
  const previous = globalThis.document;
  const encoded = [];
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob(resolve) {
        encoded.push([this.width, this.height]);
        resolve({ size: this.width > 1280 ? 4 * 1024 * 1024 : 123 });
      },
    }),
  };
  t.after(() => (globalThis.document = previous));
  const detailed = screenFrameCanvas({}, 2560, 1440, true);
  assert.deepEqual([detailed.width, detailed.height], [1920, 1080]);
  assert.equal((await screenPng(detailed)).size, 123);
  assert.deepEqual(encoded, [
    [1920, 1080],
    [1280, 720],
  ]);
  const portrait = screenFrameCanvas({}, 1080, 1920, false);
  assert.deepEqual([portrait.width, portrait.height], [405, 720]);
});

test('an unsupported-image warning survives settings IPC and is announced once without a capture error', (t) => {
  const warning = 'The active model cannot read images or video frames.';
  const element = { textContent: '', dataset: {} },
    announcements = [];
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => element };
  t.after(() => (globalThis.document = previousDocument));
  const panel = {
    ui: { text: (text) => text },
    onError: (message) => announcements.push(message),
    onFormChange() {},
    observationStatus: ScreenPanel.prototype.observationStatus,
  };
  const state = { active: true, analysing: false, error: null, warning, changed: true };
  ScreenPanel.prototype.observation.call(panel, state);
  ScreenPanel.prototype.observation.call(panel, { ...state });
  assert.deepEqual(announcements, [warning]);
  assert.equal(element.textContent, warning);
  assert.equal(element.dataset.severity, 'warning');
  const form = screenFormState({
    sources: [],
    sourceId: '',
    status: panel.observationStatus(),
    active: true,
    ready: true,
    busy: false,
    canAsk: false,
    interval: 15,
    duration: 10,
    warning,
  });
  assert.equal(form.error, null);
  assert.equal(form.warning, warning);
  assert.equal(screenObservationText(panel.ui, form.status), warning);
  assert.throws(() => screenFormState({ ...form, warning: 'Raw private provider detail' }));
});

test('only safe image-capability messages become warnings across the renderer boundary', () => {
  const message = 'The active model cannot read images or video frames.';
  assert.equal(
    screenImageWarning(
      new Error("Error invoking remote method 'capri:screen-ask': Error: " + message),
    ),
    message,
  );
  for (const other of [
    'API provider returned HTTP 403.',
    'Connection timed out.',
    message + ' private detail',
  ])
    assert.equal(screenImageWarning(other), null);
});

function watching(t, api = {}) {
  const errors = [],
    calls = [];
  const watch = new ScreenWatch({
    api: {
      screenWatchSample: async () => ({ active: true, analyse: true }),
      screenWatchFrame: async (value) => calls.push(value),
      stopScreenWatch: async (id) => calls.push({ stop: id }),
      ...api,
    },
    video: { pause() {}, srcObject: {}, hidden: false },
    onChange() {},
    onError: (message) => errors.push(message),
  });
  let tracksStopped = 0;
  const run = (watch.run = {
    id: 'lease',
    ready: true,
    sequence: 0,
    canvas: {
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8Array(64 * 36 * 4) }),
      }),
    },
    stream: { getTracks: () => [{ stop: () => tracksStopped++ }] },
  });
  watch.image = async () => new Uint8Array([1]);
  const tick = async () => {
    clearTimeout(run.timer);
    await watch.tick(run);
    clearTimeout(run.timer);
  };
  t.after(() => watch.stop(false));
  return { watch, run, errors, calls, tick, stopped: () => tracksStopped };
}

test('a transient screen frame or IPC failure retries the same grant without stopping observation', async (t) => {
  const f = watching(t);
  f.watch.image = async () => {
    throw new Error('One dropped frame');
  };
  await f.tick();
  assert.equal(f.watch.run, f.run);
  assert.equal(f.stopped(), 0);
  assert.equal(f.run.failures, 1);
  assert.deepEqual(f.errors, ['A screen update was skipped. Retrying later.']);
  f.watch.image = async () => new Uint8Array([2]);
  await f.tick();
  assert.equal(f.run.failures, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].captureId, 'lease');
  assert.equal(f.calls[0].sequence, 0);
  f.watch.api.screenWatchSample = async () => {
    throw new Error('Temporary IPC failure');
  };
  await f.tick();
  assert.equal(f.watch.run, f.run);
  assert.equal(f.run.failures, 1);
});

test('three consecutive screen failures stop the stream instead of retrying forever', async (t) => {
  const f = watching(t, {
    screenWatchFrame: async () => {
      throw new Error('Persistent failure');
    },
  });
  await f.tick();
  await f.tick();
  await f.tick();
  assert.equal(f.watch.run, null);
  assert.equal(f.stopped(), 1);
  assert.deepEqual(f.calls, [{ stop: 'lease' }]);
  assert.equal(f.errors.at(-1), 'Screen observation stopped. Select the source again.');
});

test('revoked capture and a late sample never transmit pixels or revive observation', async (t) => {
  const f = watching(t, { screenWatchSample: async () => ({ active: false, analyse: true }) });
  await f.tick();
  assert.equal(f.watch.run, null);
  assert.equal(f.stopped(), 1);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.errors, []);
  let finish;
  const g = watching(t, {
    screenWatchSample: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = g.tick();
  g.watch.stop();
  finish({ active: true, analyse: true });
  await pending;
  assert.equal(g.watch.run, null);
  assert.deepEqual(g.calls, [{ stop: 'lease' }]);
  assert.deepEqual(g.errors, []);
});

test('screen sample IPC distinguishes a revoked grant from an unchanged active scene', async () => {
  const handlers = new Map();
  let active = true,
    samples = 0;
  registerScreenIpc((name, handler) => handlers.set(name, handler), {
    capturePolicy: { checkActive: async () => active },
    screenObservation: {
      sample: () => {
        samples++;
        return { analyse: false };
      },
    },
  });
  const sample = handlers.get('capri:screen-watch-sample');
  assert.deepEqual(await sample({ captureId: 'lease' }), { active: true, analyse: false });
  active = false;
  assert.deepEqual(await sample({ captureId: 'lease' }), { active: false, analyse: false });
  assert.equal(samples, 1);
});

test('repeated requests to enable active observation cannot open a picker or interrupt its source', async () => {
  let active = true,
    proposed = 0;
  const host = {
    settings: () => ({ screenObservation: active }),
    requestSetting: async () => {
      proposed++;
      return { ok: false, needsApproval: true };
    },
  };
  const request = () =>
    CompanionActions.prototype.execute.call(host, 'settings_control', 'request', {
      action: 'request',
      setting: 'screenObservation',
      value: true,
    });
  for (let i = 0; i < 3; i++) {
    const result = await request();
    assert.equal(result.ok, true);
    assert.equal(result.alreadyEnabled, true);
    assert.equal(result.needsApproval, false);
    assert.equal(result.captureStarted, false);
  }
  assert.equal(proposed, 0);
  active = false;
  const result = await request();
  assert.equal(proposed, 1);
  assert.equal(result.needsApproval, true);
  assert.equal(result.effect, 'open_screen_picker');
  assert.equal(result.captureStarted, false);
});

test('fresh-frame waiting releases callbacks on success and timeout', async () => {
  let callback,
    cancelled = 0;
  const video = {
    requestVideoFrameCallback(fn) {
      callback = fn;
      return 1;
    },
    cancelVideoFrameCallback(id) {
      assert.equal(id, 1);
      cancelled++;
    },
  };
  const pending = waitForScreenFrame(video, 100);
  callback();
  await pending;
  await assert.rejects(waitForScreenFrame(video, 1), /fresh screen frame/);
  assert.equal(cancelled, 2);
});

test('transient grabFrame failure waits for a fresh frame and cannot revive a revoked stream', async (t) => {
  const previousDocument = globalThis.document,
    previousCapture = globalThis.ImageCapture;
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.ImageCapture = previousCapture;
  });
  let nextFrame,
    drawn = 0;
  globalThis.ImageCapture = class {
    grabFrame() {
      return Promise.reject(new DOMException('temporary', 'UnknownError'));
    }
  };
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage() {
          drawn++;
        },
      }),
      toBlob(fn) {
        fn(new Blob([new Uint8Array([1, 2, 3])]));
      },
    }),
  };
  const video = {
    videoWidth: 800,
    videoHeight: 600,
    requestVideoFrameCallback(fn) {
      nextFrame = fn;
      return 1;
    },
    cancelVideoFrameCallback() {},
    pause() {},
  };
  const watch = new ScreenWatch({ api: {}, video, onChange() {}, onError() {} });
  const run = (watch.run = {
    ready: true,
    stream: { getVideoTracks: () => [{}], getTracks: () => [] },
  });
  const frame = watch.image(run);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drawn, 0);
  nextFrame();
  assert.deepEqual(await frame, new Uint8Array([1, 2, 3]));
  const revoked = watch.image(run);
  await new Promise((resolve) => setImmediate(resolve));
  watch.stop(false);
  nextFrame();
  await assert.rejects(revoked, /off/);
  assert.equal(drawn, 1);
});
