// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MusicAnimation,
  MusicPoseLayer,
  musicNoteParticles,
  MUSIC_POSES,
} from '../apps/desktop/renderer/music-animation.mjs';
import { avatarPoseLandmarks } from '../apps/desktop/renderer/avatar-mouth.mjs';
import { avatarBodyPartAt } from '../apps/desktop/avatar-body-regions.mjs';
import { AvatarDetach } from '../apps/desktop/main/avatar-detach.mjs';
import { requireCapriAvatar } from '../apps/desktop/avatar-catalog.mjs';
import { root } from '../packages/runtime/src/index.mjs';
import {
  CHANNELS,
  POSE_RIGS,
  deformPoint,
  motionExtent,
} from '../apps/desktop/renderer/idle-gesture-rig.mjs';
import {
  beatPoseChannels,
  musicRig,
  syncSleepBreathing,
} from '../apps/desktop/renderer/music-beat-motion.mjs';
import { musicBreathingTempo } from '../apps/desktop/music-listening-settings.mjs';
import { galleryEntries } from '../apps/desktop/renderer/avatar-gallery.mjs';
import { gripArt } from '../apps/desktop/renderer/music-grip-art.mjs';
import { gripSkeleton } from '../apps/desktop/renderer/music-grip-motion.mjs';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

test('sleep breathing follows four musical beats and returns to 12.5 breaths per minute in silence', () => {
  const rates = [];
  const animation = {
    animationName: 'avatar-sleep-breathe',
    currentTime: 500,
    playbackRate: 1,
    updatePlaybackRate(rate) {
      this.playbackRate = rate;
      rates.push(rate);
    },
  };
  const sprite = { getAnimations: () => [animation] };
  const listening = { enabled: true, hearingMusic: true, tempo: 120, tempoConfidence: 1 };
  syncSleepBreathing(sprite, musicBreathingTempo(listening));
  syncSleepBreathing(sprite, musicBreathingTempo(listening));
  syncSleepBreathing(sprite, musicBreathingTempo({ ...listening, hearingMusic: false }));
  assert.deepEqual(rates, [2.4, 1]);
  assert.equal(animation.currentTime, 500);
  assert.equal(musicBreathingTempo({ ...listening, settings: { motion: false } }), 0);
  assert.equal(musicBreathingTempo({ ...listening, tempoConfidence: 0.1 }), 0);
});

test('both anchored arms retain their lengths through each layered beat cycle', () => {
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (const [id, { arms }] of Object.entries(gripArt)) {
    for (let sample = 0; sample < 96; sample++) {
      const { limbs } = gripSkeleton(id, beatPoseChannels(id, sample / 24));
      for (const [i, { wrist, elbow, shoulder }] of arms.entries()) {
        assert.ok(Math.abs(distance(wrist, limbs[i].elbow) - distance(wrist, elbow)) < 1e-7, id);
        assert.ok(
          Math.abs(distance(limbs[i].elbow, limbs[i].shoulder) - distance(elbow, shoulder)) < 1e-7,
          id,
        );
      }
    }
  }
});

test('the exposed hair beneath both ceiling arms and the crossed wall locks has continuous colour', () => {
  const plate = (id) =>
    PNG.sync.read(
      readFileSync(new URL('../assets/default/music-grip-plates/' + id + '.png', import.meta.url)),
    );
  const ceiling = plate('pose-ceiling'),
    wall = plate('pose-dock-right');
  const pixel = (img, x, y) =>
    img.data.subarray(4 * (y * img.width + x), 4 * (y * img.width + x + 1));
  for (const [cx, y] of [
    [500, 155],
    [502, 215],
    [515, 295],
    [756, 169],
    [743, 235],
    [735, 288],
  ]) {
    for (let x = cx - 9; x <= cx + 9; x++) {
      const [r, , , a] = pixel(ceiling, x, y);
      assert.ok(r >= 240 && a >= 245, 'Dark or transparent stripe under a raised arm');
    }
  }
  for (const x of [802, 815, 851]) {
    const [r, g, , a] = pixel(wall, x, 466);
    assert.ok(r > 145 && g < 15 && a >= 245, 'The red wall lock has a gap');
  }
  assert.equal(pixel(wall, 834, 479)[3], 0, 'The gap between the two locks stays open');
});

