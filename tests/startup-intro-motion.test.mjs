// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drawStartupIntro,
  startupIntroSample,
} from '../apps/desktop/renderer/startup-intro-motion.mjs';

function recorder() {
  const calls = [];
  const context = {};
  for (const name of [
    'clearRect',
    'save',
    'restore',
    'beginPath',
    'rect',
    'clip',
    'moveTo',
    'lineTo',
    'closePath',
    'fill',
    'drawImage',
  ])
    context[name] = (...args) => calls.push([name, ...args]);
  return { context, calls };
}
const images = Array.from({ length: 7 }, (_, index) => ({ index }));

test('startup exposure sheet selects all seven held poses at their approved boundaries', () => {
  const times = [0, 167, 375, 667, 1083, 1833, 2417];
  for (const [index, time] of times.entries()) {
    assert.equal(startupIntroSample(time).index, index);
    if (index) assert.equal(startupIntroSample(time - 0.001).index, index - 1);
  }
  assert.equal(startupIntroSample(-20).index, 0);
  assert.equal(startupIntroSample(3000).index, 6);
  assert.equal(startupIntroSample(3000).finished, true);
  assert.equal(startupIntroSample(6000, 6000).index, 6);
  assert.equal(startupIntroSample(Infinity).index, 6);
  for (const value of [NaN, undefined, -Infinity])
    assert.ok(Number.isFinite(startupIntroSample(value).time));
});

test('body moves only as a rigid, held drawing while every finished frame is the unchanged master', () => {
  assert.equal(startupIntroSample(380).poseY, startupIntroSample(400).poseY);
  assert.notEqual(startupIntroSample(380).poseY, startupIntroSample(450).poseY);
  for (const time of [2860, 2900, 3000, 10000]) {
    const { context, calls } = recorder();
    const result = drawStartupIntro(context, { time, width: 500, height: 360, images });
    assert.equal(result.index, 6);
    assert.equal(result.poseX, 0);
    assert.equal(result.poseY, 0);
    assert.equal(result.effects, false);
    assert.equal(result.sparkCount, 0);
    assert.deepEqual(
      calls.filter(([name]) => name === 'drawImage'),
      [['drawImage', images[6], 70, 0, 360, 360]],
    );
    assert.equal(calls.filter(([name]) => name === 'fill').length, 0);
  }
});

test('deterministic red-ink geometry stays bounded and never duplicates or stretches the character', () => {
  for (let time = 0; time <= 3000; time += 1000 / 60) {
    const a = recorder(),
      b = recorder();
    const options = {
      time,
      width: 430,
      height: 300,
      images,
      seed: 514,
      rect: { x: 55, y: 10, width: 300, height: 280 },
    };
    const sample = drawStartupIntro(a.context, options);
    drawStartupIntro(b.context, options);
    assert.deepEqual(a.calls, b.calls);
    assert.ok(sample.sparkCount <= 28);
    assert.equal(a.calls.filter(([name]) => name === 'drawImage').length, 1);
    const image = a.calls.find(([name]) => name === 'drawImage');
    assert.equal(image[4], image[5], 'A sprite must always keep its square aspect ratio');
    for (const call of a.calls)
      for (const value of call.slice(1))
        if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.equal(a.context.shadowBlur, undefined);
    assert.equal(a.context.filter, undefined);
    assert.equal(a.context.globalAlpha, undefined);
  }
});

test('only effects move at sub-exposure refresh rates, and different seeds do not move the drawing', () => {
  const a = recorder(),
    b = recorder(),
    c = recorder();
  drawStartupIntro(a.context, { time: 710, width: 400, height: 400, images, seed: 4 });
  drawStartupIntro(b.context, { time: 715, width: 400, height: 400, images, seed: 4 });
  drawStartupIntro(c.context, { time: 710, width: 400, height: 400, images, seed: 5 });
  assert.deepEqual(
    a.calls.find(([name]) => name === 'drawImage'),
    b.calls.find(([name]) => name === 'drawImage'),
  );
  assert.deepEqual(
    a.calls.find(([name]) => name === 'drawImage'),
    c.calls.find(([name]) => name === 'drawImage'),
  );
  assert.notDeepEqual(a.calls, b.calls);
  assert.notDeepEqual(a.calls, c.calls);
});

test('missing artwork and invalid viewport dimensions remain safe and transparent', () => {
  const { context, calls } = recorder();
  assert.equal(
    drawStartupIntro(context, { time: 3000, width: 0, height: 400, images }).sparkCount,
    0,
  );
  assert.equal(calls.length, 0);
  drawStartupIntro(context, { time: 3000, width: 400, height: 400 });
  assert.deepEqual(calls[0], ['clearRect', 0, 0, 400, 400]);
  assert.equal(
    calls.some(([name]) => name === 'drawImage'),
    false,
  );
});
