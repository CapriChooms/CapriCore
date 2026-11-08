// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';
import {
  computerActionSchema,
  computerPlanner,
  DISCORD_REQUEST_SCHEMA,
} from '../apps/desktop/computer-planner.mjs';
import { runDiscordComputerTask } from '../apps/desktop/discord-computer-task.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const pane = hash('host-only-fixture-pane');
const request = { action: 'send_current_message', side: 'right', text: 'hi' };
const composer = (targetId = 'composer', x = 78) => ({
  targetId,
  untrustedLabel: 'Message #private-recipient',
  role: 'ControlType.Edit',
  editable: true,
  focused: true,
  position: { x, y: 80 },
  untrustedAncestors: ['Channel content'],
  untrustedValue: '',
  untrustedValueSha256: hash(''),
  discordChatInput: true,
  discordMessageComposer: true,
  discordPaneId: pane,
});
const discord = (targets = []) => ({
  observationId: 'fixture-observation',
  window: {
    windowId: 'fixture-discord',
    applicationKind: 'discord',
    untrustedTitle: '#general | Friends - Discord',
  },
  targets,
});
const branch = (schema, action) =>
  schema.anyOf.find((entry) => entry.properties.action.const === action);

function fixture({
  initial = discord(),
  plan = async () => ({ action: 'ask_user', summary: 'Choose a chat.' }),
  mutate = () => {},
  maxDecisions = 8,
} = {}) {
  const state = { view: initial, inputs: [], trustedMutations: [], observations: 0, audit: [] };
  const control = {
    session: null,
    async begin() {
      this.session = { controller: new AbortController() };
    },
    requireSession() {
      assert(this.session);
      this.session.controller.signal.throwIfAborted();
      return this.session;
    },
    async stop() {
      this.session?.controller.abort();
      this.session = null;
    },
    async execute(args, signal, trustedOptions) {
      this.requireSession();
      signal?.throwIfAborted();
      if (args.action === 'observe') {
        state.observations++;
        return structuredClone(state.view);
      }
      state.inputs.push(args);
      state.trustedMutations.push(trustedOptions?.discordMutation ?? null);
      await mutate(args, state);
      return { ok: true };
    },
  };
  const applications = {
    operation: (_id, _args, run) => run(),
    async execute(_id, args) {
      state.inputs.push(args);
      assert.equal(args.action, 'launch');
      state.view = discord([composer()]);
      return { ok: true, focused: true, windowId: 'fixture-discord' };
    },
  };
  const agent = new ComputerAgent({
    control,
    applications,
    plan,
    maxDecisions,
    audit: (entry) => state.audit.push(entry),
  });
  return { agent, control, applications, state };
}

test('current-chat schema uses no invented destination and excludes raw mutations only in observed Discord', () => {
  const current = branch(DISCORD_REQUEST_SCHEMA, 'send_current_message');
  assert.deepEqual(current.required, ['action', 'text', 'side']);
  assert.deepEqual(Object.keys(current.properties), ['action', 'text', 'side']);
  assert.equal(current.additionalProperties, false);
  assert.deepEqual(current.properties.side.enum, ['current', 'left', 'right']);
  for (const applicationKind of ['discord', 'notepad', undefined]) {
    const schema = computerActionSchema(
      { discordTaskAllowed: true, window: { applicationKind }, targets: [composer()] },
      { type: 'string' },
    );
    for (const action of ['click', 'enter_text', 'press_keys', 'drag', 'scroll'])
      assert.equal(Boolean(branch(schema, action)), applicationKind !== 'discord', action);
    assert(branch(schema, 'discord_task'));
    assert(branch(schema, 'launch'), 'Switching to another owner-requested app stays possible');
  }
});

test('planner receives only safe current-composer descriptors, never recipient labels, pane IDs, values or fingerprints', async () => {
  let body;
  const field = composer();
  field.untrustedValue = 'PRIVATE_UNSENT_DRAFT';
  field.untrustedValueSha256 = hash(field.untrustedValue);
  const plan = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({ action: 'ask_user', summary: 'The field is not ready.' }),
        },
      });
    },
  });
  await plan({
    originalOwnerGoal: 'Write hi in the right chat in Discord.',
    discordTaskAllowed: true,
    currentObservation: discord([field]),
  });
  const encoded = JSON.stringify(body);
  for (const secret of [
    'private-recipient',
    field.untrustedValue,
    pane,
    field.untrustedValueSha256,
  ])
    assert.equal(encoded.includes(secret), false, secret);
  const context = JSON.parse(body.messages[1].content.split('\n\nORIGINAL OWNER GOAL')[0]);
  assert.deepEqual(context.currentObservation.currentComposers, [
    { targetId: 'composer', side: 'right', role: 'message-composer', position: { x: 78, y: 80 } },
  ]);
  const target = context.currentObservation.targets.find((entry) => entry.editable);
  assert.equal(target.untrustedLabel, 'Discord right message composer');
  assert.deepEqual(target.position, { x: 78, y: 80 });
});

