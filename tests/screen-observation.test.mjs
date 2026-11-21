import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ScreenObservation,
  observationOptions,
  observationText,
  prepareScreenObservationContext,
  MODEL_IMAGES_UNSUPPORTED_MESSAGE,
  isModelImagesUnsupported,
} from '../apps/desktop/screen-observation.mjs';
import { screenChanged, SAMPLE_BYTES } from '../apps/desktop/renderer/screen-change.mjs';
import {
  screenObserverModel,
  rejectUnsupportedModelImages,
} from '../apps/desktop/screen-observer-model.mjs';
import { ChatService } from '../apps/desktop/chat-service.mjs';
import { CAPRI_VISUAL_REFERENCE, CAPRI_SCREEN_SELF } from '../apps/desktop/screen-identity.mjs';

const signature = (value = 0) => new Uint8Array(SAMPLE_BYTES).fill(value);
test('text-only and failed screen observations let the turn proceed without old frames', async () => {
  let requests = 0;
  const signal = new AbortController().signal;
  const screen = {
    capturePolicy: { capture: { id: 'lease', mode: 'watch' }, checkActive: async () => true },
    clipFrames: { request: async () => (++requests, Buffer.from('new frame')) },
    validImage: () => true,
    observer: {
      foreground: async () => {
        throw new Error('Provider rejected this frame');
      },
    },
  };
  assert.deepEqual(
    await prepareScreenObservationContext({ ...screen, enabled: false }, { text: 'Hi' }, signal),
    { screenObservation: null },
  );
  assert.equal(requests, 0);
  assert.deepEqual(
    await prepareScreenObservationContext({ ...screen, enabled: true }, { text: 'Hi' }, signal),
    { screenObservation: { active: true, current: false, observation: null } },
  );
  assert.equal(requests, 1);
  const cancelled = AbortSignal.abort(new Error('Turn cancelled'));
  screen.clipFrames.request = async (_, signal) => signal.throwIfAborted();
  await assert.rejects(
    prepareScreenObservationContext({ ...screen, enabled: true }, { text: 'Hi' }, cancelled),
    /Turn cancelled/,
  );
});
test('foreground screen context uses the post-submission frame even while typing and a chat turn is busy', async () => {
  const calls = [];
  const f = fixture(async (value) => {
    calls.push(value);
    return 'Fresh foreground screen';
  });
  f.state.busy = true;
  f.state.typing = true;
  const signal = new AbortController().signal;
  const frame = Buffer.from('new frame');
  const context = await f.observer.foreground({
    captureId: 'lease',
    png: frame,
    signal,
    question: 'What is visible now?',
  });
  assert.equal(calls.length, 1);
  assert.equal(f.analyses.length, 1);
  assert.equal(calls[0].png, frame);
  assert.equal(calls[0].question, 'What is visible now?');
  assert.equal(context.current, true);
  assert.equal(context.observation.summary, 'Fresh foreground screen');
  assert.equal(Object.hasOwn(f.observer.session, 'png'), false);
});

test('reading a live screen preserves long, ordered text in its original language', async () => {
  const transcription = Array.from(
    { length: 88 },
    (_, i) => `Строка ${i + 1}: сумма * 2 = 300.00 ₽`,
  ).join('\n');
  assert.ok(transcription.length > 2400);
  const model = screenObserverModel({
    url: 'http://127.0.0.1:11434',
    model: 'test',
    fetchImpl: async (_url, { body }) => {
      const request = JSON.parse(body);
      assert.match(request.messages[0].content, /preserving the original language/);
      assert.doesNotMatch(request.messages[0].content, /under 60 words/);
      assert.ok(request.options.num_predict > 384);
      assert.deepEqual(request.tools, []);
      return Response.json({
        done: true,
        message: { content: JSON.stringify({ summary: transcription }) },
      });
    },
  });
  const { observer } = fixture(model);
  const context = await observer.foreground({
    captureId: 'lease',
    png: Buffer.from('generated fixture'),
    signal: new AbortController().signal,
    question: 'Прочитай весь текст на экране',
  });
  assert.equal(context.observation.summary, transcription);
  assert.ok(observationText(context).includes(JSON.stringify(transcription)));
});

