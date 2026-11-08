// SPDX-License-Identifier: GPL-3.0-only
// Isolated active-save transaction, with no Electron launch or provider requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { root as workspace } from '../../packages/runtime/src/host/paths.mjs';
import { apiSettings } from '../../apps/desktop/inference-api.mjs';
import { isLocalApiEndpoint } from '../../apps/desktop/renderer/inference-endpoint.mjs';

const source = readFileSync(path.join(workspace, 'apps/desktop/main.mjs'), 'utf8');
const start = source.indexOf("  handle('capri:inference-api-save'");
const end = source.indexOf("  handle('capri:inference-api-test'", start);
assert(start >= 0 && end > start);
const code = source.slice(start, end);
const settings = {
  enabled: true,
  setupRequired: false,
  baseUrl: 'https://provider.example/v1',
  model: 'model',
  contextTokens: 32768,
  vision: false,
  tools: true,
};
const payload = { id: 'active', name: 'Edited', settings };
const beforeProfiles = {
  schemaVersion: 1,
  profiles: [
    {
      id: 'active',
      credential: { ciphertext: 'ZW5jcnlwdGVk', origin: 'https://provider.example' },
    },
  ],
};
const beforeSettings = { ...settings, profileId: 'active' };

function scenario(options = {}) {
  const files = new Map(
    options.absent
      ? []
      : [
          ['profiles', JSON.stringify(beforeProfiles)],
          ['settings', JSON.stringify(beforeSettings)],
        ],
  );
  const events = [];
  const snapshotReads = [];
  let idleCount = 0;
  let save;
  const context = {
    verification: Boolean(options.verification),
    shuttingDown: false,
    URL,
    apiSettings,
    isLocalApiEndpoint,
    handle: (name, callback) => {
      assert.equal(name, 'capri:inference-api-save');
      save = callback;
    },
    assertModelIdle: () => {
      events.push('idle');
      if (++idleCount === options.busyAt) throw new Error('busy');
    },
    confirmations: {
      request: async (value) => {
        events.push('confirm');
        context.prompt = value;
        return options.confirm !== false;
      },
    },
    existsSync: (file) => files.has(file),
    readFileSync: (file) => {
      snapshotReads.push(file);
      return files.get(file);
    },
    writeJsonAtomic: (file, value) => {
      events.push(`restore:${file}`);
      if (file === options.restoreFail) throw new Error('restore failed');
      files.set(file, JSON.stringify(value));
    },
    unlinkSync: (file) => {
      events.push(`unlink:${file}`);
      files.delete(file);
    },
    inferenceApi: {
      profilesFile: 'profiles',
      settingsFile: 'settings',
      activeProfileId: () => 'active',
      saveProfile: async (value, beforeCommit) => {
        events.push('prepare');
        if (['validation', 'storage', 'encryption'].includes(options.fail))
          throw new Error(`${options.fail} failed`);
        await options.beforeCommitPreparation?.(files);
        await beforeCommit?.();
        events.push('save');
        files.set('profiles', JSON.stringify({ edited: value.name }));
        if (options.fail === 'save') throw new Error('save failed');
        return value.id ?? 'created';
      },
      selectProfile: async (id) => {
        events.push(`select:${id}`);
        files.set('settings', JSON.stringify({ selected: id }));
        if (options.fail === 'select') throw new Error('select failed');
      },
    },
    shutdownForRestart: async () => {
      events.push('shutdown');
      context.shuttingDown = true;
      if (options.fail === 'shutdown') throw new Error('shutdown failed');
    },
    queueDesktopRelaunch: () => {
      events.push('relaunch');
      if (options.fail === 'relaunch') throw new Error('relaunch failed');
    },
    setBackend: (state, message) => {
      events.push(`backend:${state}`);
      assert.equal(message, 'Reconnect to try again.');
    },
    app: { quit: () => events.push('quit') },
  };
  vm.runInNewContext(code, context);
  return { save, context, files, events, snapshotReads };
}

function assertUnchanged(test, absent = false) {
  if (absent) assert.equal(test.files.size, 0);
  else {
    assert.deepEqual(JSON.parse(test.files.get('profiles')), beforeProfiles);
    assert.deepEqual(JSON.parse(test.files.get('settings')), beforeSettings);
  }
}

