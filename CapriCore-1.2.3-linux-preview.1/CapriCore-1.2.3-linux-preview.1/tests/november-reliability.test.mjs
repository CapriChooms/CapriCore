// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cpSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SettingsWindow } from '../apps/desktop/main/settings-window.mjs';
import {
  INITIATIVE_DEFAULTS,
  validateInitiative,
  initiativeLimit,
} from '../apps/desktop/initiative-settings.mjs';
import { npmNetworkFailure } from '../packages/installer/src/npm-install.mjs';
import { observationText } from '../apps/desktop/screen-observation.mjs';
import { InitiativePolicy } from '../apps/desktop/initiative-policy.mjs';
import { CompanionActions } from '../apps/desktop/companion-actions.mjs';
import { ActionApprovals } from '../apps/desktop/action-broker.mjs';

test('screen permission waits for real confirmation and opens only the picker once', async () => {
  let opened = 0;
  const approvals = new ActionApprovals({ emit() {} });
  const host = {
    approvals,
    requestSetting: (setting, owner) => {
      assert.equal(setting, 'screenObservation');
      return owner.propose({
        title: 'Open screen picker',
        detail: 'Choose source',
        kind: 'permission',
        execute: async () => {
          opened++;
          return {
            ok: true,
            confirmation: 'Opened the settings. Review your selection to apply it.',
          };
        },
      });
    },
  };
  assert.equal(await approvals.text('confirm'), null, 'an invented request creates no approval');
  const args = { action: 'request', setting: 'screenObservation', value: true };
  const call = () =>
    CompanionActions.prototype.execute.call(host, 'settings_control', 'screen', args);
  const result = await call(),
    duplicate = await call();
  assert.equal(result.needsApproval, true);
  assert.equal(result.captureStarted, false);
  assert.equal(result.effect, 'open_screen_picker');
  assert.match(result.instruction, /NOT an error/);
  assert.match(result.instruction, /select a window or monitor and press Start observation/);
  assert.equal(duplicate.proposal.id, result.proposal.id);
  assert.equal(opened, 0);
  assert.equal((await approvals.text('confirm')).ok, true);
  assert.equal(opened, 1);
  assert.equal(await approvals.text('confirm'), null);
  assert.equal(opened, 1);
});

test('application plugin imports from a captured graph without installed configuration', async () => {
  const parent = path.resolve('.runtime/test-data');
  mkdirSync(parent, { recursive: true });
  const fixture = mkdtempSync(path.join(parent, 'captured-applications-'));
  const capture = path.join(fixture, 'capture'),
    installation = path.join(fixture, 'installation');
  for (const folder of [
    'integrations/desktop-actions',
    'integrations/companion-tools',
    'packages/runtime/src',
  ]) {
    const target = path.join(capture, folder);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.resolve(folder), target, { recursive: true });
  }
  assert.equal(existsSync(path.join(capture, 'config/core.json')), false);
  const { default: plugin } = await import(
    pathToFileURL(path.join(capture, 'integrations/desktop-actions/index.mjs')).href
  );
  let lifecycle, registered;
  plugin.register({
    source: path.join(installation, 'integrations/desktop-actions/index.mjs'),
    pluginConfig: { stateDirectory: '.runtime/application-fixture' },
    registerTool: (tool) => {
      registered = tool;
    },
    registerService: (service) => {
      lifecycle = service;
    },
  });
  try {
    const tool = registered.create({
      agentId: 'capri',
      senderIsOwner: true,
      messageChannel: 'webchat',
      sessionKey: 'fixture',
      sessionId: 'owned',
    });
    const result = await tool.execute('status', { action: 'status' });
    assert.equal(tool.name, 'application_control');
    assert.equal(result.details.ok, true);
    assert.ok(
      existsSync(path.join(installation, '.runtime/application-fixture/operations.sqlite')),
    );
    assert.equal(existsSync(path.join(capture, 'data/applications/operations.sqlite')), false);
  } finally {
    await lifecycle.stop();
  }
});