test('every installed pose has a four-beat loop with a fixed contact and a bounded silhouette', () => {
  const { poses, animations } = galleryEntries(requireCapriAvatar(root).publicGallery());
  const loops = animations.filter(({ kind }) => kind === 'music');
  assert.deepEqual(loops.map(({ poster }) => poster.id).sort(), poses.map(({ id }) => id).sort());
  for (const { id } of poses) {
    const rig = POSE_RIGS[musicRig(id)];
    const values = [];
    for (let step = 0; step < 48; step++) {
      const beat = step / 12;
      const motion = beatPoseChannels(id, beat);
      const repeated = beatPoseChannels(id, beat + 4);
      for (const key of Object.keys(motion).filter((key) => key !== 'pose'))
        assert.ok(Math.abs(motion[key] - repeated[key]) < 1e-10, id + ' ' + key);
      const channels = { ...CHANNELS, ...motion };
      const contact = deformPoint(...rig.anchor, channels);
      assert.ok(Math.hypot(contact[0] - rig.anchor[0], contact[1] - rig.anchor[1]) < 0.01, id);
      const bounds = motionExtent(channels);
      assert.ok(bounds.x > 2 && bounds.y > 2 && bounds.right < 1252 && bounds.bottom < 1252, id);
      const [x, y] = id === 'pose-sleep' ? [515, 865] : [rig.neck[0], rig.neck[1] - 150];
      values.push(deformPoint(x, y, channels));
    }
    assert.ok(
      values.some(([x, y]) => Math.hypot(x - values[0][0], y - values[0][1]) > 4),
      id,
    );
    const clock = new MusicAnimation();
    clock.sample(0, { active: true, frameId: id, tempo: 80, wallTime: 0 });
    const held = clock.sample(500, { active: true, frameId: id, tempo: 80, wallTime: 500 });
    const next = clock.sample(510, { active: true, frameId: id, tempo: 80, wallTime: 510 });
    assert.ok(held.channels, id);
    assert.equal(next.channels, held.channels, id);
    assert.equal(
      clock.sample(600, { active: true, reduced: true, frameId: id }).channels,
      null,
      id,
    );
  }
});

test('music drawings stay on twos while independent particles advance at the display clock', () => {
  const animation = new MusicAnimation();
  let last;
  for (let now = 0; now < 1200; now += 10) {
    const state = animation.sample(now, { active: true, frameId: 'music-window', strength: 0.8 });
    assert(Math.abs(state.angle) <= 1.08);
    assert.equal(state.dy, 0, 'A seat/ground contact never translates vertically');
    if (last && last.frame === state.frame) assert.equal(state.angle, last.angle);
    last = state;
  }
  const first = musicNoteParticles(2.01, 'music-window'),
    second = musicNoteParticles(2.02, 'music-window');
  assert.equal(first[0].index, second[0].index);
  assert.notEqual(
    first[0].y,
    second[0].y,
    'Notes use the smooth clock, not the drawing hold clock',
  );
});

test('notes originate alternately at registered headphones, stay bounded and reproduce deterministically', () => {
  for (const id of Object.keys(MUSIC_POSES))
    for (let time = 0; time < 50; time += 0.037) {
      const notes = musicNoteParticles(time, id);
      assert.deepEqual(notes, musicNoteParticles(time, id));
      assert(notes.length <= 7);
      for (const note of notes) {
        assert(note.x >= 0 && note.x <= 1254 && note.y >= 0 && note.y <= 1254);
        assert(note.alpha >= 0 && note.alpha <= 1);
        assert(note.size >= 45 && note.size <= 125);
        assert(note.rotation >= -0.4 && note.rotation <= 0.4);
        assert.equal(note.side, note.index % 2 ? 'right' : 'left');
        assert(note.spriteIndex >= 0 && note.spriteIndex < 4);
      }
    }
});