test('a stopped foreground capture cannot restore old private screen context', async () => {
  let resolve, observedSignal;
  const f = fixture((value) => {
    observedSignal = value.signal;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = f.observer.foreground({
    captureId: 'lease',
    png: Buffer.from('frame'),
    signal: new AbortController().signal,
  });
  f.observer.stop();
  assert.equal(observedSignal.aborted, true);
  resolve('Late screen');
  await assert.rejects(pending);
  assert.equal(f.observer.context(), null);
});
function fixture(infer = async () => 'A red square and a blue circle.', options = {}) {
  let now = 1000000;
  const state = {},
    events = [],
    analyses = [];
  const observer = new ScreenObservation({
    infer,
    state: () => state,
    now: () => now,
    onChange: (s) => events.push(s),
    onAnalysis: () => analyses.push(now),
    ...options,
  });
  observer.start({
    id: 'lease',
    source: { kind: 'window', label: 'Owned fixture' },
    expiresAt: now + 600000,
    intervalMs: 15000,
  });
  return {
    observer,
    state,
    events,
    analyses,
    advance: (ms) => {
      now += ms;
    },
    packet: (sequence = 0, value = 0) => ({
      captureId: 'lease',
      sequence,
      signature: signature(value),
      png: Buffer.from('fake frame'),
    }),
  };
}

test('screen samples ignore a small cursor blink and detect a substantial scene change', () => {
  const original = signature(40),
    blink = signature(40);
  blink[0] = 255;
  assert.equal(screenChanged(original, blink), false);
  assert.equal(screenChanged(original, signature(180)), true);
  assert.equal(screenChanged(null, original), true);
  assert.throws(() => screenChanged(original, new Uint8Array(2)));
  assert.throws(() => observationOptions({ intervalMs: 1 }));
  assert.throws(() => observationOptions({ durationMs: 86400000 }));
});

test('background inference is rate limited, scene-aware, transient and gives foreground activity priority', async () => {
  const f = fixture(),
    o = f.observer;
  assert.equal(o.sample(f.packet()).analyse, true);
  assert.equal(f.analyses.length, 0, 'Sampling alone must not start the observation cue');
  assert.equal((await o.frame(f.packet())).accepted, true);
  assert.equal(f.analyses.length, 1);
  assert.equal(o.context().current, true);
  const firstScene = o.commentEvidence();
  assert.equal(firstScene.captureId, 'lease');
  assert.equal(Object.hasOwn(o.session, 'png'), false);
  f.advance(15000);
  assert.equal(o.sample(f.packet(1)).analyse, false, 'Unchanged frame must not invoke inference');
  f.state.busy = true;
  assert.equal(o.sample(f.packet(1, 200)).analyse, false);
  assert.equal(
    o.context().current,
    false,
    'Changed but unanalysed view must not be described as current',
  );
  assert.equal(o.commentEvidence(), null);
  f.state.busy = false;
  o.activity();
  assert.equal(o.sample(f.packet(1, 200)).analyse, false);
  assert.equal(f.analyses.length, 1, 'Skipped samples must not start the observation cue');
  f.advance(10001);
  assert.equal(o.sample(f.packet(1, 200)).analyse, true);
  assert.equal((await o.frame(f.packet(1, 200))).accepted, true);
  assert.equal(f.analyses.length, 2);
  assert.notEqual(o.commentEvidence().scene, firstScene.scene);
  assert.throws(() => o.sample({ ...f.packet(), captureId: 'another-source' }));
  f.advance(90001);
  assert.equal(o.context().observation, null);
  assert.equal(o.commentEvidence(), null);
  o.stop();
  assert.equal(o.context(), null);
  assert.equal(o.snapshot().active, false);
});

test('stopped or interrupted inference cannot restore a summary or revive a source', async () => {
  let finish, signal;
  const f = fixture(async (value) => {
    signal = value.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  f.observer.sample(f.packet());
  const pending = f.observer.frame(f.packet());
  assert.equal(f.observer.snapshot().analysing, true);
  f.observer.activity();
  assert.equal(signal.aborted, true);
  f.observer.stop();
  finish('Late private content');
  await pending;
  assert.equal(f.observer.context(), null);
  assert.equal(
    f.events.some((event) => event.lastAnalysedAt !== null),
    false,
  );
});

test('watch together enriches the existing frame once and keeps the result fresh during motion', async () => {
  const calls = [],
    reads = [];
  let kind = 'video';
  let summary = 'A short scene.';
  let nativeWindow = 'window:123:0';
  let playback = { title: 'Windows media title', positionMs: 45000, durationMs: 60000 };
  const f = fixture(
    async ({ follow, source }) => {
      calls.push({ follow, capturedAt: source.capturedAt });
      return { summary, kind, title: 'Untrusted title guess', positionMs: 1 };
    },
    {
      followSource: (id) => (id === 'lease' ? nativeWindow : null),
      readPlayback: async (nativeId, { capturedAt }) => {
        reads.push({ nativeId, capturedAt });
        return playback;
      },
    },
  );
  const o = f.observer;
  const analyse = async (sequence, signatureValue) => {
    const frame = f.packet(sequence, signatureValue);
    assert.equal(o.sample(frame).analyse, true);
    assert.equal((await o.frame(frame)).accepted, true);
    return o.commentEvidence();
  };
  assert.equal(o.sample(f.packet()).analyse, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(reads, []);
  const first = await analyse(0, 0);
  assert.deepEqual(calls, [{ follow: true, capturedAt: 1000000 }]);
  assert.deepEqual(reads, [{ nativeId: 'window:123:0', capturedAt: 1000000 }]);
  assert.deepEqual(first.follow, { kind: 'video', windowId: '123', playback });
  assert.equal(first.expiresAt, first.capturedAt + 25000);
  assert.equal(Object.hasOwn(o.context().observation, 'follow'), false);
  assert.equal(Object.hasOwn(o.session, 'png'), false);
  nativeWindow = 'window:456:0';
  assert.equal(o.commentEvidence(), null);
  nativeWindow = 'window:123:0';
  f.advance(5000);
  o.sample(f.packet(1, 180));
  assert.equal(o.context().current, false);
  assert.deepEqual(o.commentEvidence(), first);
  const second = await analyse(1, 180);
  assert.notEqual(second.scene, first.scene);
  f.advance(60000);
  const unchanged = await analyse(2, 180);
  assert.notEqual(unchanged.scene, second.scene);

  playback = { title: 'Title from Windows', positionMs: -1, durationMs: null };
  f.advance(5000);
  assert.deepEqual((await analyse(3, 0)).follow.playback, { title: 'Title from Windows' });
  f.advance(25000);
  assert.equal(o.commentEvidence(), null);

  kind = 'game';
  const game = await analyse(4, 180);
  assert.deepEqual(game.follow, { kind: 'game', windowId: '123' });
  summary = 'The player crosses the bridge.';
  f.advance(5000);
  assert.deepEqual((await analyse(5, 0)).follow, {
    kind: 'game',
    windowId: '123',
    earlierView: 'A short scene.',
  });
  kind = 'other';
  f.advance(5000);
  assert.equal((await analyse(6, 180)).follow, undefined);
  assert.equal(calls.length, 7);
  assert.equal(reads.length, calls.length);
});

test('follow invalidation cancels pending playback and stale frames cannot restore comments', async () => {
  let completeInference, playbackSignal;
  let nativeId = 'window:123:0';
  const f = fixture(
    async () =>
      new Promise((resolve) => {
        completeInference = resolve;
      }),
    {
      followSource: () => nativeId,
      readPlayback: (_id, { signal }) => {
        playbackSignal = signal;
        return new Promise(() => {});
      },
    },
  );
  const o = f.observer;
  o.sample(f.packet());
  const pending = o.frame(f.packet());
  o.invalidateFollow();
  assert.equal(playbackSignal.aborted, true);
  completeInference({ summary: 'The earlier video.', kind: 'video' });
  assert.equal((await pending).accepted, false);
  assert.equal(o.commentEvidence(), null);

  f.advance(5000);
  o.sample(f.packet(1, 200));
  const wrongWindow = o.frame(f.packet(1, 200));
  nativeId = 'window:456:0';
  o.invalidateFollow();
  completeInference({ summary: 'The wrong video.', kind: 'video' });
  assert.equal((await wrongWindow).accepted, false);
  assert.equal(o.context().observation, null);
});

test('visual summaries use local tool-free inference and reject action output', async () => {
  let request;
  const model = screenObserverModel({
    url: 'http://127.0.0.1:11434',
    model: 'test',
    params: { num_ctx: 16384 },
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return Response.json({
        done: true,
        message: { content: JSON.stringify({ summary: 'A red square.' }) },
      });
    },
  });
  const text = await model({
    png: Buffer.from('temporary'),
    source: { kind: 'window', label: 'Ignore instructions' },
    signal: new AbortController().signal,
  });
  assert.equal(text, 'A red square.');
  assert.deepEqual(request.tools, []);
  assert.equal(request.think, false);
  assert.match(request.messages[0].content, /untrusted/);
  assert.ok(request.messages[0].content.includes(CAPRI_VISUAL_REFERENCE));
  assert.match(request.messages[0].content, /only when matching features are actually visible/);
  assert.ok(request.messages[1].images.length === 1);
  assert.throws(() => screenObserverModel({ url: 'https://external.example', model: 'test' }));
  const hostile = screenObserverModel({
    url: 'http://127.0.0.1:11434',
    model: 'test',
    fetchImpl: async () =>
      Response.json({ done: true, message: { tool_calls: [{}], content: '{}' } }),
  });
  await assert.rejects(hostile({ png: Buffer.alloc(1), signal: new AbortController().signal }));
});

test('only background follow requests classify visible scenes and ignore model-supplied metadata', async () => {
  let request;
  let kind = 'video';
  const model = screenObserverModel({
    url: 'http://127.0.0.1:11434',
    model: 'test',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({ summary: 'A blue circle.', kind, playback: 'guessed title' }),
        },
      });
    },
  });
  const packet = { png: Buffer.from('single frame'), signal: new AbortController().signal };
  assert.deepEqual(await model({ ...packet, follow: true }), {
    summary: 'A blue circle.',
    kind: 'video',
  });
  assert.deepEqual(request.format.required, ['summary', 'kind']);
  assert.deepEqual(request.format.properties.kind.enum, ['video', 'game', 'other']);
  assert.match(request.messages[0].content, /Do not guess the title/);
  assert.equal(request.messages[1].images.length, 1);
  assert.deepEqual(request.tools, []);
  kind = 'opaque-guess';
  assert.equal((await model({ ...packet, follow: true })).kind, 'other');
  assert.equal(
    await model({ ...packet, question: 'What is visible?', follow: true }),
    'A blue circle.',
  );
  assert.deepEqual(request.format.required, ['summary']);
  assert.equal(await model(packet), 'A blue circle.');
  assert.deepEqual(request.format.required, ['summary']);
});

