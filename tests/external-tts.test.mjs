// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ExternalTts, voiceApiPcm } from '../apps/desktop/external-tts.mjs';
import {
  EXTERNAL_TTS_DEFAULTS,
  externalTtsSettings,
} from '../apps/desktop/renderer/external-tts-settings.mjs';
import { VoiceService } from '../apps/desktop/voice-service.mjs';
import { registerCompanionIpc } from '../apps/desktop/main/companion-ipc.mjs';

const secret = 'fixture-voice-credential-12345';
const storage = {
  available: async () => true,
  encrypt: async (value) => Buffer.from(value).map((x) => x ^ 37),
  decrypt: async (bytes) =>
    Buffer.from(bytes)
      .map((x) => x ^ 37)
      .toString(),
};
function setup(t, fetchImpl) {
  const root = mkdtempSync(path.join(tmpdir(), 'capri-tts-api-'));
  const service = new ExternalTts({ root, storage, fetchImpl });
  t.after(() => {
    service.close();
    rmSync(root, { recursive: true, force: true });
  });
  return service;
}
const raw = () => {
  const pcm = Buffer.alloc(6);
  [-32768, 0, 16384].forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  return pcm;
};
const audio = () =>
  new Response(raw(), { headers: { 'content-type': 'application/octet-stream' } });
const configured = { ...EXTERNAL_TTS_DEFAULTS, enabled: true };
const save = (service, settings = configured, key = secret) => service.save({ settings, key });

test('voice API is opt-in, validates transport and accepts provider-specific model/voice IDs', () => {
  assert.equal(externalTtsSettings({}).enabled, false);
  for (const baseUrl of [
    'http://provider.example/v1',
    'https://u:p@provider.example/v1',
    'https://provider.example/v1?key=secret',
    'file:///tmp',
    'https://provider.example/v1#fragment',
  ])
    assert.throws(() => externalTtsSettings({ baseUrl }));
  assert.equal(
    externalTtsSettings({ baseUrl: 'http://127.0.0.1:9999/v1/' }).baseUrl,
    'http://127.0.0.1:9999/v1',
  );
  assert.throws(() => externalTtsSettings({ voice: '../escape' }));
  assert.throws(() => externalTtsSettings({ unexpected: true }));
});

test('encrypted settings survive restart; status and diagnostics never expose a key', async (t) => {
  const service = setup(t, () => audio());
  assert.equal(service.config.enabled, false);
  await assert.rejects(service.synthesize({ text: 'Hello.' }), /disabled/);
  await save(service);
  assert(!readFileSync(service.file, 'utf8').includes(secret));
  assert(!JSON.stringify(service.status()).includes(secret));
  assert(!JSON.stringify(service.diagnostics()).includes(secret));
  const restored = new ExternalTts({ root: path.resolve(service.file, '../../..'), storage });
  assert.equal(restored.config.enabled, true);
  assert.equal(await restored.key(), secret);
  await assert.rejects(
    service.save({ settings: { ...configured, baseUrl: 'https://another.example/v1' }, key: '' }),
    /new API key/,
  );
  assert.equal(service.config.baseUrl, configured.baseUrl);
  await service.remove();
  assert.equal(service.config.enabled, false);
  assert.equal(service.status().hasKey, false);
});

test('testing without a saved voice key reports missing credentials before any network request', async (t) => {
  let requests = 0;
  const service = setup(t, async () => {
    requests++;
    return audio();
  });
  await assert.rejects(service.test(), {
    code: 'CAPRI_TTS_API_KEY_MISSING',
    message: 'Save a voice API key before enabling external TTS.',
  });
  assert.equal(requests, 0);
  assert.equal(service.diagnostics().lastFailure.code, 'CAPRI_TTS_API_KEY_MISSING');
  assert.equal(service.controllers.size, 0);
  await save(service, { ...configured, enabled: false });
  const result = await service.test();
  assert.equal(result.sampleRate, 24000);
  assert.equal(requests, 1);
  assert.equal(service.status().enabled, false);
  assert.equal(service.diagnostics().lastFailure, null);
});

test('key persistence fails closed when encryption is unavailable and corruption never activates local TTS', async (t) => {
  const service = setup(t);
  service.storage = { available: async () => false };
  await assert.rejects(save(service), /Secure credential storage/);
  service.storage = storage;
  await save(service);
  writeFileSync(service.file, '{corrupt');
  const restored = new ExternalTts({ root: path.resolve(service.file, '../../..'), storage });
  assert.equal(restored.config.enabled, true);
  assert.equal(restored.status().loadError, true);
  await assert.rejects(restored.prepare(), /Save the key again/);
});

