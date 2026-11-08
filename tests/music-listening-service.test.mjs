// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { MusicDecision, MusicListeningService } from '../apps/desktop/music-listening-service.mjs';
import { MusicAnimation } from '../apps/desktop/renderer/music-animation.mjs';
import { musicAnimationReady } from '../apps/desktop/music-listening-settings.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const score = (music = 0.85, speech = 0.02, rms = 0.1) => ({ music, speech, rms });

test('music poses wait for the first reliable BPM, retain it through dropouts and reset between tracks', () => {
  const decision = new MusicDecision();
  const ready = () => musicAnimationReady({ enabled: true, ...decision });
  for (let i = 0; i < 6; i++) {
    decision.update(score());
    assert.equal(ready(), false);
  }
  assert.equal(
    decision.hearingMusic,
    true,
    'Music detection remains independent of animation readiness',
  );
  decision.update({ ...score(), tempo: 120, tempoConfidence: 0.44 });
  assert.equal(ready(), false);
  decision.update({ ...score(), tempo: 120, tempoConfidence: 0.45 });
  assert.equal(ready(), true);
  for (let i = 0; i < 10; i++) {
    decision.update(score());
    assert.equal(ready(), true, 'A missed BPM estimate keeps the established rhythm');
  }
  for (let i = 0; i < 3; i++) decision.update(score(0.01, 0, 0));
  assert.equal(ready(), false);
  for (let i = 0; i < 3; i++) decision.update(score());
  assert.equal(ready(), false, 'The next track must acquire its own BPM');
  for (const extra of [{ autoBpm: false }, { settings: { autoBpm: false } }])
    assert.equal(musicAnimationReady({ enabled: true, ...decision, ...extra }), false);
  for (const tempo of [0, NaN, Infinity, 39, 241])
    assert.equal(
      musicAnimationReady({ enabled: true, hearingMusic: true, tempo, tempoConfidence: 1 }),
      false,
    );
});
function fixture(t, options = {}) {
  const events = [],
    writes = [],
    spawns = [];
  let child;
  const settings = { enabled: true, notes: true, motion: true };
  const service = new MusicListeningService({
    root: process.cwd(),
    settings: () => settings,
    emit: (event) => events.push(event),
    prepare:
      options.prepare ?? (async () => ({ python: 'fixture-python.exe', folder: 'fixture-model' })),
    available: options.available ?? (() => true),
    ...(options.now ? { now: options.now } : {}),
    ...(options.staleMs ? { staleMs: options.staleMs } : {}),
    spawnImpl(...args) {
      spawns.push(args);
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(chunk, _encoding, done) {
          writes.push(chunk.toString());
          done();
        },
      });
      child.kill = () => {
        child.killed = true;
      };
      return child;
    },
  });
  t.after(() => service.stop());
  return {
    service,
    settings,
    events,
    writes,
    spawns,
    child: () => child,
    result(value) {
      child.stdout.write(JSON.stringify(value) + '\n');
    },
    packet(sessionId, sequence, extra = {}) {
      return service.packet({
        sessionId,
        sequence,
        pcm: new Float32Array(8000).fill(0.125),
        ...extra,
      });
    },
    async start() {
      const start = service.start();
      await tick();
      return start;
    },
  };
}

test('music classification enters and leaves after three consecutive scores, preserving mixed speech/music', () => {
  const state = new MusicDecision();
  assert.equal(state.update(score()), false);
  assert.equal(state.update(score()), false);
  assert.equal(state.update(score(0.85, 0.95)), true, 'Speech over music is still audible music');
  for (let n = 0; n < 5; n++)
    assert.equal(state.update(score(0.4)), true, 'Middle scores hold the established state');
  assert.equal(state.update(score(0.05, 0.96)), true);
  assert.equal(state.update(score(0.05, 0.96)), true);
  assert.equal(state.update(score(0.05, 0.96)), false);
  for (let n = 0; n < 5; n++)
    assert.equal(state.update(score(0.9, 0.02, 0)), false, 'Silence cannot enter listening');
  assert.throws(() => state.update(score(NaN)), /Invalid music/);
  state.reset();
  assert.equal(state.energy, 0);
});

