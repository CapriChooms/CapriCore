/** Tool-free optional comment joins the existing isolated conversation, not a second context. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  root,
  runtime,
  initialize,
  startGateway,
  stopManaged,
  settings,
  personaPrompt,
} from '../../packages/runtime/src/index.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { CompanionRpc } from '../../apps/desktop/gateway-rpc.mjs';
import { initiativeGenerator } from '../../apps/desktop/initiative-generator.mjs';
import { InitiativeService } from '../../apps/desktop/initiative-service.mjs';
import { INITIATIVE_DEFAULTS } from '../../apps/desktop/initiative-settings.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
const parent = path.join(root, '.runtime/initiative-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: 18798,
  logPrefix: 'initiative-verification',
});
initialize(rt);
const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
config.tools.allow = ['session_status'];
for (const [id, name] of [
  ['capri-filesystem', 'files'],
  ['capri-applications', 'apps'],
])
  config.plugins.entries[id].config = {
    stateDirectory: path.relative(root, path.join(folder, name)),
  };
writeFileSync(rt.configPath, JSON.stringify(config, null, 2));
const key = 'agent:capri:initiative-test-' + randomUUID(),
  messages = new Map(),
  catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));
const rpc = new CompanionRpc({
    url: rt.gatewayUrl,
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  }),
  report = { passed: false, folder, typed: [], comments: [], toolsExposed: false };
let service;
const chat = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: 'capri',
  sessionKey: key,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () => personaPrompt(rt),
  avatarSprites: catalog.publicSprites(),
  defaultAvatarId: catalog.defaultId,
  store: {
    snapshot: () => [...messages.values()],
    put: (m) => messages.set(m.id, structuredClone(m)),
  },
});
async function ask(text) {
  let answer, firstText;
  const start = performance.now();
  await chat.send({ id: randomUUID(), text }, (e) => {
    if (e.type === 'turn.delta') firstText ??= performance.now() - start;
    if (e.type === 'turn.completed') answer = e.assistant.text;
  });
  assert.ok(answer);
  report.typed.push({
    answer,
    firstTextMs: Math.round(firstText),
    totalMs: Math.round(performance.now() - start),
  });
}
try {
  await startGateway(rt);
  await ask("I'm going to step away from the desk for a bit.");
  await ask("I'll be back soon.");
  const generate = initiativeGenerator({
    ollamaUrl: rt.ollamaUrl,
    model: settings.model,
    params: { num_ctx: settings.contextTokens, ...settings.generation, seed: 417 },
    sessionKey: key,
    rpc,
    persona: () => personaPrompt(rt),
    avatars: catalog.publicSprites(),
    fetchImpl: async (url, options) => {
      assert.deepEqual(JSON.parse(options.body).tools, []);
      const started = performance.now();
      try {
        const response = await fetch(url, options);
        const body = await response.clone().json();
        report.generation = {
          elapsedMs: Math.round(performance.now() - started),
          result: body.message?.content,
          promptTokens: body.prompt_eval_count,
          outputTokens: body.eval_count,
        };
        return response;
      } catch (error) {
        report.generation = {
          elapsedMs: Math.round(performance.now() - started),
          error: error.name,
        };
        throw error;
      }
    },
  });
  const start = performance.now();
  service = new InitiativeService({
    settings: { ...INITIATIVE_DEFAULTS, level: 'conversational', quietStart: 0, quietEnd: 0 },
    state: () => ({}),
    generate: async (candidate, options) => {
      const result = await generate(candidate, options);
      report.modelChoseSilence = result.speak !== true;
      report.forcedDeliveryForCommitFixture = result.speak !== true;
      return { ...result, speak: true };
    },
    onError: (message) => {
      report.skippedReason = message;
    },
    commit: async (message, candidate, { signal }) => {
      const result = await rpc.call(
        'chat.inject',
        {
          sessionKey: key,
          message: message.text,
          label: 'Capri initiative / verified Windows return event',
        },
        { signal },
      );
      assert.equal(result.ok, true);
    },
    deliver: (m) =>
      report.comments.push({
        text: m.text,
        origin: m.origin,
        totalMs: Math.round(performance.now() - start),
      }),
  });
  const candidate = service.policy.observe({
    schemaVersion: 1,
    id: randomUUID(),
    source: 'windows-events',
    kind: 'user.return',
    timestamp: Date.now(),
    confidence: 1,
  });
  await service.run(candidate);
  assert.equal(
    report.comments.length,
    1,
    'The commit fixture must exercise delivery; production still honors the model’s silence decision',
  );
  const history = await rpc.call('chat.history', { sessionKey: key, limit: 20 });
  assert.equal(history.messages.filter((m) => m.role === 'user').length, 2);
  const committed = history.messages.find(
    (m) => m.role === 'assistant' && JSON.stringify(m.content).includes(report.comments[0].text),
  );
  assert.ok(committed);
  assert.equal(committed.model, 'capri-initiative');
  assert.equal(JSON.stringify(committed.content).includes('Capri initiative /'), false);
  report.contextModel = committed.model;
  assert.ok(!history.messages.some((m) => m.role === 'toolResult'));
  await ask('What exactly did you say when I returned? Repeat that sentence.');
  const spokenWords = report.comments[0].text.toLowerCase().match(/[a-z]{4,}/g) ?? [],
    recalled = report.typed.at(-1).answer.toLowerCase();
  assert.ok(
    spokenWords.filter((word) => recalled.includes(word)).length >= Math.min(3, spokenWords.length),
    'The regular shared agent must recall the optional comment',
  );
  report.passed = true;
} finally {
  service?.close();
  rpc.stop();
  await stopManaged(rt.logPrefix);
  writeFileSync(
    path.join(root, 'logs/initiative-model-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
