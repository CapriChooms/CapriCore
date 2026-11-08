// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicAudioCapture } from '../apps/desktop/music-audio-capture.mjs';
import {
  MUSIC_LISTENING_DEFAULTS,
  validateMusicListeningSettings,
} from '../apps/desktop/music-listening-settings.mjs';

function fixture() {
  const state = { id: 'music-owner-session', available: true, now: 10, granted: [] };
  const owner = { url: 'capri://desktop/index.html' };
  const gate = new MusicAudioCapture({
    ownerFrame: () => owner,
    sessionId: () => state.id,
    available: () => state.available,
    now: () => state.now,
    enableCapture: (id) => {
      state.granted.push(id);
      return true;
    },
  });
  const request = {
    audioRequested: true,
    videoRequested: true,
    userGesture: true,
    frame: owner,
    securityOrigin: 'capri://desktop',
  };
  return { state, owner, gate, request };
}

test('music permissions are independent of microphone sessions and consume only one explicit owner grant', () => {
  const f = fixture(),
    answers = [];
  assert.equal(
    f.gate.consume(f.request, (answer) => answers.push(answer)),
    false,
  );
  f.gate.prepare(f.state.id, f.owner);
  assert.equal(f.gate.armed(), true);
  assert.equal(
    f.gate.consume(f.request, (answer) => answers.push(answer)),
    true,
  );
  assert.deepEqual(answers, [{ video: f.owner, audio: 'loopback' }]);
  assert.deepEqual(f.state.granted, [f.state.id]);
  assert.equal(f.gate.armed(), false);
  assert.equal(
    f.gate.consume(f.request, () => assert.fail('No reused grant')),
    false,
  );
});

test('foreign frames, missing gestures and origin lookalikes never receive loopback permission', () => {
  for (const changed of [
    { frame: { url: 'capri://desktop/index.html' } },
    { securityOrigin: 'capri://desktop.evil' },
    { securityOrigin: 'https://example.test' },
    { userGesture: false },
    { videoRequested: false },
  ]) {
    const f = fixture();
    f.gate.prepare(f.state.id, f.owner);
    let answer;
    assert.equal(
      f.gate.consume({ ...f.request, ...changed }, (value) => {
        answer = value;
      }),
      true,
    );
    assert.deepEqual(answer, {});
    assert.deepEqual(f.state.granted, []);
  }
});

test('music grants expire, stop on session generation or settings revocation and require the exact owner URL', () => {
  for (const change of [
    (f) => {
      f.state.now += 5000;
    },
    (f) => {
      f.state.id = 'replacement';
    },
    (f) => {
      f.state.available = false;
    },
    (f) => {
      f.owner.url = 'capri://desktop/settings.html';
    },
  ]) {
    const f = fixture();
    f.gate.prepare(f.state.id, f.owner);
    change(f);
    assert.equal(f.gate.armed(), false);
    let answer;
    f.gate.consume(f.request, (value) => {
      answer = value;
    });
    assert.deepEqual(answer, {});
    assert.deepEqual(f.state.granted, []);
  }
  const f = fixture();
  assert.throws(() => f.gate.prepare('other', f.owner), /active Capri/);
  assert.throws(() => f.gate.prepare(f.state.id, { url: f.owner.url }), /active Capri/);
});

test('cancel and revoke do not enable another session or silently accept a denied host commit', () => {
  const f = fixture();
  f.gate.prepare(f.state.id, f.owner);
  assert.equal(f.gate.cancel('wrong', f.owner), false);
  assert.equal(f.gate.cancel(f.state.id, f.owner), true);
  assert.equal(f.gate.armed(), false);
  f.gate.prepare(f.state.id, f.owner);
  f.gate.revoke();
  assert.equal(f.gate.armed(), false);
  f.gate.prepare(f.state.id, f.owner);
  f.gate.enableCapture = () => false;
  let answer;
  f.gate.consume(f.request, (value) => {
    answer = value;
  });
  assert.deepEqual(answer, {});
  assert.equal(f.gate.armed(), false);
  f.gate.prepare(f.state.id, f.owner);
  f.gate.enableCapture = () => {
    throw Error('The session was revoked during commit.');
  };
  f.gate.consume(f.request, (value) => {
    answer = value;
  });
  assert.deepEqual(answer, {});
  assert.equal(f.gate.armed(), false);
});

test('music preferences default off and cannot persist a capture grant, PCM or microphone selection', () => {
  assert.deepEqual(validateMusicListeningSettings(), {
    enabled: false,
    notes: true,
    motion: true,
    autoBpm: true,
  });
  assert.deepEqual(validateMusicListeningSettings({ enabled: true, notes: false, motion: true }), {
    enabled: true,
    notes: false,
    motion: true,
    autoBpm: true,
  });
  assert.equal(
    validateMusicListeningSettings({ ...MUSIC_LISTENING_DEFAULTS, autoBpm: false }).autoBpm,
    false,
  );
  for (const value of [
    null,
    [],
    {},
    { ...MUSIC_LISTENING_DEFAULTS, enabled: 'yes' },
    { ...MUSIC_LISTENING_DEFAULTS, autoBpm: 'yes' },
    { ...MUSIC_LISTENING_DEFAULTS, autoBpm: undefined },
    { ...MUSIC_LISTENING_DEFAULTS, autoBpm: null },
    { ...MUSIC_LISTENING_DEFAULTS, sessionId: 'forged' },
    { ...MUSIC_LISTENING_DEFAULTS, pcm: [] },
  ])
    assert.throws(() => validateMusicListeningSettings(value), /Invalid music/);
});
