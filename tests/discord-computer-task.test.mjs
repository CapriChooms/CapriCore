// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runDiscordComputerTask } from '../apps/desktop/discord-computer-task.mjs';

const item = (targetId, untrustedLabel, extra = {}) => ({
  targetId,
  untrustedLabel,
  role: extra.editable ? 'ControlType.Edit' : 'ControlType.Button',
  ...(extra.editable && typeof extra.untrustedValue === 'string'
    ? { untrustedValueSha256: createHash('sha256').update(extra.untrustedValue).digest('hex') }
    : {}),
  ...extra,
});
const discord = (targets = [], title = '#general | Friends - Discord') => ({
  ok: true,
  observationId: 'current-observation',
  window: { applicationKind: 'discord', windowId: 'discord-window', untrustedTitle: title },
  targets,
});
const request = (action = 'navigate', channelType = 'text') => ({
  action,
  server: 'Friends',
  channel: channelType === 'voice' ? 'General' : 'general',
  channelType,
});
function fixture(initial, mutate = () => {}) {
  const state = { view: initial, calls: [], observations: 0, active: true };
  const controller = new AbortController();
  const control = {
    session: { controller },
    requireSession() {
      controller.signal.throwIfAborted();
      assert.equal(state.active, true);
    },
    async execute(command, signal) {
      signal.throwIfAborted();
      state.calls.push(command);
      if (command.action === 'observe') {
        state.observations++;
        return structuredClone(state.view);
      }
      const result = await mutate(command, state, controller);
      return result ?? { ok: true };
    },
  };
  return { state, control, controller };
}

test('ordinary app opening and capability questions are not consumed; missing exact targets return clarification', async () => {
  for (const goal of [
    'Open Discord.',
    'Открой дискорд',
    'Can you control Discord?',
    'Open Calculator.',
  ]) {
    const result = await runDiscordComputerTask({ goal });
    assert.deepEqual(result, { handled: false });
  }
  const result = await runDiscordComputerTask({ goal: 'Join Discord voice channel.' });
  assert.equal(result.handled, true);
  assert.equal(result.success, false);
  assert.equal(result.status, 'needs_user');
});

test('voice join uses the current channel target and two fresh same-window proofs', async () => {
  const initial = discord(
    [
      item('voice-channel', 'General (voice channel)', {
        role: 'ControlType.Hyperlink',
        untrustedAncestors: ['Channels'],
      }),
    ],
    '#other | Friends - Discord',
  );
  const f = fixture(initial, (command, state) => {
    assert.equal(command.action, 'click');
    assert.equal(command.targetId, 'voice-channel');
    state.view = discord([
      item('connected', 'Voice Connected', { untrustedAncestors: ['Voice controls'] }),
      item('where', 'General / Friends', { untrustedAncestors: ['Voice controls'] }),
      item('disconnect', 'Disconnect', { untrustedAncestors: ['Voice controls'] }),
    ]);
  });
  const notices = [];
  const result = await runDiscordComputerTask({
    request: request('join_voice', 'voice'),
    control: f.control,
    onStep: (step) => notices.push(step),
  });
  assert.equal(result.success, true);
  assert.equal(result.verified, true);
  assert.equal(result.steps, 1);
  assert.equal(f.state.calls.filter((call) => call.action === 'click').length, 1);
  assert.equal(f.state.observations, 4);
  assert.ok(
    notices.every((notice) =>
      Object.keys(notice).every((key) => ['action', 'phase', 'steps'].includes(key)),
    ),
  );
});

test('leave verifies the changed loaded voice panel without repeating disconnect', async () => {
  const f = fixture(
    discord([
      item('disconnect', 'Disconnect', { untrustedAncestors: ['Voice panel'] }),
      item('connected', 'Voice Connected', { untrustedAncestors: ['Voice panel'] }),
      item('settings', 'User Settings', { untrustedAncestors: ['User area'] }),
    ]),
    (command, state) => {
      assert.equal(command.targetId, 'disconnect');
      state.view = discord([
        item('settings', 'User Settings', { untrustedAncestors: ['User area'] }),
      ]);
    },
  );
  const result = await runDiscordComputerTask({
    request: { action: 'leave_voice' },
    control: f.control,
  });
  assert.equal(result.success, true);
  assert.equal(result.steps, 1);
});

test('an explicit send drafts then submits once, and proves a new visible message with an empty composer', async () => {
  const composer = (value, focused = false) =>
    item('composer', 'Message #general', {
      editable: true,
      untrustedAncestors: ['Channel content'],
      focused,
      untrustedValue: value,
    });
  const f = fixture(discord([composer('')]), (command, state) => {
    if (command.action === 'enter_text') {
      assert.equal(command.targetId, 'composer');
      assert.equal(command.text, 'Hello from owner');
      state.view = discord([composer(command.text, true)]);
    } else {
      assert.equal(command.action, 'press_keys');
      assert.deepEqual(command.keys, ['ENTER']);
      assert.equal(command.observationId, 'current-observation');
      state.view = discord([
        composer(''),
        item('message', 'Hello from owner', { role: 'ControlType.Text' }),
      ]);
    }
  });
  const result = await runDiscordComputerTask({
    request: { ...request('send_message'), text: 'Hello from owner' },
    control: f.control,
  });
  assert.equal(result.success, true);
  assert.equal(result.steps, 2);
  assert.equal(result.status, 'submitted');
  assert.equal(result.submitted, true);
  assert.equal(result.deliveryConfirmed, false);
  assert.equal(f.state.calls.filter((command) => command.keys?.includes('ENTER')).length, 1);
});

