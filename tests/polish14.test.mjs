// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ActionApprovals } from '../apps/desktop/action-broker.mjs';
import { Confirmations } from '../apps/desktop/main/confirmations.mjs';
import { localizedDialog } from '../apps/desktop/main/localized-dialog.mjs';
import { DesktopCatalog } from '../apps/desktop/desktop-catalog.mjs';
import { FilePermissions } from '../integrations/filesystem/permissions.mjs';
import { TimeService } from '../packages/runtime/src/time/service.mjs';
import { WakeFeedback } from '../apps/desktop/renderer/wake-feedback.mjs';
import { settingsBounds } from '../apps/desktop/main/settings-window.mjs';
import { SPEECH_DEFAULTS } from '../apps/desktop/renderer/speech-settings.mjs';
import { INITIATIVE_DEFAULTS } from '../apps/desktop/initiative-settings.mjs';
import { InitiativeService } from '../apps/desktop/initiative-service.mjs';
import { registerCompanionIpc } from '../apps/desktop/main/companion-ipc.mjs';
import { createServer } from 'node:http';

async function fixture(t, bridge = async () => ({ ok: true })) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'capri-polish14-'));
  const permissions = new FilePermissions(path.join(folder, 'permissions.json'));
  const catalog = new DesktopCatalog({
    root: folder,
    state: path.join(folder, 'state'),
    filePermissions: permissions,
    bridge,
    trash: (file) => fs.unlink(file),
  });
  t.after(async () => {
    await catalog.close();
    if (!folder.startsWith(os.tmpdir() + path.sep)) throw Error('Unsafe fixture cleanup');
    await fs.rm(folder, { recursive: true, force: true });
  });
  return { folder, catalog, permissions, approvals: new ActionApprovals({ emit() {} }) };
}

test('several file approvals queue without executing unseen actions or losing the next request', async () => {
  const seen = [],
    calls = [],
    approval = new ActionApprovals({ emit: (e) => seen.push(e.proposal?.id) });
  const first = approval.propose({
    title: 'First',
    detail: 'One',
    kind: 'trash',
    voice: false,
    execute: async () => {
      calls.push(1);
      return { ok: true };
    },
  });
  const second = approval.propose({
    title: 'Second',
    detail: 'Two',
    kind: 'trash',
    voice: false,
    execute: async () => {
      calls.push(2);
      return { ok: true };
    },
  });
  assert.equal(second.queued, true);
  assert.deepEqual(calls, []);
  assert.equal(approval.pending.id, first.proposal.id);
  await approval.respond(first.proposal.id, true);
  assert.deepEqual(calls, [1]);
  assert.equal(approval.pending.id, second.proposal.id);
  await assert.rejects(approval.respond(first.proposal.id, true), /expired/);
  assert.equal(approval.pending.id, second.proposal.id);
  await approval.respond(second.proposal.id, false);
  assert.deepEqual(calls, [1]);
  assert.equal(approval.pending, null);
});

test('the backend refuses early destructive confirmation for three full seconds', async () => {
  let now = 100,
    request;
  const confirmation = new Confirmations({ emit: (e) => (request = e), show() {}, now: () => now });
  const task = confirmation.request({ title: 'Purge', detail: 'Fixture', delayMs: 3000 });
  assert.equal(confirmation.respond({ id: request.id, choice: 'confirm' }), false);
  now = 3099;
  assert.equal(confirmation.respond({ id: request.id, choice: 'confirm' }), false);
  now = 3100;
  assert.equal(confirmation.respond({ id: request.id, choice: 'confirm' }), true);
  assert.equal(await task, true);
});