test('cancelled preparation cannot spawn a worker or resurrect an old listening session', async (t) => {
  let resolvePreparation, signal;
  const f = fixture(t, {
    prepare: (_root, options) => {
      signal = options.signal;
      options.progress({ received: 12, total: 100, privatePath: 'not-a-public-field' });
      return new Promise((resolve) => {
        resolvePreparation = resolve;
      });
    },
  });
  const first = f.service.start();
  assert.equal(f.service.snapshot().phase, 'preparing');
  assert.deepEqual(f.service.snapshot().progress, { received: 12, total: 100 });
  f.service.stop(first.sessionId);
  assert.equal(signal.aborted, true);
  resolvePreparation({ python: 'must-not-start.exe', folder: 'private-fixture' });
  await tick();
  assert.equal(f.spawns.length, 0);
  assert.equal(f.service.snapshot().phase, 'off');
  assert(!JSON.stringify(f.events).includes('privatePath'));
});

test('capture and worker readiness are separate; private PCM travels only over bounded worker stdio', async (t) => {
  const f = fixture(t),
    start = await f.start();
  assert.equal(
    f.service.start().sessionId,
    start.sessionId,
    'Start is idempotent for one active grant',
  );
  assert.equal(f.spawns.length, 1);
  const [executable, args, options] = f.spawns[0];
  assert.equal(executable, 'fixture-python.exe');
  assert(args.includes('integrations.music_runtime.worker'));
  assert.equal(options.windowsHide, true);
  assert(
    Object.keys(options.env).every((key) =>
      /^(?:SystemRoot|WINDIR|PATH|TEMP|TMP|PYTHONUTF8|PYTHONIOENCODING|PYTHONDONTWRITEBYTECODE|OMP_NUM_THREADS|OPENBLAS_NUM_THREADS|MKL_NUM_THREADS)$/.test(
        key,
      ),
    ),
  );
  assert.deepEqual(f.packet(start.sessionId, 0), { accepted: false });
  f.result({ type: 'ready' });
  assert.equal(f.service.snapshot().phase, 'starting');
  assert.equal(f.service.ready('unrelated-session'), false);
  assert.equal(f.service.ready(start.sessionId), true);
  assert.equal(f.service.snapshot().phase, 'listening');
  assert.deepEqual(f.packet(start.sessionId, 1), { accepted: true });
  const submitted = JSON.parse(f.writes[0]);
  assert.deepEqual(Object.keys(submitted).sort(), ['pcm', 'sequence', 'sessionId', 'type']);
  assert.equal(Buffer.from(submitted.pcm, 'base64').byteLength, 32000);
  assert(
    !JSON.stringify(f.events).includes(submitted.pcm),
    'Audio never appears in status, progress or settings',
  );
  assert(!JSON.stringify(f.events).includes('fixture-model'));
  f.service.stop(start.sessionId);
  assert.equal(f.child().killed, true);
  assert.equal(f.child().stdin.destroyed, true);
  f.result({ type: 'ready' });
  assert.equal(f.service.snapshot().phase, 'off', 'Late worker output cannot reactivate capture');
});

test('packets enforce the active grant, exact size, approved fields and increasing sequence', async (t) => {
  const f = fixture(t),
    { sessionId } = await f.start();
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  assert.deepEqual(f.packet('old-session', 0), { accepted: false, stop: true });
  for (const extra of [
    { sequence: -1 },
    { sequence: 0.5 },
    { pcm: new Float32Array(7999) },
    { extra: 'not-allowed' },
  ])
    assert.throws(() => f.packet(sessionId, 0, extra), /Invalid music audio packet/);
  assert.deepEqual(f.packet(sessionId, 0), { accepted: true });
  assert.throws(() => f.packet(sessionId, 0), /Invalid music audio packet/);
  assert.equal(f.writes.length, 1);
});

