// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, link, symlink, rename, utimes } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeveloperDiagnostics } from '../apps/desktop/diagnostics/developer.mjs';
import { responseTimelines } from '../apps/desktop/diagnostics/response-timeline.mjs';

const origin = Date.parse('2026-11-09T10:00:00.000Z');
const trace = randomUUID(),
  request = randomUUID();
const row = (stage, ms, source = 'desktop', values = {}) => ({
  event: 'response-timing',
  traceId: trace,
  source,
  stage,
  time: new Date(origin + ms).toISOString(),
  elapsedMs: ms,
  ...values,
});

test('joins correlated events without subtracting clocks from different processes', () => {
  const result = responseTimelines([
    row('received', 0),
    row('chat_started', 3),
    row('model_start', 5),
    row('model_ready', 55),
    row('gateway_dispatch', 60),
    row('gateway_received', 62, 'gateway', { elapsedMs: 0 }),
    row('provider_request', 64, 'provider', {
      elapsedMs: 5000,
      requestId: request,
      modelId: 'qwen:4b',
    }),
    row('provider_first_token', 74, 'provider', { elapsedMs: 5010, requestId: request }),
    row('provider_finished', 170, 'provider', {
      elapsedMs: 5106,
      requestId: request,
      loadMs: 2,
      promptEvalMs: 8,
      evalMs: 80,
      outputTokens: 8,
      promptTokens: 120,
    }),
    row('gateway_first_token', 80),
    row('first_delta', 81),
    row('first_paint', 90, 'renderer', { elapsedMs: 90 }),
    row('completed', 180),
  ])[0];
  assert.equal(result.totalMs, 180);
  assert.equal(result.firstTextMs, 81);
  assert.equal(result.firstPaintMs, 90);
  assert.equal(result.phases.find((p) => p.id === 'model').durationMs, 50);
  assert.equal(result.phases.find((p) => p.id === 'gateway').durationMs, 20);
  assert.equal(result.calls[0].firstTokenMs, 10);
  assert.equal(result.calls[0].tokensPerSecond, 100);
  assert.equal(result.modelId, 'qwen:4b');
  assert.equal(result.status, 'completed');
});
test('missing counters and failures remain explicit; unlinked calls are not assigned by time', () => {
  const orphan = {
    ...row('provider_request', 20, 'provider', { requestId: request }),
    traceId: randomUUID(),
  };
  const result = responseTimelines([
    row('received', 0),
    row('first_delta', 40),
    row('failed', 50),
    orphan,
  ]);
  const turn = result.find((x) => x.id === trace),
    call = result.find((x) => x.id === orphan.traceId);
  assert.equal(turn.status, 'failed');
  assert.equal(turn.calls.length, 0);
  assert.equal(turn.totalMs, 50);
  assert.equal(turn.phases.find((p) => p.id === 'model').durationMs, null);
  assert.equal(call.linked, false);
  assert.equal(call.totalMs, null);
  assert.equal(call.status, 'incomplete');
});
test('rotation duplicates are removed and unknown private fields cannot reach the renderer', () => {
  const event = {
    ...row('received', 0),
    prompt: 'secret dialogue',
    apiKey: 'sk-private',
    memory: 'private facts',
  };
  const result = responseTimelines([event, event, row('completed', 30)]);
  assert.equal(result[0].events.length, 2);
  assert(!JSON.stringify(result).includes('private'));
  assert(!JSON.stringify(result).includes('secret dialogue'));
});
test('multiple model calls remain separate and newest request limit is bounded', () => {
  const input = [
    row('received', 0),
    row('provider_request', 1, 'provider', { requestId: request }),
    row('provider_request', 2, 'provider', { requestId: randomUUID() }),
  ];
  for (let n = 1; n < 50; n++) input.push({ ...row('received', n * 10), traceId: randomUUID() });
  assert.equal(responseTimelines(input).length, 40);
  assert.equal(
    responseTimelines(input, { maximum: 100 }).find((x) => x.id === trace).calls.length,
    2,
  );
});
test('negative or missing elapsed durations are never presented as zero or a gain', () => {
  const result = responseTimelines([row('received', 0)])[0];
  assert.equal(result.totalMs, null);
  const invalid = responseTimelines([
    row('received', 0),
    row('model_start', 1),
    row('model_ready', 2, 'desktop', { elapsedMs: 0 }),
  ])[0];
  assert.equal(invalid.phases.find((x) => x.id === 'model').durationMs, null);
});

