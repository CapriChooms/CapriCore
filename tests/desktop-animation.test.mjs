import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root } from '../packages/runtime/src/index.mjs';
import {
  loadAvatarCatalog,
  ACTIVE_AVATAR_CATALOG,
  requireCapriAvatar,
} from '../apps/desktop/avatar-catalog.mjs';
import { AvatarState } from '../apps/desktop/avatar-state.mjs';
import { AvatarStreamParser, avatarInstructions } from '../apps/desktop/avatar-protocol.mjs';
import { AnimationDirector } from '../apps/desktop/renderer/animation-director.mjs';
import { AvatarVisemes } from '../apps/desktop/renderer/avatar-mouth.mjs';
import { registeredAvatarRect } from '../apps/desktop/avatar-layout.mjs';

const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));
const data = catalog.publicAnimation(),
  choices = catalog.publicSprites();
const create = () =>
  new AnimationDirector({
    choices,
    frames: data.frames,
    clips: data.clips,
    settings: data.autonomy,
    random: () => 0,
  });

test('the artwork pack is retained, while only standing portrait frames and facial reactions are active', () => {
  assert.equal(catalog.frames.length, 68);
  assert.equal(choices.length, 17);
  assert.equal(data.frames.length, 28);
  assert.equal(catalog.frames.filter((f) => f.canPersist).length, 39);
  assert.equal(catalog.frames.filter((f) => f.kind === 'effect').length, 1);
  for (const item of [...data.frames, ...data.clips, ...choices]) {
    assert.ok(!item.id.includes('walk'));
    assert.equal(item.file, undefined);
  }
  assert.ok(data.frames.every((frame) => frame.pose === 'idle'));
  assert.ok(choices.every((choice) => choice.pose === 'idle'));
  assert.deepEqual(
    data.clips.map(({ id }) => id),
    ['blink', 'speech', 'wink', 'laugh', 'excited'],
  );
  const state = new AvatarState(choices, 'neutral', { restoredId: 'sit_floor-thinking' });
  assert.equal(state.currentId, 'neutral');
  for (const retired of ['wave', 'sit_floor-thinking', 'air_kiss', 'point_right']) {
    assert.equal(state.request(retired), null);
    assert.ok(!avatarInstructions(choices).includes(retired));
    const parser = new AvatarStreamParser(choices);
    const events = parser.push(`[avatar:${retired}]\nHi.`);
    assert.ok(events.every(({ type }) => type === 'text'));
  }
  const action = state.request('wink');
  assert.ok(state.acknowledge(action));
  assert.equal(state.currentId, 'flirty');
  assert.equal(state.request('idle-wink_half'), null, 'LLM cannot select intermediate frames');
});

test('all active facial frames are reachable through context choices, micro-animation or gaze', () => {
  const seen = new Set(),
    director = create();
  let clock = 0,
    revision = 0;
  const tick = (input = {}) => {
    const result = director.tick(clock, { expanded: true, ...input });
    if (result) {
      seen.add(result.frameId);
      if (result.effect) seen.add(result.effect.id);
    }
    return result;
  };
  const advance = (ms, input = {}) => {
    for (let t = 0; t < ms; t += 50) {
      clock += 50;
      tick(input);
    }
  };
  for (const choice of choices) {
    director.select(choice.id, revision++, clock);
    tick();
    advance(5000);
  }
  director.select('neutral', revision++, clock);
  advance(9000);
  for (const level of [0.01, 0.05, 0.12, 0]) advance(400, { speaking: true, level });
  advance(400000);
  assert.deepEqual(
    data.frames
      .filter((frame) => !seen.has(frame.id) && !frame.id.startsWith('idle-mouth_'))
      .map((f) => f.id),
    [],
  );
});

