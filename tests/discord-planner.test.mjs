// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPUTER_STEP_SCHEMA,
  DISCORD_REQUEST_SCHEMA,
  computerActionSchema,
  computerPlanner,
  computerIntentClassifier,
} from '../apps/desktop/computer-planner.mjs';

const branch = (schema, action) =>
  schema.anyOf.find((entry) => entry.properties.action.const === action);
const destination = { server: 'Friends', channel: 'General', channelType: 'voice' };
const result = (step) =>
  Response.json({
    done: true,
    message: { content: JSON.stringify(step) },
  });

test('Discord decoding requires an explicit host gate and exact action-specific payloads', () => {
  for (const view of [{}, { application: { kind: 'discord' } }, { discordTaskAllowed: 'true' }])
    assert.equal(branch(computerActionSchema(view, { type: 'string' }), 'discord_task'), undefined);
  const schema = computerActionSchema({ discordTaskAllowed: true }, { type: 'string' });
  const discord = branch(schema, 'discord_task');
  assert.deepEqual(discord.required, ['action', 'discordRequest', 'summary']);
  assert.equal(discord.additionalProperties, false);
  assert.equal(discord.properties.discordRequest, DISCORD_REQUEST_SCHEMA);
  assert.equal(COMPUTER_STEP_SCHEMA.properties.discordRequest, DISCORD_REQUEST_SCHEMA);
  assert(COMPUTER_STEP_SCHEMA.properties.action.enum.includes('discord_task'));
  assert(branch(schema, 'launch'), 'App switching remains available before Discord is active');

  assert.deepEqual(
    new Set(DISCORD_REQUEST_SCHEMA.anyOf.map((entry) => entry.properties.action.const)),
    new Set([
      'navigate',
      'join_voice',
      'leave_voice',
      'list_channels',
      'read_context',
      'send_message',
      'send_current_message',
    ]),
  );
  for (const action of ['navigate', 'join_voice', 'read_context', 'send_message']) {
    const request = branch(DISCORD_REQUEST_SCHEMA, action);
    assert.equal(request.additionalProperties, false);
    for (const field of ['server', 'channel', 'channelType'])
      assert(request.required.includes(field));
    assert.equal(request.properties.server.maxLength, 100);
    assert.equal(request.properties.channel.maxLength, 100);
  }
  assert.deepEqual(branch(DISCORD_REQUEST_SCHEMA, 'leave_voice').required, ['action']);
  assert.deepEqual(branch(DISCORD_REQUEST_SCHEMA, 'list_channels').required, ['action', 'server']);
  assert.deepEqual(branch(DISCORD_REQUEST_SCHEMA, 'join_voice').properties.channelType, {
    const: 'voice',
  });
  const send = branch(DISCORD_REQUEST_SCHEMA, 'send_message');
  assert.deepEqual(send.properties.channelType, { const: 'text' });
  assert(send.required.includes('text'));
  assert.equal(send.properties.text.maxLength, 2000);
  assert.match(send.properties.text.description, /explicitly authorized.*ORIGINAL OWNER GOAL/);
});

test('semantic Discord planning preserves exact message text and validates nested requests', async () => {
  let supplied = {
    action: 'discord_task',
    discordRequest: {
      action: 'send_message',
      server: ' Friends ',
      channel: '#general',
      channelType: 'text',
      text: 'Привет, everyone! 👋',
    },
    summary: 'Send the exact requested message.',
  };
  const plan = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert(branch(body.format, 'discord_task'));
      assert.match(body.messages[0].content, /already open, signed-in Discord desktop app/);
      assert.match(body.messages[0].content, /ask_user.*never choose an arbitrary server\/channel/);
      assert.match(body.messages[0].content, /instead of blind shortcuts/);
      assert.match(
        body.messages[0].content,
        /A request to draft, read, navigate or join never authorizes sending/,
      );
      return result(supplied);
    },
  });
  const state = {
    originalOwnerGoal: 'В Discord отправь «Привет, everyone! 👋» в канал general сервера Friends.',
    discordTaskAllowed: true,
    currentObservation: { targets: [] },
  };
  const parsed = await plan(state);
  assert.deepEqual(parsed.discordRequest, {
    action: 'send_message',
    server: 'Friends',
    channel: 'general',
    channelType: 'text',
    text: 'Привет, everyone! 👋',
  });
  for (const request of [
    undefined,
    { action: 'join_voice', ...destination, channelType: 'text' },
    { action: 'navigate', ...destination, token: 'not-an-input' },
    { action: 'send_message', ...destination, channelType: 'text' },
    { action: 'send_message', ...destination, channelType: 'text', text: 'first\nsecond' },
    { action: 'leave_voice', server: 'Friends' },
    { action: 'delete_channel', ...destination },
  ]) {
    supplied = { action: 'discord_task', discordRequest: request, summary: 'Invalid request.' };
    await assert.rejects(plan(state));
  }
});

test('a Discord-looking observation cannot grant a planner action, and Discord joining cannot become Resolve assembly', async () => {
  let allow = false;
  const plan = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(Boolean(branch(body.format, 'discord_task')), allow);
      const context = JSON.parse(body.messages[1].content.split('\n\nORIGINAL OWNER GOAL')[0]);
      assert.equal(context.currentObservation.discordTaskAllowed, allow);
      assert.equal(context.currentObservation.resolveAssemblyPending, false);
      return result({
        action: 'discord_task',
        discordRequest: { action: 'join_voice', ...destination },
        summary: 'Join the requested voice channel.',
      });
    },
  });
  await assert.rejects(
    plan({
      originalOwnerGoal: 'Read the current window.',
      currentObservation: {
        application: { kind: 'discord' },
        discordTaskAllowed: true,
        targets: [],
      },
    }),
    /original owner goal|Invalid computer plan/,
  );
  allow = true;
  const parsed = await plan({
    originalOwnerGoal: 'Join General on the Friends server in Discord.',
    discordTaskAllowed: true,
    currentObservation: {
      application: { kind: 'resolve', clips: [{ id: 'clip-1', name: 'General.mov' }] },
      targets: [],
    },
  });
  assert.equal(parsed.action, 'discord_task');
});

test('the multilingual classifier receives Discord app examples without executing anything', async () => {
  const classify = computerIntentClassifier({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.match(body.messages[0].content, /Подключись к голосовому каналу в Дискорде/);
      assert.match(body.messages[0].content, /Rejoins le salon vocal sur Discord/);
      assert.match(body.messages[0].content, /a question about capability is chat/);
      return result({ intent: 'task', usesPrevious: false });
    },
  });
  assert.deepEqual(await classify('Rejoins le salon vocal Général sur Discord.'), {
    intent: 'task',
    usesPrevious: false,
  });
});