async function fixture() {
  const parent = path.resolve('.runtime/developer-diagnostics-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  await mkdir(path.join(root, 'logs'));
  return { root, service: new DeveloperDiagnostics({ root }) };
}
test('technical log viewer and timeline never return dialogue, credentials, or arbitrary files', async () => {
  const { root, service } = await fixture();
  await writeFile(
    path.join(root, 'logs', 'capri.stderr.log'),
    'Authorization: Bearer sk-private-example\nprivate conversation\n' +
      JSON.stringify({
        event: 'failure',
        stage: 'starting',
        password: 'secret',
        message: 'my memories',
        exitCode: 1,
      }) +
      '\n',
  );
  await writeFile(
    path.join(root, 'logs', 'response-desktop.jsonl'),
    [row('received', 0), row('completed', 90)].map(JSON.stringify).join('\n'),
  );
  await writeFile(path.join(root, 'logs', 'conversation-history.log'), 'must not be listed');
  const snapshot = await service.snapshot();
  assert.equal(snapshot.turns[0].totalMs, 90);
  assert(snapshot.logs.every((x) => !('file' in x) && !x.name.includes('history')));
  const log = await service.read(snapshot.logs.find((x) => x.name === 'capri.stderr.log').id);
  assert(log.text.includes('exitCode'));
  assert(!/private conversation|sk-private-example|secret|memories|Bearer/.test(log.text));
  await assert.rejects(service.read('../config/core.local.json'), /Invalid log selection/);
  await assert.rejects(service.read('a'.repeat(24)), /no longer available/);
});
test('linked files and linked directories cannot add external content to the log catalog', async (t) => {
  const { root, service } = await fixture();
  const outside = path.join(root, 'outside.txt');
  await writeFile(outside, 'private');
  await link(outside, path.join(root, 'logs', 'linked.log'));
  let supported = true;
  try {
    await symlink(outside, path.join(root, 'logs', 'symbolic.log'), 'file');
  } catch (e) {
    if (!['EPERM', 'EACCES'].includes(e.code)) throw e;
    supported = false;
  }
  const snapshot = await service.snapshot();
  assert.equal(snapshot.logs.length, 0);
  if (!supported) t.diagnostic('Symlink creation unavailable; hardlink exclusion verified.');
});
test('log reads are bounded and refresh caching does not introduce background work', async () => {
  const { root, service } = await fixture();
  await writeFile(
    path.join(root, 'logs', 'large.log'),
    Array(2000).fill('{"event":"failure","exitCode":1,"password":"secret"}').join('\n'),
  );
  let collections = 0;
  const original = service.collect.bind(service);
  service.collect = () => {
    collections++;
    return original();
  };
  const [a, b] = await Promise.all([service.snapshot(), service.snapshot()]);
  assert.equal(a, b);
  assert.equal(collections, 1);
  assert.equal(await service.snapshot(), a);
  assert.equal(collections, 1);
  const log = await service.read(a.logs[0].id);
  assert.equal(log.truncated, true);
  assert(log.text.length <= 64 * 1024);
  assert(!log.text.includes('secret'));
});
test('no diagnostic directory is a normal empty state', async () => {
  const { root } = await fixture();
  const service = new DeveloperDiagnostics({ root: path.join(root, 'missing') });
  const result = await service.snapshot();
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.turns, []);
  await assert.rejects(service.folder(), /not available yet/);
});

test('a catalogued file replaced with a hardlink is rejected at read time', async () => {
  const { root, service } = await fixture();
  const file = path.join(root, 'logs', 'safe.log');
  await writeFile(file, '{"event":"started"}\n');
  const snapshot = await service.snapshot();
  await rename(file, path.join(root, 'original.log'));
  const outside = path.join(root, 'private.txt');
  await writeFile(outside, 'private data');
  await link(outside, file);
  await assert.rejects(service.read(snapshot.logs[0].id), /no longer available/);
});

test('unchanged timing files reuse parsed timelines after the snapshot cache expires', async () => {
  const { root } = await fixture();
  let now = origin;
  const service = new DeveloperDiagnostics({ root, now: () => now });
  await writeFile(
    path.join(root, 'logs', 'response-desktop.jsonl'),
    JSON.stringify(row('received', 0)),
  );
  const before = await service.snapshot();
  now += 3000;
  const after = await service.snapshot();
  assert.notEqual(before, after);
  assert.equal(before.turns, after.turns);
});

test('installer logs come from the newest sessions rather than UUID alphabetical order', async () => {
  const { root } = await fixture();
  const installerDirectory = path.join(root, 'installer');
  for (let n = 0; n < 4; n++) {
    const folder = path.join(installerDirectory, 'sessions', String(n).repeat(32));
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'worker-' + n + '.log'), '{"event":"started"}\n');
    const date = new Date(origin - n * 86400000);
    await utimes(folder, date, date);
  }
  const service = new DeveloperDiagnostics({ root, installerDirectory });
  const snapshot = await service.snapshot();
  assert.deepEqual(snapshot.logs.map((log) => log.name).sort(), [
    'worker-0.log',
    'worker-1.log',
    'worker-2.log',
  ]);
});