test('new proposals preserve FIFO order while an approved action is still executing', async () => {
  const approval = new ActionApprovals({ emit() {} });
  let finish;
  const first = approval.propose({
    title: 'First',
    detail: '1',
    kind: 'type',
    execute: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const second = approval.propose({
    title: 'Second',
    detail: '2',
    kind: 'type',
    execute: async () => ({ ok: true }),
  });
  const running = approval.respond(first.proposal.id, true);
  const third = approval.propose({
    title: 'Third',
    detail: '3',
    kind: 'type',
    execute: async () => ({ ok: true }),
  });
  assert.equal(third.queued, true);
  assert.equal(approval.pending, null);
  finish({ ok: true });
  await running;
  assert.equal(approval.pending.id, second.proposal.id);
  await approval.respond(second.proposal.id, false);
  assert.equal(approval.pending.id, third.proposal.id);
  approval.cancel();
  assert.equal(approval.pending, null);
  assert.deepEqual(approval.queue, []);
});

test('purging recovery removes only the private backup, never a restored original', async (t) => {
  const f = await fixture(t),
    folder = path.join(f.folder, 'personal');
  await fs.mkdir(folder);
  const original = path.join(folder, 'note.txt');
  await fs.writeFile(original, 'Owner fixture');
  const [scope] = f.permissions.grant(folder);
  f.permissions.update(scope.id, true);
  const proposal = await f.catalog.execute(
    'trash1',
    { action: 'trash', scopeId: scope.id, path: 'note.txt' },
    f.approvals,
  );
  await f.approvals.respond(proposal.proposal.id, true);
  assert.equal(f.catalog.recovery().length, 1);
  f.catalog.restore('trash1');
  assert.equal(await fs.readFile(original, 'utf8'), 'Owner fixture');
  assert.equal(f.catalog.purgeRecovery('trash1').ok, true);
  assert.deepEqual(f.catalog.recovery(), []);
  assert.equal((await fs.readdir(path.join(f.folder, 'state/file-recovery'))).length, 0);
  assert.equal(await fs.readFile(original, 'utf8'), 'Owner fixture');
  assert.throws(() => f.catalog.restore('trash1'), /unavailable/);
});

test('Chrome text entry can resolve one real cached lease but cannot invent a control', async (t) => {
  let typed = 0;
  const f = await fixture(t, async (_root, args) =>
    args.action === 'catalog_inspect'
      ? {
          ok: true,
          processId: 12,
          startedAtTicks: '123',
          windowId: '20',
          untrustedControls: [{ id: 'actual-field', name: 'Draft', editable: true }],
        }
      : { ok: true, n: ++typed },
  );
  const exe = path.join(f.folder, 'Editor.exe');
  await fs.writeFile(exe, 'fixture');
  const [app] = f.catalog.add(exe);
  f.catalog.update({ id: app.id, inspect: true, text: true });
  await f.catalog.execute('inspect', { action: 'inspect', appId: app.id }, f.approvals);
  const missing = await f.catalog.execute(
    'bad',
    { action: 'type_text', appId: app.id, controlId: 'invented', text: 'No' },
    f.approvals,
  );
  assert.equal(missing.error.code, 'inspection_required');
  const proposal = await f.catalog.execute(
    'good',
    { action: 'type_text', controlId: 'actual-field', text: 'Draft only' },
    f.approvals,
  );
  assert.equal(typed, 0);
  await f.approvals.respond(proposal.proposal.id, true);
  assert.equal(typed, 1);
  const inspected = await f.catalog.execute(
    'inspect-again',
    { action: 'inspect', appId: 'editor' },
    f.approvals,
  );
  const explicit = await f.catalog.execute(
    'explicit',
    {
      action: 'type_text',
      appId: 'editor',
      inspectionId: inspected.inspectionId,
      controlId: 'actual-field',
      text: 'Another draft',
    },
    f.approvals,
  );
  await f.approvals.respond(explicit.proposal.id, true);
  assert.equal(typed, 2);
});

test('direct browser navigation requires exact grants, a web URL and explicit approval', async (t) => {
  let invoked;
  const f = await fixture(t, async (_root, args) => {
    invoked = args;
    return { ok: true };
  });
  const exe = path.join(f.folder, 'chrome.exe');
  await fs.writeFile(exe, 'fixture');
  const [app] = f.catalog.add(exe);
  f.catalog.update({ id: app.id, launch: true, inspect: true, text: true });
  for (const url of [
    'javascript:alert(1)',
    'file:///C:/test',
    'https://user:password@example.com',
    'https://example.com/\n--bad',
  ])
    await assert.rejects(
      f.catalog.execute('bad', { action: 'open_url', appId: app.id, url }, f.approvals),
    );
  const proposal = await f.catalog.execute(
    'valid',
    { action: 'open_url', url: 'https://example.com/' },
    f.approvals,
  );
  assert.equal(invoked, undefined);
  await f.approvals.respond(proposal.proposal.id, true);
  assert.equal(invoked.action, 'browser_open');
  assert.equal(invoked.url, 'https://example.com/');
  const second = await f.catalog.execute(
    'alias',
    { action: 'open_url', appId: 'chrome', url: 'https://example.org/' },
    f.approvals,
  );
  await f.approvals.respond(second.proposal.id, true);
  assert.equal(invoked.url, 'https://example.org/');
});

test('browser and field inference refuses ambiguous capabilities instead of guessing', async (t) => {
  const f = await fixture(t, async () => ({
    ok: true,
    untrustedControls: [{ id: 'shared-field', name: 'Draft', editable: true }],
  }));
  for (const name of ['chrome', 'msedge']) {
    const exe = path.join(f.folder, name + '.exe');
    await fs.writeFile(exe, 'fixture');
    const apps = f.catalog.add(exe),
      app = apps.at(-1);
    f.catalog.update({ id: app.id, launch: true, inspect: true, text: true });
  }
  for (const app of f.catalog.apps())
    await f.catalog.execute('inspect-' + app.id, { action: 'inspect', appId: app.id }, f.approvals);
  const navigation = await f.catalog.execute(
    'ambiguous-browser',
    { action: 'open_url', url: 'https://example.com/' },
    f.approvals,
  );
  assert.equal(navigation.error.code, 'missing_app_id');
  assert.equal(f.approvals.pending, null);
  const field = await f.catalog.execute(
    'ambiguous-field',
    { action: 'type_text', controlId: 'shared-field', text: 'Draft' },
    f.approvals,
  );
  assert.equal(field.error.code, 'missing_app_id');
  assert.equal(f.approvals.pending, null);
});

test('stopwatch reset keeps the same clock, resets elapsed time and preserves pause', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'capri-clock14-'));
  let wall = Date.now(),
    tick = 0;
  const service = new TimeService({
    file: path.join(folder, 'clock.sqlite'),
    now: () => wall,
    monotonic: () => tick,
    deliver: async () => {},
  });
  t.after(async () => {
    service.close();
    if (!folder.startsWith(os.tmpdir() + path.sep)) throw Error('Unsafe cleanup');
    await fs.rm(folder, { recursive: true, force: true });
  });
  const created = await service.execute('create', { action: 'stopwatch' });
  tick += 10000;
  wall += 10000;
  const reset = await service.execute('reset1', { action: 'reset', id: created.id });
  assert.equal(reset.object.elapsedSeconds, 0);
  assert.equal(reset.id, created.id);
  tick += 5000;
  wall += 5000;
  await service.execute('pause', { action: 'pause', id: created.id });
  await service.execute('reset2', { action: 'reset', id: created.id });
  tick += 5000;
  wall += 5000;
  const current = await service.execute('read', { action: 'status', id: created.id });
  assert.equal(current.state, 'paused');
  assert.equal(current.elapsedSeconds, 0);
});