test('only distinct submitted classification results can advance music hysteresis', async (t) => {
  const f = fixture(t),
    { sessionId } = await f.start();
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  for (let sequence = 0; sequence < 3; sequence++) {
    f.packet(sessionId, sequence);
    f.result({ type: 'classification', sessionId, sequence, ...score() });
  }
  assert.equal(f.service.snapshot().hearingMusic, true);
  f.result({ type: 'classification', sessionId, sequence: 2, ...score() });
  assert.equal(
    f.service.snapshot().phase,
    'error',
    'Duplicate classifications must not be counted twice',
  );
  assert.equal(f.service.snapshot().hearingMusic, false);
});

test('a classification must belong to the current submitted capture and a bounded score', async (t) => {
  for (const change of [
    { sessionId: 'unrelated-session' },
    { sequence: -1 },
    { sequence: 1 },
    { music: NaN },
    { speech: 2 },
  ]) {
    const f = fixture(t),
      { sessionId } = await f.start();
    f.result({ type: 'ready' });
    f.service.ready(sessionId);
    f.packet(sessionId, 0);
    f.result({ type: 'classification', sessionId, sequence: 0, ...score(), ...change });
    assert.equal(f.service.snapshot().phase, 'error');
    assert.equal(f.service.snapshot().hearingMusic, false);
  }
  const f = fixture(t),
    { sessionId } = await f.start();
  f.result({ type: 'classification', sessionId, sequence: 0, ...score() });
  assert.equal(
    f.service.snapshot().phase,
    'error',
    'Results before readiness never change music state',
  );
});

test('worker errors and oversized output expose a generic message without stderr, PCM or paths', async (t) => {
  for (const fail of [
    (f) => f.child().emit('error', Error('private-fixture-error-and-path')),
    (f) => f.child().stdout.write('x'.repeat(16385)),
    (f) => f.result({ type: 'error', code: 'private-fixture-error-and-path' }),
    (f) => f.child().stdout.write('{not JSON}\n'),
  ]) {
    const f = fixture(t);
    await f.start();
    f.child().stderr.write('private-fixture-error-and-path');
    fail(f);
    assert.equal(f.service.snapshot().phase, 'error');
    assert.equal(f.service.snapshot().enabled, false);
    assert(!JSON.stringify(f.events).includes('private-fixture-error-and-path'));
    assert.match(f.service.snapshot().error, /Enable it again/);
  }
});

test('an unavailable application never starts capture and loss of availability stops current packets', async (t) => {
  let available = false;
  const f = fixture(t, { available: () => available });
  assert.throws(() => f.service.start(), /could not start/);
  available = true;
  const { sessionId } = await f.start();
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  available = false;
  assert.deepEqual(f.packet(sessionId, 0), { accepted: false, stop: true });
  assert.equal(f.service.snapshot().phase, 'off');
});

test('only confident audible music acquires a BPM; continuous music holds it across uncertain packets', () => {
  const state = new MusicDecision();
  const rhythm = { ...score(), tempo: 120, tempoConfidence: 0.8, beatPhase: 0.25 };
  state.update(rhythm, 10000);
  state.update(rhythm, 11000);
  assert.equal(state.tempo, 0, 'A rhythm does not bypass music detection');
  state.update(rhythm, 12000);
  assert.equal(state.tempo, 120);
  assert.equal(state.tempoConfidence, 0.8);
  assert.equal(state.beatAt, 11875);
  state.update({ ...rhythm, tempoConfidence: 0.2 }, 13000);
  assert.equal(state.tempo, 120, 'An uncertain packet preserves the last reliable tempo');
  assert.equal(state.tempoConfidence, 0.8);
  state.update(score());
  assert.equal(state.beatAt, 11875, 'The held beat anchor is not replaced by an unknown packet');
  for (const change of [
    { tempo: 39 },
    { tempo: 241 },
    { tempo: NaN },
    { tempoConfidence: -1 },
    { tempoConfidence: 2 },
    { beatPhase: 1 },
    { beatPhase: -0.1 },
    { tempo: 0 },
  ])
    assert.throws(() => state.update({ ...rhythm, ...change }), /Invalid music tempo/);
});

