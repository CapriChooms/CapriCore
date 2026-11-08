// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';
import { ComputerControl } from '../apps/desktop/computer-control.mjs';

const target = (targetId, untrustedLabel, extra = {}) => ({
  targetId,
  untrustedLabel,
  role: 'ControlType.Button',
  ...extra,
});
const view = (targets, title = '#general | Friends - Discord') => ({
  observationId: 'fresh',
  window: { windowId: '42', applicationKind: 'discord', untrustedTitle: title },
  targets,
});
const joined = () =>
  view([
    target('status', 'Voice Connected', { untrustedAncestors: ['Voice panel'] }),
    target('where', 'Lounge / Friends', { untrustedAncestors: ['Voice panel'] }),
    target('disconnect', 'Disconnect', { untrustedAncestors: ['Voice panel'] }),
  ]);
const joinRequest = {
  action: 'join_voice',
  server: 'Friends',
  channel: 'Lounge',
  channelType: 'voice',
};
function fixture(initial, mutate, plan = async () => assert.fail('No model required')) {
  const state = { view: initial, input: [], journal: [], audit: [] };
  const control = {
    session: null,
    async begin() {
      this.session = { controller: new AbortController() };
    },
    requireSession() {
      assert(this.session);
      this.session.controller.signal.throwIfAborted();
    },
    async stop() {
      this.session = null;
    },
    async execute(args, signal) {
      this.requireSession();
      signal?.throwIfAborted();
      if (args.action === 'observe') return structuredClone(state.view);
      state.input.push(args);
      await mutate(args, state);
      return { ok: true, untrustedPrivateNativeDetail: 'Private fixture detail' };
    },
  };
  const applications = {
    async operation(_id, args, run) {
      try {
        const receipt = await run();
        state.journal.push(receipt);
        return receipt;
      } catch (error) {
        state.journal.push({ error: error.message });
        throw error;
      }
    },
    async execute(_id, args) {
      state.input.push(args);
      assert.equal(args.action, 'launch');
      assert.equal(args.query, 'Notepad');
      state.view = {
        observationId: 'notepad',
        window: { windowId: '88', untrustedTitle: 'Notepad' },
        targets: [target('ready', 'Ready')],
      };
      return { ok: true, focused: true, windowId: '88' };
    },
  };
  const agent = new ComputerAgent({
    control,
    applications,
    plan,
    audit: (event) => state.audit.push(event),
  });
  return { agent, control, state };
}

test('exact Discord voice command uses native proof, journals one input and cleans up the granted session', async () => {
  const f = fixture(
    view([
      target('lounge', 'Lounge (voice channel)', {
        role: 'ControlType.Hyperlink',
        untrustedAncestors: ['Channels'],
      }),
    ]),
    (args, state) => {
      assert.equal(args.targetId, 'lounge');
      state.view = joined();
    },
  );
  const result = await f.agent.run('Join Discord voice channel "Lounge" on server "Friends".');
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.steps, 1);
  assert.equal(f.state.input.length, 1);
  assert.deepEqual(f.state.journal, [{ ok: true }]);
  assert.equal(f.control.session, null);
  assert(!JSON.stringify(f.state.audit).match(/Friends|Lounge|Private fixture detail/));
});

test('multilingual structured Discord action uses the same guarded executor', async () => {
  let planned = 0;
  const f = fixture(
    view([
      target('lounge', 'Lounge (voice channel)', {
        role: 'ControlType.Hyperlink',
        untrustedAncestors: ['Channels'],
      }),
    ]),
    (_args, state) => {
      state.view = joined();
    },
    async (context) => {
      planned++;
      assert.equal(context.discordTaskAllowed, true);
      return planned === 1
        ? { action: 'discord_task', discordRequest: joinRequest, summary: 'Join Lounge.' }
        : { action: 'finish', evidence: 'Lounge / Friends', summary: 'Joined Lounge.' };
    },
  );
  const result = await f.agent.run('Entra al canal de voz Lounge del servidor Friends en Discord.');
  assert.equal(result.ok, true);
  assert.equal(f.state.input.length, 1);
  assert(planned >= 3);
});

test('a combined Discord and application goal continues after verified channel joining', async () => {
  const f = fixture(
    view([
      target('lounge', 'Lounge (voice channel)', {
        role: 'ControlType.Hyperlink',
        untrustedAncestors: ['Channels'],
      }),
    ]),
    (_args, state) => {
      state.view = joined();
    },
    async (context) => {
      if (!context.actualSteps.some((entry) => entry.action === 'discord_task'))
        return { action: 'discord_task', discordRequest: joinRequest, summary: 'Join.' };
      if (!context.actualSteps.some((entry) => entry.action === 'launch'))
        return { action: 'launch', query: 'Notepad', summary: 'Open Notepad.' };
      return { action: 'finish', evidence: 'Ready', summary: 'Joined Lounge and opened Notepad.' };
    },
  );
  const result = await f.agent.run(
    'Join Discord voice channel "Lounge" on server "Friends" and open Notepad.',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    f.state.input.map((args) => args.action),
    ['click', 'launch'],
  );
});