test('inactive music releases its visual envelope and reduced motion keeps a static registered drawing', () => {
  const animation = new MusicAnimation();
  for (let now = 0; now <= 1000; now += 16) animation.sample(now, { active: true });
  const reduced = animation.sample(1010, { active: true, reduced: true });
  assert.equal(reduced.angle, 0);
  assert.deepEqual(reduced.notes, []);
  assert.equal(reduced.active, true);
  let stopped;
  for (let now = 1020; now < 3500; now += 16) stopped = animation.sample(now, { active: false });
  assert.equal(stopped.active, false);
  assert.equal(stopped.angle, 0);
  assert.deepEqual(stopped.notes, []);
  assert.deepEqual(musicNoteParticles(Infinity, 'music-floor'), []);
  assert.deepEqual(musicNoteParticles(1, 'unknown'), []);
});

test('a long renderer suspension does not spawn an accumulated burst or reuse stale movement', () => {
  const animation = new MusicAnimation();
  animation.sample(0, { active: true });
  animation.sample(1000, { active: true });
  const resumed = animation.sample(60000, { active: true });
  assert.equal(resumed.frame, 0);
  assert.equal(resumed.angle, 0);
  assert.deepEqual(resumed.notes, []);
});

const epoch = 1_800_000_000_000;
function rhythm(now, tempo, extra = {}) {
  return {
    active: true,
    tempo,
    tempoConfidence: 1,
    wallTime: epoch + now,
    ...extra,
  };
}

test('measured music covers 40–240 BPM and a doubled tempo advances twice as many beats', () => {
  for (const tempo of [40, 60, 120, 180, 240]) {
    const animation = new MusicAnimation();
    let beats = 0,
      lastPhase = 0,
      lastState;
    for (let now = 0; now <= 12000; now += 20) {
      const state = animation.sample(now, rhythm(now, tempo));
      if (now) beats += (state.beatPhase - lastPhase + 1) % 1;
      lastPhase = state.beatPhase;
      assert(Math.abs(state.angle) <= 1.08);
      assert(state.notes.length <= 7);
      assert.equal(state.tempo, tempo);
      if (lastState?.frame === state.frame) assert.equal(state.angle, lastState.angle);
      lastState = state;
    }
    assert(Math.abs(beats - tempo / 5) < 1e-8, tempo + ' BPM clock keeps its rate');
  }
});

test('small live tempo changes preserve phase after a long listening session', () => {
  const steady = new MusicAnimation(),
    changing = new MusicAnimation();
  for (let now = 0; now <= 37100; now += 20) {
    steady.sample(now, rhythm(now, 120));
    changing.sample(now, rhythm(now, 120));
  }
  const before = steady.sample(37200, rhythm(37200, 120));
  const updated = changing.sample(37200, rhythm(37200, 121));
  assert.equal(updated.angle, before.angle, 'A rate update never rewrites elapsed phase');
  const first = steady.sample(37300, rhythm(37300, 120));
  const second = changing.sample(37300, rhythm(37300, 121));
  assert(Math.abs(first.angle - second.angle) < 0.02);
  assert(Math.abs(first.beatPhase - second.beatPhase) < 0.002);
});

