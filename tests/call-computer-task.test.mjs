// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { callTaskRequest, waitForCallForeground } from '../apps/desktop/call-computer-task.mjs';
import { computerModeRequest } from '../apps/desktop/computer-mode-request.mjs';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';

const meet = 'https://meet.google.com/abc-defg-hij';
const teams = 'https://teams.microsoft.com/meet/123456789012?p=fixture';
const button = (targetId, untrustedLabel) => ({
  targetId,
  untrustedLabel,
  pageContent: true,
  role: 'ControlType.Button',
});
const composer = (untrustedValue = '') => ({
  targetId: 'compose',
  untrustedLabel: 'Send a message to everyone',
  pageContent: true,
  role: 'ControlType.Edit',
  editable: true,
  untrustedValue,
});
const view = (controls, address = meet, addressFocused = false) => ({
  window: { windowId: 'window-1' },
  targets: [
    { browserAddress: true, focused: addressFocused, untrustedValue: address },
    ...controls,
  ],
});
const lobby = [
  button('join', 'Join now'),
  button('mic', 'Turn on microphone (Ctrl + D)'),
  button('camera', 'Turn on camera'),
];
const hangup = button('hangup', 'Leave call');

function fixture(observations, mutate = () => ({ ok: true }), options = {}) {
  const actions = [];
  let index = 0;
  const control = {
    session: null,
    async begin() {
      this.session = { controller: new AbortController() };
    },
    async stop() {
      this.session = null;
    },
    async execute(args) {
      actions.push(args);
      if (args.action === 'observe')
        return observations[Math.min(index++, observations.length - 1)];
      return mutate(args);
    },
  };
  return {
    actions,
    agent: new ComputerAgent({
      control,
      applications: { operation: (_id, _args, execute) => execute() },
      plan: () => assert.fail('Call actions must not use a model-generated UI plan'),
      ...options,
    }),
  };
}

test('only an explicit call request enters the specialized computer route and keeps the exact draft', () => {
  const join = 'Капри, подключись к этому созвону в Тимс.';
  assert.deepEqual(callTaskRequest(join), { action: 'join', client: 'teams' });
  assert.deepEqual(computerModeRequest(join), { enabled: true, run: true });
  assert.deepEqual(
    callTaskRequest('Could you please write “Привет, everyone!” in the call chat?'),
    {
      action: 'draft',
      client: null,
      text: 'Привет, everyone!',
      sendRequested: false,
    },
  );
  assert.deepEqual(callTaskRequest('Отправь в чат встречи в Google Meet: Привет, я Capri!'), {
    action: 'draft',
    client: 'meet',
    text: 'Привет, я Capri!',
    sendRequested: true,
  });
  for (const text of [
    'Do not join this meeting.',
    'How do I join this meeting?',
    'Explain how to join this call.',
    'Open Chrome and search for call chat',
  ])
    assert.equal(callTaskRequest(text), null, text);
  assert.equal(callTaskRequest('Send hello in the call chat.').action, 'clarify');
});

test('a typed call command waits for Capri to lose focus and then checks the selected meeting once', async () => {
  const capriWindow = Object.assign(new EventEmitter(), { isFocused: () => true });
  const f = fixture([view(lobby), view([hangup])], undefined, {
    callFocusWindow: () => capriWindow,
  });
  const pending = f.agent.run('Join this call.', { ownerRequestedCall: true });
  await new Promise(setImmediate);
  assert.deepEqual(f.actions, []);
  assert.equal(capriWindow.listenerCount('blur'), 1);
  capriWindow.emit('blur');
  assert.equal((await pending).verified, true);
  assert.deepEqual(
    f.actions.map(({ action }) => action),
    ['observe', 'click', 'observe'],
  );
  assert.equal(capriWindow.listenerCount('blur'), 0);
});

test('the foreground wait expires without acquiring a target and abort removes its listener', async () => {
  const capriWindow = Object.assign(new EventEmitter(), { isFocused: () => true });
  const onWaiting = () => {};
  const [timedOut] = await Promise.all([
    waitForCallForeground(capriWindow, { onWaiting, timeoutMs: 5 }),
    delay(20),
  ]);
  assert.equal(timedOut, false);
  assert.equal(capriWindow.listenerCount('blur'), 0);
  const controller = new AbortController();
  const pending = waitForCallForeground(capriWindow, { signal: controller.signal, onWaiting });
  controller.abort(new Error('Cancelled'));
  await assert.rejects(pending, /Cancelled/);
  assert.equal(capriWindow.listenerCount('blur'), 0);
});

test('joining only clicks an unambiguous prejoin button with mic and camera off, then verifies the call', async () => {
  const f = fixture([view(lobby, teams), view([hangup], teams)]);
  const result = await f.agent.run('Join this call in Teams.', { ownerRequestedCall: true });
  assert.equal(result.verified, true);
  assert.equal(result.steps, 1);
  assert.deepEqual(f.actions, [
    { action: 'observe', vision: false },
    { action: 'click', targetId: 'join' },
    { action: 'observe', vision: false },
  ]);
});

test('a call request from a model, unverified tab, draft address, or live mic cannot join', async () => {
  const cases = [
    [view(lobby), false],
    [view(lobby, 'https://meet.google.com.example.org/abc-defg-hij'), true],
    [view(lobby, meet, true), true],
    [view(lobby.filter(({ targetId }) => targetId !== 'mic')), true],
    [view([...lobby, button('join2', 'Join now')]), true],
  ];
  for (const [state, ownerRequestedCall] of cases) {
    const f = fixture([state]);
    const result = await f.agent.run('Join this call.', { ownerRequestedCall });
    assert.equal(result.status, 'needs_user');
    assert.ok(f.actions.every(({ action }) => action === 'observe'));
  }
});

test('requested sending ends with a verified draft, never a Send click or key press', async () => {
  const exact = 'Привет от Capri!';
  const f = fixture(
    [
      view([hangup, button('chat', 'In-call messages')]),
      view([hangup, button('send', 'Send a message to everyone'), composer()]),
      view([hangup, composer(exact)]),
    ],
    (args) => ({ ok: true, ...(args.action === 'enter_text' ? { submitted: false } : {}) }),
  );
  const result = await f.agent.run(`Send "${exact}" in the call chat.`, {
    ownerRequestedCall: true,
  });
  assert.equal(result.status, 'needs_user');
  assert.equal(result.steps, 2);
  assert.match(result.summary, /draft is ready.*click Send/iu);
  assert.deepEqual(
    f.actions.filter(({ action }) => action !== 'observe'),
    [
      { action: 'click', targetId: 'chat' },
      { action: 'enter_text', targetId: 'compose', text: exact },
    ],
  );
  assert.equal(JSON.stringify(f.agent.diagnostics()).includes(exact), false);
});

test('drafting preserves existing text and refuses a chat that changed meetings after opening', async () => {
  for (const observations of [
    [view([hangup, composer('Owner draft')])],
    [
      view([hangup, button('chat', 'Chat')]),
      view([hangup, composer()], 'https://meet.google.com/xyz-defg-hij'),
    ],
  ]) {
    const f = fixture(observations);
    const result = await f.agent.run('Write "Hello" in this call chat.', {
      ownerRequestedCall: true,
    });
    assert.equal(result.status, 'needs_user');
    assert.equal(
      f.actions.some(({ action }) => action === 'enter_text'),
      false,
    );
  }
});