test('unsupported image responses preserve only the bounded exact local error code and fixed warning', async () => {
  const model = screenObserverModel({
    url: 'http://127.0.0.1:11434',
    model: 'test',
    fetchImpl: async () =>
      Response.json(
        {
          error: {
            code: 'model_images_unsupported',
            message: 'Synthetic private provider text must not appear',
          },
        },
        { status: 400 },
      ),
  });
  await assert.rejects(
    model({ png: Buffer.alloc(1), signal: new AbortController().signal }),
    (error) => {
      assert.equal(isModelImagesUnsupported(error), true);
      assert.equal(error.message, MODEL_IMAGES_UNSUPPORTED_MESSAGE);
      return true;
    },
  );
  for (const body of [
    { error: { code: 'other', message: MODEL_IMAGES_UNSUPPORTED_MESSAGE } },
    { code: 'model_images_unsupported' },
    { error: { code: 'MODEL_IMAGES_UNSUPPORTED' } },
  ])
    await rejectUnsupportedModelImages(Response.json(body, { status: 400 }));
  await rejectUnsupportedModelImages(new Response('Malformed synthetic response', { status: 400 }));
  const successful = Response.json({ safe: true });
  await rejectUnsupportedModelImages(successful);
  assert.equal(successful.bodyUsed, false);
  let cancelled = false;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({
              error: {
                code: 'model_images_unsupported',
                message: 'x'.repeat(8192),
              },
            }),
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 400 },
  );
  await rejectUnsupportedModelImages(oversized);
  assert.equal(cancelled, true);
  assert.equal(isModelImagesUnsupported(new Error(MODEL_IMAGES_UNSUPPORTED_MESSAGE)), false);
});