test('shared beat anchors align separate renderer clocks with irregular frame intervals', () => {
  const framed = new MusicAnimation(),
    detached = new MusicAnimation();
  const anchored = (now) => rhythm(now, 120, { beatAt: epoch + Math.floor(now / 500) * 500 });
  for (let now = 0; now <= 15000; now += 20) framed.sample(now, anchored(now));
  let now = 333,
    index = 0;
  const intervals = [17, 63, 140, 31, 1000, 49];
  while (now < 15000) {
    detached.sample(now - 333, anchored(now));
    now = Math.min(15000, now + intervals[index++ % intervals.length]);
  }
  const first = framed.sample(15000, anchored(15000));
  const second = detached.sample(14667, anchored(15000));
  assert.equal(first.beatLocked, true);
  assert.equal(second.beatLocked, true);
  const phaseDifference = Math.abs(first.beatPhase - second.beatPhase);
  assert(Math.min(phaseDifference, 1 - phaseDifference) < 1e-9);
  assert(Math.abs(first.angle - second.angle) < 1e-6, 'Held drawings share the wall-clock phase');
});

test('phase correction is bounded and tempo changes preserve existing particle trajectories', () => {
  const animation = new MusicAnimation(),
    control = new MusicAnimation();
  for (let now = 0; now <= 1800; now += 20) {
    animation.sample(now, rhythm(now, 120));
    control.sample(now, rhythm(now, 120));
  }
  const changed = animation.sample(1900, rhythm(1900, 240, { beatAt: epoch + 1840 }));
  const steady = control.sample(1900, rhythm(1900, 120));
  assert.deepEqual(
    changed.notes.find((note) => note.index === 0),
    steady.notes.find((note) => note.index === 0),
  );
  let previousPhase = changed.beatPhase;
  for (let now = 1920; now <= 7000; now += 20) {
    const tempo = Math.floor(now / 100) % 2 ? 40 : 240;
    const value = animation.sample(now, rhythm(now, tempo, { beatAt: epoch + now - 80 }));
    const advance = (value.beatPhase - previousPhase + 1) % 1;
    assert(advance < 0.1, 'A new beat estimate cannot jump the visible phase');
    assert(value.notes.length <= 7);
    assert(Number.isFinite(value.angle));
    assert(Math.abs(value.angle) <= 1.08);
    previousPhase = value.beatPhase;
  }
});

test('missed compositor frames do not change which capped beat particles are born', () => {
  const fast = new MusicAnimation(),
    slow = new MusicAnimation();
  let first, second;
  for (let now = 0; now <= 12000; now += 20) first = fast.sample(now, rhythm(now, 240));
  for (let now = 0; now <= 12000; now += 1000) second = slow.sample(now, rhythm(now, 240));
  assert.deepEqual(
    first.notes.map((note) => note.index),
    second.notes.map((note) => note.index),
  );
  for (let index = 0; index < first.notes.length; index++)
    for (const key of ['x', 'y', 'progress'])
      assert(Math.abs(first.notes[index][key] - second.notes[index][key]) < 0.001);
});

test('unknown tempo remains calm without beat particles; stale or future anchors are ignored', () => {
  const unknown = new MusicAnimation();
  let state;
  for (let now = 0; now <= 12000; now += 20) {
    state = unknown.sample(now, rhythm(now, 0, { beatAt: epoch + now }));
    assert(Math.abs(state.angle) <= 0.1);
    assert.deepEqual(state.notes, []);
    assert.equal(state.beatLocked, false);
    assert.equal(state.beatPhase, null);
  }
  for (const beatAt of [epoch - 6000, epoch + 10000]) {
    const animation = new MusicAnimation();
    const value = animation.sample(0, rhythm(0, 120, { beatAt }));
    assert.equal(value.beatLocked, false);
    assert.equal(value.beatPhase, 0);
  }
  const uncertain = new MusicAnimation();
  assert.equal(uncertain.sample(0, rhythm(0, 120, { tempoConfidence: 0 })).beatPhase, null);
});

