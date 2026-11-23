// SPDX-License-Identifier: GPL-3.0-only
// Real isolated Gateway and compactor, deterministic local provider. No user
// history, model loading or GPU memory is touched by this transport regression.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  root,
  runtime,
  initialize,
  startGateway,
  stopManaged,
} from '../../packages/runtime/src/index.mjs';
import { CompanionRpc } from '../../apps/desktop/gateway-rpc.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';

const parent = path.join(root, '.runtime/context-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'cache-'));
const identity = 'context-cache-' + randomUUID().slice(0, 8);
const key = 'agent:capri:' + identity;
const requests = [],
  turns = [];
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (req.url !== '/api/chat') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ models: [], capabilities: ['completion', 'tools'], model_info: {} }));
    return;
  }
  const body = JSON.parse(raw);
  const last = body.messages?.at(-1)?.content ?? '';
  const summary = last.includes('<conversation>');
  requests.push({ summary, messages: body.messages });
  const content = summary
    ? '## Decisions\nThe synthetic test phrase is copper moon. Inert panel fixtures were discussed.\n\n## Open TODOs\nNone.\n\n## Constraints/Rules\nFollow the live user request.\n\n## Pending user asks\nRespond briefly to the latest prompt.\n\n## Exact identifiers\ncopper moon'
    : 'READY. The synthetic phrase is copper moon.';
  const packet = {
    model: body.model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 4000,
    eval_count: 12,
  };
  res.setHeader(
    'content-type',
    body.stream === false ? 'application/json' : 'application/x-ndjson',
  );
  res.end(JSON.stringify(packet) + '\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
// Reserve an unused gateway port independently of the running desktop.
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const rt = runtime({
  stateDir: path.join(folder, 'state'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
  logPrefix: identity,
});
initialize(rt);
const cfg = JSON.parse(readFileSync(rt.configPath));
cfg.models.providers.ollama.baseUrl = `http://127.0.0.1:${provider.address().port}`;
cfg.tools.allow = ['session_status'];
cfg.memory.search = { enabled: false };
for (const id of ['capri-filesystem', 'capri-applications'])
  if (cfg.plugins.entries[id]) cfg.plugins.entries[id].enabled = false;
cfg.plugins.entries['capri-perception'].config = {
  sessionKey: key,
  stateDirectory: path.relative(root, path.join(folder, 'perception')),
};
writeFileSync(rt.configPath, JSON.stringify(cfg, null, 2));
const rpc = new CompanionRpc({
  url: rt.gatewayUrl,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
});
const messages = new Map();
let tick = 0;
const chat = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: 'capri',
  sessionKey: key,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () => 'CAPRI PERSONALITY (PERSONALITY.md):\nSynthetic test assistant.',
  store: {
    snapshot: () => [...messages.values()],
    put: (m) => messages.set(m.id, structuredClone(m)),
  },
  interfaceState: () => ({ temporalContext: `Elapsed: ${++tick}`, microphone: tick % 2 === 0 }),
});
async function ask(text) {
  const start = requests.length;
  let answer, failure;
  await chat.send({ id: randomUUID(), text }, (event) => {
    if (event.type === 'turn.completed') answer = event.assistant.text;
    if (event.type === 'turn.failed') failure = event.message;
  });
  assert.ok(answer, failure ?? 'No response');
  const request = requests
    .slice(start)
    .findLast((r) =>
      r.messages.some(
        (m) => m.role === 'system' && m.content.includes('CURRENT DESKTOP INTERFACE:'),
      ),
    );
  assert.ok(request);
  turns.push(request);
}
const report = { folder, ownerHistoryTouched: false, passed: false };
try {
  await startGateway(rt);
  await rpc.connect();
  await ask('Hello.');
  await ask('Hello again.');
  assert.deepEqual(
    turns[0].messages.filter((m) => m.role === 'system'),
    turns[1].messages.filter((m) => m.role === 'system'),
    'Native provider system prefix must be stable across clock/mic changes',
  );
  assert.deepEqual(
    turns[0].messages,
    turns[1].messages.slice(0, turns[0].messages.length),
    'Previously evaluated provider messages must remain byte-for-byte reusable',
  );
  const detail = Array.from(
    { length: 38 },
    (_, n) =>
      `Inert synthetic panel ${n}: cobalt trim and copper indicators; a fixed white rectangular frame. No actions requested.`,
  ).join(' ');
  for (let n = 0; n < 6; n++)
    await rpc.call('capri.visual.commit', {
      sessionKey: key,
      id: randomUUID(),
      userText: `Fixture ${n}. The test phrase is copper moon.`,
      assistantText: detail,
      source: { kind: 'window', label: 'Synthetic fixture', capturedAt: Date.now() },
    });
  const before = await rpc.call('chat.history', { sessionKey: key, limit: 100 });
  report.seedCharacters = JSON.stringify(before.messages).length;
  await ask('Reply READY after the long conversation.');
  await ask('Reply READY again.');
  report.summaryRequests = requests.filter((r) => r.summary).length;
  assert.ok(report.summaryRequests > 0, 'History must compact before the hard context limit');
  assert.equal(
    requests.some((r) => r.messages.some((m) => m.content.includes('Write an Activity recap'))),
    false,
    'Unused recaps must not compete with dialogue',
  );
  assert.deepEqual(
    turns[2].messages.filter((m) => m.role === 'system'),
    turns[3].messages.filter((m) => m.role === 'system'),
  );
  const after = await rpc.call('chat.history', { sessionKey: key, limit: 100 });
  assert.ok(JSON.stringify(after.messages).includes('copper moon'));
  report.replayCharacters = turns
    .at(-1)
    .messages.filter((m) => m.role !== 'system')
    .reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  assert.ok(
    report.replayCharacters < report.seedCharacters,
    'Replay should shrink without deleting archive',
  );
  report.passed = true;
} finally {
  rpc.stop();
  await stopManaged(rt.logPrefix);
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(path.join(folder, 'requests.json'), JSON.stringify(requests, null, 2));
}
console.log(JSON.stringify(report));
