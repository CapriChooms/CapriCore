import test from 'node:test';
import assert from 'node:assert/strict';
import {
  screenshotShutterSamples,
  playScreenshotShutter,
} from '../apps/desktop/renderer/wake-feedback.mjs';

test('short shutter cue is finite, bounded and plays directly to output', () => {
  for (const rate of [16000, 24000, 48000]) {
    const pcm = screenshotShutterSamples(rate);
    assert.equal(pcm.length, Math.ceil(rate * 0.17));
    assert.ok(pcm.every(Number.isFinite));
    const peak = pcm.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
    assert.ok(peak > 0.03 && peak < 0.25);
    assert.ok(pcm.subarray(Math.ceil(rate * 0.14)).every((x) => Math.abs(x) < 0.001));
  }
  let started = false,
    connected;
  const destination = {};
  const context = {
    sampleRate: 24000,
    destination,
    createBuffer: () => ({ copyToChannel() {} }),
    createBufferSource: () => ({
      connect: (target) => {
        connected = target;
      },
      start: () => {
        started = true;
      },
      disconnect() {},
    }),
  };
  playScreenshotShutter(context);
  assert.equal(started, true);
  assert.equal(connected, destination);
});