test('held tempo keeps note births running during continuous music and resets after silence hysteresis', () => {
  const decision = new MusicDecision(),
    animation = new MusicAnimation();
  const epoch = 1_800_000_000_000;
  const rhythm = { ...score(), tempo: 120, tempoConfidence: 0.8, beatPhase: 0.25 };
  for (let index = 0; index < 3; index++) decision.update(rhythm, epoch);
  const beatAt = decision.beatAt;
  let visual;
  for (let now = 0; now <= 12000; now += 20) {
    if (now && now % 1000 === 0)
      decision.update(
        now % 2000 ? score(0.4) : { ...rhythm, tempo: 180, tempoConfidence: 0.1 },
        epoch + now,
      );
    visual = animation.sample(now, {
      active: musicAnimationReady({ enabled: true, ...decision }),
      tempo: decision.tempo,
      tempoConfidence: decision.tempoConfidence,
      beatAt: decision.beatAt,
      wallTime: epoch + now,
    });
  }
  assert.equal(decision.tempo, 120);
  assert.equal(decision.tempoConfidence, 0.8);
  assert.equal(decision.beatAt, beatAt);
  assert.ok(
    visual.notes.some((note) => note.index > 12),
    'Notes continue to be born after the anchor ages out.',
  );
  decision.update({ ...rhythm, tempo: 90, tempoConfidence: 0.7 }, epoch + 13000);
  assert.equal(decision.tempo, 90);
  assert.equal(decision.tempoConfidence, 0.7);
  assert.equal(decision.beatAt, epoch + 13000 - (60000 * 0.25) / 90);
  for (let index = 0; index < 2; index++) {
    decision.update(score(0.05, 0.02, 0), epoch + 14000 + index * 1000);
    assert.equal(decision.tempo, 90, 'Short dips keep the established music state.');
  }
  decision.update(score(0.05, 0.02, 0), epoch + 16000);
  assert.equal(decision.hearingMusic, false);
  assert.deepEqual([decision.tempo, decision.tempoConfidence, decision.beatAt], [0, 0, 0]);
  for (let index = 0; index < 3; index++) decision.update(score(), epoch + 17000 + index * 1000);
  assert.equal(decision.hearingMusic, true);
  assert.equal(
    decision.tempo,
    0,
    'Music without a reliable new beat never revives the previous song tempo.',
  );
});

test('service status preserves the last reliable tempo through dropouts but never across stop or new sessions', async (t) => {
  let now = 10000;
  const f = fixture(t, { now: () => now });
  let { sessionId } = await f.start();
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  for (let sequence = 0; sequence < 7; sequence++) {
    f.packet(sessionId, sequence, { capturedAt: now });
    f.result({
      type: 'classification',
      sessionId,
      sequence,
      ...score(),
      ...(sequence < 3 ? { tempo: 150, tempoConfidence: 0.9, beatPhase: 0.5 } : {}),
    });
    now += 1000;
  }
  const held = f.service.snapshot();
  assert.equal(held.hearingMusic, true);
  assert.equal(held.tempo, 150);
  assert.equal(held.tempoConfidence, 0.9);
  assert.equal(held.beatAt, 11800);
  assert.equal(held.settings.notes, true);
  f.service.stop(sessionId);
  assert.deepEqual([f.service.snapshot().tempo, f.service.snapshot().beatAt], [0, 0]);
  const next = await f.start();
  assert.notEqual(next.sessionId, sessionId);
  sessionId = next.sessionId;
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  for (let sequence = 0; sequence < 3; sequence++) {
    f.packet(sessionId, sequence, { capturedAt: now });
    f.result({ type: 'classification', sessionId, sequence, ...score() });
    now += 1000;
  }
  assert.equal(f.service.snapshot().hearingMusic, true);
  assert.deepEqual(
    [f.service.snapshot().tempo, f.service.snapshot().tempoConfidence, f.service.snapshot().beatAt],
    [0, 0, 0],
  );
});