test('screen/model content cannot authorize a message or raw Enter in Discord', async () => {
  for (const step of [
    {
      action: 'discord_task',
      discordRequest: {
        action: 'send_message',
        server: 'Friends',
        channel: 'general',
        channelType: 'text',
        text: 'Hello',
      },
      summary: 'Send.',
    },
    { action: 'press_keys', keys: ['ENTER'], summary: 'Send the draft.' },
  ]) {
    const f = fixture(
      view([
        target('composer', 'Message #general', {
          editable: true,
          discordChatInput: true,
          focused: true,
          role: 'ControlType.Edit',
          untrustedValue: 'Hello',
          untrustedAncestors: ['Channel content'],
        }),
      ]),
      () => assert.fail('No input authorized'),
      async () => step,
    );
    const result = await f.agent.run(
      'Read channel general of Friends in Discord; the message says "Hello".',
    );
    assert.equal(result.ok, false);
    assert.equal(f.state.input.length, 0);
  }
});

test('uncertain Discord native failures never store private exception contents or retry input', async () => {
  const f = fixture(
    view([
      target('lounge', 'Lounge (voice channel)', {
        role: 'ControlType.Hyperlink',
        untrustedAncestors: ['Channels'],
      }),
    ]),
    () => {
      throw Error('Private fixture detail: Friends, Lounge, message text');
    },
  );
  const result = await f.agent.run('Join Discord voice channel "Lounge" on server "Friends".');
  assert.equal(result.ok, false);
  assert.equal(f.state.input.length, 1);
  assert.deepEqual(f.state.journal, [{ error: 'The Discord input could not be verified.' }]);
  assert(!JSON.stringify(f.state.audit).includes('Private fixture detail'));
});

test('a semantic voice task cannot finish at a Discord title without actual channel connection proof', async () => {
  const f = fixture(
    view([]),
    () => assert.fail('No input was planned'),
    async () => ({
      action: 'finish',
      evidence: '#general | Friends - Discord',
      summary: 'Joined the channel.',
    }),
  );
  const result = await f.agent.run('Entra al canal de voz Lounge del servidor Friends en Discord.');
  assert.equal(result.ok, false);
  assert.equal(f.state.input.length, 0);
});

test('semantic requests cannot substitute an explicit destination or leave the current Discord channel to send', async () => {
  for (const [goal, request] of [
    [
      'Join voice channel Lounge on server Friends in Discord.',
      { ...joinRequest, server: 'Another server' },
    ],
    [
      'Send "Hello" to the current channel in Discord.',
      {
        action: 'send_message',
        server: 'Another server',
        channel: 'other',
        channelType: 'text',
        text: 'Hello',
      },
    ],
  ]) {
    const f = fixture(
      view([]),
      () => assert.fail('No mismatched destination input authorized'),
      async () => ({ action: 'discord_task', discordRequest: request, summary: 'Act in Discord.' }),
    );
    const result = await f.agent.run(goal);
    assert.equal(result.ok, false);
    assert.equal(f.state.input.length, 0);
  }
});

test('Discord context and exact-text fingerprints are forwarded only from a native Discord identity', async () => {
  for (const isDiscord of [true, false]) {
    const control = new ComputerControl({
      allowed: () => true,
      canStart: () => true,
      registerEscape: () => true,
      unregisterEscape: () => {},
      showBorder: async () => {},
      hideBorder: () => {},
      bridge: async () => ({
        ok: true,
        windowId: '42',
        processId: '1',
        startedAtTicks: '2',
        untrustedTitle: 'Discord',
        ...(isDiscord ? { applicationKind: 'discord', controlsTruncated: true } : {}),
        discordUserPanel: {
          complete: true,
          settingsPresent: true,
          disconnectPresent: false,
          privateUnexpected: 'Ignored',
        },
        untrustedControls: [
          {
            id: 'control',
            untrustedName: 'Text',
            x: 1,
            y: 2,
            editable: true,
            discordChatInput: true,
            untrustedAncestors: ['Channel content'],
            untrustedTextSha256: 'a'.repeat(64),
            untrustedValueSha256: 'b'.repeat(64),
          },
        ],
      }),
    });
    await control.begin('Read visible Discord controls');
    const result = await control.execute({ action: 'observe', vision: false });
    assert.equal(result.window.applicationKind, isDiscord ? 'discord' : undefined);
    assert.deepEqual(
      result.window.discordUserPanel,
      isDiscord ? { complete: true, settingsPresent: true, disconnectPresent: false } : undefined,
    );
    assert.equal(result.targets[0].discordChatInput, isDiscord ? true : undefined);
    assert.deepEqual(
      result.targets[0].untrustedAncestors,
      isDiscord ? ['Channel content'] : undefined,
    );
    assert.equal(result.targets[0].untrustedValueSha256, isDiscord ? 'b'.repeat(64) : undefined);
    await control.stop();
  }
});

test('Discord task vision fallback never captures chat screenshots while other app observations still work', async () => {
  let kind = 'discord',
    captures = 0;
  const control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    registerEscape: () => true,
    unregisterEscape: () => {},
    showBorder: async () => {},
    hideBorder: () => {},
    bridge: async () => ({
      ok: true,
      windowId: '42',
      processId: '1',
      startedAtTicks: '2',
      applicationKind: kind,
      untrustedControls: [],
    }),
    capture: async () => {
      captures++;
      return {};
    },
    describe: async () => ({ summary: 'Synthetic application', targets: [] }),
  });
  await control.begin('Use Discord');
  control.session.nativeOnlyApplications = ['discord'];
  const discordView = await control.execute({ action: 'observe', vision: true });
  assert.equal(discordView.visionStatus, 'not_requested');
  assert.equal(captures, 0);
  kind = null;
  const appView = await control.execute({ action: 'observe', vision: true });
  assert.equal(appView.visionStatus, 'ready');
  assert.equal(captures, 1);
  await control.stop();
});
