// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { SettingsWindow } from '../apps/desktop/main/settings-window.mjs';
import { SETTINGS_CHANNELS } from '../apps/desktop/main/settings-channels.mjs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function host({ visible = true, ready = true } = {}) {
  const owner = new EventEmitter();
  const screen = new EventEmitter();
  screen.getDisplayMatching = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
  const host = new SettingsWindow({
    BrowserWindow: class {},
    screen,
    owner,
    directory: '.',
    url: 'fixture',
    quitting: () => false,
    onBusy() {},
    onError() {},
  });
  const view = {
    shown: visible,
    isVisible() {
      return this.shown;
    },
    isDestroyed() {
      return false;
    },
    hide() {
      this.shown = false;
    },
    webContents: { setBackgroundThrottling() {} },
  };
  host.view = view;
  host.ready = ready;
  host.sent = [];
  host.send = (event) => host.sent.push(event);
  return host;
}

test('restart proceeds at once when Settings is hidden or still loading', async () => {
  const hidden = host({ visible: false });
  assert.equal(await hidden.confirmDrafts(), true);
  assert.deepEqual(hidden.sent, []);

  const loading = host({ ready: false });
  assert.equal(await loading.confirmDrafts(), true);
  assert.deepEqual(loading.sent, []);
});

test('restart asks the open Settings renderer to settle drafts and waits for its answer', async () => {
  const stay = host();
  const waiting = stay.confirmDrafts();
  assert.deepEqual(stay.sent, [{ type: 'settings.drafts-check' }]);
  stay.settleDrafts(false);
  assert.equal(await waiting, false, 'Stay cancels the restart');

  const saved = host();
  const proceeding = saved.confirmDrafts();
  saved.settleDrafts(true);
  assert.equal(await proceeding, true, 'Save or Discard lets the restart continue');
});

test('hiding or losing Settings while the prompt is open cancels the restart', async () => {
  const hidden = host();
  const waiting = hidden.confirmDrafts();
  hidden.hide();
  assert.equal(await waiting, false);

  const lost = host();
  const destroyed = lost.confirmDrafts();
  lost.clear();
  assert.equal(await destroyed, false);
});

test('every pending restart is settled by one answer and later answers are ignored', async () => {
  const settings = host();
  const first = settings.confirmDrafts();
  const second = settings.confirmDrafts();
  settings.settleDrafts(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  settings.settleDrafts(false);
  assert.deepEqual(settings.draftWaiters, []);
});

test('the renderer settle channel is reachable from Settings only', () => {
  assert.ok(SETTINGS_CHANNELS.includes('capri:settings-drafts-settled'));
  const main = source('../apps/desktop/main.mjs');
  assert.match(
    main,
    /handle\('capri:settings-drafts-settled', \(proceed, \{ role \}\) => \{\s*if \(role !== 'settings'\) throw new Error\('Settings frame required'\);\s*settingsHost\?\.settleDrafts\(proceed === true\);/,
  );
  const preload = source('../apps/desktop/preload.cjs');
  assert.match(preload, /settingsDraftsSettled: \(proceed\) =>/);
});

test('the restart branch waits for Settings before shutting down', () => {
  const main = source('../apps/desktop/main.mjs');
  assert.match(
    main,
    /if \(choice === 'restart'\) \{\s*if \(!\(await settingsHost\.confirmDrafts\(\)\)\) return;\s*try \{\s*await shutdownForRestart/,
  );
});

test('Settings renders the draft prompt on request and settles at every exit', () => {
  const app = source('../apps/desktop/renderer/settings-app.mjs');
  assert.match(app, /value\.type === 'settings\.drafts-check'/);
  assert.match(
    app,
    /settleRestart\(false\);\s*return;\s*\}\s*if \(!syncDraftActions\(\)\.length\)/,
  );
  assert.match(app, /if \(!syncDraftActions\(\)\.length\) \{\s*settleRestart\(true\);/);
  assert.match(app, /if \(save\) \{\s*settleRestart\(true\);/);
  assert.match(app, /settleRestart\(true\);\s*await raw\.closeSettings\(\);/);
  assert.match(app, /if \(closeRequested\) settleRestart\(false\);\s*closeRequested = false;/);
  assert.match(
    app,
    /\$\('settings-stay'\)\.onclick = \(\) => \{\s*if \(closeRequested\) settleRestart\(false\);/,
  );
});