let checks = 0;
for (const id of [undefined, 'inactive']) {
  const test = scenario();
  assert.equal(await test.save({ ...payload, id }), id ?? 'created');
  assert.deepEqual(test.events, ['prepare', 'save']);
  assert.deepEqual(JSON.parse(test.files.get('settings')), beforeSettings);
  assert.deepEqual(test.snapshotReads, []);
  checks++;
}
{
  const test = scenario({ confirm: false });
  assert.equal(await test.save(payload), false);
  assert.deepEqual(test.events, ['idle', 'confirm']);
  assertUnchanged(test);
  assert.deepEqual(test.snapshotReads, []);
  checks++;
}
for (const busyAt of [1, 2, 3]) {
  const test = scenario({ busyAt });
  await assert.rejects(test.save(payload), /busy/);
  assert(!test.events.includes('save') && !test.events.includes('shutdown'));
  assert(!test.events.includes('backend:offline'));
  assert.equal(test.context.shuttingDown, false);
  assertUnchanged(test);
  checks++;
}
{
  const test = scenario({ verification: true });
  await assert.rejects(test.save(payload), /API switching is disabled in desktop verification/);
  assert.deepEqual(test.events, []);
  assert.deepEqual(test.snapshotReads, []);
  checks++;
}
for (const baseUrl of ['https://provider.example/v1', 'http://localhost:8000/v1']) {
  const test = scenario();
  assert.equal(await test.save({ ...payload, settings: { ...settings, baseUrl } }), 'active');
  assert.deepEqual(test.events, [
    'idle',
    'confirm',
    'idle',
    'prepare',
    'idle',
    'shutdown',
    'save',
    'select:active',
    'relaunch',
    'quit',
  ]);
  assert.equal(test.context.prompt.title, 'Change AI provider?');
  assert.equal(test.context.prompt.confirmLabel, 'Apply and restart');
  assert.match(
    test.context.prompt.detail,
    baseUrl.startsWith('http:') ? /selected server on this PC/ : /Provider charges may apply/,
  );
  checks++;
}
for (const fail of ['shutdown', 'save', 'select', 'relaunch']) {
  for (const absent of [false, true]) {
    const test = scenario({ fail, absent });
    await assert.rejects(test.save(payload), new RegExp(`${fail} failed`));
    assert.equal(test.context.shuttingDown, false);
    assert(test.events.includes('backend:offline'));
    assert(!test.events.includes('quit'));
    if (fail === 'shutdown') assert(!test.events.includes('save'));
    assertUnchanged(test, absent);
    checks++;
  }
}
for (const fail of ['validation', 'storage', 'encryption']) {
  for (const absent of [false, true]) {
    const test = scenario({ fail, absent });
    await assert.rejects(test.save(payload), new RegExp(`${fail} failed`));
    assert.deepEqual(test.events, ['idle', 'confirm', 'idle', 'prepare']);
    assert.equal(test.context.shuttingDown, false);
    assertUnchanged(test, absent);
    assert.deepEqual(test.snapshotReads, []);
    checks++;
  }
}
{
  const queuedProfiles = {
    ...beforeProfiles,
    profiles: beforeProfiles.profiles.map((profile) => ({
      ...profile,
      name: 'Earlier queued save',
    })),
  };
  const queuedSettings = { ...beforeSettings, contextTokens: 65536 };
  const test = scenario({
    fail: 'select',
    beforeCommitPreparation: (files) => {
      files.set('profiles', JSON.stringify(queuedProfiles));
      files.set('settings', JSON.stringify(queuedSettings));
    },
  });
  await assert.rejects(test.save(payload), /select failed/);
  assert.deepEqual(JSON.parse(test.files.get('profiles')), queuedProfiles);
  assert.deepEqual(JSON.parse(test.files.get('settings')), queuedSettings);
  checks++;
}
{
  const test = scenario({ fail: 'relaunch', restoreFail: 'profiles' });
  await assert.rejects(test.save(payload), /Reconnect to try again/);
  assert(test.events.includes('restore:profiles') && test.events.includes('restore:settings'));
  assert.equal(test.context.shuttingDown, false);
  assert.deepEqual(JSON.parse(test.files.get('settings')), beforeSettings);
  checks++;
}
{
  const test = scenario();
  await assert.rejects(
    test.save({ ...payload, settings: { ...settings, baseUrl: 'http://provider.example/v1' } }),
    /Use HTTPS/,
  );
  assert.deepEqual(test.events, ['idle']);
  assert.deepEqual(test.snapshotReads, []);
  checks++;
}
console.log(`${checks} isolated active-save transaction cases passed.`);