test('OpenAI-compatible speech sends only one sentence, model, voice and output format', async (t) => {
  const requests = [];
  const service = setup(t, async (url, options) => {
    requests.push({ url, ...options });
    return audio();
  });
  await save(service);
  const response = await service.synthesize({ text: 'Private spoken sentence.' });
  assert.equal(requests[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(requests[0].redirect, 'error');
  assert.equal(requests[0].credentials, 'omit');
  assert.equal(requests[0].headers.authorization, 'Bearer ' + secret);
  assert.deepEqual(JSON.parse(requests[0].body), {
    input: 'Private spoken sentence.',
    model: configured.model,
    voice: 'coral',
    response_format: 'pcm',
  });
  const pcm = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(
    [0, 4, 8].map((i) => pcm.readFloatLE(i)),
    [-1, 0, 0.5],
  );
  assert.equal(response.headers.get('x-sample-rate'), '24000');
  assert(!JSON.stringify(service.diagnostics()).includes('Private spoken'));
});

test('ElevenLabs uses its native API and 24 kHz output without forwarding reference audio or history', async (t) => {
  let request;
  const service = setup(t, async (url, options) => {
    request = { url, ...options };
    return audio();
  });
  await save(service, {
    ...configured,
    provider: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    model: 'eleven_multilingual_v2',
    voice: 'voiceExample',
  });
  await service.synthesize({ text: 'Bonjour.' });
  assert.equal(
    request.url,
    'https://api.elevenlabs.io/v1/text-to-speech/voiceExample?output_format=pcm_24000',
  );
  assert.deepEqual(JSON.parse(request.body), {
    text: 'Bonjour.',
    model_id: 'eleven_multilingual_v2',
  });
  assert.equal(request.headers['xi-api-key'], secret);
  assert.equal(request.headers.authorization, undefined);
});

test('connection test works while disabled and uses a fixed sample, not conversation contents', async (t) => {
  let text;
  const service = setup(t, async (_url, options) => {
    text = JSON.parse(options.body).input;
    return audio();
  });
  await save(service, { ...configured, enabled: false });
  const response = await service.test();
  assert.match(text, /voice connection test/);
  assert.equal(response.sampleRate, 24000);
  assert.equal(service.config.enabled, false);
});

test('provider errors never include a response body, fetch cause, URL or credential', async (t) => {
  const service = setup(t, () => new Response(secret + ' Private sentence.', { status: 401 }));
  await save(service);
  await assert.rejects(service.synthesize({ text: 'Hello.' }), /HTTP 401/);
  assert(!JSON.stringify(service.diagnostics()).includes(secret));
  service.fetchImpl = () => {
    throw new Error('Echo ' + secret);
  };
  await assert.rejects(
    service.synthesize({ text: 'Hello.' }),
    (error) => !error.message.includes(secret) && /network/.test(error.message),
  );
  assert(!JSON.stringify(service.diagnostics()).includes(secret));
});

test('encryption errors cannot echo the key, and advertised incompatible rates are rejected', async (t) => {
  const service = setup(
    t,
    () =>
      new Response(raw(), { headers: { 'content-type': 'audio/pcm', 'x-sample-rate': '48000' } }),
  );
  service.storage = {
    ...storage,
    encrypt() {
      throw new Error(secret);
    },
  };
  await assert.rejects(save(service), (error) => !error.message.includes(secret));
  service.storage = storage;
  await save(service);
  await assert.rejects(service.synthesize({ text: 'Hello.' }), /24 kHz/);
});

test('wake voice uses the selected synthesis backend and invalidates its cache when the voice identity changes', async (t) => {
  let calls = 0,
    identity = 'voice-a';
  const external = setup(t, () => {
    calls++;
    return audio();
  });
  await save(external);
  const folder = path.resolve(external.file, '../../..');
  const handlers = new Map();
  const value = { wakeSound: 'voice', wakePhrase: 'Listening.' };
  registerCompanionIpc((name, fn) => handlers.set(name, fn), {
    root: folder,
    state: folder,
    rt: { workspace: folder },
    preferences: { value, snapshot: () => value },
    emit() {},
    assertIdle() {},
    prepareVoice: () => external.prepare(),
    wakeLanguage: () => 'en',
    wakeIdentity: () => identity,
    synthesizeVoice: (request, signal) => external.synthesize({ text: request.text, signal }),
    voiceUrl: 'http://127.0.0.1:1/never-local',
  });
  await handlers.get('capri:wake-prepare')();
  await handlers.get('capri:wake-prepare')();
  assert.equal(calls, 1);
  assert.equal(handlers.get('capri:wake-audio')().sampleRate, 24000);
  identity = 'voice-b';
  assert.equal(handlers.get('capri:wake-audio')(), null);
  await handlers.get('capri:wake-prepare')();
  assert.equal(calls, 2);
});

test('JSON, compressed audio, oversized and malformed samples are rejected', async (t) => {
  const service = setup(
    t,
    () => new Response('{"error":"private"}', { headers: { 'content-type': 'application/json' } }),
  );
  await save(service);
  await assert.rejects(service.synthesize({ text: 'Hello.' }), /24 kHz/);
  service.fetchImpl = () =>
    new Response(Buffer.alloc(24000 * 2 * 46 + 65536), {
      headers: { 'content-type': 'audio/pcm' },
    });
  await assert.rejects(service.synthesize({ text: 'Hello.' }), /limit/);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(3), Buffer.from('RIFFxxxxMP3!')])
    assert.throws(() => voiceApiPcm(bytes));
});