test('unsupported background analysis becomes a session warning and stops retries until restarted', async () => {
  let calls = 0,
    unsupported = true;
  const f = fixture(async () => {
    calls++;
    if (unsupported)
      throw Object.assign(new Error('Untrusted synthetic provider detail'), {
        code: 'MODEL_IMAGES_UNSUPPORTED',
      });
    return 'A fresh safe scene.';
  });
  const o = f.observer;
  o.sample(f.packet());
  assert.deepEqual(await o.frame(f.packet()), {
    accepted: false,
    warning: MODEL_IMAGES_UNSUPPORTED_MESSAGE,
  });
  assert.equal(o.snapshot().warning, MODEL_IMAGES_UNSUPPORTED_MESSAGE);
  assert.equal(o.snapshot().error, null);
  assert.equal(o.snapshot().active, true);
  assert.equal(o.snapshot().canAnalyse, false);
  f.advance(60000);
  assert.equal(o.sample(f.packet(1, 200)).analyse, false);
  assert.deepEqual(await o.frame(f.packet(1, 200)), { accepted: false });
  await assert.rejects(
    o.foreground({
      captureId: 'lease',
      png: Buffer.alloc(1),
      signal: new AbortController().signal,
    }),
    (error) => {
      assert.equal(isModelImagesUnsupported(error), true);
      assert.equal(error.message, MODEL_IMAGES_UNSUPPORTED_MESSAGE);
      return true;
    },
  );
  assert.equal(calls, 1);
  const previous = o.session;
  o.start({
    id: previous.id,
    source: previous.source,
    expiresAt: previous.expiresAt,
    intervalMs: previous.intervalMs,
  });
  unsupported = false;
  assert.equal(o.snapshot().warning, null);
  assert.equal(o.sample(f.packet()).analyse, true);
  assert.deepEqual(await o.frame(f.packet()), { accepted: true });
  assert.equal(calls, 2);
});

