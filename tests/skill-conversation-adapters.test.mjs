// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerAccessIpc } from '../apps/desktop/main/access-ipc.mjs';
import { createConversationSkills } from '../apps/desktop/main/conversation-skills.mjs';
import { createIpcHandler } from '../apps/desktop/main/ipc.mjs';
import { CapriCore } from '../packages/core/src/index.mjs';

test('conversation skills keep existing results and separate owner and chat capabilities', async () => {
  const core = new CapriCore();
  const events = [];
  core.subscribe({}, (event) => events.push(event));
  const initiativePreferences = { level: 'off', excludedApps: [] };
  const schedule = { reason: 'waiting', nextAt: 123, history: [] };
  const knowledgeStatus = {
    enabled: true,
    shareWithApi: false,
    busy: false,
    indexed: 1,
    skipped: 0,
  };
  const searchResults = [{ content: 'A reference excerpt', source: 'sample.txt' }];
  const vaultStatus = { exists: true, unlocked: false, count: 0, busy: false };
  const unlocked = { ...vaultStatus, unlocked: true };
  const notes = [{ id: 'one', text: 'A private note' }];
  const scopes = { scopes: [{ id: 'scope', label: 'sample' }], warning: null };
  const badPermission = new Error('Invalid folder permission');
  const calls = [];
  const conversation = createConversationSkills(core, {
    initiative: {
      configure: async (value) => value,
      snapshot: () => schedule,
      test: () => schedule,
      dismiss: () => true,
      restore: () => true,
    },
    brain: {
      service: {
        snapshot: () => knowledgeStatus,
        refresh: async () => knowledgeStatus,
        search: (query) => (assert.equal(query, 'reference'), searchResults),
        configure: (value) => ({ ...knowledgeStatus, ...value }),
        context: (query, { remote }) => (remote ? '' : `Local result for ${query}`),
      },
      open: async () => true,
    },
    privateMemory: {
      service: {
        snapshot: () => vaultStatus,
        lock: () => calls.push('lock'),
        unlock: async (password, { create = false } = {}) => {
          assert.equal(password, 'sample password');
          calls.push({ create });
          return unlocked;
        },
        list: () => notes,
        add: (text) => (assert.equal(text, notes[0].text), notes),
        remove: (id) => (assert.equal(id, notes[0].id), []),
        changePassword: async (old, next) => {
          assert.equal(old, 'sample password');
          assert.equal(next, 'new sample password');
          return unlocked;
        },
      },
    },
    files: {
      permissions: {
        grant: (path) => calls.push(['grant', path]),
        update: (id, write) => {
          if (id !== 'scope') throw badPermission;
          calls.push(['update', id, write]);
        },
        revoke: (id) => calls.push(['revoke', id]),
        save: (value) => calls.push(['save', value]),
      },
      snapshot: () => scopes,
    },
    attachments: { open: async (id) => id === 'image' },
  });

  const { initiative, brain, privateMemory, files, attachments } = conversation;
  assert.equal(
    await initiative.configure(initiativePreferences, 'settings'),
    initiativePreferences,
  );
  assert.equal(initiative.snapshot(), schedule);
  assert.equal(initiative.test('settings'), schedule);
  assert.equal(initiative.dismiss('companion'), true);
  assert.equal(initiative.restore('companion'), true);
  assert.equal(brain.settings({ action: 'status' }), knowledgeStatus);
  assert.equal(await brain.settings({ action: 'open' }), true);
  assert.equal(await brain.settings({ action: 'refresh' }), knowledgeStatus);
  assert.equal(brain.settings({ action: 'search', query: 'reference' }), searchResults);
  assert.deepEqual(brain.settings({ action: 'configure', enabled: false, shareWithApi: true }), {
    ...knowledgeStatus,
    enabled: false,
    shareWithApi: true,
  });
  assert.equal(brain.context('reference'), 'Local result for reference');
  assert.equal(brain.context('reference', { remote: true }), '');
  assert.equal(privateMemory.settings({ action: 'status' }), vaultStatus);
  assert.equal(privateMemory.settings({ action: 'lock' }), vaultStatus);
  assert.equal(
    await privateMemory.settings({ action: 'create', password: 'sample password' }),
    unlocked,
  );
  assert.equal(
    await privateMemory.settings({ action: 'unlock', password: 'sample password' }),
    unlocked,
  );
  assert.equal(privateMemory.settings({ action: 'list' }), notes);
  assert.equal(privateMemory.settings({ action: 'add', text: notes[0].text }), notes);
  assert.deepEqual(privateMemory.settings({ action: 'remove', id: notes[0].id }), []);
  assert.equal(
    await privateMemory.settings({
      action: 'password',
      oldPassword: 'sample password',
      password: 'new sample password',
    }),
    unlocked,
  );
  assert.equal(files.snapshot(), scopes);
  assert.equal(files.grant('C:/fixture', 'settings'), scopes);
  assert.equal(files.write({ id: 'scope', write: true }, 'settings'), scopes);
  assert.throws(() => files.write({ id: 'unknown', write: true }, 'settings'), badPermission);
  assert.equal(files.revoke('scope', 'companion'), scopes);
  assert.equal(files.clear('settings'), scopes);
  assert.equal(await attachments.open('image'), true);
  assert.equal(await attachments.open('unknown'), false);
  assert.equal(await attachments.open({ id: 'image' }), false);

  assert.deepEqual(calls, [
    'lock',
    { create: true },
    { create: false },
    ['grant', 'C:/fixture'],
    ['update', 'scope', true],
    ['revoke', 'scope'],
    ['save', []],
  ]);
  for (const [skillId, command, source] of [
    ['capri.initiative', 'configure', 'tool'],
    ['capri.private-memory', 'list', 'chat'],
    ['capri.private-memory', 'unlock', 'companion'],
    ['capri.brain', 'search', 'tool'],
    ['capri.file-access', 'grant', 'tool'],
    ['capri.attachment-viewer', 'open', 'settings'],
  ]) {
    assert.throws(() => core.call({ skillId, command }, { source }), {
      code: 'skill_access_denied',
    });
  }
  for (const [skillId, command, source] of [
    ['capri.private-memory', 'chat', 'settings'],
    ['capri.file-access', 'execute', 'tool'],
    ['capri.attachment-viewer', 'add', 'companion'],
  ]) {
    assert.throws(() => core.call({ skillId, command }, { source }), {
      code: 'unknown_skill_command',
    });
  }
  assert.deepEqual(events, []);
  await core.close();
});