test('an unverified send never repeats Enter and reports no native or private error text', async () => {
  const f = fixture(
    discord([
      item('composer', 'Message #general', {
        editable: true,
        untrustedAncestors: ['Channel content'],
        focused: true,
        untrustedValue: 'Private exact message',
      }),
    ]),
    () => {
      throw Error('Provider failed while sending Private exact message and private-window-title');
    },
  );
  const result = await runDiscordComputerTask({
    request: { ...request('send_message'), text: 'Private exact message' },
    control: f.control,
  });
  assert.equal(result.success, false);
  assert.equal(f.state.calls.filter((command) => command.keys?.includes('ENTER')).length, 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /Private exact message|private-window-title|Provider/,
  );
});

test('a visible duplicate server is clarified without a click or switcher query', async () => {
  const f = fixture(
    discord(
      [
        item('server-one', 'Friends', { untrustedAncestors: ['Servers sidebar'] }),
        item('server-two', 'Friends', { untrustedAncestors: ['Servers sidebar'] }),
      ],
      '#other | Another - Discord',
    ),
  );
  const result = await runDiscordComputerTask({ request: request(), control: f.control });
  assert.equal(result.success, false);
  assert.equal(result.status, 'needs_user');
  assert.ok(f.state.calls.every((command) => command.action === 'observe'));
});

test('an existing taskbar button focuses Discord and does not invoke launch', async () => {
  const f = fixture(
    {
      ok: true,
      observationId: 'current-observation',
      window: { windowId: 'other', untrustedTitle: 'Other' },
      targets: [item('discord-app', 'Discord', { surface: 'taskbar' })],
    },
    (command, state) => {
      assert.equal(command.targetId, 'discord-app');
      state.view = discord();
    },
  );
  const result = await runDiscordComputerTask({
    request: request(),
    control: f.control,
    launch: () => assert.fail('Taskbar focus should use the observed current target'),
  });
  assert.equal(result.success, true);
  assert.equal(result.steps, 1);
});

test('one optional launch/focus attempt is verified from the actual foreground observation', async () => {
  const f = fixture({
    ok: true,
    observationId: 'current-observation',
    window: { windowId: 'other', untrustedTitle: 'Other' },
    targets: [],
  });
  let launches = 0;
  const result = await runDiscordComputerTask({
    request: request(),
    control: f.control,
    launch: async (query, signal) => {
      assert.equal(query, 'Discord');
      assert.equal(signal.aborted, false);
      launches++;
      f.state.view = discord();
      return { ok: true };
    },
  });
  assert.equal(launches, 1);
  assert.equal(result.success, true);
});

test('the finish result is rejected when Discord foreground changes during verification', async () => {
  const f = fixture(discord());
  const base = f.control.execute;
  f.control.execute = async (...args) => {
    const result = await base(...args);
    if (f.state.observations >= 2) result.window.windowId = 'changed-window';
    return result;
  };
  const result = await runDiscordComputerTask({ request: request(), control: f.control });
  assert.equal(result.success, false);
  assert.equal(result.verified, undefined);
  assert.equal(result.steps, 0);
});

test('owner cancellation and Escape propagate their abort instead of trying another input', async () => {
  for (const external of [true, false]) {
    const owner = new AbortController();
    const reason = Error(external ? 'Owner cancelled' : 'Escape pressed');
    const f = fixture(
      discord(
        [
          item('voice-channel', 'General (voice channel)', {
            role: 'ControlType.Hyperlink',
            untrustedAncestors: ['Channels'],
          }),
        ],
        '#other | Friends - Discord',
      ),
      (_command, _state, session) => {
        (external ? owner : session).abort(reason);
        throw reason;
      },
    );
    await assert.rejects(
      runDiscordComputerTask({
        request: request('join_voice', 'voice'),
        control: f.control,
        signal: owner.signal,
      }),
      (error) => error === reason,
    );
    assert.equal(f.state.calls.filter((command) => command.action === 'click').length, 1);
  }
});

test('navigating a voice channel never uses the Quick Switcher join prefix or clicks its voice control', async () => {
  for (const targets of [
    [],
    [
      item('voice', 'General (voice channel)', {
        role: 'ControlType.Hyperlink',
        untrustedAncestors: ['Channels'],
      }),
    ],
  ]) {
    const f = fixture(discord(targets, '#other | Friends - Discord'));
    const result = await runDiscordComputerTask({
      request: request('navigate', 'voice'),
      control: f.control,
    });
    assert.equal(result.success, false);
    assert.ok(f.state.calls.every((command) => command.action === 'observe'));
  }
});

test('visible context fields survive verified task completion and omit the unsent draft', async () => {
  const f = fixture(
    discord([
      item('visible', 'Current visible conversation', {
        role: 'ControlType.Text',
        untrustedAncestors: ['Messages'],
      }),
      item('composer', 'Message #general', {
        editable: true,
        untrustedAncestors: ['Channel content'],
        untrustedValue: 'Unsent private draft',
      }),
    ]),
  );
  const result = await runDiscordComputerTask({
    request: request('read_context'),
    control: f.control,
  });
  assert.equal(result.success, true);
  assert.equal(result.contextScope, 'visible_only');
  assert.equal(result.untrustedVisibleContext, 'Current visible conversation');
});
