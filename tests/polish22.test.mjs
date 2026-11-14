// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { wantsVoiceFollowUp } from '../apps/desktop/voice-follow-up.mjs';
import { settingsBounds, settingsHelpBounds } from '../apps/desktop/main/settings-window.mjs';
import {
  INITIATIVE_DEFAULTS,
  validateInitiative,
  quietHour,
} from '../apps/desktop/initiative-settings.mjs';
import { InitiativeService } from '../apps/desktop/initiative-service.mjs';
import { FileService } from '../integrations/filesystem/service.mjs';
import { FilePermissions } from '../integrations/filesystem/permissions.mjs';
import { TimeService } from '../packages/runtime/src/time/service.mjs';
import { TimeConversation } from '../apps/desktop/time-conversation.mjs';
import { ReminderDelivery } from '../apps/desktop/reminder-delivery.mjs';
import { speakReminder } from '../apps/desktop/reminder-playback.mjs';
import { VoiceService } from '../apps/desktop/voice-service.mjs';
import { SleepService, visuallySleeping } from '../apps/desktop/sleep-service.mjs';
import { ActionReplyFilter } from '../apps/desktop/action-replies.mjs';
import { createIpcHandler, settingsVersion } from '../apps/desktop/main/ipc.mjs';

const cleanup = new Map();
async function temp(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'capri-polish-'));
  t.after(async () => {
    await cleanup.get(folder)?.();
    cleanup.delete(folder);
    if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Invalid fixture cleanup path');
    await fs.rm(folder, { recursive: true, force: true });
  });
  return folder;
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};