test('a screen request with an explicit true value still only offers owner approval', async () => {
  const requested = [],
    approvals = {};
  const host = {
    approvals,
    requestSetting: (setting, pending) => {
      assert.equal(pending, approvals);
      requested.push(setting);
      return { pending: true };
    },
  };
  for (const args of [
    { action: 'request', setting: 'screenObservation' },
    { action: 'request', setting: 'screenObservation', value: true },
  ])
    assert.deepEqual(
      await CompanionActions.prototype.execute.call(host, 'settings_control', 'fixture', args),
      { pending: true },
    );
  assert.deepEqual(requested, ['screenObservation', 'screenObservation']);
  for (const args of [
    { action: 'set', setting: 'screenObservation', value: true },
    { action: 'request', setting: 'screenObservation', value: false },
  ])
    await assert.rejects(
      CompanionActions.prototype.execute.call(host, 'settings_control', 'fixture', args),
    );
  assert.equal(requested.length, 2);
});

test('the complete initiative hourly budget survives restart at the new maximum', () => {
  const now = 10_000_000;
  const first = new InitiativePolicy({ now: () => now });
  first.recent = Array.from({ length: 30 }, (_, i) => now - i * 60000);
  const restored = new InitiativePolicy({ now: () => now });
  restored.restoreBudget(first.budget());
  assert.deepEqual(restored.recent, first.recent);
});

test('reported Windows npm reset exit values retry only with an explicit network code', () => {
  for (const exitCode of [-4077, 4294963219]) {
    assert.equal(
      npmNetworkFailure({ exitCode, outputTail: 'npm error code ECONNRESET' }),
      'ECONNRESET',
    );
    assert.equal(npmNetworkFailure({ exitCode, outputTail: 'npm error code EPERM' }), null);
    assert.equal(npmNetworkFailure({ exitCode, outputTail: 'Process terminated' }), null);
  }
});
test('initiative presets migrate and explicit hourly limits stay bounded', () => {
  const old = { ...INITIATIVE_DEFAULTS };
  delete old.hourlyLimit;
  assert.equal(validateInitiative(old).hourlyLimit, null);
  assert.equal(initiativeLimit({ ...old, level: 'occasional' }), 10);
  assert.equal(initiativeLimit({ ...old, level: 'conversational' }), 30);
  for (const n of [1, 7, 30, 120])
    assert.equal(initiativeLimit(validateInitiative({ ...old, hourlyLimit: n })), n);
  for (const n of [0, 121, 2.5, '10', NaN])
    assert.throws(() => validateInitiative({ ...old, hourlyLimit: n }));
});
test('inactive and stale observation never transmit an old scene as current evidence', () => {
  assert.equal(observationText(null), '');
  const stale = {
    active: true,
    current: false,
    observation: {
      summary: 'Old private scene',
      kind: 'window',
      label: 'private.png',
      capturedAt: 1234,
    },
  };
  assert.doesNotMatch(observationText(stale), /Old private scene|private.png/);
  const current = observationText({ ...stale, current: true });
  assert.match(current, /Old private scene/);
  assert.doesNotMatch(current, /private.png|capturedAt/);
});
test('settings loading cannot resurrect a hidden window or open during shutdown', async () => {
  let release,
    rejectLoad,
    quitting = false;
  class View extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      this.webContents.capturePage = async () => ({ isEmpty: () => false });
      this.webContents.invalidate = () => {};
      this.webContents.setBackgroundThrottling = () => {};
      this.shows = 0;
      this.visible = false;
    }
    getBounds() {
      return { x: 700, y: 0, width: 480, height: 660 };
    }
    setBounds() {}
    setMenu() {}
    isAlwaysOnTop() {
      return true;
    }
    setAlwaysOnTop() {}
    focus() {}
    setOpacity() {}
    setIgnoreMouseEvents() {}
    isVisible() {
      return this.visible;
    }
    show() {
      this.shows++;
      this.visible = true;
    }
    showInactive() {
      this.show();
    }
    hide() {
      this.visible = false;
      this.emit('hide');
    }
    isDestroyed() {
      return Boolean(this.destroyed);
    }
    destroy() {
      this.destroyed = true;
      this.visible = false;
    }
    loadURL() {
      return new Promise((r, j) => {
        release = r;
        rejectLoad = j;
      });
    }
  }
  const owner = new View(),
    screen = new EventEmitter();
  screen.getDisplayMatching = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
  const host = new SettingsWindow({
    BrowserWindow: View,
    screen,
    owner,
    directory: '.',
    url: 'fixture',
    quitting: () => quitting,
    onBusy: () => {},
    onError: () => {},
  });
  const opening = host.open();
  const view = host.window;
  host.hide();
  view.emit('ready-to-show');
  host.loaded();
  host.rendered();
  release();
  await opening;
  assert.equal(view.shows, 0);
  owner.emit('show');
  assert.equal(view.visible, false);
  await host.open('voice');
  await host.surfacePending;
  assert.equal(view.visible, true);
  quitting = true;
  host.destroy();
  await host.open();
  host.loaded();
  assert.equal(host.window, null);
  quitting = false;
  const interrupted = host.open();
  quitting = true;
  host.destroy();
  rejectLoad(new Error('ERR_ABORTED'));
  await interrupted;
  assert.equal(host.window, null);
});

