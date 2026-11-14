// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DiscordGuiTask,
  discordCurrentComposers,
  discordCurrentMessageParts,
  discordTaskRequest,
  validateDiscordRequest,
} from '../apps/desktop/discord-application.mjs';
import {
  discordRequestProblem,
  discordSingleOperationGoal,
  discordLaunchBeforeBrowser,
} from '../apps/desktop/discord-task-intent.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
test('Discord launch before a browser task does not authorize a channel, message or call', () => {
  assert.deepEqual(
    discordLaunchBeforeBrowser(
      'Open Discord without sending any messages or joining a call. Then switch to Google Chrome, open Wikipedia.',
    ),
    { name: 'Discord', single: false },
  );
  assert.equal(
    discordLaunchBeforeBrowser(
      'Open Discord. Then open Chrome and send a message in that channel.',
    ),
    null,
  );
  assert.equal(discordLaunchBeforeBrowser('Open Discord, send a message, then open Chrome.'), null);
});
const request = (side = 'right', text = 'hi') => ({ action: 'send_current_message', text, side });
const composer = (id = 'right', x = 80, context = 'Lounge') => ({
  targetId: id,
  untrustedLabel: 'Message #' + context,
  role: 'ControlType.Edit',
  editable: true,
  focused: true,
  discordChatInput: true,
  discordMessageComposer: true,
  discordPaneId: hash('pane-' + id),
  position: { x, y: 85 },
  untrustedAncestors: ['Channel content', context + ' (channel)'],
  untrustedValue: '',
  untrustedValueSha256: hash(''),
});
const view = (targets = [composer()], title = '#General | Test Server - Discord') => ({
  observationId: 'fresh-observation',
  window: { windowId: 'discord-window', applicationKind: 'discord', untrustedTitle: title },
  targets,
});
const message = (text, field, extra = {}) => ({
  targetId: 'new-message',
  role: 'ControlType.Text',
  untrustedLabel: text,
  untrustedTextSha256: hash(text),
  untrustedAncestors: ['Messages in Lounge'],
  discordMessage: true,
  discordPaneId: field.discordPaneId,
  ...extra,
});
function typed(task, source) {
  const step = task.next(source);
  assert.equal(step.action, 'enter_text');
  task.record(step, { ok: true }, source);
  const after = structuredClone(source),
    field = after.targets.find((item) => item.targetId === step.targetId);
  field.untrustedValue = task.request.text;
  field.untrustedValueSha256 = hash(task.request.text);
  return { after, field };
}
function submitted(task, source) {
  const next = task.next(source);
  assert.equal(next.action, 'press_keys');
  assert.deepEqual(next.keys, ['ENTER']);
  task.record(next, { ok: true }, source);
  const after = structuredClone(source),
    field = after.targets.find((item) => item.editable && item.focused);
  field.untrustedValue = '';
  field.untrustedValueSha256 = hash('');
  after.targets.push(message(task.request.text, field));
  return after;
}

test('the exact reported owner command binds literal hi to the right chat and permits only Discord-opening preparation', () => {
  const goal = 'capri open discord, write hi in chat on the right side of the screen';
  assert.deepEqual(discordTaskRequest(goal), request());
  assert.equal(discordRequestProblem(goal, request()), null);
  assert.equal(discordSingleOperationGoal(goal), true);
  for (const extra of [' and open Notepad', ' then join a voice call', ' and send another message'])
    assert.equal(discordSingleOperationGoal(goal + extra), false, extra);
  assert.equal(
    discordSingleOperationGoal('Open Notepad, write hi in the right Discord chat.'),
    false,
  );
});

