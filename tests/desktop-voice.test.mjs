import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SentenceBuffer, VoiceService, spokenText } from '../apps/desktop/voice-service.mjs';
import { VoicePlayer } from '../apps/desktop/renderer/voice-player.mjs';
import { VOICE_EFFECT_PRESETS } from '../apps/desktop/renderer/voice-effects-settings.mjs';
import { speechLanguageMismatch } from '../apps/desktop/renderer/speech-text.mjs';
import { randomUUID } from 'node:crypto';
import { ChatService } from '../apps/desktop/chat-service.mjs';
import {
  configureResponseTimings,
  withResponseTiming,
} from '../packages/runtime/src/response-timing.mjs';

test('cold voice timings retain correlation after text completes and never contain reply or credentials', async () => {
  const records = [],
    id = randomUUID();
  configureResponseTimings({ write: (record) => records.push(record) });
  const { voice, events, requests } = service();
  try {
    voice.setReady(false);
    withResponseTiming(id, () => turn(voice, id, 'Private speech fixture.'));
    assert.equal(requests.length, 0);
    assert.equal(records.find((r) => r.stage === 'voice_queued').cold, 1);
    // Readiness arrives outside the chat callback's AsyncLocalStorage context.
    voice.setReady(true);
    await until(() => events.some((event) => event.type === 'voice.audio'));
    const stages = records.filter((r) => r.stage.startsWith('voice_'));
    assert.deepEqual(
      stages.map((r) => r.stage),
      ['voice_text', 'voice_queued', 'voice_synthesis', 'voice_audio'],
    );
    assert(stages.every((r) => r.traceId === id && r.source === 'desktop'));
    assert.equal(stages[2].speechCharacters, 23);
    assert(!JSON.stringify(stages).includes('Private speech'));
    assert(!JSON.stringify(stages).includes('authorization'));
    assert(!JSON.stringify(stages).includes('pcm'));
    // Later phrases must not overwrite the first-audio measurement.
    voice.onChat({ type: 'turn.delta', turnId: id, text: 'Second sentence. ' });
    voice.onChat({ type: 'turn.completed', turnId: id });
    await until(() => events.filter((event) => event.type === 'voice.audio').length === 2);
    assert.equal(records.filter((r) => r.stage === 'voice_audio').length, 1);
  } finally {
    voice.close();
    configureResponseTimings(undefined);
  }
});

test('turn cancellation while voice is loading never starts stale queued speech', async () => {
  const { voice, events, requests } = service();
  voice.setReady(false);
  turn(voice, 'stale', 'This turn was cancelled.');
  voice.cancel();
  voice.setReady(true);
  await delay(10);
  assert.equal(requests.length, 0);
  assert(!events.some((event) => event.type === 'voice.audio'));
});

test('a cold enabled voice starts on the first reply and drains it after text completion', async () => {
  const { voice, events, requests } = service();
  voice.setReady(false);
  let starts = 0,
    release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  voice.ensureReady = async () => {
    starts++;
    await ready;
    voice.setReady(true);
  };
  turn(voice, 'first', "Hi! I'm here.");
  await until(() => starts === 1);
  assert.equal(voice.turn.final, true);
  assert.equal(requests.length, 0);
  release();
  await until(() => events.some((event) => event.type === 'voice.generated'));
  assert.equal(requests.map(({ text }) => text).join(' '), "Hi! I'm here.");
  assert.ok(events.some((event) => event.type === 'voice.audio' && event.turnId === 'first'));
  turn(voice, 'warm', 'Ready.');
  await until(() =>
    events.some((event) => event.type === 'voice.generated' && event.turnId === 'warm'),
  );
  assert.equal(starts, 1);
});

test('muted and cancelled turns skip deferred startup and an unavailable voice clears its queue', async () => {
  const { voice, events, requests } = service();
  voice.setReady(false);
  let starts = 0;
  voice.ensureReady = async () => {
    starts++;
  };
  voice.setEnabled(false);
  turn(voice, 'muted', 'Keep this silent.');
  voice.setEnabled(true);
  turn(voice, 'cancelled', 'Cancel this one.');
  voice.cancel();
  await Promise.resolve();
  assert.equal(starts, 0);
  turn(voice, 'unavailable', 'Keep the text available.');
  await until(() => events.some((event) => event.type === 'voice.error'));
  assert.equal(starts, 1);
  assert.equal(voice.diagnostics().queuedSentences, 0);
  assert.equal(requests.length, 0);
  assert.ok(
    events.some((event) => event.type === 'voice.cancelled' && event.turnId === 'unavailable'),
  );
  voice.ensureReady = async () => voice.setReady(true);
  turn(voice, 'retry', 'Ready again.');
  await until(() =>
    events.some((event) => event.type === 'voice.audio' && event.turnId === 'retry'),
  );
});

