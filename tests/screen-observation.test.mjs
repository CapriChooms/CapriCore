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
  assert.equal(calls[0].png, frame);
  assert.equal(calls[0].question, 'What is visible now?');
  assert.equal(context.current, true);
  assert.equal(context.observation.summary, 'Fresh foreground screen');
  assert.equal(Object.hasOwn(f.observer.session, 'png'), false);
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
function fixture(infer = async () => 'A red square and a blue circle.') {
  let now = 1000000;
  const state = {},
    events = [];
  const observer = new ScreenObservation({
    infer,
    state: () => state,
    now: () => now,
    onChange: (s) => events.push(s),
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
  assert.equal((await o.frame(f.packet())).accepted, true);
  assert.equal(o.context().current, true);
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
  f.state.busy = false;
  o.activity();
  assert.equal(o.sample(f.packet(1, 200)).analyse, false);
  f.advance(10001);
  assert.equal(o.sample(f.packet(1, 200)).analyse, true);
  assert.equal((await o.frame(f.packet(1, 200))).accepted, true);
  assert.throws(() => o.sample({ ...f.packet(), captureId: 'another-source' }));
  f.advance(90001);
  assert.equal(o.context().observation, null);
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
