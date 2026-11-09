import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { RequestRouter } from '../apps/desktop/request-router.mjs';
import { root } from '../packages/runtime/src/index.mjs';

function fixture(t, timeoutMs = 100) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.requests = [];
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      child.requests.push(JSON.parse(chunk));
      done();
    },
  });
  child.kill = () => {
    child.killed = true;
    child.emit('exit', 0);
  };
  let spawnOptions;
  const router = new RequestRouter({
    root,
    exists: () => true,
    config: { schemaVersion: 1, enabled: true, timeoutMs },
    spawnImpl: (_python, _args, options) => {
      spawnOptions = options;
      return child;
    },
  });
  t.after(() => router.close());
  const ready = router.start();
  const emit = (event) => child.stdout.write(JSON.stringify(event) + '\n');
  emit({ type: 'ready', protocol: 1, provider: 'cpu' });
  return { router, child, emit, ready, options: () => spawnOptions };
}

test('warm classifier uses bounded private IPC and returns a mode without modifying the request', async (t) => {
  const f = fixture(t);
  assert.equal(await f.ready, true);
  const text = 'Hey Capri, how are you?';
  const result = f.router.classify(text, { context: ['old', 'x'.repeat(900), 'last'] });
  assert.equal(f.child.requests[0].text, text);
  assert.equal(f.child.requests[0].context.length, 2);
  assert.equal(f.child.requests[0].context[0].length, 400);
  f.emit({ type: 'result', request: 1, mode: 'fast', reason: 'simple-dialogue', elapsedMs: 2 });
  assert.deepEqual(await result, { mode: 'fast', reason: 'simple-dialogue', classificationMs: 2 });
  assert.equal(f.options().windowsHide, true);
  assert.equal(f.options().env.HF_HUB_OFFLINE, '1');
  assert.equal(f.options().env.OPENCLAW_GATEWAY_TOKEN, undefined);
});

test('timeout, malformed results and missing installation fall back to the normal route', async (t) => {
  const timeout = fixture(t, 25);
  await timeout.ready;
  assert.equal((await timeout.router.classify('Hello Capri')).mode, 'normal');
  assert.equal(timeout.child.killed, true);
  const bad = fixture(t);
  await bad.ready;
  const pending = bad.router.classify('Hello Capri');
  bad.emit({ type: 'result', request: 1, mode: 'execute-spotify', reason: 'bad', elapsedMs: 1 });
  assert.equal((await pending).mode, 'normal');
  const missing = new RequestRouter({
    root,
    exists: () => false,
    config: { schemaVersion: 1, enabled: true, timeoutMs: 150 },
    spawnImpl: () => assert.fail('must not spawn'),
  });
  assert.equal(await missing.start(), false);
  assert.equal((await missing.classify('Hello Capri')).mode, 'normal');
});

test('cancellation rejects classification and ignores its late result before a fresh request', async (t) => {
  const f = fixture(t);
  await f.ready;
  const controller = new AbortController();
  const old = f.router.classify('Hello Capri', { signal: controller.signal });
  controller.abort();
  await assert.rejects(old, { name: 'AbortError' });
  const next = f.router.classify('How are you?');
  f.emit({ type: 'result', request: 1, mode: 'fast', reason: 'simple-dialogue', elapsedMs: 1 });
  assert.equal(f.router.pending.size, 1);
  f.emit({ type: 'result', request: 2, mode: 'normal', reason: 'uncertain', elapsedMs: 1 });
  assert.equal((await next).mode, 'normal');
  f.router.close();
  assert.equal(f.router.child, null);
  assert.equal(await f.router.start(), false);
  assert.equal(f.router.isReady, false);
});

test('the reviewed Gateway override allows owner-only one-shot reasoning for conversation without persistence', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../integrations/openclaw-compat/patches.json', import.meta.url), 'utf8'),
  );
  const edits = manifest.patches.find((p) => p.file.includes('openai-http-')).edits;
  let source = edits[0].after;
  for (const edit of edits.slice(1))
    if (source.includes(edit.before)) source = source.replace(edit.before, edit.after);
  const invoke = new Function(
    'req',
    'agentId',
    'senderIsOwner',
    'res',
    'sendInvalidRequest',
    'resolveActiveTurnContext',
    'payload',
    source + '\nreturn capriThinkingOnce;',
  );
  let errors = 0;
  const call = (header, agent = 'capri', owner = true, domain = 'conversation') =>
    invoke(
      {
        headers: {
          ...(header === undefined ? {} : { 'x-capri-thinking-once': header }),
          ...(domain ? { 'x-capri-tools-once': domain } : {}),
        },
      },
      agent,
      owner,
      {},
      () => errors++,
      () => ({}),
      { messages: [] },
    );
  assert.equal(call('off'), 'off');
  assert.equal(call('off', 'capri', true, 'dialogue'), 'off');
  assert.equal(call('medium'), 'medium');
  assert.equal(call('medium', 'capri', true, 'dialogue'), 'medium');
  assert.equal(call(undefined), undefined);
  for (const args of [
    ['high'],
    ['off', 'other'],
    ['off', 'capri', false],
    [['off', 'off']],
    ['medium', 'capri', false],
    ['medium', 'capri', true, 'spotify'],
    ['medium', 'capri', true, null],
  ])
    assert.equal(call(...args), true);
  assert.equal(errors, 7);
});

test('plain dialogue has no tools; personal recall keeps memory and never broadens persistent permissions', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../integrations/openclaw-compat/patches.json', import.meta.url), 'utf8'),
  );
  const patch = manifest.patches.find((p) => p.file.includes('openai-tool-choice-'));
  let source = patch.edits[0].after;
  for (const edit of patch.edits.slice(1))
    if (source.includes(edit.before)) source = source.replace(edit.before, edit.after);
  const line = source.split('\n').find((line) => line.includes('toolsAllow:'));
  const allow = new Function('params', 'return ({' + line + '}).toolsAllow;');
  assert.deepEqual(allow({ capriToolsOnce: 'dialogue' }), []);
  assert.deepEqual(allow({ capriToolsOnce: 'conversation' }), ['memory_search', 'memory_get']);
  assert.deepEqual(allow({ capriToolsOnce: 'desktop' }), ['desktop_control', 'settings_control']);
  assert.equal(allow({}), undefined);
});
