// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DiscordGuiTask,
  discordTaskRequest,
  discordObservation,
  validateDiscordRequest,
} from '../apps/desktop/discord-application.mjs';

const target = (targetId, untrustedLabel, extra = {}) => ({
  targetId,
  untrustedLabel,
  role: extra.editable ? 'ControlType.Edit' : 'ControlType.Button',
  ...extra,
});
const server = (id, label) => target(id, label, { untrustedAncestors: ['Servers sidebar'] });
const channel = (id, label, type = 'text', extra = {}) =>
  target(id, `${label} (${type} channel)`, {
    role: 'ControlType.Hyperlink',
    untrustedAncestors: ['Channels'],
    ...extra,
  });
const composer = (value = '', focused = false) =>
  target('composer', 'Message #general', {
    editable: true,
    focused,
    untrustedValue: value,
    untrustedValueSha256: createHash('sha256').update(value).digest('hex'),
    untrustedAncestors: ['Channel content'],
  });
const view = (targets = [], title = '#general | Friends - Discord', extra = {}) => ({
  observationId: 'fresh',
  window: {
    applicationKind: 'discord',
    windowId: 'discord-window',
    untrustedTitle: title,
    ...extra,
  },
  targets,
});
const request = (action = 'navigate', channelType = 'text') => ({
  action,
  server: 'Friends',
  channel: channelType === 'voice' ? 'General' : 'general',
  channelType,
});
const record = (task, step, before) => task.record(step, { ok: true }, before);

test('Discord requests require an owner action and preserve exact EN/RU names and message content', () => {
  assert.equal(discordTaskRequest('Open Discord.'), null);
  assert.equal(discordTaskRequest('Открой дискорд'), null);
  assert.equal(
    discordTaskRequest(
      'Send message "＄100  café" in Discord channel #general on server "Friends".',
    ).text,
    '＄100  café',
  );
  assert.equal(
    discordTaskRequest(
      'Write message "Hello" in Discord channel #general on server "Friends", but do not press Enter.',
    ),
    null,
  );
  assert.equal(
    discordTaskRequest('Discord can join voice channel "General" on server "Friends".'),
    null,
  );
  assert.equal(
    discordTaskRequest(
      'I never asked you to send message "Hello" in Discord channel #general on server "Friends".',
    ),
    null,
  );
  assert.equal(discordTaskRequest('Can you control Discord?'), null);
  assert.equal(
    discordTaskRequest('How do I join Discord voice channel "General" on server "Friends"?'),
    null,
  );
  assert.equal(
    discordTaskRequest('Do not join Discord voice channel "General" on server "Friends".'),
    null,
  );
  assert.equal(
    discordTaskRequest('Set up a Discord bot to join voice channel "General" on server "Friends".'),
    null,
  );
  assert.deepEqual(
    discordTaskRequest('Can you join Discord voice channel "General" on server "Friends"?'),
    request('join_voice', 'voice'),
  );
  assert.deepEqual(
    discordTaskRequest('В дискорде зайди в голосовой канал «General» на сервере «Friends».'),
    request('join_voice', 'voice'),
  );
  assert.deepEqual(
    discordTaskRequest(
      'Send message "Hello Friends!" in Discord channel #general on server "Friends".',
    ),
    { ...request('send_message'), text: 'Hello Friends!' },
  );
  assert.equal(discordTaskRequest('Join the general voice channel in Discord.').action, 'clarify');
  assert.deepEqual(discordTaskRequest('List Discord channels on server "Friends".'), {
    action: 'list_channels',
    server: 'Friends',
  });
  assert.equal(
    discordTaskRequest('Join Discord voice channel "General" on server "Friends" and share screen.')
      .action,
    'clarify',
  );
});

