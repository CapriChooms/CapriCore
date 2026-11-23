/** Actual isolated OpenClaw -> selected voice timings. No prerecorded replies. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { VoiceService } from '../../apps/desktop/voice-service.mjs';
import { TranscriptStore } from '../../apps/desktop/storage.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import {
  root,
  settings,
  runtime,
  personaPrompt,
  runCli,
  reasoningBudget,
} from '../../packages/runtime/src/index.mjs';
import {
  companionVoiceUrl,
  companionVoiceHeaders,
  startCompanionVoice,
} from '../../integrations/voice_runtime/host.mjs';
import { startCore } from '../../packages/runtime/src/providers/core.mjs';

const startupStarted = performance.now();
await startCore();
const health = await startCompanionVoice();
const startupMs = performance.now() - startupStarted;
const rt = runtime();
const parent = path.join(root, '.runtime/latency');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'optimized-'));
const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));
const results = [];
const sessions = [];
try {
  for (const question of [
    'Hey Capri, how is your evening going?',
    'What should we do for a quiet evening?',
    'What is two plus two?',
  ]) {
    const started = performance.now(),
      row = { question, segments: [], audioTimings: [] };
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    const voice = new VoiceService({
      url: companionVoiceUrl(),
      headers: companionVoiceHeaders,
      fetchImpl: async (url, options) => {
        if (url.endsWith('/synthesize'))
          row.segments.push({
            text: JSON.parse(options.body).text,
            queuedMs: performance.now() - started,
          });
        return fetch(url, options);
      },
      emit: (event) => {
        if (event.type === 'voice.audio' && row.firstAudioMs === undefined)
          row.firstAudioMs = performance.now() - started;
        if (event.type === 'voice.timing') row.audioTimings.push(event);
        if (event.type === 'voice.error') {
          row.error = event.message;
          resolveDone();
        }
        if (event.type === 'voice.generated') resolveDone();
      },
    });
    voice.setReady(true);
    const sessionKey = `agent:${settings.agentId}:latency-optimized-${randomUUID()}`;
    sessions.push(sessionKey);
    const client = new ChatService({
      gatewayUrl: rt.gatewayUrl,
      agentId: settings.agentId,
      sessionKey,
      token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
      persona: () => personaPrompt(rt),
      store: new TranscriptStore(path.join(folder, randomUUID() + '.json')),
      avatarSprites: catalog.publicSprites(),
      defaultAvatarId: catalog.defaultId,
    });
    await client.send(
      {
        id: randomUUID(),
        text:
          question + ' Answer in at most two short sentences. Do not use tools or write memory.',
      },
      (event) => {
        if (event.type === 'turn.delta' && row.firstTextMs === undefined)
          row.firstTextMs = performance.now() - started;
        if (event.type === 'turn.avatar' && row.firstAvatarMs === undefined)
          row.firstAvatarMs = performance.now() - started;
        if (event.type === 'turn.completed') {
          row.fullTextMs = performance.now() - started;
          row.answer = event.assistant.text;
        }
        if (event.type === 'turn.failed') {
          row.error = event.message;
          resolveDone();
        }
        voice.onChat(event);
      },
    );
    await Promise.race([
      done,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Speech benchmark timeout')), 120000);
        timer.unref();
      }),
    ]);
    row.totalMs = performance.now() - started;
    results.push(row);
    writeFileSync(
      path.join(root, 'logs/latency-optimized.json'),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          model: settings.model,
          reasoningBudget: reasoningBudget(),
          startupMs,
          health,
          conditions:
            'After startCore + voice readiness; new isolated Gateway sessions; audio ready before renderer playback',
          results,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(row));
  }
} finally {
  for (const key of sessions)
    await runCli(
      [
        'gateway',
        'call',
        'sessions.delete',
        '--params',
        JSON.stringify({ key, deleteTranscript: true }),
        '--json',
        '--timeout',
        '60000',
      ],
      rt,
    );
}
