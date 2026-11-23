// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DesktopCatalog } from '../apps/desktop/desktop-catalog.mjs';
import { ActionApprovals } from '../apps/desktop/action-broker.mjs';
import { FilePermissions } from '../integrations/filesystem/permissions.mjs';
const parent = path.resolve('.runtime/catalog-unit');
mkdirSync(parent, { recursive: true });
function fixture(bridge = async () => ({ ok: true }), options = {}) {
  const root = mkdtempSync(path.join(parent, 'case-')),
    state = path.join(root, 'state');
  mkdirSync(state);
  const filePermissions = new FilePermissions(path.join(state, 'permissions.json'));
  return {
    root,
    state,
    filePermissions,
    catalog: new DesktopCatalog({
      root,
      state,
      filePermissions,
      bridge,
      trash: async (file) => unlinkSync(file),
      ...options,
    }),
    approvals: new ActionApprovals({ emit() {} }),
  };
}

test('packaged Start apps launch by a discovered identity and lose that capability after revocation', async () => {
  const packageId = 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App';
  let fullAccess = true;
  const calls = [];
  const f = fixture(
    async (_root, command) => {
      calls.push(command);
      return command.action === 'catalog_discover'
        ? {
            matches: [
              { name: 'Блокнот', packageId },
              { name: 'Other', packageId: 'invalid' },
            ],
          }
        : { ok: true, windowVerified: true, focused: true, windowId: '123' };
    },
    { fullAccess: () => fullAccess },
  );
  const [app] = await f.catalog.findApplications('Блокнот', undefined, { exact: true });
  assert.equal(app.inspect, false);
  assert.deepEqual(f.catalog.apps(), []);
  const result = await f.catalog.execute(
    'package-launch',
    { action: 'launch', appId: app.id },
    f.approvals,
  );
  assert.equal(result.windowId, '123');
  assert.deepEqual(calls.at(-1), { action: 'catalog_launch', packageId });
  fullAccess = false;
  const denied = await f.catalog.execute(
    'package-denied',
    { action: 'launch', appId: app.id },
    f.approvals,
  );
  assert.equal(denied.ok, false);
  assert.equal(calls.length, 2);
});

test('launch_executable with a human name resolves only through the permitted catalog, never a shell', async () => {
  const calls = [];
  const f = fixture(async (_root, command) => {
    calls.push(command);
    return { ok: true };
  });
  try {
    const exe = path.join(f.root, 'chrome.exe');
    writeFileSync(exe, 'fixture');
    const [app] = f.catalog.add(exe);
    await assert.rejects(
      f.catalog.execute(
        'denied',
        { action: 'launch_executable', executable: 'chrome.exe' },
        f.approvals,
      ),
      /permission/,
    );
    assert.equal(calls.length, 0);
    f.catalog.update({ id: app.id, launch: true });
    const result = await f.catalog.execute(
      'allowed',
      { action: 'launch_executable', executable: 'chrome.exe' },
      f.approvals,
    );
    assert.equal(result.appId, app.id);
    assert.equal(calls[0].action, 'catalog_launch');
    assert.equal(calls[0].executable, exe);
    await assert.rejects(
      f.catalog.execute(
        'unsafe',
        { action: 'launch_executable', executable: 'chrome.exe & echo secret' },
        f.approvals,
      ),
      /Full computer access/,
    );
    assert.equal(calls.length, 1);
  } finally {
    await f.catalog.close();
  }
});
test('app catalog defaults to no permissions, remembers explicit grants and journals mutations idempotently', async () => {
  let calls = 0;
  const f = fixture(async (_root, command) => ({ ok: true, command, call: ++calls }));
  const exe = path.join(f.root, 'Editor.exe');
  writeFileSync(exe, 'fixture');
  const [app] = f.catalog.add(exe);
  await assert.rejects(
    f.catalog.execute('a', { action: 'launch', appId: app.id }, f.approvals),
    /permission/,
  );
  f.catalog.update({ id: app.id, launch: true });
  const a = await f.catalog.execute('a', { action: 'launch', appId: app.id }, f.approvals);
  assert.deepEqual(
    await f.catalog.execute('a', { action: 'launch', appId: app.id }, f.approvals),
    a,
  );
  assert.equal(calls, 1);
  assert.equal(f.catalog.journal()[0].state, 'complete');
  f.catalog.update({ id: app.id, remove: true });
  assert.equal(f.catalog.apps().length, 0);
  await f.catalog.close();
});

