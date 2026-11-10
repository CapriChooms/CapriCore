// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spotifyPlanner, SPOTIFY_PLAN_SCHEMA } from '../apps/desktop/spotify-planner.mjs';

const packet = (content) =>
  new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(content) } }));
test('Spotify uses bounded isolated JSON planning and the configured runner allocation', async () => {
  const seen = [];
  const planner = spotifyPlanner({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    params: { num_thread: 4, num_ctx: 32768, num_gpu: 0 },
    fetchImpl: async (url, options) => {
      seen.push({ url, options, body: JSON.parse(options.body) });
      return packet({ action: 'play', query: 'Example Artist', type: 'artist' });
    },
  });
  assert.deepEqual(await planner('Play Example Artist'), {
    action: 'play',
    query: 'Example Artist',
    type: 'artist',
  });
  const { body, options, url } = seen[0];
  assert.equal(url.href, 'http://127.0.0.1:11434/api/chat');
  assert.deepEqual(body.format, SPOTIFY_PLAN_SCHEMA);
  assert.equal(body.tools, undefined);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[1].content, 'Play Example Artist');
  assert.deepEqual(body.options, {
    num_thread: 4,
    num_ctx: 32768,
    num_gpu: 0,
    temperature: 0,
    num_predict: 192,
  });
  assert.equal(body.think, false);
  assert.equal(body.shift, false);
  assert.equal(options.redirect, 'error');
});

test('generic music resumes a queue, none remains conversation, invalid or unfinished plans never execute', async () => {
  for (const plan of [
    { action: 'resume' },
    { action: 'pause' },
    { action: 'volume', delta: -10 },
    { action: 'none' },
  ]) {
    const planner = spotifyPlanner({
      url: 'http://127.0.0.1:11434',
      fetchImpl: async () => packet(plan),
    });
    assert.deepEqual(await planner('A fixture request'), plan.action === 'none' ? null : plan);
  }
  for (const bad of [
    { done: false, message: { content: '{"action":"resume"}' } },
    { done: true, done_reason: 'length', message: { content: '{"action":"resume"}' } },
    { done: true, message: { content: '[spotify_control{action:resume}]' } },
    { done: true, message: { tool_calls: [{}], content: '{"action":"resume"}' } },
    { done: true, message: { content: '{"action":"play","query":"x","shell":"calc"}' } },
    { done: true, message: { content: '{"action":"volume","value":101}' } },
  ]) {
    let calls = 0;
    const planner = spotifyPlanner({
      url: 'http://127.0.0.1:11434',
      fetchImpl: async () => {
        calls++;
        return new Response(JSON.stringify(bad));
      },
    });
    await assert.rejects(planner('A fixture request'));
    assert.equal(calls, 1);
  }
  assert.throws(
    () => spotifyPlanner({ url: 'https://provider.example/api' }),
    /local inference boundary/,
  );
});