test(
  'selective Windows uninstall preserves unchecked groups and leaves linked external data intact',
  { skip: process.platform !== 'win32', timeout: 90000 },
  () => {
    const parent = path.resolve('.runtime/november-uninstall-tests');
    mkdirSync(parent, { recursive: true });
    const wrapper = path.join(parent, 'invoke.ps1');
    writeFileSync(
      wrapper,
      `param([string]$Script,[string]$Root,[int]$App,[int]$Models,[int]$Settings,[int]$Plan)
& $Script -InstallRoot $Root -Quiet -RemoveApplication:([bool]$App) -DeleteModels:([bool]$Models) -DeleteSettings:([bool]$Settings) -PlanOnly:([bool]$Plan)
exit $LASTEXITCODE
`,
    );
    const fixture = () => {
      const root = mkdtempSync(path.join(parent, 'owned-'));
      assert.ok(root.startsWith(parent + path.sep));
      const put = (name, text = 'fixture') => {
        const file = path.join(root, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text);
      };
      put(
        '.capri-install.json',
        JSON.stringify({
          productId: 'capri.desktop',
          root,
          installId: '00000000-0000-4000-8000-000000000001',
        }),
      );
      put('app.mjs');
      put('Capri.exe');
      put('config/core.local.json', '{}');
      put(
        'config/installer.json',
        JSON.stringify({ artifacts: { node: { directory: 'absent-test-node' } } }),
      );
      put(
        '.runtime/installer/source-files.json',
        JSON.stringify({
          files: [
            { path: 'app.mjs', sha256: createHash('sha256').update('fixture').digest('hex') },
          ],
        }),
      );
      for (const name of [
        'data/models/model.bin',
        'data/speech/voice.bin',
        'data/speech/companion-voice-token',
        'data/voices/capri/en/exports/pack/model.bin',
        'data/voices/capri/en/exports/capri-en-v1/model.bin',
        'data/voices/capri/en/raw/original.wav',
        'data/desktop/settings.json',
        'data/workspace/MEMORY.md',
        'data/screenshots/photo.png',
      ])
        put(name);
      return root;
    };
    const run = (root, app, models, settings, plan = 0) =>
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          wrapper,
          '-Script',
          path.resolve('packages/installer/windows/uninstall.ps1'),
          '-Root',
          root,
          '-App',
          String(app),
          '-Models',
          String(models),
          '-Settings',
          String(settings),
          '-Plan',
          String(plan),
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 20000 },
      );
    for (let bits = 0; bits < 8; bits++) {
      const root = fixture(),
        app = bits & 1,
        models = (bits >> 1) & 1,
        settings = (bits >> 2) & 1;
      const preview = run(root, app, models, settings, 1);
      assert.equal(preview.status, 0, preview.stderr);
      assert.ok(existsSync(path.join(root, 'app.mjs')));
      const result = run(root, app, models, settings);
      assert.equal(result.status, 0, result.stderr);
      for (const [file, kept] of [
        ['app.mjs', !app],
        ['.capri-install.json', !app],
        ['data/models/model.bin', !models],
        ['data/speech/voice.bin', !models],
        ['data/speech/companion-voice-token', !settings],
        ['data/desktop/settings.json', !settings],
        ['data/workspace/MEMORY.md', !settings],
        ['config/core.local.json', !settings],
        ['data/screenshots/photo.png', bits !== 7],
        ['data/voices/capri/en/raw/original.wav', !settings],
        ['data/voices/capri/en/exports/pack/model.bin', !settings],
        ['data/voices/capri/en/exports/capri-en-v1/model.bin', !models],
      ])
        assert.equal(existsSync(path.join(root, file)), kept, `${bits}: ${file}`);
    }
    const root = fixture(),
      outside = mkdtempSync(path.join(parent, 'sentinel-'));
    writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    symlinkSync(outside, path.join(root, 'data/models/external'), 'junction');
    const removed = run(root, 1, 1, 1);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(path.join(root, 'app.mjs')), false);
    assert.ok(existsSync(path.join(outside, 'keep.txt')));
  },
);
