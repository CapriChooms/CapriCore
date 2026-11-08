// SPDX-License-Identifier: GPL-3.0-only
/** Real pinned OpenClaw + local Qwen, isolated clocks/settings and no owner history. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  root,
  runtime,
  initialize,
  startGateway,
  stopManaged,
  startOllama,
  managedProcess,
  settings,
} from '../../packages/runtime/src/index.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { CompanionActions } from '../../apps/desktop/companion-actions.mjs';
import { ensureLanguageModelReady } from '../../packages/runtime/src/providers/model-residency.mjs';
const parent = path.join(root, '.runtime/companion-tools-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-')),
  rt = runtime({
    workspace: path.join(folder, 'workspace'),
    stateDir: path.join(folder, 'openclaw'),
    gatewayPort: 18797,
    logPrefix: 'companion-tools-verification',
  });
initialize(rt);
const cfg = JSON.parse(readFileSync(rt.configPath));
cfg.tools.allow = ['time_control', 'settings_control', 'session_status'];
cfg.plugins.entries['capri-companion-tools'].config.endpointRoot = path.relative(root, folder);
cfg.plugins.load.paths = [path.join(root, 'integrations/companion-tools')];
cfg.plugins.entries = { 'capri-companion-tools': cfg.plugins.entries['capri-companion-tools'] };
writeFileSync(rt.configPath, JSON.stringify(cfg, null, 2));
let strength = 65;
const actions = new CompanionActions({
  root: folder,
  emit() {},
  deliver: async () => {},
  desktop: {
    close() {},
    execute() {
      throw new Error('Not enabled in this fixture.');
    },
  },
  settings: () => ({ glitchStrength: strength }),
  setSetting: (_, value) => (strength = value),
  requestSetting() {
    throw new Error('Not enabled in this fixture.');
  },
});
const messages = new Map(),
  turns = [];
const chat = new ChatService({
  prepareModel: ({ signal }) =>
    ensureLanguageModelReady(
      {
        url: rt.ollamaUrl,
        model: settings.model,
        contextTokens: settings.contextTokens,
        keepAlive: settings.keepAlive,
      },
      { signal },
    ),
  gatewayUrl: rt.gatewayUrl,
  agentId: 'capri',
  sessionKey: 'agent:capri:time-fixture-' + randomUUID(),
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () =>
    'You are Capri. This is an isolated tool verification. Use the listed tools to carry out the explicit request and confirm the actual result in one short sentence. Never write memories.',
  avatarSprites: [],
  defaultAvatarId: 'neutral',
  store: {
    snapshot: () => [...messages.values()],
    put: (v) => messages.set(v.id, structuredClone(v)),
  },
});
const report = { passed: false, folder, ownerHistoryChanged: false, turns };
const previousOllama = managedProcess('ollama');
try {
  await actions.start();
  await startOllama(rt);
  await startGateway(rt);
  for (const text of [
    'Remind me in ten minutes to drink tea.',
    'Set the visual glitch strength to twenty percent.',
  ]) {
    await chat.send({ id: randomUUID(), text }, (e) => {
      if (e.type === 'turn.completed') turns.push(e.assistant.text);
    });
  }
  assert.ok(
    actions.time
      .snapshot()
      .some(
        (o) =>
          o.kind === 'reminder' &&
          /tea/i.test(o.title) &&
          o.remainingMs > 500000 &&
          o.remainingMs <= 600000,
      ),
    JSON.stringify({ clocks: actions.time.snapshot(), turns }),
  );
  assert.equal(strength, 20, JSON.stringify(turns));
  assert.equal(turns.length, 2);
  report.passed = true;
} finally {
  actions.close();
  await stopManaged('companion-tools-verification');
  if (!previousOllama) await stopManaged('ollama');
  writeFileSync(path.join(folder, 'result.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