test('a selected uncached voice never silently substitutes the standard signal', async () => {
  let chimes = 0;
  const feedback = new WakeFeedback({ element: {}, root: {} });
  feedback.configure({ wakeSound: 'voice', wakeVolume: 0.7 }, async () => null);
  await new Promise((r) => setImmediate(r));
  assert.equal(
    feedback.play({
      createGain() {
        chimes++;
      },
    }),
    false,
  );
  assert.equal(chimes, 0);
});

test('wake voice preparation uses the selected speech language, caches PCM and notifies the companion', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'capri-wake14-'));
  let requests = 0,
    body;
  const server = createServer(async (req, res) => {
    let input = '';
    for await (const part of req) input += part;
    body = JSON.parse(input);
    requests++;
    res.writeHead(200, { 'x-sample-rate': '24000', 'content-type': 'application/octet-stream' });
    res.end(Buffer.alloc(2400 * 4));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    if (!folder.startsWith(os.tmpdir() + path.sep)) throw Error('Unsafe cleanup');
    await fs.rm(folder, { recursive: true, force: true });
  });
  const events = [],
    handlers = new Map(),
    value = { wakeSound: 'voice', wakePhrase: 'Listening.' };
  registerCompanionIpc((name, fn) => handlers.set(name, fn), {
    root: folder,
    state: folder,
    rt: { workspace: folder },
    preferences: { value, snapshot: () => ({ ...value }) },
    emit: (e) => events.push(e),
    assertIdle() {},
    prepareVoice: async () => {},
    wakeLanguage: () => 'ru',
    translateWake: () => 'Слушаю.',
    voiceUrl: 'http://127.0.0.1:' + server.address().port,
    voiceHeaders: () => ({}),
  });
  assert.equal(handlers.get('capri:wake-audio')(), null);
  await handlers.get('capri:wake-prepare')();
  await handlers.get('capri:wake-prepare')();
  assert.equal(requests, 1);
  assert.equal(body.language, 'ru');
  assert.equal(body.text, 'Слушаю.');
  assert.equal(handlers.get('capri:wake-audio')().pcm, true);
  assert.equal(handlers.get('capri:wake-audio')().text, 'Слушаю.');
  assert(events.some((e) => e.type === 'wake.audio-ready'));
});