test('a browser name resolves without an ID and launch binds following inspection only to its owner turn', async () => {
  let turn = 'owner-1';
  const calls = [];
  const f = fixture(
    async (_root, q) => {
      calls.push(q);
      return q.action === 'catalog_inspect'
        ? {
            ok: true,
            windowId: '20',
            processId: 12,
            startedAtTicks: '123',
            untrustedControls: [{ id: 'field', editable: true, name: 'Draft' }],
          }
        : { ok: true, windowVerified: true, windowId: '20' };
    },
    { currentTurn: () => turn },
  );
  try {
    const exe = path.join(f.root, 'chrome.exe');
    writeFileSync(exe, 'fixture');
    const [app] = f.catalog.add(exe);
    f.catalog.update({ id: app.id, launch: true, inspect: true, text: true });
    assert.equal(
      (
        await f.catalog.execute(
          'launch-by-name',
          { action: 'launch', query: 'Google Chrome' },
          f.approvals,
        )
      ).appId,
      app.id,
    );
    assert.equal(
      (await f.catalog.execute('inspect-bound', { action: 'inspect' }, f.approvals)).appId,
      app.id,
    );
    assert.equal(calls.at(-1).windowId, '20');
    turn = 'owner-2';
    const missing = await f.catalog.execute(
      'no-cross-turn-default',
      { action: 'inspect' },
      f.approvals,
    );
    assert.equal(missing.error.code, 'missing_app_id');
    assert.match(missing.error.message, /Never ask the owner/);
    assert.equal(
      (
        await f.catalog.execute(
          'inspect-by-name',
          { action: 'inspect', query: 'Google Chrome' },
          f.approvals,
        )
      ).appId,
      app.id,
    );
  } finally {
    await f.catalog.close();
  }
});

test('full-access discovery returns usable transient IDs without writing individual grants, and revocation removes them', async () => {
  let enabled = true;
  const f = fixture(
    async (_root, q) =>
      q.action === 'catalog_discover'
        ? {
            ok: true,
            matches: [{ name: 'Google Chrome', executable: path.join(f.root, 'chrome.exe') }],
          }
        : { ok: true, windowVerified: true },
    { fullAccess: () => enabled, currentTurn: () => 'owner' },
  );
  try {
    const exe = path.join(f.root, 'chrome.exe');
    writeFileSync(exe, 'fixture');
    const found = await f.catalog.execute(
      'discover',
      { action: 'find_app', query: 'Google Chrome' },
      f.approvals,
    );
    const appId = found.matches[0].appId;
    assert.match(appId, /^[a-f0-9-]{36}$/);
    const launched = await f.catalog.execute(
      'open-discovered',
      found.matches[0].launchCommand,
      f.approvals,
    );
    assert.equal(launched.appId, appId);
    assert.equal(
      (await f.catalog.execute('follow-up', { action: 'inspect' }, f.approvals)).appId,
      appId,
    );
    assert.deepEqual(f.catalog.apps(), []);
    enabled = false;
    assert.deepEqual(f.catalog.availableApps(), []);
    assert.equal(
      (await f.catalog.execute('revoked', { action: 'launch', appId }, f.approvals)).error.code,
      'unknown_app_id',
    );
  } finally {
    await f.catalog.close();
  }
});

test('browser draft is one granted, confirmed, verifiable operation and never interprets text as keys or submits it', async () => {
  const calls = [];
  const f = fixture(async (_root, q) => {
    calls.push(q);
    return { ok: true, typed: true, submitted: false };
  });
  try {
    const exe = path.join(f.root, 'chrome.exe');
    writeFileSync(exe, 'fixture');
    const [app] = f.catalog.add(exe);
    await assert.rejects(
      f.catalog.execute(
        'denied',
        { action: 'browser_input', query: 'Google Chrome', text: 'Capri' },
        f.approvals,
      ),
      /permission/,
    );
    f.catalog.update({ id: app.id, launch: true, inspect: true, text: true });
    await assert.rejects(
      f.catalog.execute(
        'newline',
        { action: 'browser_input', query: 'Google Chrome', text: 'Capri\n' },
        f.approvals,
      ),
      /single-line/,
    );
    const proposal = await f.catalog.execute(
      'draft',
      { action: 'browser_input', query: 'Google Chrome', text: 'Capri' },
      f.approvals,
    );
    assert.equal(calls.length, 0);
    const result = await f.approvals.respond(proposal.proposal.id, true);
    assert.equal(result.typed, true);
    assert.equal(result.submitted, false);
    assert.equal(calls[0].action, 'browser_input');
    assert.equal(calls[0].text, 'Capri');
  } finally {
    await f.catalog.close();
  }
});