test('structured Discord actions reject hidden arguments, malformed names and implicit send text', () => {
  assert.throws(
    () => validateDiscordRequest({ ...request(), token: 'not-an-input' }),
    /Invalid Discord/,
  );
  assert.throws(
    () => validateDiscordRequest({ ...request(), text: 'unrequested' }),
    /Only an explicit/,
  );
  assert.throws(
    () => validateDiscordRequest({ ...request('send_message'), text: 'first\nsecond' }),
    /one explicit message/,
  );
  assert.throws(
    () => validateDiscordRequest({ ...request('send_message'), text: '/ban someone' }),
    /one explicit message/,
  );
  assert.throws(
    () => validateDiscordRequest({ action: 'leave_voice', server: 'Friends' }),
    /Unexpected/,
  );
});

test('a Discord window title cannot identify another application as Discord; focus uses an observed app button', () => {
  assert.equal(
    discordObservation({ window: { untrustedTitle: '#general | Friends - Discord' }, targets: [] }),
    null,
  );
  const task = new DiscordGuiTask(request());
  const otherApp = {
    window: { untrustedTitle: 'Discord help - Browser' },
    targets: [
      target('tray', 'Discord', { surface: 'taskbar', notificationArea: true }),
      target('app', 'Discord', { surface: 'taskbar' }),
    ],
  };
  assert.deepEqual(task.next(otherApp), {
    action: 'click',
    targetId: 'app',
    summary: 'Focus the already open Discord window.',
  });
  assert.equal(task.outcome(otherApp), null);
});

test('server resolution uses the server-list ancestry and refuses duplicate names', () => {
  const task = new DiscordGuiTask(request());
  const before = view(
    [target('chat-message', 'Friends'), server('server', 'Friends')],
    '#elsewhere | Another - Discord',
  );
  assert.equal(task.next(before).targetId, 'server');
  assert.equal(
    task.next(
      view([server('a', 'Friends'), server('b', 'Friends')], '#elsewhere | Another - Discord'),
    ).action,
    'ask_user',
  );
});

test('exact server and channel identities preserve compatibility characters and meaningful spaces', () => {
  assert.equal(
    validateDiscordRequest({ ...request(), server: 'Test  Server' }).server,
    'Test  Server',
  );
  const task = new DiscordGuiTask(request());
  assert.notEqual(
    task.next(view([server('wrong', 'Ｆｒｉｅｎｄｓ')], '#elsewhere | Another - Discord')).targetId,
    'wrong',
  );
  assert.notEqual(
    task.next(view([channel('wrong', 'ｇｅｎｅｒａｌ')], '#other | Friends - Discord')).targetId,
    'wrong',
  );
  const spaced = new DiscordGuiTask({ ...request(), server: 'Test  Server' });
  assert.equal(spaced.outcome(view([], '#general | Test Server - Discord')), null);
});

test('text and voice channels with equal names remain distinct and duplicate categories are clarified', () => {
  const task = new DiscordGuiTask(request());
  const before = view(
    [channel('voice', 'general', 'voice'), channel('text', 'general')],
    '#other | Friends - Discord',
  );
  assert.equal(task.next(before).targetId, 'text');
  assert.equal(
    task.next(
      view([channel('a', 'general'), channel('b', 'general')], '#other | Friends - Discord'),
    ).action,
    'ask_user',
  );
});

test('Quick Switcher fallback types only into its observed field and clicks an exact scoped result', () => {
  const task = new DiscordGuiTask(request());
  const before = view([], '#other | Friends - Discord');
  const open = task.next(before);
  assert.deepEqual(open.keys, ['CTRL', 'K']);
  record(task, open, before);
  assert.equal(task.next(view([composer()], '#other | Friends - Discord')).action, 'ask_user');
  const field = target('quick-field', 'Where would you like to go?', {
    editable: true,
    untrustedValue: '',
    untrustedAncestors: ['Quick Switcher'],
  });
  const opened = view([field], '#other | Friends - Discord', { modal: true });
  const type = task.next(opened);
  assert.equal(type.action, 'enter_text');
  assert.equal(type.targetId, 'quick-field');
  assert.equal(type.text, '#general');
  record(task, type, opened);
  const results = view(
    [
      { ...field, untrustedValue: '#general' },
      target('wrong-server', 'general, text channel, Other', {
        role: 'ControlType.ListItem',
        untrustedAncestors: ['Quick Switcher'],
      }),
      target('right', 'general, text channel, Friends', {
        role: 'ControlType.ListItem',
        untrustedAncestors: ['Quick Switcher'],
      }),
    ],
    '#other | Friends - Discord',
    { modal: true },
  );
  assert.equal(task.next(results).targetId, 'right');
  assert.equal(task.next(results).action, 'click');
  assert.equal(task.outcome(results), null);
});

