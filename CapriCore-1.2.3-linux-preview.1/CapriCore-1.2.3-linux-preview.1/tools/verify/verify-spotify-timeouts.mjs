/** Real Gateway progress and Qwen tool choice; never changes Spotify playback. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import {
  root,
  runtime,
  settings,
  request,
  runCli,
  personaPrompt,
} from '../../packages/runtime/src/index.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import spotifyPlugin from '../../integrations/spotify/index.mjs';
import { invokeSpotify } from '../../integrations/spotify/cli.mjs';

const rt = runtime(),
  sessionKey = `agent:${settings.agentId}:spotify-timeout-verification-${randomUUID()}`;
const messages = new Map(),
  events = [],
  report = { passed: false, playbackMutated: false };
let transportDiagnostic;
const service = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: settings.agentId,
  sessionKey,
  avatarSprites: loadAvatarCatalog(ACTIVE_AVATAR_CATALOG).publicSprites(),
  fetchImpl: async (url, options) => {
    const response = await fetch(url, options),
      copy = response.clone();
    transportDiagnostic = copy
      .text()
      .then((body) => {
        report.httpStatus = response.status;
        if (!response.ok) report.transportError = body.slice(0, 1000);
        else
          for (const line of body.split('\n').filter((l) => l.startsWith('data: {'))) {
            const value = JSON.parse(line.slice(6));
            if (value.error) report.transportError = value.error;
          }
      })
      .catch((error) => {
        report.transportError = error.name;
      });
    return response;
  },
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () => personaPrompt(rt),
  store: {
    snapshot: () => [...messages.values()],
    put: (message) => messages.set(message.id, { ...message }),
  },
});
try {
  const started = performance.now();
  await service.send(
    {
      id: randomUUID(),
      text: 'Check the current Spotify playback status. Do not play, pause, search or change anything.',
    },
    (event) => events.push(event),
  );
  assert.equal(events.at(-1).type, 'turn.completed', events.at(-1).message);
  const progress = events.filter((e) => e.type === 'turn.tool' && e.tool === 'spotify_control');
  assert.ok(
    progress.some((e) => e.phase === 'start') && progress.some((e) => e.phase === 'result'),
    'Real Gateway must deliver tool lifecycle metadata',
  );
  report.statusMs = Math.round(performance.now() - started);
  report.progress = progress.map(({ phase, tool }) => ({ phase, tool }));
  const player = await invokeSpotify({ action: 'status' });
  report.spotifyRunning = player.running;

  // Test the model's actual action choice without dispatching that action.
  let tool;
  spotifyPlugin.register({
    source: path.join(root, 'integrations/spotify/index.mjs'),
    registerTool: (value) => {
      tool = value;
    },
    registerService() {},
  });
  const response = await request(rt.ollamaUrl + '/api/chat', {
    method: 'POST',
    timeout: 90000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      think: false,
      keep_alive: -1,
      truncate: false,
      shift: false,
      messages: [
        {
          role: 'system',
          content:
            'Use the provided Spotify tool to carry out the request. For named music playback use play with query directly; it searches and verifies playback. Do not search first.',
        },
        {
          role: 'user',
          content: 'Can you play I Really Want to Stay at Your House in my Spotify?',
        },
      ],
      tools: [
        {
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        },
      ],
      options: { num_ctx: settings.contextTokens, num_predict: 256 },
    }),
  });
  const selected = response.message?.tool_calls?.find((c) => c.function?.name === 'spotify_control')
    ?.function.arguments;
  assert.equal(selected?.action, 'play');
  assert.match(selected.query, /really.*want.*stay.*house/i);
  report.selectedAction = selected.action;
  report.selectionExecuted = false;
  report.passed = true;
} finally {
  await transportDiagnostic;
  await runCli(
    [
      'gateway',
      'call',
      'sessions.delete',
      '--params',
      JSON.stringify({ key: sessionKey, deleteTranscript: true }),
      '--json',
      '--timeout',
      '15000',
    ],
    rt,
  ).catch(() => {});
  writeFileSync(
    path.join(root, 'logs/spotify-timeout-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