test('Opera GX browser actions resolve the friendly launcher without changing saved permissions or submitting a draft', async () => {
  const calls = [];
  let exe;
  const f = fixture(
    async (_root, command) => {
      calls.push(command);
      return command.action === 'catalog_discover'
        ? { matches: [{ name: 'Opera GX Browser', executable: exe }] }
        : { ok: true, typed: true, submitted: false };
    },
    { fullAccess: () => true },
  );
  try {
    exe = path.join(f.root, 'launcher.exe');
    writeFileSync(exe, 'fixture');
    const [saved] = f.catalog.add(exe);
    const before = JSON.stringify(f.catalog.apps());
    const [found] = await f.catalog.findApplications('Opera GX');
    assert.equal(found.id, saved.id);
    assert.equal(found.name, 'Opera GX Browser');
    assert.equal(JSON.stringify(f.catalog.apps()), before);
    const draftProposal = await f.catalog.execute(
      'opera-draft',
      { action: 'browser_input', appId: found.id, text: 'Capri' },
      f.approvals,
    );
    const draft = await f.approvals.respond(draftProposal.proposal.id, true);
    assert.equal(draft.submitted, false);
    assert.equal(calls.at(-1).action, 'browser_input');
    const openProposal = await f.catalog.execute(
      'opera-open',
      { action: 'open_url', appId: found.id, url: 'https://example.com/' },
      f.approvals,
    );
    const opened = await f.approvals.respond(openProposal.proposal.id, true);
    assert.equal(opened.ok, true);
    assert.equal(calls.at(-1).action, 'browser_open');
    assert.equal(JSON.stringify(f.catalog.apps()), before);
  } finally {
    await f.catalog.close();
  }
});

test('launch-only applications advertise exact launch arguments and inspection explains the separate permission', async () => {
  let calls = 0;
  const f = fixture(async (_root, command) => {
    calls++;
    return { ok: true, command };
  });
  const exe = path.join(f.root, 'Firefox.exe');
  writeFileSync(exe, 'fixture');
  const [app] = f.catalog.add(exe);
  f.catalog.update({ id: app.id, launch: true });
  const result = await f.catalog.execute('list', { action: 'apps' }, f.approvals);
  assert.deepEqual(result.apps[0].launchCommand, { action: 'launch', appId: app.id });
  await assert.rejects(
    f.catalog.execute('inspect', { action: 'inspect', appId: app.id }, f.approvals),
    (error) => error.code === 'DESKTOP_PERMISSION_REQUIRED' && /use launch/.test(error.message),
  );
  assert.equal(calls, 0);
  assert.equal(
    (await f.catalog.execute('open', result.apps[0].launchCommand, f.approvals)).ok,
    true,
  );
  assert.equal(calls, 1);
  await f.catalog.close();
});
test('text entry requires inspected field, separate grant and exact UI confirmation; revoked permission prevents action', async () => {
  let typed = 0;
  const f = fixture(async (_root, q) =>
    q.action === 'catalog_inspect'
      ? {
          ok: true,
          processId: 123,
          startedAtTicks: '1',
          untrustedControls: [{ id: 'edit', editable: true, name: 'Message' }],
        }
      : { ok: true, n: ++typed },
  );
  const exe = path.join(f.root, 'Editor.exe');
  writeFileSync(exe, 'fixture');
  const [app] = f.catalog.add(exe);
  f.catalog.update({ id: app.id, inspect: true, text: true });
  const inspection = await f.catalog.execute(
    'inspect',
    { action: 'inspect', appId: app.id },
    f.approvals,
  );
  const args = {
    action: 'type_text',
    appId: app.id,
    inspectionId: inspection.inspectionId,
    controlId: 'edit',
    text: 'Hello',
  };
  const proposal = await f.catalog.execute('type', args, f.approvals);
  assert.equal(typed, 0);
  assert.match((await f.approvals.text('yes')).confirmation, /buttons/);
  f.catalog.update({ id: app.id, text: false });
  await assert.rejects(f.approvals.respond(proposal.proposal.id, true), /permission/);
  assert.equal(typed, 0);
  await f.catalog.close();
});
test('Recycle Bin action checks exact file again and retains a verified recovery copy', async () => {
  const f = fixture(),
    folder = path.join(f.root, 'personal');
  mkdirSync(folder);
  const file = path.join(folder, 'note.txt');
  writeFileSync(file, 'original');
  const [scope] = f.filePermissions.grant(folder);
  f.filePermissions.update(scope.id, true);
  const args = { action: 'trash', scopeId: scope.id, path: 'note.txt' };
  let proposal = await f.catalog.execute('changed', args, f.approvals);
  writeFileSync(file, 'changed');
  await assert.rejects(f.approvals.respond(proposal.proposal.id, true), /changed/);
  proposal = await f.catalog.execute('actual', args, f.approvals);
  const result = await f.approvals.respond(proposal.proposal.id, true);
  assert.equal(result.recoveryId, 'actual');
  const row = f.catalog.db.prepare('SELECT * FROM recovery WHERE id=?').get('actual');
  assert.equal(readFileSync(path.join(f.state, 'file-recovery', row.backup), 'utf8'), 'changed');
  await assert.rejects(
    f.catalog.execute('escape', { ...args, path: '../outside.txt' }, f.approvals),
    /relative/,
  );
  await f.catalog.close();
});