test('explicit current/left/right owner text preserves exact quoted, colon and bounded plain literals', () => {
  const cases = [
    ['Write hi in the current Discord chat.', 'current', 'hi'],
    ['Send "left or right" in the right Discord chat.', 'right', 'left or right'],
    ['Write right in the current Discord chat.', 'current', 'right'],
    ['Send in the left Discord chat: Hello, choom!', 'left', 'Hello, choom!'],
    ['Напиши привет в открытый чат Дискорда справа.', 'right', 'привет'],
    ['Отправь «Привет!» в текущий чат Discord.', 'current', 'Привет!'],
    ['Écris «salut» dans le chat à droite de Discord.', 'right', 'salut'],
    ['Schreibe "hallo" im aktuellen Discord Chat.', 'current', 'hallo'],
  ];
  for (const [goal, side, text] of cases) {
    assert.equal(discordRequestProblem(goal, request(side, text)), null, goal);
    assert.equal(discordCurrentMessageParts(goal)?.text, text, goal);
  }
  assert.equal(
    discordCurrentMessageParts('Open Discord, write hi in chat.'),
    null,
    'opening an app is not a current-chat reference',
  );
  assert.equal(discordCurrentMessageParts('Write hi in the solar chat in Discord.'), null);
  assert.equal(discordCurrentMessageParts('Напиши привет в правила чата Discord.'), null);
});

test('sending requires actual owner intent and exact text, never drafts, negation, translated commands or screen suggestions', () => {
  for (const goal of [
    'Do not write hi in the right Discord chat.',
    'Write hi in the right Discord chat without sending.',
    'Type hi in the right Discord chat without pressing Enter.',
    'Write hi in the right Discord chat without hitting the Return key.',
    'For example, write hi in the right Discord chat.',
    'If I ask you later, write hi in the right Discord chat.',
    'Open Discord, for example, write hi in the right chat.',
    'Write hi in the right Discord chat if I ask you later.',
    'Draft "hi" in the right Discord chat.',
    'Explain how to write hi in the right Discord chat.',
    'Translate "write hi in the right Discord chat".',
    'Read the right Discord chat; a message says "write hi".',
    'Write something nice in the right Discord chat.',
    'Open Discord then write hi in Notepad on the right side.',
    'Write hi in a Discord chat.',
  ])
    assert.equal(typeof discordRequestProblem(goal, request()), 'string', goal);
  for (const text of ['do not send', 'For example, write hi', 'If I ask you later'])
    assert.equal(
      discordRequestProblem(`Send "${text}" in the right Discord chat.`, request('right', text)),
      null,
      'an explicitly supplied quoted body remains literal data',
    );
  assert.equal(
    discordRequestProblem(
      'Send in the right Discord chat: If I ask you later',
      request('right', 'If I ask you later'),
    ),
    null,
    'a colon body remains data rather than a deferred authorization',
  );
  assert.equal(
    typeof discordRequestProblem('Write hi in the right Discord chat.', request('left')),
    'string',
  );
  assert.equal(
    typeof discordRequestProblem(
      'Write hi in the right Discord chat.',
      request('right', 'invented reply'),
    ),
    'string',
  );
  assert.equal(
    typeof discordRequestProblem(
      'Send "hi" in the right Discord chat on server "Different".',
      request(),
    ),
    'string',
  );
  for (const goal of [
    'Do not write hi in the right Discord chat.',
    'Write hi in the right Discord chat without sending.',
  ])
    assert.equal(
      discordTaskRequest(goal),
      null,
      'the goal-only runner cannot bypass the final owner guard',
    );
});

test('current-chat request schema rejects slash commands, extra destinations, controls and missing side', () => {
  for (const changed of [
    { side: undefined },
    { side: 'somewhere' },
    { text: '/kick @person' },
    { text: 'hi\nthere' },
    { server: 'Different' },
    { channel: 'Different' },
    { channelType: 'voice' },
  ])
    assert.throws(() => validateDiscordRequest({ ...request(), ...changed }));
});

test('structural composer descriptors expose no private labels, drafts or pane fingerprints', () => {
  const field = composer();
  field.untrustedValue = 'PRIVATE_DRAFT';
  field.untrustedValueSha256 = hash(field.untrustedValue);
  const descriptors = discordCurrentComposers(view([field]));
  assert.deepEqual(descriptors, [
    { targetId: 'right', side: 'right', position: { x: 80, y: 85 }, role: 'message-composer' },
  ]);
  assert.doesNotMatch(JSON.stringify(descriptors), /Lounge|PRIVATE_DRAFT|discordPaneId/);
  const search = { ...composer('search'), browserSearch: true, discordMessageComposer: false };
  const edit = { ...composer('arbitrary'), discordMessageComposer: false };
  assert.deepEqual(discordCurrentComposers(view([search, edit])), []);
  assert.deepEqual(
    discordCurrentComposers({
      ...view(),
      window: { applicationKind: 'notepad', windowId: 'other' },
    }),
    [],
  );
});