test('fresh microphone pause is one second and settings initially match companion height', () => {
  assert.equal(SPEECH_DEFAULTS.trailingSilenceSeconds, 1);
  assert.equal(
    settingsBounds(
      { x: 1400, y: 80, width: 480, height: 660 },
      { x: 0, y: 0, width: 1920, height: 1040 },
    ).height,
    660,
  );
});

test('background activity gates initiative briefly without perpetually moving its deadline', async (t) => {
  let now = 1000000,
    spoken = 0;
  const service = new InitiativeService({
    settings: { ...INITIATIVE_DEFAULTS, level: 'conversational', quietHoursEnabled: false },
    state: () => ({}),
    now: () => now,
    hour: () => 12,
    random: () => 0,
    generate: async () => ({ speak: true, text: 'A quiet thought.' }),
    commit: async () => {},
    deliver: () => spoken++,
  });
  t.after(() => service.close());
  const deadline = service.nextAt;
  for (let i = 0; i < 10; i++) {
    now += 10000;
    service.activity();
    assert.equal(service.nextAt, deadline);
  }
  now += 3001;
  service.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(spoken, 1);
});

test('native dialog localization translates controls while preserving personal paths', async () => {
  let seen;
  const dialog = localizedDialog(
    {
      showSaveDialog: async (...args) => {
        seen = args.at(-1);
        return 'ok';
      },
    },
    (s) => 'localized:' + s,
  );
  await dialog.showSaveDialog(
    {},
    {
      title: 'Save report',
      defaultPath: 'C:/Personal/report.zip',
      filters: [{ name: 'Diagnostic ZIP archive', extensions: ['zip'] }],
    },
  );
  assert.equal(seen.title, 'localized:Save report');
  assert.equal(seen.defaultPath, 'C:/Personal/report.zip');
  assert.deepEqual(seen.filters[0].extensions, ['zip']);
});