test('a final question opens follow-up only for the current trusted voice session', () => {
  const valid = {
    text: 'Stay a while?”',
    origin: 'microphone',
    sessionId: 'mic1',
    activeSessionId: 'mic1',
    enabled: true,
  };
  assert.equal(wantsVoiceFollowUp(valid), true);
  for (const delta of [
    { origin: 'text' },
    { activeSessionId: 'mic2' },
    { enabled: false },
    { text: 'That is fine.' },
    { text: 'A question? Then a statement.' },
    { sessionId: null },
  ])
    assert.equal(wantsVoiceFollowUp({ ...valid, ...delta }), false);
  assert.equal(wantsVoiceFollowUp({ ...valid, text: 'هل تبقى؟' }), true);
});
test('settings docking stays within a monitor, including negative coordinates and high DPI work areas', () => {
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1280, y: 0, width: 1280, height: 720 },
    { x: 0, y: 0, width: 640, height: 480 },
  ]) {
    const result = settingsBounds(
      { x: area.x + area.width - 480, y: 100, width: 480, height: 660 },
      area,
    );
    assert(result.x >= area.x && result.y >= area.y);
    assert(
      result.x + result.width <= area.x + area.width &&
        result.y + result.height <= area.y + area.height,
    );
  }
});
test('settings IPC checks both exact main frames and excludes audio/capture channels', () => {
  const handlers = new Map(),
    primary = {
      isDestroyed: () => false,
      webContents: { mainFrame: { url: 'capri://desktop/index.html' } },
    },
    settings = {
      isDestroyed: () => false,
      webContents: { mainFrame: { url: 'capri://desktop/settings.html' } },
    };
  const handle = createIpcHandler(
    { handle: (name, fn) => handlers.set(name, fn) },
    {
      getWindow: () => primary,
      url: primary.webContents.mainFrame.url,
      getSettingsWindow: () => settings,
      settingsUrl: settings.webContents.mainFrame.url,
      settingsChannels: ['capri:bootstrap'],
    },
  );
  handle('capri:bootstrap', (_, context) => context.role);
  handle('capri:microphone-audio', () => true);
  const event = { sender: settings.webContents, senderFrame: settings.webContents.mainFrame };
  assert.equal(handlers.get('capri:bootstrap')(event), 'settings');
  assert.throws(() => handlers.get('capri:microphone-audio')(event), /unavailable/);
  assert.throws(
    () =>
      handlers.get('capri:bootstrap')({
        ...event,
        senderFrame: { url: settings.webContents.mainFrame.url },
      }),
    /Untrusted/,
  );
});
test('quiet hours migrate without resetting equal-hour opt-out or other initiative options', () => {
  const old = { ...INITIATIVE_DEFAULTS, quietStart: 0, quietEnd: 0 };
  delete old.quietHoursEnabled;
  delete old.spontaneous;
  const migrated = validateInitiative(old);
  assert.equal(migrated.quietHoursEnabled, false);
  assert.equal(quietHour(migrated, 3), false);
  assert.equal(
    quietHour({ ...migrated, quietStart: 23, quietEnd: 9, quietHoursEnabled: true }, 1),
    true,
  );
  assert.equal(
    quietHour({ ...migrated, quietStart: 23, quietEnd: 9, quietHoursEnabled: false }, 1),
    false,
  );
});
test('simultaneous settings writes serialize and reject the stale revision', async () => {
  const handlers = new Map(),
    owner = {
      isDestroyed: () => false,
      webContents: { mainFrame: { url: 'capri://desktop/index.html' } },
    },
    settings = {
      isDestroyed: () => false,
      webContents: { mainFrame: { url: 'capri://desktop/settings.html' } },
    };
  let state = { value: 1 };
  const handle = createIpcHandler(
    { handle: (name, fn) => handlers.set(name, fn) },
    {
      getWindow: () => owner,
      url: owner.webContents.mainFrame.url,
      getSettingsWindow: () => settings,
      settingsUrl: settings.webContents.mainFrame.url,
      settingsChannels: ['capri:edit'],
      revisionReaders: { 'capri:edit': () => state },
    },
  );
  handle('capri:edit', async (value) => {
    await settle();
    state = value;
    return value;
  });
  const invoke = handlers.get('capri:edit'),
    event = { sender: settings.webContents, senderFrame: settings.webContents.mainFrame },
    expectedRevision = settingsVersion(state);
  const first = invoke(event, { payload: { value: 2 }, expectedRevision }),
    second = invoke(event, { payload: { value: 3 }, expectedRevision });
  assert.deepEqual((await first).settings, { value: 2 });
  await assert.rejects(second, /changed elsewhere/);
  assert.equal(state.value, 2);
});
test('spontaneous initiative needs no Windows event and reports why a candidate cannot run', async (t) => {
  let now = 10000000,
    delivered = 0,
    state = { busy: true };
  const service = new InitiativeService({
    settings: { ...INITIATIVE_DEFAULTS, level: 'conversational', quietHoursEnabled: false },
    state: () => state,
    now: () => now,
    hour: () => 12,
    random: () => 0,
    generate: async () => ({ speak: true, text: 'A quiet moment, choom.' }),
    commit: async () => {},
    deliver: () => delivered++,
  });
  t.after(() => service.close());
  now += 400000;
  service.tick();
  assert.equal(service.snapshot().reason, 'model_busy');
  state = {};
  service.tick();
  await settle();
  assert.equal(delivered, 1);
  assert.equal(service.snapshot().reason, 'delivered');
  service.tick(true);
  await settle();
  assert.equal(delivered, 1);
});
test('file replacement reviews the exact file, keeps recovery and refuses concurrent edits', async (t) => {
  const folder = await temp(t),
    work = path.join(folder, 'work');
  await fs.mkdir(work);
  const permissions = new FilePermissions(path.join(folder, 'permissions.json'), {
    protectedRoots: [],
  });
  const [scope] = permissions.grant(work);
  permissions.update(scope.id, true);
  let accepted;
  const service = new FileService(permissions, {
    database: path.join(folder, 'ops.sqlite'),
    recovery: path.join(folder, 'recovery'),
    review: (_details, execute) => {
      accepted = execute;
      return { ok: false, needsApproval: true };
    },
    replaceFile: async ({ source, target }) => fs.rename(source, target),
  });
  cleanup.set(folder, () => service.close());
  await service.execute('create', {
    action: 'write_text',
    scopeId: scope.id,
    path: 'Текст.txt',
    text: 'original',
  });
  const read = await service.execute('read', {
    action: 'read_text',
    scopeId: scope.id,
    path: 'Текст.txt',
  });
  const args = {
    action: 'replace_text',
    scopeId: scope.id,
    path: 'Текст.txt',
    text: 'replacement',
    expectedHash: read.expectedHash,
  };
  assert.equal((await service.execute('replace', args)).needsApproval, true);
  assert.equal(await fs.readFile(path.join(work, 'Текст.txt'), 'utf8'), 'original');
  assert.equal((await accepted()).action, 'replace_text');
  assert.equal(await fs.readFile(path.join(work, 'Текст.txt'), 'utf8'), 'replacement');
  assert.equal((await service.execute('replace', args)).ok, true);
  await service.execute('undo', { action: 'undo', operationId: 'replace' });
  assert.equal(await fs.readFile(path.join(work, 'Текст.txt'), 'utf8'), 'original');
  const second = await service.execute('reread', {
    action: 'read_text',
    scopeId: scope.id,
    path: 'Текст.txt',
  });
  await service.execute('replace2', { ...args, expectedHash: second.expectedHash });
  await fs.writeFile(path.join(work, 'Текст.txt'), 'changed elsewhere');
  await assert.rejects(accepted(), /changed/);
  assert.equal(await fs.readFile(path.join(work, 'Текст.txt'), 'utf8'), 'changed elsewhere');
  const missing = await service.execute('missing', {
    action: 'read_text',
    scopeId: scope.id,
    path: 'выдуманное.txt',
  });
  assert.equal(missing.error.code, 'file_not_found');
  assert.equal(missing.entries[0].path, 'Текст.txt');
});
test('elapsed follow-ups always sample the service instead of a creation receipt', async (t) => {
  const folder = await temp(t);
  let wall = Date.now(),
    mono = 0;
  const service = new TimeService({
    file: path.join(folder, 'time.sqlite'),
    now: () => wall,
    monotonic: () => mono,
    deliver: async () => {},
  });
  cleanup.set(folder, () => service.close());
  const result = await service.execute('start', { action: 'stopwatch' });
  const conversation = new TimeConversation({
    service: () => service,
    language: () => 'en',
    now: () => wall,
  });
  conversation.observe({ action: 'stopwatch' }, result);
  mono = 26000;
  wall += 26000;
  assert.match(conversation.read('How much time has passed?'), /00:00:26/);
  mono = 46000;
  wall += 20000;
  assert.match(conversation.read('А сейчас?'), /00:00:46/);
  const read = await service.execute('same-read', { action: 'status', id: result.id });
  mono += 10000;
  const next = await service.execute('same-read', { action: 'status', id: result.id });
  assert.equal(next.elapsedSeconds, read.elapsedSeconds + 10);
  conversation.read('Tell me about Night City');
  assert.equal(conversation.read('А сейчас?'), null);
});
test('reminders persist spoken delivery separately, wake the voice and respect mute', async (t) => {
  const folder = await temp(t),
    events = [];
  let ready = 'busy';
  const options = {
    file: path.join(folder, 'delivery.json'),
    visual: async () => events.push('visual'),
    ready: () => ready,
    prepare: async () => events.push('prepare'),
    speak: async () => events.push('speak'),
  };
  const delivery = new ReminderDelivery(options);
  t.after(() => delivery.close());
  await delivery.enqueue({ id: 'clock1', kind: 'reminder', title: 'Breakfast', dueAt: 1 });
  assert.deepEqual(events, ['visual']);
  ready = 'ready';
  await delivery.pump();
  assert.deepEqual(events, ['visual', 'prepare', 'speak']);
  assert.equal(delivery.snapshot()[0].state, 'spoken');
  const reopened = new ReminderDelivery(options);
  t.after(() => reopened.close());
  await reopened.enqueue({ id: 'clock1', kind: 'reminder', title: 'Breakfast', dueAt: 1 });
  await reopened.pump();
  assert.equal(events.length, 3);
  ready = 'silent';
  await reopened.enqueue({ id: 'clock2', kind: 'reminder', title: 'Quiet', dueAt: 2 });
  await settle();
  assert.equal(reopened.snapshot().find((i) => i.id === 'clock2').state, 'silent');
  assert.equal(events.filter((e) => e === 'speak').length, 1);
});
test('a reminder can prepare voice without loading the conversation model', async () => {
  let reloads = 0,
    voices = 0;
  const service = new SleepService({ unload: async () => {}, reload: async () => reloads++ });
  await service.sleep();
  await service.wakeForReminder(async () => voices++);
  assert.equal(service.phase, 'voice-awake');
  assert.equal(reloads, 0);
  assert.equal(voices, 1);
  await service.wake();
  assert.equal(reloads, 1);
  assert.equal(visuallySleeping('voice-awake', 'offline'), true);
  assert.equal(visuallySleeping('notifying', 'offline'), true);
  assert.equal(visuallySleeping('asleep', 'offline'), true);
});

