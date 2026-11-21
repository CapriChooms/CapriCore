import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCelPainter,
  hangingCelActions,
  registeredCelAt,
  registeredCelClip,
  registeredCelFrame,
  seatedCelActions,
  validRegisteredCel,
} from '../apps/desktop/renderer/hanging-cels.mjs';
import {
  createScreenInteractionClip,
  createScreenInteractionRenderer,
  getScreenInteraction,
  sampleScreenInteraction,
  usesSurfacePerformance,
} from '../apps/desktop/renderer/screen-interaction-motion.mjs';

const original = { src: 'capri://desktop/sprites/pose-ceiling.png' };
function recordingCanvas() {
  const commands = [];
  const context = {
    drawImage: (...args) => commands.push(['draw', ...args]),
    clearRect: (...args) => commands.push(['clear', ...args]),
  };
  return {
    commands,
    width: 1254,
    height: 1254,
    dataset: {},
    getContext(type) {
      assert.equal(type, '2d');
      return context;
    },
  };
}

test('registered actions accept only their matching pose, name and duration', () => {
  for (const id of [...hangingCelActions, ...seatedCelActions, 'ledge-peek-below']) {
    const clip = registeredCelClip(id);
    assert.equal(createScreenInteractionClip(id, { frameId: clip.frameId }), clip);
    assert.ok(usesSurfacePerformance(id));
    const fixed = getScreenInteraction(id).contacts.map((point) => point.name);
    assert.deepEqual(fixed, clip.frameId === 'pose-ceiling' ? ['left-grip'] : ['seat']);
    assert.ok(validRegisteredCel(clip, id, clip.frameId));
    assert.equal(validRegisteredCel({ ...clip, durationMs: 2 }, id, clip.frameId), false);
    assert.equal(validRegisteredCel(clip, 'unknown', clip.frameId), false);
    assert.equal(validRegisteredCel(clip, id, 'neutral'), false);
    const seen = new Set();
    for (let time = 0; time < clip.durationMs; time += 20) {
      const frame = registeredCelFrame(id, time);
      if (frame && !frame.asset.endsWith('-breakdowns')) seen.add(frame.cell);
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5]);
    assert.equal(registeredCelAt(id, 0), -1);
    assert.equal(registeredCelAt(id, clip.durationMs - 1), -1);
  }
});

test('a registered drawing occupies a fixed rectangle, with solid original endpoints and safe delayed decode', () => {
  const canvas = recordingCanvas();
  const sheets = new Map();
  const paint = createCelPainter(canvas, (asset) => sheets.get(asset));
  const action = 'hang-pullup';
  const atlas = { src: 'test-keys' };
  const breakdown = { src: 'test-breakdowns' };
  const timeFor = (index) => {
    for (let ms = 0; ms < registeredCelClip(action).durationMs; ms++)
      if (registeredCelAt(action, ms) === index) return ms;
    assert.fail('missing exposure ' + index);
  };
  assert.ok(paint.draw(original, action, timeFor(2)));
  assert.deepEqual(canvas.commands.at(-1), ['draw', original, 0, 0, 1254, 1254]);
  sheets.set(action, atlas);
  assert.ok(paint.draw(original, action, timeFor(2)));
  assert.deepEqual(canvas.commands.at(-1), ['draw', atlas, 1024, 0, 512, 512, 0, 0, 1254, 1254]);
  assert.equal(paint.draw(original, action, timeFor(9)), false); // late in-between holds key 2
  sheets.set(action + '-breakdowns', breakdown);
  assert.ok(paint.draw(original, action, timeFor(9)));
  assert.deepEqual(canvas.commands.at(-1), ['draw', breakdown, 0, 512, 512, 512, 0, 0, 1254, 1254]);
  assert.ok(paint.draw(original, action, registeredCelClip(action).durationMs));
  assert.deepEqual(canvas.commands.at(-1), ['draw', original, 0, 0, 1254, 1254]);
});

test('the hanging body is stationary even when obsolete body offsets arrive', (t) => {
  const output = recordingCanvas();
  const unusedMesh = {
    getContext() {
      throw Error('unexpected whole-body mesh');
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => unusedMesh },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const renderer = createScreenInteractionRenderer(output);
  renderer.setAction('bar-read-below', 0, { frameId: 'pose-ceiling' });
  renderer.draw(original, { bodyX: 150, bodyY: 100, head: 1 });
  assert.deepEqual(output.commands.at(-1), ['draw', original, 0, 0]);
  assert.equal(renderer.channels.bodyX, 0);
  assert.equal(sampleScreenInteraction('bar-read-below', 1960).bodyY, 0);
  renderer.setAction('edge-hang', 3000, { frameId: 'pose-ceiling' });
  renderer.draw(original, { bodyX: 25, bodyY: 10 });
  assert.deepEqual(output.commands.at(-1), ['draw', original, 0, 0]);
});

test('catch and scanner resume from their prop holds', () => {
  for (const [action, held, holdMs, next] of [
    ['hang-catch', 3, 1000, 10],
    ['hang-wrist-scan', 5, 3000, 4],
  ]) {
    const duration = registeredCelClip(action).durationMs;
    const entry = Array.from({ length: duration }, (_, ms) => registeredCelAt(action, ms)).indexOf(
      held,
    );
    assert.ok(entry > 0);
    assert.equal(registeredCelAt(action, entry + holdMs - 1), held);
    assert.equal(registeredCelAt(action, entry + holdMs), next);
    assert.equal(registeredCelAt(action, duration - 1), -1);
  }
});

test('all catalogued surface clips sample at their start, midpoint and end', async () => {
  const { screenInteractionClips } = await import(
    '../apps/desktop/renderer/screen-interaction-motion.mjs'
  );
  for (const id of Object.keys(screenInteractionClips)) {
    const interaction = getScreenInteraction(id);
    assert.ok(interaction, id);
    for (const fraction of [0, 0.5, 1]) {
      assert.ok(sampleScreenInteraction(id, fraction * interaction.clip.durationMs), id);
    }
  }
});