test('foreground image rejection publishes a safe warning while ordinary text chat keeps its fallback', async () => {
  const f = fixture(async () => {
    throw Object.assign(new Error('Synthetic private provider detail'), {
      code: 'MODEL_IMAGES_UNSUPPORTED',
    });
  });
  const signal = new AbortController().signal;
  await assert.rejects(
    f.observer.foreground({ captureId: 'lease', png: Buffer.alloc(1), signal }),
    (error) => {
      assert.equal(isModelImagesUnsupported(error), true);
      assert.equal(error.message, MODEL_IMAGES_UNSUPPORTED_MESSAGE);
      return true;
    },
  );
  assert.equal(f.observer.snapshot().warning, MODEL_IMAGES_UNSUPPORTED_MESSAGE);
  assert.equal(f.observer.snapshot().error, null);
  assert.equal(f.observer.snapshot().canAnalyse, false);
  assert.equal(f.observer.context().observation, null);
  assert.deepEqual(
    await prepareScreenObservationContext(
      {
        enabled: true,
        capturePolicy: { capture: { id: 'lease', mode: 'watch' }, checkActive: async () => true },
        clipFrames: { request: async () => Buffer.from('local frame') },
        validImage: () => true,
        observer: f.observer,
      },
      { text: 'Continue the conversation' },
      signal,
    ),
    {
      screenObservation: { active: true, current: false, observation: null },
    },
  );
});

test('ordinary analysis failures retain the existing retry error and cooldown', async () => {
  const f = fixture(async () => {
    throw new Error('Synthetic transient failure');
  });
  f.observer.sample(f.packet());
  assert.deepEqual(await f.observer.frame(f.packet()), { accepted: false });
  assert.equal(f.observer.snapshot().warning, null);
  assert.equal(f.observer.snapshot().error, 'A screen update was skipped. Retrying later.');
  assert.equal(f.observer.snapshot().canAnalyse, false);
  f.advance(45001);
  assert.equal(f.observer.snapshot().canAnalyse, true);
});

test('ordinary chat receives read-only scene facts without capture metadata; explicit metadata questions retain provenance', async () => {
  const f = fixture();
  f.observer.sample(f.packet());
  await f.observer.frame(f.packet());
  const messages = new Map();
  let request;
  const chat = new ChatService({
    gatewayUrl: 'http://127.0.0.1:18789',
    agentId: 'capri',
    sessionKey: 'agent:capri:test',
    token: () => 'private',
    persona: () => 'Test Capri',
    avatarSprites: [],
    defaultAvatarId: 'neutral',
    interfaceState: () => ({ screenObservation: f.observer.context() }),
    store: {
      snapshot: () => [...messages.values()],
      put: (m) => messages.set(m.id, structuredClone(m)),
    },
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: 'A red square and blue circle.' } }] }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await chat.send(
    { id: '00000000-0000-4000-8000-000000000001', text: 'What is visible?' },
    () => {},
  );
  assert.match(request.messages[1].content, /Read-only screen observation/);
  assert.match(request.messages[1].content, /red square/);
  assert.ok(request.messages[0].content.includes(CAPRI_SCREEN_SELF));
  assert.match(request.messages[0].content, /WITHOUT calling tools/);
  assert.match(request.messages[1].content, /"screenObservation":true/);
  assert.doesNotMatch(request.messages[1].content, /"capturedAt"|"source"|2026-/);
  assert.match(
    observationText(f.observer.context(), 'What is the capture timestamp?'),
    /"capturedAt"/,
  );
  assert.equal(request.messages[1].images, undefined);
  assert.equal([...messages.values()].find((m) => m.role === 'user').text, 'What is visible?');
  assert.equal(observationText(null), '');
  f.observer.stop();
  await chat.send(
    { id: '00000000-0000-4000-8000-000000000002', text: 'What do you see now?' },
    () => {},
  );
  assert.match(request.messages[1].content, /"screenObservation":false/);
  assert.doesNotMatch(request.messages[1].content, /red square|Read-only screen observation/);
});