test('a completed retained voice turn does not block the next reminder', () => {
  const voice = new VoiceService({ url: 'http://127.0.0.1:8101', headers: () => ({}), emit() {} });
  voice.turn = { final: true, queue: [] };
  assert.equal(voice.generating, false);
  voice.turn.queue.push('A new sentence.');
  assert.equal(voice.generating, true);
  voice.turn.queue = [];
  voice.turn.final = false;
  assert.equal(voice.generating, true);
});

test('reminder playback ignores cancellation of the previous turn and waits for real playback', async () => {
  let listener,
    busy = false,
    done = false;
  const voice = {
    enabled: true,
    preview(id) {
      listener({ type: 'voice.cancelled', turnId: 'previous' });
      listener({ type: 'voice.generated', turnId: id });
    },
  };
  const task = speakReminder({
    voice,
    emit() {},
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    playbackBusy: () => busy,
    shuttingDown: () => false,
    text: 'Fixture',
    turnId: 'reminder-new',
    pollMs: 5,
    graceMs: 0,
  });
  task.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(done, false);
  busy = true;
  listener({ type: 'playback.state', busy: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, false);
  busy = false;
  await task;
  assert.equal(listener, null);
});

test('damaged reminder speech state preserves the original and does not prevent startup', async (t) => {
  const folder = await temp(t),
    file = path.join(folder, 'delivery.json');
  await fs.writeFile(file, '{"items":');
  const service = new ReminderDelivery({
    file,
    visual: async () => {},
    ready: () => 'silent',
    prepare: async () => {},
    speak: async () => {
      throw new Error('Must stay silent');
    },
  });
  t.after(() => service.close());
  assert.match(service.warning, /preserved/);
  await service.enqueue({ id: 'new', title: 'New', dueAt: 1 });
  await settle();
  assert.equal(await fs.readFile(file, 'utf8'), '{"items":');
  assert.equal(JSON.parse(await fs.readFile(file + '.recovered', 'utf8')).items[0].state, 'silent');
});
test('settings help stays outside its window and finds space on the adjacent display', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  const next = { x: 1920, y: -120, width: 1440, height: 1000 };
  const owner = { x: 80, y: 220, width: 680, height: 800 };
  const right = settingsHelpBounds(owner, [work], 240, 142);
  assert.equal(right.side, 'right');
  assert.equal(right.x, owner.x + owner.width + 10);
  const rightEdge = { ...owner, x: 1230 };
  const adjacent = settingsHelpBounds(rightEdge, [work, next], 220, 125);
  assert.equal(adjacent.side, 'right');
  assert.equal(adjacent.x, next.x + 10);
  const left = settingsHelpBounds(rightEdge, [work], 790, 140);
  assert.equal(left.side, 'left');
  assert.ok(left.x + left.width < rightEdge.x);
  assert.ok(left.y + left.height < work.height);
  assert.equal(settingsHelpBounds(owner, [{ ...work, width: 840 }], 220, 140), null);
});

test('stock tool nudges are removed across every stream split; necessary questions survive', () => {
  const text = "Volume is 30%. What's next?";
  for (let split = 0; split <= text.length; split++) {
    const filter = new ActionReplyFilter();
    filter.enabled = true;
    const output =
      filter.push(text.slice(0, split)) + filter.push(text.slice(split)) + filter.push('', true);
    assert.equal(output.trim(), 'Volume is 30%.');
  }
  const filter = new ActionReplyFilter();
  filter.enabled = true;
  assert.equal(filter.push('Which file should I remove?', true), 'Which file should I remove?');
});