test('Quick Switcher ambiguous results never accept the first result with Enter', () => {
  const task = new DiscordGuiTask(request());
  const field = target('search', 'Where would you like to go?', {
    editable: true,
    untrustedValue: '#general',
  });
  const result = (id) =>
    target(id, 'general, text channel, Friends', {
      role: 'ControlType.ListItem',
      untrustedAncestors: ['Quick Switcher'],
    });
  assert.equal(
    task.next(view([field, result('one'), result('two')], '#other | Friends - Discord')).action,
    'ask_user',
  );
  assert.equal(
    task.next(
      view(
        [
          target('wrong-search', 'Search', {
            editable: true,
            focused: true,
            untrustedValue: '#general',
          }),
        ],
        '#other | Friends - Discord',
      ),
    ).action,
    'press_keys',
  );
});

test('joining requires actual voice connection evidence bound to both the exact server and channel', () => {
  const task = new DiscordGuiTask(request('join_voice', 'voice'));
  const panel = ['Voice controls'];
  const connected = [
    target('connected', 'Voice Connected', { untrustedAncestors: panel }),
    target('disconnect', 'Disconnect', { untrustedAncestors: panel }),
  ];
  assert.equal(
    task.outcome(
      view(
        [channel('selected', 'General', 'voice', { selected: true })],
        'General | Friends - Discord',
      ),
    ),
    null,
  );
  assert.equal(
    task.outcome(
      view([...connected, target('where', 'General / Other', { untrustedAncestors: panel })]),
    ),
    null,
  );
  const result = task.outcome(
    view([...connected, target('where', 'General / Friends', { untrustedAncestors: panel })]),
  );
  assert.equal(result.verified, true);
  assert.equal(result.evidence, 'General / Friends');
  assert.equal(
    new DiscordGuiTask(request('navigate', 'voice')).next(
      view([channel('vc', 'General', 'voice')], '#other | Friends - Discord'),
    ).action,
    'ask_user',
  );
});

test('disconnect is verified only from explicit state or the changed loaded voice panel after one click', () => {
  const task = new DiscordGuiTask({ action: 'leave_voice' });
  assert.equal(task.outcome(view([])), null);
  const before = view([
    target('disconnect', 'Disconnect', { untrustedAncestors: ['Voice panel'] }),
    target('connected', 'Voice Connected', { untrustedAncestors: ['Voice panel'] }),
    target('settings', 'User Settings', { untrustedAncestors: ['User area'] }),
  ]);
  const step = task.next(before);
  assert.equal(step.targetId, 'disconnect');
  record(task, step, before);
  assert.equal(task.next(before).action, 'ask_user');
  assert.equal(
    task.outcome(view([target('settings', 'User Settings', { untrustedAncestors: ['User area'] })]))
      .verified,
    true,
  );
  assert.equal(task.outcome(view([])), null);
  assert.equal(
    task.outcome({
      ...view([target('settings', 'User Settings', { untrustedAncestors: ['User area'] })]),
      application: { kind: 'discord', controlsTruncated: true },
    }),
    null,
  );
});

