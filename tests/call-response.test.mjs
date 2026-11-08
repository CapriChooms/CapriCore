// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { callResponseGenerator } from '../apps/desktop/call-response.mjs';

test('call routing sees one approved prompt and cannot call tools or access private history', async () => {
  const signal = new AbortController().signal;
  const generate = callResponseGenerator({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    fetchImpl: async (url, request) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      assert.equal(request.signal, signal);
      const body = JSON.parse(request.body);
      assert.deepEqual(body.tools, []);
      assert.deepEqual(
        body.messages.map(({ role }) => role),
        ['system', 'user'],
      );
      assert.equal(body.messages[1].content, 'Greet everyone.');
      return Response.json({
        message: { content: '{"route":"owner-and-call","reply":"Hello, everyone."}' },
      });
    },
  });
  assert.deepEqual(await generate('Greet everyone.', undefined, signal), {
    route: 'owner-and-call',
    reply: 'Hello, everyone.',
  });
});

test('an invalid output cannot fall back to audible call speech', async () => {
  const signal = new AbortController().signal;
  for (const message of [
    { content: '{"route":"owner-and-call","reply":"Hello.","private":true}' },
    { content: '{"route":"another-output","reply":"Hello."}' },
    { content: '{"route":"owner-and-call","reply":"Hello."}', tool_calls: [{}] },
  ]) {
    const generate = callResponseGenerator({
      url: 'http://127.0.0.1:11434',
      model: 'fixture',
      fetchImpl: async () => Response.json({ message }),
    });
    await assert.rejects(generate('Hello', undefined, signal), /safe call reply/);
  }
  assert.throws(() => callResponseGenerator({ url: 'https://example.com' }), /loopback/);
});