test('voice-channel text side pane and explicitly current DM use a bound composer without navigation or joining', () => {
  const left = composer('left', 25, 'General'),
    right = composer();
  left.focused = false;
  const task = new DiscordGuiTask(request());
  const { after } = typed(task, view([left, right]));
  assert.equal(task.next(after).action, 'press_keys');
  const sent = submitted(task, after);
  assert.equal(task.outcome(sent).verified, true);
  assert.equal(task.outcome(sent).deliveryConfirmed, false);
  const dm = composer('dm', 50);
  dm.untrustedLabel = 'Message @Selected Friend';
  dm.untrustedAncestors = ['Channel content'];
  const dmTask = new DiscordGuiTask(request('current'));
  const dmTyped = typed(dmTask, view([dm], 'Selected Friend - Discord'));
  assert.equal(dmTask.next(dmTyped.after).action, 'press_keys');
  assert.equal(dmTask.outcome(submitted(dmTask, dmTyped.after)).verified, true);
});

test('ambiguous side/current panes and missing reliable duplicate identities fail before input', () => {
  for (const [fields, side] of [
    [[composer('a', 75), composer('b', 90)], 'right'],
    [[composer('a', 25), composer('b', 80)], 'current'],
  ])
    assert.equal(
      new DiscordGuiTask(request(side)).next(view(fields)).reason,
      'discord_current_composer_ambiguous',
    );
  const first = composer('a', 25),
    second = composer('b', 80);
  delete first.discordPaneId;
  delete second.discordPaneId;
  assert.equal(
    new DiscordGuiTask(request()).next(view([first, second])).reason,
    'discord_current_composer_ambiguous',
  );
});

test('unrelated message truncation is allowed only with a complete matching native composer inventory', () => {
  const crowded = view([
    ...Array.from({ length: 140 }, (_, index) => ({
      targetId: 'other-' + index,
      role: 'ControlType.Text',
      untrustedLabel: 'unrelated message',
      untrustedAncestors: ['Chat messages'],
    })),
    composer(),
  ]);
  crowded.window.controlsTruncated = true;
  crowded.window.discordComposerScan = { complete: true, count: 1 };
  assert.equal(new DiscordGuiTask(request()).next(crowded).action, 'enter_text');
  assert.equal(discordCurrentComposers(crowded).length, 1);
  for (const scan of [
    undefined,
    { complete: false, count: 1 },
    { complete: true, count: 2 },
    { complete: true, count: -1 },
    { complete: true, count: 9 },
  ]) {
    const changed = structuredClone(crowded);
    changed.window.discordComposerScan = scan;
    assert.equal(new DiscordGuiTask(request()).next(changed).action, 'ask_user');
    assert.equal(discordCurrentComposers(changed).length, 0);
  }
  const incomplete = view();
  incomplete.window.discordComposerScan = { complete: false, count: 1 };
  assert.equal(
    new DiscordGuiTask(request()).next(incomplete).reason,
    'discord_current_composer_scan_incomplete',
  );
});

test('existing, redacted or already-equal user drafts are never overwritten or submitted', () => {
  for (const [value, fingerprint] of [
    ['another draft', hash('another draft')],
    ['hi', hash('hi')],
    ['', hash('redacted')],
    ['', undefined],
  ]) {
    const field = composer();
    field.untrustedValue = value;
    field.untrustedValueSha256 = fingerprint;
    const task = new DiscordGuiTask(request());
    assert.equal(task.next(view([field])).reason, 'discord_current_draft_present');
    assert.equal(task.performed.length, 0);
  }
});