test('chat text, links and unscoped buttons cannot impersonate voice controls or connection proof', () => {
  for (const role of ['ControlType.Text', 'ControlType.Hyperlink', 'ControlType.Button']) {
    const fake = view(
      [
        target('fake-disconnect', 'Disconnect', { role }),
        target('fake-connected', 'Voice Connected', { role }),
        target('fake-where', 'General / Friends', { role }),
      ],
      'General | Friends - Discord',
    );
    assert.equal(new DiscordGuiTask({ action: 'leave_voice' }).next(fake).action, 'ask_user');
    assert.equal(new DiscordGuiTask(request('join_voice', 'voice')).outcome(fake), null);
    assert.equal(
      new DiscordGuiTask(request('join_voice', 'voice')).next(
        view([target('fake-join', 'Join Voice', { role })], 'General | Friends - Discord'),
      ).action,
      'ask_user',
    );
  }
  const scopedText = view([
    target('fake-disconnect', 'Disconnect', {
      role: 'ControlType.Text',
      untrustedAncestors: ['Voice panel'],
    }),
  ]);
  assert.equal(new DiscordGuiTask({ action: 'leave_voice' }).next(scopedText).action, 'ask_user');
  const realJoin = view(
    [target('join', 'Join Voice', { untrustedAncestors: ['General (voice channel)'] })],
    'General | Friends - Discord',
  );
  assert.equal(new DiscordGuiTask(request('join_voice', 'voice')).next(realJoin).targetId, 'join');
});

test('complete native user-panel scan proves one disconnect despite a truncated long chat', () => {
  const task = new DiscordGuiTask({ action: 'leave_voice' });
  const before = view([
    target('disconnect', 'Disconnect', { untrustedAncestors: ['User status and settings'] }),
  ]);
  const step = task.next(before);
  record(task, step, before);
  const after = view([], '#general | Friends - Discord', {
    controlsTruncated: true,
    discordUserPanel: { complete: true, settingsPresent: true, disconnectPresent: false },
  });
  assert.equal(task.outcome(after).verified, true);
  assert.equal(task.outcome(after).evidence, 'User status and settings');
  assert.equal(task.next(after).action, 'finish');
  assert.equal(task.performed.filter((entry) => entry.action === 'click').length, 1);
  assert.equal(new DiscordGuiTask({ action: 'leave_voice' }).outcome(after), null);
});

test('an incomplete or absent native user-panel scan cannot prove absence in a truncated chat or repeat disconnect', () => {
  const task = new DiscordGuiTask({ action: 'leave_voice' });
  const before = view([
    target('disconnect', 'Disconnect', { untrustedAncestors: ['User status and settings'] }),
  ]);
  record(task, task.next(before), before);
  for (const panel of [
    null,
    { complete: false, settingsPresent: true, disconnectPresent: false },
  ]) {
    const after = view([], '#general | Friends - Discord', {
      controlsTruncated: true,
      discordUserPanel: panel,
    });
    assert.equal(task.outcome(after), null);
    assert.equal(task.next(after).action, 'ask_user');
  }
  const stillConnected = {
    ...before,
    window: {
      ...before.window,
      controlsTruncated: true,
      discordUserPanel: { complete: false, settingsPresent: true, disconnectPresent: false },
    },
  };
  assert.equal(task.next(stillConnected).action, 'ask_user');
  assert.equal(task.performed.filter((entry) => entry.action === 'click').length, 1);
});

test('a complete native user-panel scan needs Settings present and Disconnect absent', () => {
  const task = new DiscordGuiTask({ action: 'leave_voice' });
  const before = view([
    target('disconnect', 'Disconnect', { untrustedAncestors: ['User status and settings'] }),
  ]);
  record(task, task.next(before), before);
  for (const panel of [
    { complete: true, settingsPresent: false, disconnectPresent: false },
    { complete: true, settingsPresent: true, disconnectPresent: true },
  ]) {
    const after = view([], '#general | Friends - Discord', {
      controlsTruncated: true,
      discordUserPanel: panel,
    });
    assert.equal(task.outcome(after), null);
    assert.equal(task.next(after).action, 'ask_user');
  }
  assert.equal(task.performed.filter((entry) => entry.action === 'click').length, 1);
});