test('blocked raw Discord input records a technical outcome without a false crash or private summary', async () => {
  const f = fixture({
    plan: async () => ({ action: 'press_keys', keys: ['ENTER'], summary: 'PRIVATE_MODEL_SUMMARY' }),
  });
  const result = await f.agent.run('Read the current Discord chat and then open Notepad.');
  assert.equal(result.status, 'needs_user');
  assert.equal(f.state.inputs.length, 0);
  const diagnostic = f.agent.diagnostics();
  assert.equal(diagnostic.phase, 'stopped');
  assert.equal(diagnostic.lastFailure, null);
  assert.equal(diagnostic.lastOutcome.status, 'needs_user');
  assert.equal(diagnostic.lastOutcome.reason, 'discord_structured_step_required');
  assert.equal(diagnostic.lastOutcome.phase, 'planning');
  assert(!JSON.stringify(f.state.audit).includes('PRIVATE_MODEL_SUMMARY'));
});

test('semantic current-chat proposals cannot bypass no-Enter, example or future-conditional owner scope', async () => {
  for (const goal of [
    'Type hi in the right Discord chat without pressing Enter.',
    'For example, write hi in the right Discord chat.',
    'If I ask you later, write hi in the right Discord chat.',
  ]) {
    const f = fixture({
      initial: discord([composer()]),
      plan: async () => ({ action: 'discord_task', discordRequest: request, summary: 'Send hi.' }),
    });
    const result = await f.agent.run(goal);
    assert.equal(result.ok, false);
    assert.equal(f.state.inputs.length, 0, goal);
    assert.equal(f.control.session, null);
  }
});

test('ask-user, invalid checkpoint and decision-limit exits all retain terminal metadata', async () => {
  const ask = fixture();
  assert.equal(
    (await ask.agent.run('Inspect Discord and ask which chat to use.')).status,
    'needs_user',
  );
  assert.equal(ask.agent.diagnostics().lastOutcome.reason, 'needs_user');
  const blocked = fixture({ plan: async () => ({ action: 'observe', plan: [{ id: 'bad' }] }) });
  assert.equal((await blocked.agent.run('Inspect this window.')).status, 'incomplete');
  assert.equal(blocked.agent.diagnostics().lastOutcome.reason, 'plan_blocked');
  const limit = fixture({ maxDecisions: 1, plan: async () => ({ action: 'observe' }) });
  assert.equal((await limit.agent.run('Inspect this window.')).status, 'limit');
  assert.equal(limit.agent.diagnostics().lastOutcome.reason, 'limit');
  for (const f of [ask, blocked, limit]) assert.equal(f.control.session, null);
});

