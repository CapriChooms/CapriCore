/** Dense synthetic shared conversation, real compaction/Qwen, optional silent-memory fault. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  root,
  runtime,
  initialize,
  startGateway,
  stopManaged,
  runCli,
  personaPrompt,
} from '../../packages/runtime/src/index.mjs';
import { CompanionRpc } from '../../apps/desktop/gateway-rpc.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';

const parent = path.join(root, '.runtime/context-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  stallMemory = process.argv.includes('--stall-memory');
const key = 'agent:capri:context-test-' + randomUUID();
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: 18803,
  logPrefix: 'context-verification',
});
initialize(rt);
const report = {
  passed: false,
  folder,
  stallMemory,
  turns: [],
  requests: [],
  ownerHistoryTouched: false,
};
const proxy = createServer(async (req, res) => {
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url === '/api/chat') {
      const data = JSON.parse(body),
        last = data.messages?.at(-1)?.content ?? '';
      const memory =
        typeof last === 'string' && /NO_REPLY/i.test(last) && /memory|memories/i.test(last);
      report.requests.push({
        memory,
        summary: typeof last === 'string' && last.startsWith('<conversation>'),
        promptCharacters: data.messages.reduce((n, m) => n + String(m.content ?? '').length, 0),
        contextTokens: data.options?.num_ctx,
        outputLimit: data.options?.num_predict,
        lastUser: data.messages
          .filter((m) => m.role === 'user')
          .at(-1)
          ?.content?.slice(0, 200),
      });
      if (stallMemory && memory && !report.memoryStalled) {
        report.memoryStalled = true;
        const start = performance.now();
        res.once('close', () => {
          report.memoryAbortMs = Math.round(performance.now() - start);
        });
        return; // No output at all; the real maintenance signal must abort this request.
      }
    }
    const upstream = await fetch(rt.ollamaUrl + req.url, {
      method: req.method,
      ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}),
      signal: controller.signal,
    });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    if (upstream.body)
      Readable.fromWeb(upstream.body)
        .on('error', () => res.destroy())
        .pipe(res);
    else res.end();
  } catch {
    if (!res.destroyed) {
      res.writeHead(502);
      res.end();
    }
  }
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
config.models.providers.ollama.baseUrl = `http://127.0.0.1:${proxy.address().port}`;
config.tools.allow = ['read', 'write', 'edit', 'memory_search', 'memory_get', 'session_status'];
for (const [id, name] of [
  ['capri-filesystem', 'files'],
  ['capri-applications', 'apps'],
])
  config.plugins.entries[id].config = {
    stateDirectory: path.relative(root, path.join(folder, name)),
  };
config.plugins.entries['capri-perception'].config = {
  sessionKey: key,
  stateDirectory: path.relative(root, path.join(folder, 'perception')),
};
writeFileSync(rt.configPath, JSON.stringify(config, null, 2));
const rpc = new CompanionRpc({
  url: rt.gatewayUrl,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
});
const messages = new Map(),
  chat = new ChatService({
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
  let answer, firstTextMs, failure;
  const start = performance.now();
  await chat.send({ id: randomUUID(), text }, (e) => {
    if (e.type === 'turn.delta') firstTextMs ??= Math.round(performance.now() - start);
    if (e.type === 'turn.completed') answer = e.assistant.text;
    if (e.type === 'turn.failed') failure = e.message;
  });
  report.turns.push({
    answer,
    firstTextMs,
    totalMs: Math.round(performance.now() - start),
    failure,
  });
  console.log(JSON.stringify(report.turns.at(-1)));
  assert.ok(answer, failure ?? 'The real model must complete');
  return answer;
}
try {
  const validation = JSON.parse((await runCli(['config', 'validate', '--json'], rt)).stdout);
  assert.equal(validation.valid, true);
  await startGateway(rt);
  // This isolated Gateway has not had startCore's normal preparation turn.
  chat.firstTextTimeoutMs = 90000;
  await ask('Hello. This is an isolated synthetic context test. Reply briefly.');
  chat.firstTextTimeoutMs = 30000;
  const detail = Array.from(
    { length: 60 },
    (_, n) =>
      `Synthetic panel ${n}: cobalt trim, copper indicator, white background, a fixed rectangular frame; these are inert test descriptions, with no actions requested.`,
  )
    .join(' ')
    .slice(0, 4800);
  for (let n = 0; n < 4; n++)
    await rpc.call('capri.visual.commit', {
      sessionKey: key,
      id: randomUUID(),
      userText:
        `Synthetic fixture ${n}. ` +
        (n === 0 ? "The owner's test phrase is copper moon. " : '') +
        'Describe this inert generated panel.',
      assistantText:
        (n === 0 ? 'The test phrase is copper moon. ' : '') + `Fixture ${n}. ` + detail,
      source: {
        kind: 'window',
        label: 'Synthetic text fixture; no physical capture',
        capturedAt: Date.now(),
      },
    });
  const before = await rpc.call('chat.history', { sessionKey: key, limit: 100 });
  report.seededMessages = before.messages.length;
  assert.ok(JSON.stringify(before.messages).length > 20000);
  await ask(
    'This is the new request after the fixture descriptions. Reply exactly READY42 and nothing else.',
  );
  assert.match(report.turns.at(-1).answer, /READY42/i);
  await ask('Reply exactly READY43 and nothing else.');
  assert.match(report.turns.at(-1).answer, /READY43/i);
  const archived = await rpc.call('chat.history', { sessionKey: key, limit: 100 });
  report.archivedEarlyFact = JSON.stringify(archived.messages).includes('copper moon');
  assert.equal(report.archivedEarlyFact, true, 'Compaction must not delete the saved conversation');
  // A disabled/slow optional memory provider must not enter the foreground path.
  report.foregroundMemoryRequests = report.requests.filter((request) => request.memory).length;
  assert.equal(report.foregroundMemoryRequests, 0);
  assert.ok(report.turns.slice(1).every((t) => t.firstTextMs < 30000));
  report.compactionObserved = report.requests.some((request) => request.summary);
  assert.equal(report.compactionObserved, true);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  rpc.stop();
  await stopManaged(rt.logPrefix);
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  writeFileSync(
    path.join(
      root,
      stallMemory
        ? 'logs/context-pressure-stalled-memory.json'
        : 'logs/context-pressure-verification.json',
    ),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  JSON.stringify({
    passed: report.passed,
    turns: report.turns,
    memoryAbortMs: report.memoryAbortMs,
    folder,
  }),
);