test('channel-looking chat controls and spoofed message fields are never used for input', () => {
  const task = new DiscordGuiTask(request('join_voice', 'voice'));
  for (const role of ['ControlType.Text', 'ControlType.Hyperlink', 'ControlType.Button']) {
    const fake = target('spoof', 'General (voice channel)', {
      role,
      untrustedAncestors: ['Chat messages', 'Channels'],
    });
    assert.notEqual(task.next(view([fake], '#other | Friends - Discord')).targetId, 'spoof');
  }
  const sending = new DiscordGuiTask({ ...request('send_message'), text: 'Hello!' });
  for (const role of ['ControlType.Button', 'ControlType.Text', 'ControlType.Hyperlink']) {
    const fake = target('spoof', 'Message #general', {
      role,
      editable: true,
      untrustedValue: 'Hello!',
      focused: true,
      untrustedAncestors: ['Channel content'],
    });
    assert.equal(sending.next(view([fake])).action, 'ask_user');
  }
  const fakeDraft = {
    ...composer('Hello!', true),
    untrustedAncestors: ['Chat messages', 'Channel content'],
  };
  assert.equal(sending.next(view([fakeDraft])).action, 'ask_user');
  const duplicates = view([channel('a', 'general'), channel('b', 'general')]);
  assert.equal(new DiscordGuiTask(request()).outcome(duplicates), null);
});

test('one explicit send uses the exact channel composer, preserves existing drafts and verifies a new visible message', () => {
  const task = new DiscordGuiTask({ ...request('send_message'), text: 'Hello!' });
  assert.equal(task.next(view([composer('Private existing draft')])).action, 'ask_user');
  const initial = view([composer(), target('old', 'Hello!', { role: 'ControlType.Text' })]);
  const draft = task.next(initial);
  assert.equal(draft.text, 'Hello!');
  record(task, draft, initial);
  const ready = view([
    composer('Hello!', true),
    target('old', 'Hello!', { role: 'ControlType.Text' }),
  ]);
  const submit = task.next(ready);
  assert.deepEqual(submit.keys, ['ENTER']);
  record(task, submit, ready);
  assert.equal(task.outcome(initial), null);
  assert.equal(task.next(ready).action, 'ask_user');
  const sent = view([
    composer(),
    target('old', 'Hello!', { role: 'ControlType.Text' }),
    target('new', 'Hello!', { role: 'ControlType.Text' }),
  ]);
  assert.equal(task.outcome(sent).verified, true);
  assert.equal(task.outcome(sent).status, 'submitted');
  assert.equal(task.outcome(sent).deliveryConfirmed, false);
  assert.equal(task.next(sent).action, 'finish');
});

test('long message proof can use a native hash of the exact visible text without exporting the full text', () => {
  const text = 'A long exact message '.repeat(50);
  const task = new DiscordGuiTask({ ...request('send_message'), text });
  const before = view([
    {
      ...composer(text.slice(0, 500), true),
      untrustedValueSha256: createHash('sha256').update(text).digest('hex'),
    },
  ]);
  const submit = task.next(before);
  record(task, submit, before);
  const after = view([
    composer(),
    target('sent', text.slice(0, 100), {
      role: 'ControlType.Text',
      untrustedTextSha256: createHash('sha256').update(text).digest('hex'),
    }),
  ]);
  assert.equal(task.outcome(after).verified, true);
  assert.equal(
    task.outcome(
      view([composer(), target('sent', text.slice(0, 100), { role: 'ControlType.Text' })]),
    ),
    null,
  );
});