test('owner cancellation remains a rejection with safe terminal metadata and a stopped overlay', async () => {
  const controller = new AbortController();
  const f = fixture({
    plan: async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    },
  });
  await assert.rejects(f.agent.run('Inspect this window.', { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(f.agent.diagnostics().lastOutcome.status, 'cancelled');
  assert.equal(f.agent.diagnostics().lastOutcome.reason, 'cancelled');
  assert.equal(f.agent.diagnostics().phase, 'stopped');
  assert.equal(f.agent.diagnostics().active, false);
});

test('unavailable current composer retries only three fresh reads and performs no input', async () => {
  const f = fixture();
  await f.control.begin();
  const result = await runDiscordComputerTask({ request, control: f.control });
  assert.equal(result.status, 'needs_user');
  assert.equal(result.reason, 'discord_current_composer_unavailable');
  assert.equal(f.state.observations, 4);
  assert.equal(f.state.inputs.length, 0);
  assert.match(result.summary, /message field/);
  assert.doesNotMatch(result.summary, /server|channel names/i);
  await f.control.stop();
});

test('a current-chat launch settles late native observations for one bounded launch without any input', async () => {
  const f = fixture();
  await f.control.begin();
  let reads = 0;
  let launches = 0;
  const field = composer();
  field.untrustedValue = 'existing draft';
  field.untrustedValueSha256 = hash(field.untrustedValue);
  const result = await runDiscordComputerTask({
    request,
    control: {
      get session() {
        return f.control.session;
      },
      requireSession: () => f.control.requireSession(),
      async execute(args) {
        assert.equal(args.action, 'observe');
        if (++reads < 3)
          throw Object.assign(Error('No application yet'), {
            code: 'COMPUTER_APPLICATION_UNAVAILABLE',
          });
        return reads < 6 ? { window: { windowId: 'desktop' }, targets: [] } : discord([field]);
      },
    },
    launch: async () => {
      launches++;
      return { ok: true };
    },
  });
  assert.equal(launches, 1);
  assert.equal(reads, 6, 'A startup longer than the old subsecond budget is observed');
  assert.equal(result.reason, 'discord_current_draft_present');
  assert.equal(f.state.inputs.length, 0);
  await f.control.stop();
});

test('known failed current-chat launch does not consume a readiness grace or relaunch', async () => {
  const f = fixture({ initial: { window: { windowId: 'desktop' }, targets: [] } });
  await f.control.begin();
  let launches = 0;
  const result = await runDiscordComputerTask({
    request,
    control: f.control,
    launch: async () => {
      launches++;
      return { ok: false };
    },
  });
  assert.equal(result.status, 'needs_user');
  assert.equal(launches, 1);
  assert.equal(f.state.observations, 1);
  assert.equal(f.state.inputs.length, 0);
  await f.control.stop();
});

test('multiple current composers do not enter a retry or send to an arbitrary visible chat', async () => {
  const f = fixture({ initial: discord([composer('left', 25), composer('right', 78)]) });
  await f.control.begin();
  const result = await runDiscordComputerTask({
    request: { ...request, side: 'current' },
    control: f.control,
  });
  assert.equal(result.status, 'needs_user');
  assert.equal(f.state.inputs.length, 0);
  assert.equal(f.state.observations, 1);
  await f.control.stop();
});

test('the full current-chat agent launches Discord and sends the exact owner message once with fresh proof', async () => {
  const f = fixture({
    initial: { window: { windowId: 'desktop' }, targets: [] },
    plan: async () => assert.fail('An exact current-chat request uses the guarded native task'),
    mutate(args, state) {
      const field = state.view.targets.find((entry) => entry.editable);
      if (args.action === 'enter_text') {
        field.untrustedValue = args.text;
        field.untrustedValueSha256 = hash(args.text);
      } else if (args.action === 'press_keys') {
        assert.deepEqual(args.keys, ['ENTER']);
        field.untrustedValue = '';
        field.untrustedValueSha256 = hash('');
        state.view.targets.push({
          targetId: 'new-message',
          role: 'ControlType.Text',
          untrustedLabel: 'hi',
          untrustedTextSha256: hash('hi'),
          untrustedAncestors: ['Chat messages'],
          discordPaneId: pane,
          discordMessage: true,
        });
      } else assert.fail('No other native input is needed');
    },
  });
  const result = await f.agent.run(
    'capri open discord, write hi in chat on the right side of the screen',
  );
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.deepEqual(
    f.state.inputs.map((entry) => entry.action),
    ['launch', 'enter_text', 'press_keys'],
  );
  assert.equal(f.state.inputs.filter((entry) => entry.action === 'enter_text')[0].text, 'hi');
  assert.equal(f.agent.diagnostics().lastOutcome.status, 'completed');
  assert.equal(f.agent.diagnostics().lastFailure, null);
  assert(f.state.observations >= 5);
  assert.deepEqual(f.state.trustedMutations, [
    { expectedValueSha256: hash(''), expectedDiscordPaneId: pane },
    { expectedValueSha256: hash('hi'), expectedDiscordPaneId: pane },
  ]);
  assert(f.state.inputs.every((entry) => entry.discordMutation === undefined));
  assert(!JSON.stringify(f.state.audit).includes('private-recipient'));
  assert(!JSON.stringify(f.state.audit).includes(pane));
  assert.equal(f.control.session, null);
});

test('a current-chat request with an existing draft needs the owner without a crash or overwritten text', async () => {
  const field = composer();
  field.untrustedValue = 'PRIVATE_EXISTING_DRAFT';
  field.untrustedValueSha256 = hash(field.untrustedValue);
  const f = fixture({
    initial: discord([field]),
    plan: async () => assert.fail('The native task must preserve the existing draft'),
  });
  const result = await f.agent.run('Write hi in the right chat in Discord.');
  assert.equal(result.status, 'needs_user');
  assert.equal(f.state.inputs.length, 0);
  assert.equal(f.agent.diagnostics().lastFailure, null);
  assert.equal(f.agent.diagnostics().lastOutcome.reason, 'discord_current_draft_present');
  assert.match(result.summary, /draft was kept/);
  assert.doesNotMatch(result.summary, /server|channel names/i);
  assert(!JSON.stringify(f.state.audit).includes(field.untrustedValue));
});

test('an uncertain first Discord input is never replayed or reclassified as a readiness retry', async () => {
  const f = fixture({
    initial: discord([composer()]),
    mutate() {
      throw Error('PRIVATE_NATIVE_ERROR');
    },
  });
  await f.control.begin();
  const result = await runDiscordComputerTask({ request, control: f.control });
  assert.equal(result.status, 'incomplete');
  assert.equal(f.state.inputs.length, 1);
  assert.equal(f.state.observations, 1);
  assert(!JSON.stringify(result).includes('PRIVATE_NATIVE_ERROR'));
  await f.control.stop();
});