test('automatic BPM can be disabled without stopping notes or using the measured rhythm', () => {
  const slow = new MusicAnimation(),
    fast = new MusicAnimation(),
    unmeasured = new MusicAnimation();
  let a, b, c;
  for (let now = 0; now <= 8000; now += 16) {
    a = slow.sample(now, rhythm(now, 60, { autoBpm: false }));
    b = fast.sample(now, rhythm(now, 240, { autoBpm: false }));
    c = unmeasured.sample(now, rhythm(now, 0, { autoBpm: false }));
  }
  assert.ok(a.notes.length > 0);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(slow.targetBpm, 110);
  fast.sample(8016, rhythm(8016, 180, { autoBpm: true }));
  assert.equal(fast.targetBpm, 180);
});

test('anchor expiry and reacquisition keep the same 12 FPS hold clock', () => {
  const animation = new MusicAnimation();
  const wall = epoch + 37;
  const anchor = wall - 4950;
  const options = (now, beatAt) => rhythm(now, 120, { wallTime: wall + now, beatAt });
  const first = animation.sample(0, options(0, anchor));
  const expired = animation.sample(60, options(60, anchor));
  assert.equal(first.beatLocked, true);
  assert.equal(expired.beatLocked, false);
  assert.equal(expired.frame, Math.floor((wall + 60) / (1000 / 12)));
  const acquired = animation.sample(70, options(70, wall + 30));
  assert.equal(acquired.beatLocked, true);
  assert.equal(acquired.frame, expired.frame);
  assert.equal(acquired.angle, expired.angle);
});

test('reduced motion and a suspended renderer restart without old notes or a phase jump', () => {
  const animation = new MusicAnimation();
  for (let now = 0; now <= 1500; now += 20) animation.sample(now, rhythm(now, 120));
  assert(animation.sample(1600, rhythm(1600, 120)).notes.length > 0);
  const reduced = animation.sample(1620, rhythm(1620, 120, { reduced: true }));
  assert.equal(reduced.angle, 0);
  assert.deepEqual(reduced.notes, []);
  const resumed = animation.sample(1640, rhythm(1640, 120, { beatAt: epoch + 1500 }));
  assert.equal(resumed.angle, 0);
  assert.deepEqual(resumed.notes, []);
  const suspended = animation.sample(12000, rhythm(12000, 120, { beatAt: epoch + 11800 }));
  assert.equal(suspended.angle, 0);
  assert.deepEqual(suspended.notes, []);
});

test('facial landmarks and native body regions follow both registered music poses', () => {
  for (const [id, [x, y], chest] of [
    ['music-window', [639, 375], [630, 515]],
    ['music-floor', [645, 615], [655, 780]],
  ]) {
    const face = avatarPoseLandmarks(id);
    assert(face && Math.abs(face.mouth[2]) < 0.6);
    assert(face.mouth[1] > face.face[1]);
    assert.equal(
      avatarBodyPartAt(x / 1254, y / 1254, () => true, { poseId: id }),
      'head',
    );
    assert.equal(
      avatarBodyPartAt(chest[0] / 1254, chest[1] / 1254, () => true, { poseId: id }),
      'chest',
    );
    assert.equal(
      avatarBodyPartAt(x / 1254, y / 1254, () => false, { poseId: id }),
      null,
    );
  }
});

test('body texture uploads are independent of note motion and only rotate the complete image rigidly', () => {
  const previous = globalThis.document,
    calls = [];
  const painter = Object.fromEntries(
    ['resetTransform', 'clearRect', 'save', 'translate', 'rotate', 'drawImage', 'restore'].map(
      (method) => [method, (...args) => calls.push([method, ...args])],
    ),
  );
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => painter }),
  };
  try {
    const layer = new MusicPoseLayer(),
      source = { avatarTextureRevision: 1 };
    const state = {
      active: true,
      frameId: 'music-window',
      frame: 12,
      angle: 0.9,
      dy: 0,
      notes: [],
    };
    const first = layer.image(source, state),
      revision = first.avatarTextureRevision;
    assert.equal(
      layer.image(source, { ...state, notes: musicNoteParticles(2, state.frameId) }),
      first,
    );
    assert.equal(first.avatarTextureRevision, revision);
    assert.equal(calls.filter(([method]) => method === 'drawImage').length, 1);
    assert(!calls.some(([method]) => method === 'scale'), 'No part of Capri stretches');
    assert.deepEqual(
      calls.filter(([method]) => method === 'translate'),
      [
        ['translate', 628, 771],
        ['translate', -628, -771],
      ],
    );
    assert.equal(layer.image(source, { ...state, active: false }), source);
  } finally {
    globalThis.document = previous;
  }
});