test('new user attention preempts gaze and a new model choice supersedes a facial reaction', () => {
  const director = create();
  director.select('neutral', 1, 0);
  for (let t = 0; t <= 20000; t += 100) director.tick(t, { expanded: true });
  assert.equal(director.sequence.kind, 'ambient');
  director.attend(20000, true);
  assert.equal(director.tick(20001, { expanded: true, active: true }).frameId, 'neutral');
  director.select('wink', 2, 20002);
  assert.equal(director.sequence.id, 'wink');
  director.select('concerned', 3, 20003);
  assert.equal(
    director.tick(20004, { expanded: true, speaking: true, level: 0.2 }).frameId,
    'concerned',
  );
  assert.equal(director.select('happy', 2, 20005), false);
  assert.equal(director.select('wave', 4, 20005), false);
});

test('reviewed ground poses are available to idle animation and keep the original neutral frame', () => {
  const installed = requireCapriAvatar(root);
  const artwork = installed.publicAnimation();
  assert.equal(
    installed.portraitFrames.find(({ id }) => id === 'neutral').file,
    catalog.portraitFrames.find(({ id }) => id === 'neutral').file,
  );
  assert.deepEqual(
    installed
      .publicSprites()
      .filter(({ kind }) => kind === 'reviewed_pose')
      .map(({ id }) => id),
    ['pose-sit-floor', 'pose-crouch'],
  );
  for (const [random, pose] of [
    [0, 'pose-sit-floor'],
    [0.95, 'pose-crouch'],
  ]) {
    const director = new AnimationDirector({
      choices: installed.publicSprites(),
      frames: artwork.frames,
      clips: artwork.clips,
      settings: artwork.autonomy,
      random: () => random,
    });
    director.select('neutral', 1, 0);
    let frame;
    for (let t = 0; t <= artwork.autonomy.firstActivityMs; t += 100)
      frame = director.tick(t, { expanded: true });
    assert.equal(frame.frameId, pose);
    assert.equal(
      director.tick(artwork.autonomy.firstActivityMs + 50, { expanded: true, speaking: true })
        .frameId,
      'neutral',
    );
  }
});

test('speech visemes use their own clock and leave every body expression or reaction intact', () => {
  const director = create();
  const mouth = new AvatarVisemes();
  director.select('neutral', 0, 0);
  assert.equal(
    director.tick(100, { expanded: true, speaking: true, level: 0.1 }).frameId,
    'neutral',
  );
  assert.equal(mouth.sample(100, true, 0.18), 'wide');
  assert.equal(mouth.sample(150, true, 0.016), 'wide');
  assert.equal(mouth.sample(190, true, 0.016), 'round');
  assert.equal(mouth.sample(280, true, 0.008), 'small');
  assert.equal(mouth.sample(290, true, 0.004), 'closed');
  assert.equal(mouth.sample(300, false, 0.2), 'closed');
  assert.equal(director.tick(200, { expanded: true }).frameId, 'neutral');
  director.select('attentive', 1, 300);
  assert.equal(
    director.tick(400, { expanded: true, speaking: true, level: 0.1 }).frameId,
    'attentive',
  );
  director.select('wink', 2, 500);
  const opening = data.clips.find(({ id }) => id === 'wink').frames.slice(0, 2);
  const winkAt = 500 + opening.reduce((sum, { ms }) => sum + ms, 0);
  assert.equal(
    director.tick(winkAt, { expanded: true, speaking: true, level: 0.1 }).frameId,
    'idle-wink_closed',
  );
});

test('reduced motion renders stable choices and contact registration preserves shared ground', () => {
  const director = create();
  director.select('wink', 0, 0);
  assert.equal(director.tick(100, { expanded: true, reduced: true }).frameId, 'flirty');
  const viewport = { x: 0, y: 0, width: 400, height: 260, baseSize: 260 },
    layout = { x: 0.5, y: 1, zoom: 1.15 };
  const ground = ['neutral', 'flirty', 'thinking', 'idle-blink_half'].map((id) => {
    const frame = data.frames.find((f) => f.id === id),
      rect = registeredAvatarRect(layout, viewport, frame);
    return rect.y + (frame.anchor.y / 1254) * rect.height;
  });
  assert.ok(ground.every((y) => Math.abs(y - ground[0]) < 0.001));
});
