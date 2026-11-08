/** Real Gateway SDK transaction and normal-agent recall; no screen capture. */
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
  personaPrompt,
} from '../../packages/runtime/src/index.mjs';
import { CompanionRpc } from '../../apps/desktop/gateway-rpc.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
const parent = path.join(root, '.runtime/visual-context-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: 18800,
  logPrefix: 'visual-context-verification',
});
initialize(rt);
const key = 'agent:capri:vision-test-' + randomUUID(),
  config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
config.tools.allow = ['session_status'];
for (const [id, name] of [
  ['capri-filesystem', 'files'],
  ['capri-applications', 'apps'],
])
  config.plugins.entries[id].config = {
    stateDirectory: path.relative(root, path.join(folder, name)),
  };
if (!config.plugins.load.paths.includes(path.join(root, 'integrations/perception')))
  config.plugins.load.paths.push(path.join(root, 'integrations/perception'));
config.plugins.entries['capri-perception'] = {
  enabled: true,
  config: { sessionKey: key, stateDirectory: path.relative(root, path.join(folder, 'perception')) },
};
writeFileSync(rt.configPath, JSON.stringify(config, null, 2));
const rpc = new CompanionRpc({
    url: rt.gatewayUrl,
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  }),
  messages = new Map(),
  report = { passed: false, folder, capturedRealScreen: false };
const chat = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: 'capri',
  sessionKey: key,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () => personaPrompt(rt),
  store: {
    snapshot: () => [...messages.values()],
    put: (m) => messages.set(m.id, structuredClone(m)),
  },
});
async function ask(text) {
  let answer;
  await chat.send({ id: randomUUID(), text }, (e) => {
    if (e.type === 'turn.completed') answer = e.assistant.text;
  });
  assert.ok(answer);
  return answer;
}
try {
  await startGateway(rt);
  await ask('Hello Capri. This is an isolated verification.');
  const source = { kind: 'window', label: 'Generated shape fixture', capturedAt: Date.now() },
    turn = {
      sessionKey: key,
      id: randomUUID(),
      userText: 'What shapes are in this image?',
      assistantText: 'A red square and a blue circle.',
      source,
    };
  const first = await rpc.call('capri.visual.commit', turn);
  assert.equal(first.ok, true);
  assert.equal(first.imageRetained, false);
  assert.deepEqual(await rpc.call('capri.visual.commit', turn), first);
  const history = await rpc.call('chat.history', { sessionKey: key, limit: 20 });
  assert.equal(history.messages.filter((m) => m.role === 'user').length, 2);
  assert.equal(
    history.messages.filter((m) => JSON.stringify(m.content).includes('red square')).length,
    1,
  );
  report.recall = await ask('Which two shapes did you just identify?');
  assert.match(report.recall, /red square/i);
  assert.match(report.recall, /blue circle/i);
  await assert.rejects(
    rpc.call('capri.visual.commit', { ...turn, id: randomUUID(), image: 'forbidden' }),
  );
  report.passed = true;
} finally {
  rpc.stop();
  await stopManaged(rt.logPrefix);
  writeFileSync(
    path.join(root, 'logs/visual-context-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