test('a redacted empty-looking draft is not overwritten and a cleared verified draft is not entered twice', () => {
  const task = new DiscordGuiTask({ ...request('send_message'), text: 'Hello!' });
  const hidden = { ...composer(), untrustedValueSha256: undefined };
  assert.equal(task.next(view([hidden])).action, 'ask_user');
  const initial = view([composer()]);
  const draft = task.next(initial);
  assert.equal(draft.action, 'enter_text');
  record(task, draft, initial);
  assert.equal(task.next(initial).action, 'ask_user');
  assert.equal(
    task.outcome(view([hidden, target('new', 'Hello!', { role: 'ControlType.Text' })])),
    null,
  );
});

test('actual Discord User status and settings scope binds connection hyperlinks and the current channel composer', () => {
  const scope = ['User status and settings'];
  const connected = view([
    target('status', 'Connection info, Voice Connected', { untrustedAncestors: scope }),
    target('where', 'General / Friends', {
      role: 'ControlType.Hyperlink',
      untrustedAncestors: scope,
    }),
    target('disconnect', 'Disconnect', { untrustedAncestors: scope }),
    target('settings', 'User Settings', { untrustedAncestors: scope }),
  ]);
  assert.equal(
    new DiscordGuiTask(request('join_voice', 'voice')).outcome(connected).verified,
    true,
  );
  const leave = new DiscordGuiTask({ action: 'leave_voice' });
  assert.equal(leave.next(connected).targetId, 'disconnect');
  record(leave, leave.next(connected), connected);
  assert.equal(
    leave.outcome(view([target('settings', 'User Settings', { untrustedAncestors: scope })]))
      .verified,
    true,
  );
  const fakeConnection = structuredClone(connected);
  fakeConnection.targets.find((item) => item.targetId === 'where').role = 'ControlType.Text';
  assert.equal(new DiscordGuiTask(request('join_voice', 'voice')).outcome(fakeConnection), null);
  const sending = new DiscordGuiTask({ ...request('send_message'), text: 'Explicit message' });
  const actualComposer = {
    ...composer(),
    discordChatInput: true,
    untrustedAncestors: ['general (channel)'],
  };
  assert.equal(sending.next(view([actualComposer])).action, 'enter_text');
  assert.equal(
    sending.next(view([{ ...actualComposer, discordChatInput: false }])).action,
    'ask_user',
  );
  const wrongComposer = { ...actualComposer, untrustedAncestors: ['other (channel)'] };
  assert.equal(sending.next(view([wrongComposer])).action, 'ask_user');
  const messageSpoof = { ...actualComposer, untrustedAncestors: ['Messages', 'general (channel)'] };
  assert.equal(sending.next(view([messageSpoof])).action, 'ask_user');
});

test('uncertain input never retries or confirms a Discord mutation automatically', () => {
  const task = new DiscordGuiTask(request('join_voice', 'voice'));
  const before = view([channel('voice', 'General', 'voice')], '#other | Friends - Discord');
  const step = task.next(before);
  task.record(step, { ok: false }, before);
  assert.equal(task.next(before).action, 'ask_user');
  assert.equal(task.outcome(before), null);
});

test('channel listing and context reads are restricted to current visible UI data', () => {
  const listing = new DiscordGuiTask({ action: 'list_channels', server: 'Friends' });
  const visible = view([
    channel('general', 'general'),
    channel('voice', 'General', 'voice'),
    target('message', 'Visible current message', {
      role: 'ControlType.Text',
      untrustedAncestors: ['Messages'],
    }),
    composer('Unsent private draft'),
  ]);
  assert.deepEqual(listing.outcome(visible).untrustedVisibleChannels, [
    { name: 'general', type: 'text' },
    { name: 'General', type: 'voice' },
  ]);
  const reading = new DiscordGuiTask(request('read_context'));
  const result = reading.outcome(visible);
  assert.match(result.untrustedVisibleContext, /Visible current message/);
  assert.doesNotMatch(result.untrustedVisibleContext, /Unsent private draft/);
  assert.equal(result.contextScope, 'visible_only');
});