test('call voice volume ramps existing output without restarting audio or changing the local output', () => {
  const player = new VoicePlayer({ onState() {}, onError() {} });
  assert.equal(player.callVoiceVolume, 50);
  const ramps = [],
    holds = [];
  const gain = {
    cancelAndHoldAtTime: (time) => holds.push(time),
    linearRampToValueAtTime: (value, time) => ramps.push([value, time]),
  };
  player.callOutput = { context: { state: 'running', currentTime: 3 }, voiceGain: { gain } };
  for (const value of [25, 0, 100]) player.setCallVoiceVolume(value);
  assert.deepEqual(holds, [3, 3, 3]);
  assert.deepEqual(ramps, [
    [0.25, 3.02],
    [0, 3.02],
    [1, 3.02],
  ]);
  assert.deepEqual(player.speakers, {});
  for (const value of [-1, 101, '50', null, NaN])
    assert.throws(() => player.setCallVoiceVolume(value), /Invalid/);
  assert.equal(player.callVoiceVolume, 100);
});

test('speaker volume ramps to silence independently of the call mix', () => {
  const player = new VoicePlayer({ onState() {}, onError: assert.fail });
  const ramps = [];
  player.speakers.context = { state: 'running', currentTime: 3 };
  player.speakers.voiceGain = {
    gain: {
      cancelAndHoldAtTime: (time) => assert.equal(time, 3),
      linearRampToValueAtTime: (value, time) => ramps.push([value, time]),
    },
  };
  player.callOutput = {
    context: player.speakers.context,
    voiceGain: { gain: { cancelAndHoldAtTime: () => assert.fail('Call gain changed') } },
  };
  for (const value of [42, 42, 0]) player.setSpeakerVolume(value);
  assert.deepEqual(ramps, [
    [0.42, 3.02],
    [0, 3.02],
  ]);
  assert.equal(player.callVoiceVolume, 50);
  for (const value of [-1, 101, '50', null, NaN])
    assert.throws(() => player.setSpeakerVolume(value), /Invalid voice volume/);
});

test('English-only TTS reports unsupported text before synthesis without failing the text reply', async () => {
  assert.equal(speechLanguageMismatch('Привет, как дела?', 'en'), true);
  assert.equal(speechLanguageMismatch('Привет, как дела?', 'ru'), false);
  assert.equal(speechLanguageMismatch('Hey choom. Café at midnight?', 'en'), false);
  const { voice, events, requests } = service();
  turn(voice, 'mismatch', 'Привет, как дела?');
  await until(() => events.some((event) => event.type === 'voice.generated'));
  assert.equal(requests.length, 0);
  const warning = events.find((event) => event.type === 'voice.warning');
  assert.match(warning.message, /English voice/);
  assert.doesNotMatch(warning.message, /Choose|Settings/);
  assert.equal(warning.turnId, 'mismatch');
  assert.ok(
    !events.some(({ type }) => ['voice.audio', 'voice.error', 'voice.cancelled'].includes(type)),
  );
  assert.equal(voice.diagnostics().lastFailure.code, 'CAPRI_VOICE_LANGUAGE_MISMATCH');
  assert.equal(voice.snapshot().ready, true);
});

test('mixed replies keep the English sentences in order and show a single warning per turn', async () => {
  const { voice, events, requests } = service();
  turn(voice, 'mixed', 'I am doing fine. Привет, как дела? До встречи. Happy to see you.');
  await until(() => events.some((event) => event.type === 'voice.generated'));
  assert.deepEqual(
    requests.map(({ text }) => text),
    ['I am doing fine.', 'Happy to see you.'],
  );
  assert.deepEqual(
    events.filter(({ type }) => type === 'voice.audio').map(({ sequence }) => sequence),
    [0, 1],
  );
  assert.equal(events.filter(({ type }) => type === 'voice.warning').length, 1);
  assert.ok(!events.some(({ type }) => ['voice.error', 'voice.cancelled'].includes(type)));
});

const pcm = () =>
  new Response(Buffer.from(new Float32Array([0.1, -0.2, 0.1]).buffer), {
    headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': '24000' },
  });

test('missing multilingual weights retain a specific repair message and diagnostic failure', async () => {
  const events = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({}),
    emit: (event) => events.push(event),
    language: 'ru',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'model_missing', component: 'tts' }), { status: 503 }),
  });
  await voice.prepareLanguage();
  assert.equal(voice.ready, false);
  assert.match(voice.snapshot().error, /missing or damaged/);
  assert.match(events.find((event) => event.type === 'voice.error').message, /Open Languages/);
  assert.equal(voice.diagnostics().lastFailure.phase, 'prepare');
});
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(5);
  }
  throw new Error('Timed out');
}

