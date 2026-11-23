/** Real classifier -> Gateway -> Qwen -> selected voice, in disposable sessions. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { RequestRouter } from '../../apps/desktop/request-router.mjs';
import { VoiceService } from '../../apps/desktop/voice-service.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import {
  root,
  settings,
  runtime,
  personaPrompt,
  runCli,
} from '../../packages/runtime/src/index.mjs';
import {
  companionVoiceUrl,
  companionVoiceHeaders,
  startCompanionVoice,
} from '../../integrations/voice_runtime/host.mjs';

const rt = runtime(),
  router = new RequestRouter({ root }),
  sessions = [],
  rows = [];
const rpc = async (method, params) =>
  JSON.parse(
    (
      await runCli(
        [
          'gateway',
          'call',
          method,
          '--params',
          JSON.stringify(params),
          '--json',
          '--timeout',
          '60000',
        ],
        rt,
      )
    ).stdout,
  );
const history = (key) => rpc('chat.history', { sessionKey: key, limit: 200 });
const digest = async () =>
  createHash('sha256')
    .update(JSON.stringify((await history(settings.sessionKey)).messages))
    .digest('hex');
const before = await digest();
const report = {
  timestamp: new Date().toISOString(),
  realCpuClassifier: true,
  realQwen: true,
  realSelectedVoice: true,
  conditions:
    'Two paired fresh-session dialogue probes, alternating order; the first pair can include unprimed system-prefix work. Then sequential fast/normal turns in one session. Audio readiness before renderer playback. Owner data excluded.',
  rows,
};
const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));
const save = () =>
  writeFileSync(
    path.join(root, 'logs/request-routing-integration.json'),
    JSON.stringify(report, null, 2),
  );
function client(key, routed, store) {
  return new ChatService({
    gatewayUrl: rt.gatewayUrl,
    agentId: settings.agentId,
    sessionKey: key,
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
    requestRouter: routed ? router : null,
    persona: () =>
      personaPrompt(rt) +
      '\nTemporary verification: never write files or save memories. Use only the read-only status action for Spotify. Answer in at most two short sentences.',
    avatarSprites: catalog.publicSprites(),
    defaultAvatarId: catalog.defaultId,
    store,
  });
}
function store() {
  const entries = new Map();
  return {
    snapshot: () => [...entries.values()],
    put: (value) => entries.set(value.id, structuredClone(value)),
  };
}
async function session() {
  const key = `agent:${settings.agentId}:routing-integration-${randomUUID()}`;
  sessions.push(key);
  await rpc('sessions.patch', { key, thinkingLevel: 'low' });
  return key;
}
async function turn(chat, text, speech = false) {
  const row = { text },
    started = performance.now();
  let voice, resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  if (speech) {
    voice = new VoiceService({
      url: companionVoiceUrl(),
      headers: companionVoiceHeaders,
      emit: (event) => {
        if (event.type === 'voice.audio' && row.firstAudioMs === undefined)
          row.firstAudioMs = Math.round(performance.now() - started);
        if (event.type === 'voice.error') {
          row.voiceError = event.message;
          resolveDone();
        }
        if (event.type === 'voice.generated') resolveDone();
      },
    });
    voice.setReady(true);
  }
  try {
    await chat.send({ id: randomUUID(), text }, (event) => {
      if (event.type === 'turn.routing') row.routing = event;
      if (event.type === 'turn.delta' && row.firstTextMs === undefined)
        row.firstTextMs = Math.round(performance.now() - started);
      if (event.type === 'turn.completed') row.answer = event.assistant.text;
      if (event.type === 'turn.failed') {
        row.error = event.message;
        resolveDone();
      }
      voice?.onChat(event);
    });
    if (speech)
      await Promise.race([
        done,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Voice verification timeout')), 60000);
          timer.unref();
        }),
      ]);
  } finally {
    voice?.cancel();
  }
  rows.push(row);
  save();
  console.log(JSON.stringify(row));
  assert.ok(row.answer && !row.error && !row.voiceError);
  if (speech) assert.ok(row.firstAudioMs);
  return row;
}
try {
  assert.equal(await router.start(), true);
  await startCompanionVoice();
  const prompts = ['Hey Capri, how are you?', 'What should we do for a quiet evening?'];
  for (const [index, text] of prompts.entries()) {
    for (const routed of index ? [true, false] : [false, true]) {
      const key = await session();
      const row = await turn(client(key, routed, store()), text, true);
      row.variant = routed ? 'routed' : 'baseline';
      if (routed) assert.equal(row.routing.mode, 'fast');
      const described = await rpc('sessions.describe', { key });
      assert.equal(
        described.session.thinkingLevel,
        'low',
        'One-shot fast mode must not change the shared session setting',
      );
    }
  }
  const key = await session(),
    chat = client(key, true, store());
  await turn(chat, 'Hey Capri, how are you?');
  const math = await turn(chat, 'What is two plus two?');
  assert.equal(math.routing.mode, 'normal');
  assert.match(math.answer, /\b(four|4)\b/i);
  const music = await turn(
    chat,
    'Just check which song is in Spotify right now. Do not change playback.',
  );
  assert.equal(music.routing.mode, 'normal');
  await turn(chat, 'What should we do for a quiet evening?');
  const transcript = (await history(key)).messages;
  const thinking = [],
    calls = [];
  for (const message of transcript ?? []) {
    if (message.role === 'user') thinking.push(0);
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type === 'thinking' && thinking.length)
        thinking[thinking.length - 1] += (part.thinking ?? '').length;
      if (['toolCall', 'tool_use'].includes(part.type)) {
        let args = part.arguments ?? part.input;
        if (typeof args === 'string') args = JSON.parse(args);
        calls.push({ name: part.name, action: args?.action });
      }
    }
  }
  assert.equal(thinking[0], 0);
  assert.ok(thinking[1] > 0);
  assert.equal(thinking.at(-1), 0);
  assert.ok(calls.some((c) => c.name === 'spotify_control' && c.action === 'status'));
  assert.ok(calls.every((c) => c.name === 'spotify_control' && c.action === 'status'));
  assert.equal((await rpc('sessions.describe', { key })).session.thinkingLevel, 'low');
  report.thinkingCharactersPerTurn = thinking;
  report.toolCalls = calls;
  report.mixedRequest = await router.classify(
    'Tell me something cheerful and save it in my notes.',
  );
  assert.equal(report.mixedRequest.mode, 'normal');
  const mean = (values) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  report.timings = Object.fromEntries(
    ['baseline', 'routed'].map((variant) => [
      variant,
      {
        firstTextMs: mean(rows.filter((r) => r.variant === variant).map((r) => r.firstTextMs)),
        firstAudioMs: mean(rows.filter((r) => r.variant === variant).map((r) => r.firstAudioMs)),
      },
    ]),
  );
  report.pairs = prompts.map((text) => ({
    text,
    unprimedFirstPair: text === prompts[0],
    variants: Object.fromEntries(
      rows
        .filter((row) => row.text === text && row.variant)
        .map((row) => [
          row.variant,
          {
            firstTextMs: row.firstTextMs,
            firstAudioMs: row.firstAudioMs,
          },
        ]),
    ),
  }));
  report.timingCaveat =
    'Aggregate includes the unprimed first pair; do not present that reduction as the classifier gain. Use pairs and a larger warmed series for performance claims.';
  report.passed = true;
} finally {
  router.close();
  report.ownerHistoryUnchanged = (await digest()) === before;
  report.cleanupErrors = [];
  for (const key of sessions)
    try {
      await rpc('sessions.delete', { key, deleteTranscript: true });
    } catch {
      report.cleanupErrors.push(key);
    }
  if (!report.ownerHistoryUnchanged || report.cleanupErrors.length) report.passed = false;
  save();
}
assert.equal(report.passed, true);
console.log(
  JSON.stringify({
    passed: report.passed,
    timings: report.timings,
    ownerHistoryUnchanged: report.ownerHistoryUnchanged,
  }),
);