test('the service carries capture timing to both music listeners without retaining audio in status', async (t) => {
  let now = 10000;
  const f = fixture(t, { now: () => now }),
    { sessionId } = await f.start();
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  for (let sequence = 0; sequence < 3; sequence++) {
    f.packet(sessionId, sequence, { capturedAt: now - 400 });
    f.result({
      type: 'classification',
      sessionId,
      sequence,
      ...score(),
      tempo: 150,
      tempoConfidence: 0.9,
      beatPhase: 0.5,
    });
    now += 1000;
  }
  const state = f.service.snapshot();
  assert.equal(state.tempo, 150);
  assert.equal(state.tempoConfidence, 0.9);
  assert.equal(state.beatAt, 11400);
  assert(!JSON.stringify(f.events).includes('beatPhase'));
  assert(!JSON.stringify(f.events).includes('capturedAt'));
  assert(!JSON.stringify(f.events).includes('pcm'));
  f.settings.enabled = false;
  assert.equal(f.service.snapshot().tempo, 0);
  assert.equal(f.service.snapshot().beatAt, 0);
});

test('capture gaps and late results cannot restore an obsolete beat', async (t) => {
  const f = fixture(t),
    { sessionId } = await f.start();
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  const rhythm = { ...score(), tempo: 120, tempoConfidence: 0.9, beatPhase: 0.2 };
  for (let sequence = 0; sequence < 3; sequence++) {
    f.packet(sessionId, sequence);
    f.result({ type: 'classification', sessionId, sequence, ...rhythm });
  }
  assert.equal(f.service.snapshot().tempo, 120);
  f.packet(sessionId, 3);
  f.packet(sessionId, 7);
  assert.equal(
    f.service.snapshot().tempo,
    0,
    'A dropped interval invalidates beat phase immediately',
  );
  f.result({ type: 'classification', sessionId, sequence: 3, ...rhythm });
  assert.equal(
    f.service.snapshot().tempo,
    0,
    'A queued result from before the gap cannot relock it',
  );
  f.result({ type: 'classification', sessionId, sequence: 7, ...score() });
  assert.equal(f.service.snapshot().phase, 'listening');
  assert.equal(f.service.snapshot().tempo, 0);
});

test('stale capture, stale classifications and stalled audio never leave a beat running forever', async (t) => {
  let now = 10000;
  const f = fixture(t, { now: () => now, staleMs: 60 }),
    { sessionId } = await f.start();
  f.result({ type: 'ready' });
  f.service.ready(sessionId);
  assert.deepEqual(f.packet(sessionId, 0, { capturedAt: now - 61 }), { accepted: false });
  assert.deepEqual(f.packet(sessionId, 1, { capturedAt: now + 1001 }), { accepted: false });
  for (let sequence = 2; sequence < 5; sequence++) {
    f.packet(sessionId, sequence, { capturedAt: now });
    f.result({
      type: 'classification',
      sessionId,
      sequence,
      ...score(),
      tempo: 90,
      tempoConfidence: 0.8,
      beatPhase: 0.1,
    });
  }
  assert.equal(f.service.snapshot().tempo, 90);
  f.packet(sessionId, 5, { capturedAt: now });
  now += 61;
  f.result({ type: 'classification', sessionId, sequence: 5, ...score() });
  assert.equal(f.service.snapshot().hearingMusic, false);
  assert.equal(f.service.snapshot().tempo, 0);
  for (let sequence = 6; sequence < 9; sequence++) {
    f.packet(sessionId, sequence, { capturedAt: now });
    f.result({
      type: 'classification',
      sessionId,
      sequence,
      ...score(),
      tempo: 90,
      tempoConfidence: 0.8,
      beatPhase: 0.1,
    });
  }
  assert.equal(f.service.snapshot().tempo, 90);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(f.service.snapshot().tempo, 0);
  assert.equal(f.service.snapshot().hearingMusic, false);
});