test('voice HTTP failures retain a safe backend code while excluding response text', async () => {
  const { voice, events } = service(
    () =>
      new Response(
        JSON.stringify({
          code: 'CAPRI_VOICE_SPEECH_LIMIT',
          text: 'private transcript fixture',
          token: 'private token fixture',
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
  );
  turn(voice, 'failure-code', 'A complete sentence.');
  await until(() => events.some((e) => e.type === 'voice.error'));
  const value = voice.diagnostics();
  assert.equal(value.lastFailure.code, 'CAPRI_VOICE_SPEECH_LIMIT');
  assert.equal(value.lastFailure.httpStatus, 503);
  assert.match(events.find((e) => e.type === 'voice.error').message, /Voice is still ready/);
  assert.equal(voice.ready, true);
  assert(!JSON.stringify(value).includes('private transcript fixture'));
  assert(!JSON.stringify(value).includes('private token fixture'));
});

test('a generation limit affects one reply, and a subsequent turn speaks without restarting voice', async () => {
  let fail = true;
  const { voice, events } = service(() =>
    fail
      ? new Response(JSON.stringify({ code: 'CAPRI_VOICE_SPEECH_LIMIT' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      : pcm(),
  );
  turn(voice, 'limited', 'A complete sentence.');
  await until(() => events.some((e) => e.type === 'voice.error'));
  fail = false;
  turn(voice, 'next', 'Hello again.');
  await until(() => events.some((e) => e.type === 'voice.audio' && e.turnId === 'next'));
  assert.equal(voice.ready, true);
  voice.cancel();
});

test('oversized backend error bodies cannot enter voice diagnostics', async () => {
  const { voice, events } = service(
    () =>
      new Response(JSON.stringify({ code: 'untrusted-code', text: 'x'.repeat(10000) }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  );
  turn(voice, 'oversized-error', 'A complete sentence.');
  await until(() => events.some((e) => e.type === 'voice.error'));
  const failure = voice.diagnostics().lastFailure;
  assert.equal(failure.httpStatus, 503);
  assert.equal(failure.code, undefined);
  assert(JSON.stringify(failure).length < 2000);
});
function service(fetchImpl) {
  const events = [],
    requests = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({ authorization: 'private' }),
    emit: (event) => events.push(event),
    fetchImpl: async (url, options) => {
      requests.push({ url, text: JSON.parse(options.body).text });
      return fetchImpl ? fetchImpl(options) : pcm();
    },
  });
  voice.setReady(true);
  return { voice, events, requests };
}
function turn(voice, id, text) {
  voice.onChat({ type: 'turn.started', turnId: id });
  voice.onChat({ type: 'turn.delta', turnId: id, text });
  voice.onChat({ type: 'turn.completed', turnId: id });
}

test('a classified social reply completes both streamed text and the entire speech queue', async () => {
  const { voice, events, requests } = service(),
    records = new Map(),
    chatEvents = [];
  const chat = new ChatService({
    gatewayUrl: 'http://127.0.0.1:18789',
    agentId: 'capri',
    token: () => 'fixture',
    persona: () => 'You are Capri.',
    store: { snapshot: () => [...records.values()], put: (value) => records.set(value.id, value) },
    interfaceState: () => ({ fullComputerAccess: true, languages: { conversation: 'en' } }),
    computerIntent: async () => ({ intent: 'chat', usesPrevious: false }),
    computerTask: () => assert.fail('Smalltalk cannot start a computer task'),
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['x-capri-tools-once'], 'dialogue');
      const parts = ['No worries. ', 'We can just hang out. ', 'How was your evening?'];
      return new Response(
        parts
          .map(
            (content) => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n',
          )
          .join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  try {
    await chat.send({ id: randomUUID(), text: 'Not much, just chilling.' }, (event) => {
      chatEvents.push(event);
      voice.onChat(event);
    });
    await until(() => events.some((event) => event.type === 'voice.generated'));
    assert.equal(chatEvents.at(-1).type, 'turn.completed');
    assert.equal(
      requests.map((request) => request.text).join(' '),
      'No worries. We can just hang out. How was your evening?',
    );
    assert(!events.some((event) => ['voice.cancelled', 'voice.error'].includes(event.type)));
    assert.equal(voice.generating, false);
  } finally {
    voice.close();
  }
});

test('speech preserves asterisk-wrapped words and hides code across arbitrary stream boundaries', () => {
  const input =
    '*looks up. smiles* Hello there. I can stay here for a while. ```js\n' +
    'private(); '.repeat(100) +
    '``` Just say the word and I will be right here.';
  for (const step of [1, 3, 40, 2000]) {
    const buffer = new SentenceBuffer(),
      parts = [];
    for (let index = 0; index < input.length; index += step)
      parts.push(...buffer.push(input.slice(index, index + step)));
    parts.push(...buffer.push('', true));
    assert.equal(
      parts.join(' ').replace(/\s+/g, ' '),
      'looks up. smiles Hello there. I can stay here for a while. Just say the word and I will be right here.',
    );
  }
  assert.equal(
    spokenText('**Hello** [voice:warm] [guide](https://example.com) *smiles*'),
    'Hello guide smiles',
  );
  assert.equal(
    spokenText('That *really* matters. Please **do not** skip it.'),
    'That really matters. Please do not skip it.',
  );
  assert.equal(
    spokenText('Even an *unfinished emphasis must remain audible.'),
    'Even an unfinished emphasis must remain audible.',
  );
  assert.equal(
    spokenText('Created `welcome.txt` in your folder.'),
    'Created welcome.txt in your folder.',
  );
});

test('voice completes independently of text and queues a reply during startup', async () => {
  const { voice, events, requests } = service();
  voice.setReady(false);
  turn(voice, 'one', 'Hey. There you are. I have been waiting for you.');
  assert.equal(requests.length, 0);
  voice.setReady(true);
  await until(() => events.some((e) => e.type === 'voice.generated'));
  assert.ok(events.filter((e) => e.type === 'voice.audio').length >= 1);
  assert.equal(
    requests.map((r) => r.text).join(' '),
    'Hey. There you are. I have been waiting for you.',
  );
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('speech waits for a complete sentence instead of cutting at commas or character limits', () => {
  const buffer = new SentenceBuffer();
  assert.deepEqual(buffer.push('How about we brew some coffee, and then think'), []);
  assert.deepEqual(buffer.push(' about the rest? '), [
    'How about we brew some coffee, and then think about the rest?',
  ]);
  const long =
    'We can talk about the city, its lights and its people while the rain taps softly against the window and the music plays in the background, giving us enough time to finish one thought naturally before moving on to another without breaking that thought into tiny pieces just because a character counter reached its limit.';
  assert.ok(long.length > 280);
  assert.deepEqual(buffer.push(long.slice(0, 200)), []);
  assert.deepEqual(buffer.push(long.slice(200)), []);
  assert.deepEqual(buffer.push(' '), [long]);
  assert.deepEqual(buffer.push('One unfinished closing thought'), []);
  assert.deepEqual(buffer.push('', true), ['One unfinished closing thought']);
});

test('sentence punctuation, abbreviations, decimals and quotes survive arbitrary streamed boundaries', () => {
  const input = 'Dr. Smith paid 3.14 dollars. "Really?!" Wait… Go; Now!';
  for (const step of [1, 7, 1000]) {
    const buffer = new SentenceBuffer(),
      parts = [];
    for (let i = 0; i < input.length; i += step)
      parts.push(...buffer.push(input.slice(i, i + step)));
    parts.push(...buffer.push('', true));
    assert.deepEqual(parts, ['Dr. Smith paid 3.14 dollars.', '"Really?!"', 'Wait…', 'Go;', 'Now!']);
  }
  const abbreviations = new SentenceBuffer();
  const parts = [
    ...abbreviations.push('Dr. Smith lives on St. George Street. He enjoys quiet evenings. '),
    ...abbreviations.push('', true),
  ];
  assert.ok(!parts.includes('Dr.') && !parts.includes('Smith lives on St.'));
});

test('new turn and mute discard stale generation, including a server ignoring abort', async () => {
  let resolve;
  let first = true;
  const { voice, events } = service(() => {
    if (first) {
      first = false;
      return new Promise((done) => {
        resolve = done;
      });
    }
    return pcm();
  });
  turn(voice, 'old', 'An earlier reply that must never be played after it is interrupted.');
  await until(() => resolve);
  turn(voice, 'new', 'A new response.');
  resolve(pcm());
  await until(() => events.some((e) => e.type === 'voice.audio' && e.turnId === 'new'));
  assert.ok(!events.some((e) => e.type === 'voice.audio' && e.turnId === 'old'));
  voice.setEnabled(false);
  turn(voice, 'muted', 'Stay silent.');
  await delay(15);
  assert.ok(!events.some((e) => e.type === 'voice.audio' && e.turnId === 'muted'));
});

test('bad audio fails visibly without leaking service details', async () => {
  const { voice, events } = service(() => new Response('private diagnostic', { status: 503 }));
  turn(voice, 'bad', 'Hello there.');
  await until(() => events.some((e) => e.type === 'voice.error'));
  assert.ok(!JSON.stringify(events).includes('private diagnostic'));
  assert.equal(voice.turn, null);
});

test('explicit preview works while muted without enabling automatic speech', async () => {
  const { voice, events, requests } = service();
  voice.setEnabled(false);
  voice.preview('preview', 'Hear this sample.');
  await until(() => events.some((e) => e.type === 'voice.generated' && e.turnId === 'preview'));
  assert.ok(events.some((e) => e.type === 'voice.audio' && e.turnId === 'preview'));
  assert.equal(voice.enabled, false);
  const count = requests.length;
  turn(voice, 'muted-reply', 'This reply stays silent.');
  await delay(10);
  assert.equal(requests.length, count);
});

test('PCM playback preserves order, stops immediately, and ignores old packets', async () => {
  const sources = [],
    states = [],
    playback = [];
  const context = {
    state: 'running',
    destination: {},
    createBuffer: () => ({ copyToChannel() {} }),
    createBufferSource: () => {
      const source = {
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
        connect() {},
        disconnect() {},
      };
      sources.push(source);
      return source;
    },
  };
  const player = new VoicePlayer({
    onState: (value) => states.push(value),
    onPlayback: (value) => playback.push(value),
    onError: () => assert.fail('Unexpected playback error'),
    contextFactory: () => context,
  });
  const packet = (id, sequence) => ({
    turnId: id,
    sequence,
    text: 'Hello.',
    sampleRate: 24000,
    pcm: Buffer.from(new Float32Array([0.2, -0.1]).buffer).toString('base64'),
  });
  player.begin('one');
  player.accept(packet('one', 0));
  player.accept(packet('one', 1));
  await delay(0);
  assert.equal(sources.length, 1);
  assert.deepEqual(
    playback.filter((event) => event.type === 'started').map((event) => event.sequence),
    [0],
  );
  assert.equal(playback[0].durationMs, (2 / 24000) * 1000);
  sources[0].onended();
  await delay(0);
  assert.equal(sources.length, 2);
  assert.deepEqual(
    playback.filter((event) => event.type === 'started').map((event) => event.sequence),
    [0, 1],
  );
  player.finish('one');
  player.begin('two');
  assert.equal(sources[1].stopped, true);
  player.accept(packet('one', 2));
  await delay(0);
  assert.equal(sources.length, 2);
  player.accept(packet('two', 0));
  await delay(0);
  player.finish('two');
  sources[2].onended();
  assert.equal(states.at(-1).busy, false);
});

test('voice preview effects are scoped to one speaker turn and restore the latest baseline', () => {
  const player = new VoicePlayer({ onState() {}, onError: assert.fail });
  const configurations = [];
  const effects = () => ({
    configure: ({ preset }) => configurations.push(preset),
    reset() {},
    speaking() {},
  });
  player.speakers.effects = effects();
  player.callOutput = { available: true, effects: effects() };
  player.begin('draft', { effects: VOICE_EFFECT_PRESETS.holographic });
  player.setEffects(VOICE_EFFECT_PRESETS.radio);
  assert.deepEqual(configurations, ['holographic', 'radio']);
  player.finish('different-turn');
  assert.equal(player.turnEffects.preset, 'holographic');
  player.finish('draft');
  assert.equal(player.turnEffects, null);
  assert.deepEqual(configurations, ['holographic', 'radio', 'radio']);
  player.begin('cancelled', { effects: VOICE_EFFECT_PRESETS.synthetic });
  player.stop();
  assert.deepEqual(configurations.slice(-2), ['synthetic', 'radio']);
  player.begin('call', { call: true, effects: VOICE_EFFECT_PRESETS.cybernetic });
  assert.equal(player.turnEffects, null);
  assert.equal(configurations.at(-1), 'radio');
});

test('a microphone unplugged while listing call outputs is not misreported as a feedback loop', async () => {
  const track = {
    label: 'Physical microphone',
    readyState: 'live',
    getSettings: () => ({ groupId: 'cable-group' }),
  };
  const player = new VoicePlayer({
    onState() {},
    onError: assert.fail,
    enumerateCallOutputs: async () => {
      track.readyState = 'ended';
      return [{ deviceId: 'call-cable', label: 'CABLE Input', groupId: 'cable-group' }];
    },
    callContextFactory: () =>
      assert.fail('A disconnected microphone must be rejected before opening the mixer.'),
  });
  await assert.rejects(
    player.enableCallOutput('call-cable', { getAudioTracks: () => [track] }),
    /selected microphone is unavailable/,
  );
  assert.equal(player.callOutputState().active, false);
  assert.equal(player.callOutputState().mixingMic, false);
});

function sharedGroupCallFixture(enumerate) {
  const groupId = 'shared-device-group';
  const devices = [
    {
      kind: 'audioinput',
      deviceId: 'physical-mic',
      label: 'Microphone (Physical audio)',
      groupId,
    },
    { kind: 'audioinput', deviceId: 'cable-recording', label: 'CABLE Output', groupId },
    { kind: 'audiooutput', deviceId: 'cable-playback', label: 'CABLE Input', groupId },
  ];
  const track = Object.assign(new EventTarget(), {
    label: devices[0].label,
    readyState: 'live',
    getSettings: () => ({ deviceId: 'physical-mic', groupId }),
  });
  const microphone = { getAudioTracks: () => [track] };
  let contexts = 0,
    mixed = 0;
  const player = new VoicePlayer({
    onState() {},
    onError: assert.fail,
    mediaDevices: Object.assign(new EventTarget(), {
      enumerateDevices: () => (enumerate ? enumerate(devices, track) : Promise.resolve(devices)),
    }),
    enumerateCallOutputs: async () => [devices[2]],
    callContextFactory: (sinkId) => {
      contexts++;
      return Object.assign(new EventTarget(), {
        sinkId,
        state: 'running',
        destination: {},
        async setSinkId(value) {
          this.sinkId = value;
        },
        createDynamicsCompressor: () => ({
          threshold: {},
          knee: {},
          ratio: {},
          attack: {},
          release: {},
          connect() {},
          disconnect() {},
        }),
        createMediaStreamSource: (stream) => {
          assert.equal(stream, microphone);
          mixed++;
          return { connect() {}, disconnect() {} };
        },
        async close() {
          this.state = 'closed';
        },
      });
    },
  });
  return { player, microphone, track, contexts: () => contexts, mixed: () => mixed };
}

test('a freshly verified distinct cable route accepts shared group metadata without opening a second mic', async () => {
  const fixture = sharedGroupCallFixture();
  const state = await fixture.player.enableCallOutput('cable-playback', fixture.microphone);
  assert.equal(state.available, true);
  assert.equal(state.mixingMic, true);
  assert.equal(fixture.contexts(), 1);
  assert.equal(fixture.mixed(), 1);
  fixture.player.disableCallOutput();
});

test('lost input or failed fresh enumeration cannot open a same-group call sink', async () => {
  for (const mode of ['unplug', 'unavailable', 'retarget']) {
    const fixture = sharedGroupCallFixture(async (devices, track) => {
      if (mode === 'unavailable') throw new Error('Enumeration unavailable');
      if (mode === 'unplug') track.readyState = 'ended';
      if (mode === 'retarget')
        track.getSettings = () => ({ deviceId: 'different-mic', groupId: 'shared-device-group' });
      return devices;
    });
    await assert.rejects(
      fixture.player.enableCallOutput('cable-playback', fixture.microphone),
      mode === 'unplug' ? /selected microphone is unavailable/ : /separate from your microphone/,
    );
    assert.equal(fixture.contexts(), 0);
    assert.equal(fixture.mixed(), 0);
    assert.equal(fixture.player.callOutputState().active, false);
  }
});

test('cancelling while proving a shared-group route does not recreate the call output', async () => {
  let resolveDevices;
  const fixture = sharedGroupCallFixture(
    (devices) =>
      new Promise((resolve) => {
        resolveDevices = () => resolve(devices);
      }),
  );
  const pending = fixture.player.enableCallOutput('cable-playback', fixture.microphone);
  await delay(0);
  assert.equal(typeof resolveDevices, 'function');
  fixture.player.disableCallOutput();
  resolveDevices();
  const state = await pending;
  assert.equal(state.active, false);
  assert.equal(fixture.contexts(), 0);
  assert.equal(fixture.mixed(), 0);
});

test('an approved call mirrors Capri to both outputs and keeps only the selected microphone in the call mixer', async () => {
  const deviceId = 'virtual-mic-playback';
  const mediaDevices = new EventTarget();
  let devices = [{ deviceId, label: 'Test cable' }];
  const errors = [],
    routes = [],
    micRoutes = [];
  const track = Object.assign(new EventTarget(), { readyState: 'live' });
  const microphone = { getAudioTracks: () => [track] };
  const context = (sinkId) =>
    Object.assign(new EventTarget(), {
      sinkId,
      state: 'running',
      currentTime: 0,
      destination: { sinkId },
      createDynamicsCompressor() {
        return {
          threshold: {},
          knee: {},
          ratio: {},
          attack: {},
          release: {},
          connect(destination) {
            this.sinkId = destination.sinkId;
          },
          disconnect() {},
        };
      },
      createMediaStreamSource(stream) {
        assert.equal(stream, microphone);
        const source = {
          connect(destination) {
            this.sinkId = destination.sinkId;
          },
          disconnect() {
            this.disconnected = true;
          },
        };
        micRoutes.push(source);
        return source;
      },
      createBuffer: () => ({ copyToChannel() {} }),
      createBufferSource() {
        return {
          connect(destination) {
            this.destination = destination;
          },
          disconnect() {},
          start() {
            routes.push(this);
          },
          stop() {
            this.stopped = true;
          },
        };
      },
      async setSinkId(id) {
        this.sinkId = id;
        this.destination.sinkId = id;
      },
      async close() {
        this.state = 'closed';
      },
    });
  const speaker = context('speakers');
  let call;
  const player = new VoicePlayer({
    contextFactory: () => speaker,
    callContextFactory: () => (call = context(null)),
    mediaDevices,
    enumerateCallOutputs: async () => devices,
    onState: () => {},
    onError: (error) => errors.push(error.message),
  });
  const play = async (id, options, reply = false) => {
    if (reply) player.beginReply(id);
    else player.begin(id, options);
    player.accept({
      turnId: id,
      sequence: 0,
      text: 'Test audio',
      sampleRate: 24000,
      pcm: Buffer.from(new Float32Array([0.2, -0.1]).buffer).toString('base64'),
    });
    await delay(0);
  };
  await assert.rejects(player.enableCallOutput('default'), /specific call output/);
  for (const label of ['Stereo Mix (Test Audio)', 'Microphone (Steam Streaming Microphone)']) {
    track.label = label;
    await assert.rejects(
      player.enableCallOutput(deviceId, microphone),
      /Select a physical microphone/,
    );
  }
  track.label = 'Test microphone';
  devices[0].groupId = 'cable';
  track.getSettings = () => ({ groupId: 'cable' });
  await assert.rejects(
    player.enableCallOutput(deviceId, microphone),
    /separate from your microphone/,
  );
  track.getSettings = () => ({ groupId: 'mic' });
  await play('disabled', { call: true });
  assert.equal(routes.length, 0);
  assert.match(errors.pop(), /Call audio output is unavailable/);
  assert.equal((await player.enableCallOutput(deviceId, microphone)).mixingMic, true);
  assert.equal(player.callOutputState().shareReplies, true);
  assert.equal(micRoutes[0].sinkId, deviceId);
  await play('ordinary');
  await play('explicit', { call: true });
  assert.deepEqual(
    routes.map(({ destination }) => destination.sinkId),
    ['speakers', 'speakers', deviceId],
  );
  assert.equal(player.context, speaker);
  devices = [];
  mediaDevices.dispatchEvent(new Event('devicechange'));
  await delay(0);
  assert.equal(routes[1].stopped, true);
  assert.equal(routes[2].stopped, true);
  assert.equal(micRoutes[0].disconnected, true);
  assert.equal(call.state, 'closed');
  assert.deepEqual(player.callOutputState(), {
    deviceId,
    active: true,
    available: false,
    mixingMic: false,
    shareReplies: false,
  });
  await play('disconnected', { call: true });
  assert.equal(routes.length, 3);
  assert.match(errors.pop(), /Call audio output is unavailable/);
  player.disableCallOutput();
  assert.equal(player.callOutputState().active, false);
  await play('ordinary-after-loss');
  assert.equal(routes[3].destination.sinkId, 'speakers');
  assert.deepEqual(errors, []);

  devices = [{ deviceId, label: 'Test cable' }];
  await player.enableCallOutput(deviceId, microphone);
  routes.length = 0;
  await play('shared-conversation', undefined, true);
  assert.deepEqual(
    routes.map(({ destination }) => destination.sinkId),
    ['speakers', deviceId],
  );
  player.setCallReplySharing(false);
  assert.equal(player.turnId, null, 'Turning sharing off immediately stops the shared reply.');
  assert.equal(
    routes.every((source) => source.stopped),
    true,
  );
  routes.length = 0;
  await play('private-conversation', undefined, true);
  assert.deepEqual(
    routes.map(({ destination }) => destination.sinkId),
    ['speakers'],
  );
  player.setCallReplySharing(true);
  routes.length = 0;
  await play('local-voice-preview');
  assert.deepEqual(
    routes.map(({ destination }) => destination.sinkId),
    ['speakers'],
  );
  player.disableCallOutput();
  routes.length = 0;
  await play('conversation-after-disconnect', undefined, true);
  assert.deepEqual(
    routes.map(({ destination }) => destination.sinkId),
    ['speakers'],
  );
  assert.equal(player.callOutputState().shareReplies, false);
  assert.throws(() => player.setCallReplySharing(true), /unavailable/);
  assert.deepEqual(errors, []);
});

test('disabling a pending call output cannot activate it after device enumeration', async () => {
  let resolveDevices,
    sinkChanges = 0,
    closes = 0;
  const player = new VoicePlayer({
    callContextFactory: () => ({
      setSinkId: () => sinkChanges++,
      close: async () => closes++,
    }),
    enumerateCallOutputs: () =>
      new Promise((resolve) => {
        resolveDevices = resolve;
      }),
  });
  const enabling = player.enableCallOutput('test-device');
  player.disableCallOutput();
  resolveDevices([{ deviceId: 'test-device', label: 'Test cable' }]);
  assert.deepEqual(await enabling, {
    deviceId: '',
    active: false,
    available: false,
    mixingMic: false,
    shareReplies: false,
  });
  assert.equal(sinkChanges, 0);
  assert.equal(closes, 0, 'Cancelled enumeration must not create an audio context.');
});

test('a ready VAC receives 24 kHz speech even when the local speaker cannot unlock', async () => {
  const deviceId = 'approved-call-cable';
  const played = [],
    errors = [];
  let selected;
  const context = {
    state: 'suspended',
    sampleRate: 48000,
    sinkId: deviceId,
    currentTime: 0,
    destination: {},
    setSinkId() {
      assert.fail('The requested sink was bound at construction.');
    },
    async resume() {
      this.state = 'running';
    },
    async close() {
      this.state = 'closed';
    },
    createBuffer(channels, length, sampleRate) {
      assert.equal(channels, 1);
      assert.equal(sampleRate, 24000, 'PCM keeps its true source rate for native resampling.');
      return { duration: length / sampleRate, copyToChannel() {} };
    },
    createBufferSource() {
      return {
        connect() {},
        disconnect() {},
        stop() {},
        start() {
          played.push(this.buffer.duration);
        },
      };
    },
  };
  const player = new VoicePlayer({
    callContextFactory: (id) => {
      selected = id;
      return context;
    },
    contextFactory: () => {
      throw new Error('Speaker unavailable');
    },
    enumerateCallOutputs: async () => [{ deviceId }],
    onState() {},
    onError: (error) => errors.push(error.message),
  });
  await player.enableCallOutput(deviceId);
  assert.equal(selected, deviceId);
  assert.equal(context.state, 'running', 'A speech-only VAC also resumes during setup.');
  player.begin('call', { call: true });
  player.accept({
    turnId: 'call',
    sequence: 0,
    text: 'Test.',
    sampleRate: 24000,
    pcm: Buffer.from(new Float32Array(24000).buffer).toString('base64'),
  });
  await delay(0);
  assert.deepEqual(played, [1]);
  assert.deepEqual(errors, []);
  player.disableCallOutput();
});

test('Steam transport cannot be enabled through a stale device ID or reported as a call cable', async () => {
  let contexts = 0;
  const player = new VoicePlayer({
    enumerateCallOutputs: async () => [
      { deviceId: 'steam', label: 'Microphone (Steam Streaming Microphone)' },
      { deviceId: 'vb-cable', label: 'CABLE Input (VB-Audio Virtual Cable)' },
    ],
    contextFactory: () => {
      contexts++;
      assert.fail('Rejected transport must not open a local monitor.');
    },
    callContextFactory: () => {
      contexts++;
      assert.fail('Rejected transport must not open the call mixer.');
    },
    onState() {},
    onError: assert.fail,
  });
  assert.equal(await player.hasCallOutput('steam'), false);
  assert.equal(await player.hasCallOutput('vb-cable'), true);
  await assert.rejects(player.enableCallOutput('steam'), /Install VB-CABLE/);
  assert.equal(contexts, 0);
  assert.equal(player.callOutputState().active, false);
  assert.equal(player.callOutputState().available, false);
  assert.equal(player.callOutputState().shareReplies, false);
});

test('the native VAC context uses its selected sink clock and stays within a mono endpoint limit', async () => {
  const previous = globalThis.AudioContext;
  try {
    for (const nativeRate of [44100, 48000]) {
      let options, context;
      globalThis.AudioContext = class {
        constructor(value) {
          options = value;
          context = this;
          this.sinkId = value.sinkId;
          this.sampleRate = value.sampleRate ?? nativeRate;
          this.state = 'running';
          let channels = 2;
          this.destination = {
            maxChannelCount: 1,
            channelCountMode: 'max',
            get channelCount() {
              return channels;
            },
            set channelCount(value) {
              assert.equal(value, 1, 'The mono cable cannot accept an extra channel.');
              channels = value;
            },
          };
        }
        setSinkId() {
          assert.fail('No silent sink should be retargeted.');
        }
        async close() {
          this.state = 'closed';
        }
      };
      const player = new VoicePlayer({
        enumerateCallOutputs: async () => [{ deviceId: 'test-cable' }],
        contextFactory: () => {
          throw new Error('No local monitor needed');
        },
        onState() {},
        onError: assert.fail,
      });
      try {
        await player.enableCallOutput('test-cable');
        assert.deepEqual(options, { latencyHint: 'interactive', sinkId: 'test-cable' });
        assert.equal(context.sampleRate, nativeRate);
        assert.equal(context.destination.channelCount, 1);
        assert.equal(context.destination.channelCountMode, 'explicit');
        assert.equal(player.callOutputState().available, true);
      } finally {
        player.disableCallOutput();
      }
    }
  } finally {
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
});