test('file access grants use the native folder selection and retain the original IPC result', async () => {
  const handlers = new Map();
  const frame = { url: 'capri://desktop/settings.html' };
  const webContents = { mainFrame: frame };
  const settingsWindow = { isDestroyed: () => false, webContents };
  const handle = createIpcHandler(
    { handle: (name, fn) => handlers.set(name, fn) },
    {
      getWindow: () => null,
      getSettingsWindow: () => settingsWindow,
      settingsUrl: frame.url,
      settingsChannels: ['capri:file-folder-add', 'capri:file-folder-write'],
    },
  );
  const events = [];
  const fileAccess = { scopes: [], warning: null };
  const grants = [];
  let picked = { canceled: false, filePaths: ['D:/chosen'] };
  registerAccessIpc(handle, {
    getWindow: () => settingsWindow,
    getInterfaceLanguage: () => 'en',
    dialog: { showOpenDialog: async () => picked },
    files: {
      grant(folder, role) {
        grants.push([folder, role]);
        return fileAccess;
      },
      snapshot: () => fileAccess,
    },
    emit: (event) => events.push(event),
  });
  const add = handlers.get('capri:file-folder-add');
  assert.throws(() => add({ sender: webContents, senderFrame: { ...frame } }), /Untrusted/);
  const sender = { sender: webContents, senderFrame: frame };
  assert.equal(await add(sender, 'D:/from-renderer'), fileAccess);
  picked = { canceled: true, filePaths: [] };
  assert.equal(await add(sender), fileAccess);
  const write = handlers.get('capri:file-folder-write');
  assert.throws(() => write(sender, { id: 'scope' }), /Invalid folder permission/);
  assert.deepEqual(grants, [['D:/chosen', 'settings']]);
  assert.deepEqual(events, [
    { type: 'file-access', settings: fileAccess },
    { type: 'file-access', settings: fileAccess },
  ]);
});
