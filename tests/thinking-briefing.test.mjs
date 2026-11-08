// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { thinkingBriefing } from '../apps/desktop/thinking-briefing.mjs';

const publicBriefing = {
  text: 'Those remainders look sneaky — let me check where they meet.',
  approach: 'Express both conditions as congruences. Check their shared boundary cases.',
};
const packet = (value = publicBriefing, extra = {}) =>
  JSON.stringify({
    message: { content: JSON.stringify(value), reasoning_content: 'PRIVATE_PROVIDER_FIELD' },
    ...extra,
  });

test('briefing uses only the active local/proxy inference transport and the current text/language', async () => {
  for (const port of [11434, 18792]) {
    const calls = [];
    const prepare = thinkingBriefing({
      url: `http://127.0.0.1:${port}`,
      model: 'selected-model',
      fetchImpl: async (url, request) => {
        calls.push({ url, request });
        return new Response(packet());
      },
    });
    assert.deepEqual(
      await prepare({ text: 'Compare the remainder conditions.', language: 'Russian' }),
      publicBriefing,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `http://127.0.0.1:${port}/api/chat`);
    const request = calls[0].request,
      body = JSON.parse(request.body);
    assert.equal(request.redirect, 'error');
    assert.deepEqual(request.headers, { 'content-type': 'application/json' });
    assert.equal(body.model, 'selected-model');
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.options.num_predict, 192);
    assert.equal(body.options.temperature, 0.7);
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[1].content, 'Compare the remainder conditions.');
    assert.ok(body.messages[0].content.includes('Russian'));
    assert.match(body.messages[0].content, /You are Capri/);
    assert.match(body.messages[0].content, /first person/);
    assert.match(body.messages[0].content, /one specific detail/);
    assert.match(body.messages[0].content, /serious or sensitive questions/);
    assert.equal(/history|persona|images|authorization|session/i.test(JSON.stringify(body)), false);
  }
  for (const url of ['https://example.com', 'http://localhost:11434', 'http://user:pass@127.0.0.1'])
    assert.throws(() => thinkingBriefing({ url, model: 'fixture' }));
});

test('dry task-report introductions are omitted without retrying or substituting a stock phrase', async () => {
  for (const text of [
    'This task asks for an estimate of YouTube views over a lifetime.',
    'The user asks how much time people spend watching videos.',
    'This question asks about physics.',
    'Эта задача требует оценить число просмотров.',
    'Пользователь просит оценить число просмотров.',
  ]) {
    let calls = 0;
    const prepare = thinkingBriefing({
      url: 'http://127.0.0.1:11434',
      model: 'fixture',
      fetchImpl: async () => {
        calls++;
        return new Response(packet({ ...publicBriefing, text }));
      },
    });
    assert.equal(await prepare({ text: 'How often do people watch YouTube?' }), null);
    assert.equal(calls, 1);
  }
});

test('briefing malformed, private-tagged, truncated and tool output silently fails closed', async () => {
  for (const raw of [
    'not JSON',
    packet(null),
    packet({ ...publicBriefing, analysis: 'PRIVATE' }),
    packet({ ...publicBriefing, text: '<think>PRIVATE</think>' }),
    packet({ ...publicBriefing, approach: 'x'.repeat(901) }),
    packet(publicBriefing, { done_reason: 'length' }),
    packet(publicBriefing, {
      message: { content: JSON.stringify(publicBriefing), tool_calls: [{}] },
    }),
  ]) {
    const prepare = thinkingBriefing({
      url: 'http://127.0.0.1:11434',
      model: 'fixture',
      fetchImpl: async () => new Response(raw),
    });
    assert.equal(await prepare({ text: 'A task.', language: 'English' }), null);
  }
});

test('briefing response limit counts bytes, cancels excess body and decodes split Unicode', async () => {
  let cancelled = false;
  const prepare = thinkingBriefing({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('あ'.repeat(12000)));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  assert.equal(await prepare({ text: 'A task.', language: 'English' }), null);
  assert.equal(cancelled, true);
  const value = {
    text: 'Проверю условия задачи.',
    approach: 'Сопоставлю ограничения. Проверю крайние случаи.',
  };
  const bytes = new TextEncoder().encode(packet(value));
  const unicode = thinkingBriefing({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      ),
  });
  assert.deepEqual(await unicode({ text: 'Проверь условия.', language: 'Russian' }), value);
});

test('briefing has a bounded silent timeout but propagates cancellation of the same turn', async () => {
  const prepare = thinkingBriefing({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    timeoutMs: 15,
    fetchImpl: async () => new Promise(() => {}),
  });
  const started = Date.now();
  assert.equal(await prepare({ text: 'A task.', language: 'English' }), null);
  assert.ok(Date.now() - started < 1000);
  const controller = new AbortController();
  const pending = prepare({ text: 'A task.', language: 'English', signal: controller.signal });
  controller.abort(new DOMException('Turn cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
});