test('WAV parsing preserves sample rate and pitch; incompatible WAV is rejected', () => {
  const wav = Buffer.alloc(44 + raw().length);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(raw().length, 40);
  raw().copy(wav, 44);
  assert.equal(voiceApiPcm(wav).readFloatLE(8), 0.5);
  wav.writeUInt32LE(48000, 24);
  assert.throws(() => voiceApiPcm(wav), /24 kHz/);
});

test('aborting a stalled response body promptly cancels it and no retry is sent', async (t) => {
  let requests = 0;
  const service = setup(t, () => {
    requests++;
    return new Response(new ReadableStream({ start() {} }), {
      headers: { 'content-type': 'audio/pcm' },
    });
  });
  await save(service);
  const controller = new AbortController();
  const pending = service.synthesize({ text: 'Hello.', signal: controller.signal });
  const rejected = assert.rejects(pending, /cancelled or timed out/);
  await delay(5);
  controller.abort();
  await rejected;
  assert.equal(service.controllers.size, 0);
  assert.equal(requests, 1);
});

test('real HTTP speech transport, sentence queue and cancellation never call the local voice runtime', async (t) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: JSON.parse(body) });
    res.setHeader('content-type', 'application/octet-stream');
    res.end(raw());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const external = setup(t, fetch);
  await save(
    external,
    { ...configured, baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' },
    '',
  );
  const events = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({}),
    external,
    emit: (event) => events.push(event),
    fetchImpl: () => assert.fail('Local TTS must never be contacted'),
  });
  t.after(() => voice.close());
  await voice.prepareLanguage();
  assert.equal(voice.ready, true);
  assert.equal(voice.snapshot().source, 'api');
  voice.onChat({ type: 'turn.started', turnId: 'external-test' });
  voice.onChat({
    type: 'turn.delta',
    turnId: 'external-test',
    text: 'Hello there. Another sentence.',
  });
  voice.onChat({ type: 'turn.completed', turnId: 'external-test' });
  for (let i = 0; i < 100 && events.filter((event) => event.type === 'voice.audio').length < 2; i++)
    await delay(10);
  assert.equal(events.filter((event) => event.type === 'voice.audio').length, 2);
  assert.equal(requests.length, 2);
  assert(requests.every((request) => request.path === '/v1/audio/speech'));
  voice.cancel();
});

test('external failure keeps text intact, performs no local retry and allows a new turn', async (t) => {
  let fail = true,
    requests = 0;
  const external = setup(t, () => {
    requests++;
    return fail ? new Response(secret, { status: 429 }) : audio();
  });
  await save(external);
  const events = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({}),
    external,
    emit: (event) => events.push(event),
    fetchImpl: () => assert.fail('No local fallback'),
  });
  t.after(() => voice.close());
  await voice.prepareLanguage();
  const turn = (id) => {
    voice.onChat({ type: 'turn.started', turnId: id });
    voice.onChat({ type: 'turn.delta', turnId: id, text: 'A complete reply.' });
    voice.onChat({ type: 'turn.completed', turnId: id });
  };
  turn('failed');
  for (let i = 0; i < 100 && !events.some((event) => event.type === 'voice.error'); i++)
    await delay(5);
  assert.match(events.find((event) => event.type === 'voice.error').message, /429/);
  assert.equal(requests, 1);
  assert.equal(voice.ready, true);
  assert(!JSON.stringify(voice.diagnostics()).includes(secret));
  assert(!events.some((event) => event.type.startsWith('turn.')));
  fail = false;
  turn('next');
  for (let i = 0; i < 100 && !events.some((event) => event.type === 'voice.audio'); i++)
    await delay(5);
  assert(events.some((event) => event.type === 'voice.audio' && event.turnId === 'next'));
});