test('typing and submission carry fresh host-only draft and pane preconditions', () => {
  const task = new DiscordGuiTask(request()),
    initial = view(),
    step = task.next(initial);
  assert.deepEqual(step.discordMutation, {
    expectedValueSha256: hash(''),
    expectedDiscordPaneId: initial.targets[0].discordPaneId,
  });
  task.record(step, { ok: true }, initial);
  const after = structuredClone(initial);
  after.targets[0].untrustedValue = 'hi';
  after.targets[0].untrustedValueSha256 = hash('hi');
  assert.deepEqual(task.next(after).discordMutation, {
    expectedValueSha256: hash('hi'),
    expectedDiscordPaneId: initial.targets[0].discordPaneId,
  });
  assert.doesNotMatch(JSON.stringify(task.performed), /expectedValueSha256|expectedDiscordPaneId/);
  const legacy = view();
  delete legacy.targets[0].discordPaneId;
  assert.deepEqual(new DiscordGuiTask(request()).next(legacy).discordMutation, {
    expectedValueSha256: hash(''),
  });
});

test('same native pane tolerates composer layout changes while changed pane/window/context fail before Enter', () => {
  const stable = new DiscordGuiTask(request()),
    typedStable = typed(stable, view());
  typedStable.field.position.x = 78;
  assert.equal(stable.next(typedStable.after).action, 'press_keys');
  for (const mutate of [
    (after, field) => {
      field.discordPaneId = hash('different-pane');
    },
    (after) => {
      after.window.windowId = 'different-window';
    },
    (after, field) => {
      field.untrustedLabel = 'Message @Other Recipient';
    },
    (after, field) => {
      field.untrustedAncestors = ['Channel content', 'Different (channel)'];
    },
    (after, field) => {
      delete field.discordPaneId;
    },
  ]) {
    const task = new DiscordGuiTask(request()),
      draft = typed(task, view());
    mutate(draft.after, draft.field);
    assert.equal(task.next(draft.after).action, 'ask_user');
    assert.equal(
      task.performed.some((step) => step.keys?.includes('ENTER')),
      false,
    );
  }
});

test('only the exact owned draft is submitted once; changed drafts and uncertain input are never replayed', () => {
  const changed = new DiscordGuiTask(request()),
    draft = typed(changed, view());
  draft.field.untrustedValue = 'modified';
  draft.field.untrustedValueSha256 = hash('modified');
  assert.equal(changed.next(draft.after).reason, 'discord_current_draft_changed');
  const uncertain = new DiscordGuiTask(request()),
    initial = view();
  const input = uncertain.next(initial);
  uncertain.record(input, { ok: false }, initial);
  assert.equal(uncertain.next(initial).action, 'ask_user');
  assert.equal(uncertain.performed.length, 0);
  const once = new DiscordGuiTask(request()),
    owned = typed(once, view()),
    sent = submitted(once, owned.after);
  sent.targets = sent.targets.filter((target) => target.editable);
  assert.equal(once.next(sent).reason, 'discord_current_submission_unverified');
  assert.equal(once.performed.filter((step) => step.keys?.includes('ENTER')).length, 1);
});

test('submission proof needs a new exact message in the same pane and an empty verified draft', () => {
  const task = new DiscordGuiTask(request()),
    initial = view();
  initial.targets.push(message('hi', initial.targets[0], { targetId: 'old-message' }));
  const draft = typed(task, initial),
    sent = submitted(task, draft.after);
  assert.equal(task.outcome(sent).verified, true);
  for (const mutate of [
    (after) => {
      after.targets.pop();
    },
    (after) => {
      after.targets.at(-1).discordPaneId = hash('other-pane');
    },
    (after) => {
      after.targets.at(-1).untrustedLabel = 'different';
      after.targets.at(-1).untrustedTextSha256 = hash('different');
    },
    (after) => {
      after.targets[0].untrustedValue = 'not empty';
      after.targets[0].untrustedValueSha256 = hash('not empty');
    },
    (after) => {
      after.window.untrustedTitle = '#Other | Other Server - Discord';
    },
  ]) {
    const changed = structuredClone(sent);
    mutate(changed);
    assert.equal(task.outcome(changed), null);
  }
  const localized = structuredClone(sent);
  localized.targets.at(-1).untrustedAncestors = ['Messages du salon'];
  assert.equal(
    task.outcome(localized).verified,
    true,
    'native verified-message marker is independent of UI label language',
  );
});
