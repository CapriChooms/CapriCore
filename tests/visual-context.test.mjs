import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../packages/runtime/src/index.mjs';
import {
  VisualContextService,
  validateVisualTurn,
} from '../integrations/perception/context-service.mjs';
const sessionKey = 'agent:capri:fixture';
const packet = () => ({
  sessionKey,
  id: '00000000-0000-4000-8000-000000000001',
  userText: 'What is in this snapshot?',
  assistantText: 'A red square and a blue circle.',
  source: { kind: 'window', label: 'Owned fixture', capturedAt: Date.now() },
});
test('visual commits accept bounded text/provenance and reject image data or another session', () => {
  const p = packet();
  assert.equal(validateVisualTurn(p, sessionKey).source.kind, 'window');
  for (const value of [
    { ...p, sessionKey: 'agent:capri:other' },
    { ...p, image: 'bytes' },
    { ...p, userText: 'data:image/png;base64,abc' },
    { ...p, assistantText: 'a'.repeat(600) },
    { ...p, source: { ...p.source, capturedAt: NaN } },
  ])
    assert.throws(() => validateVisualTurn(value, sessionKey));
});
test('visual dialogue commits as one ordered pair, with durable retry protection and no image', async (t) => {
  const parent = path.join(root, '.runtime/test-data');
  await fs.mkdir(parent, { recursive: true });
  const dir = await fs.mkdtemp(path.join(parent, 'visual-'));
  const database = path.join(dir, 'commits.sqlite');
  let calls = 0,
    received;
  const options = {
    sessionKey,
    database,
    resolve: async () => ({ agentId: 'capri', sessionKey, sessionId: 'owned-session' }),
    append: async (value) => {
      calls++;
      received = value;
      return [{ messageId: 'user' }, { messageId: 'assistant' }];
    },
    publish: async () => {},
  };
  let service = new VisualContextService(options);
  t.after(() => service.close());
  const value = packet(),
    result = await service.commit(value);
  assert.equal(result.imageRetained, false);
  assert.equal(calls, 1);
  assert.deepEqual(
    received.messages.map((m) => m.message.role),
    ['user', 'assistant'],
  );
  assert.ok(!JSON.stringify(received).includes('base64'));
  const savedText = received.messages[0].message.content[0].text;
  assert.match(savedText, /Historical one-shot image/);
  assert.doesNotMatch(savedText, /Owned fixture|\d{4}-\d{2}-\d{2}T/);
  assert.equal(received.messages[0].message.capriObservation.capturedAt, value.source.capturedAt);
  await service.close();
  service = new VisualContextService(options);
  assert.deepEqual(await service.commit(value), result);
  assert.equal(calls, 1);
  await assert.rejects(service.commit({ ...value, assistantText: 'Changed' }), /cannot change/);
  await assert.rejects(
    service.commit({
      ...value,
      id: '00000000-0000-4000-8000-000000000003',
      source: { ...value.source, capturedAt: Date.now() - 180000 },
    }),
    /expired/,
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.commit(
      { ...value, id: '00000000-0000-4000-8000-000000000002' },
      { signal: controller.signal },
    ),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});