test('detached music state is a bounded allowlist and cannot forward arbitrary metadata', () => {
  const avatar = new AvatarDetach({ screen: {}, owner: {} }),
    calls = [];
  avatar.updateParked = async (...args) => {
    calls.push(args);
    return true;
  };
  const value = {
    enabled: true,
    hearingMusic: true,
    energy: 0.8,
    tempo: 110,
    notes: true,
    motion: true,
  };
  assert.equal(avatar.sendMusic({ ...value, privateMetadata: 'never-forwarded' }), true);
  assert.deepEqual(avatar.music, value);
  assert.equal(calls.length, 0, 'State is held while the desktop layer is absent');
  avatar.phase = 'detached';
  assert.equal(avatar.sendMusic(value), true);
  assert.deepEqual(calls, [['setMusic', value]]);
  for (const change of [{ energy: NaN }, { energy: 2 }, { tempo: 241 }, { hearingMusic: 'true' }])
    assert.equal(avatar.sendMusic({ ...value, ...change }), false);
  assert.equal(calls.length, 1);
  const measured = { ...value, tempo: 240, tempoConfidence: 0.8, beatAt: epoch };
  assert.equal(avatar.sendMusic(measured), true);
  assert.deepEqual(avatar.music, measured);
  assert.equal(avatar.sendMusic({ ...measured, autoBpm: false }), true);
  assert.equal(avatar.music.autoBpm, false);
  assert.equal(avatar.sendMusic({ ...measured, autoBpm: 'yes' }), false);
  for (const change of [
    { tempo: 39 },
    { tempoConfidence: NaN },
    { tempoConfidence: 2 },
    { beatAt: -1 },
  ])
    assert.equal(avatar.sendMusic({ ...measured, ...change }), false);
});

test('switching a detached avatar to music preserves contact, focal bounds and registered body hitboxes', async () => {
  for (const [id, anchor, visibleBounds] of [
    ['music-window', { x: 628, y: 771, name: 'seat' }, { x: 194, y: 76, width: 889, height: 1090 }],
    [
      'music-floor',
      { x: 641, y: 1164, name: 'ground' },
      { x: 199, y: 296, width: 883, height: 871 },
    ],
  ]) {
    const avatar = new AvatarDetach({ screen: {}, owner: {} });
    avatar.phase = 'detached';
    avatar.session = {
      point: { x: 300, y: 600, scale: 500 },
      area: { x: 0, y: 0, width: 1200, height: 900 },
      anchor: { x: 0.5, y: 0.9 },
    };
    avatar.updateParked = async () => true;
    avatar.watchPoseMotion = () => {};
    const frame = {
      id,
      url: `capri://desktop/sprites/${id}.png`,
      kind: 'reviewed_music',
      anchor,
      visibleBounds,
    };
    const mask = { alpha: new Uint8Array([255]), imageSize: { width: 1, height: 1 } };
    assert.equal(
      await avatar.updateFrame(frame, { width: 1254, height: 1254 }, mask, { x: 500, y: 700 }),
      true,
    );
    assert.equal(avatar.session.mask.poseId, id);
    assert.deepEqual(avatar.session.mask.visibleBounds, visibleBounds);
    assert(avatar.session.point.focus && Number.isFinite(avatar.session.point.focus.y));
    assert.equal(avatar.session.anchor.x, anchor.x / 1254);
    assert.equal(avatar.session.dock, anchor.name);
  }
});
