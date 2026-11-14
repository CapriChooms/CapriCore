// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  musicListeningLabel,
  musicCaptureActive,
  MusicListeningPanel,
} from '../apps/desktop/renderer/music-listening-panel.mjs';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  PANEL_SECTIONS,
} from '../apps/desktop/renderer/settings-registry.mjs';
import { SettingsLocation } from '../apps/desktop/renderer/settings-location.mjs';
import { settingsApi } from '../apps/desktop/renderer/settings-api.mjs';

test('music capture status distinguishes remembered visual preferences from actual listening', () => {
  assert.equal(
    musicCaptureActive({ phase: 'off', enabled: false, settings: { enabled: true } }),
    false,
  );
  assert.equal(
    musicListeningLabel({ phase: 'off', settings: { enabled: true }, hearingMusic: true }),
    'Off',
  );
  assert.equal(musicListeningLabel({ phase: 'listening', enabled: true }), 'Listening');
  assert.equal(
    musicListeningLabel({ phase: 'listening', enabled: true, hearingMusic: true }),
    'Music detected',
  );
  assert.equal(
    musicListeningLabel({ phase: 'listening', enabled: true, speechScore: 0.9, musicScore: 0.1 }),
    'Speech detected',
  );
  assert.equal(
    musicListeningLabel({ phase: 'preparing', enabled: true }),
    'Preparing music detection…',
  );
  assert.equal(musicListeningLabel({ phase: 'starting' }), 'Connecting system audio…');
  assert.equal(musicListeningLabel({ phase: 'paused', hearingMusic: true }), 'Paused');
  assert.equal(musicListeningLabel({ phase: 'error', hearingMusic: true }), 'Unavailable');
  assert.equal(musicListeningLabel({ phase: 'off', supported: false }), 'Unavailable');
});

test('music listening has its own skill page before the more specialised voice calls skill', () => {
  const group = SETTINGS_GROUPS.find(({ id }) => id === 'skills');
  const music = group.sections.findIndex(([id]) => id === 'music');
  const calls = group.sections.findIndex(([id]) => id === 'calls');
  assert.ok(music < calls);
  assert.deepEqual(group.sections[music], ['music', 'Music listening', 'music-listening-panel']);
  assert.equal(SETTINGS_SECTIONS.filter(([id]) => id === 'music').length, 1);
  assert.equal(PANEL_SECTIONS['music-listening-panel'], 'music');
});

test('an explicit animation toggle starts and stops listening, but restoring preferences never captures audio', async () => {
  const originalDocument = globalThis.document;
  const fields = new Map(),
    calls = [],
    errors = [];
  const element = {
    dataset: {},
    set innerHTML(value) {
      for (const [, id] of value.matchAll(/\bid="([^"]+)"/g)) fields.set(id, { checked: false });
    },
    querySelector: (id) => fields.get(id.slice(1)),
  };
  globalThis.document = { createElement: () => element, getElementById: () => ({ append() {} }) };
  try {
    const panel = new MusicListeningPanel({
      ui: { text: (value) => value },
      api: {
        musicCommand: async (action) => {
          calls.push(action);
          return {
            enabled: action === 'start',
            phase: action === 'start' ? 'listening' : 'off',
            settings: { enabled: action === 'start' },
          };
        },
      },
      onError: (error) => errors.push(error),
    });
    panel.show({ phase: 'off', enabled: false, settings: { enabled: true } });
    assert.deepEqual(calls, []);
    panel.status({
      phase: 'listening',
      enabled: true,
      hearingMusic: true,
      tempo: 0,
      tempoConfidence: 0,
      settings: { enabled: true },
    });
    assert.equal(panel.get('status').textContent, 'Music detected · BPM …');
    panel.status({ tempo: 120.3, tempoConfidence: 0.8 });
    assert.equal(panel.get('status').textContent, 'Music detected · BPM 120');
    panel.show({ phase: 'off', enabled: false, hearingMusic: false, settings: { enabled: true } });
    panel.get('enabled').checked = false;
    await panel.get('enabled').onchange();
    assert.deepEqual(calls, []);
    panel.get('enabled').checked = true;
    await panel.get('enabled').onchange();
    assert.deepEqual(calls, ['start']);
    assert.equal(panel.value.phase, 'listening');
    panel.get('notes').checked = false;
    panel.get('notes').onchange();
    assert.deepEqual(calls, ['start']);
    panel.get('enabled').checked = false;
    await panel.get('enabled').onchange();
    assert.deepEqual(calls, ['start', 'stop']);
    assert.equal(panel.value.phase, 'off');
    assert.deepEqual(errors, []);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('closing and reopening music settings preserves section and scroll without storing capture state', () => {
  let stored;
  const storage = () => ({
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  const sections = SETTINGS_SECTIONS.map(([id]) => id);
  const first = new SettingsLocation(sections, storage);
  first.remember('music', 238, 110);
  const reopened = new SettingsLocation(sections, storage);
  assert.equal(reopened.section, 'music');
  assert.equal(reopened.top('music'), 238);
  assert.equal(reopened.navigation, 110);
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), [
    'navigation',
    'schemaVersion',
    'scrolls',
    'section',
  ]);
});

test('music setting saves join the ordinary close barrier and keep the complete status snapshot', async () => {
  const writes = new Set(),
    saved = [],
    snapshot = {
      phase: 'off',
      enabled: false,
      settings: { enabled: true, notes: false, motion: true },
    };
  let resolveSave;
  const api = settingsApi(
    {
      setMusicSettings: (value) => {
        assert.deepEqual(value, snapshot.settings);
        return new Promise((resolve) => {
          resolveSave = () => resolve(snapshot);
        });
      },
    },
    { writes, revisions: () => ({}), saved: (id) => saved.push(id) },
  );
  const saving = api.setMusicSettings(snapshot.settings);
  assert.equal(writes.size, 1);
  resolveSave();
  assert.deepEqual(await saving, snapshot);
  assert.equal(writes.size, 0);
  assert.deepEqual(saved, ['music-listening-panel']);
});

test('automatic BPM defaults on for old settings and survives draft preview and save when disabled', async () => {
  const originalDocument = globalThis.document;
  const fields = new Map();
  const panelElement = {
    dataset: {},
    set innerHTML(value) {
      for (const [, id] of value.matchAll(/\bid="([^"]+)"/g)) fields.set(id, { checked: false });
    },
    querySelector: (id) => fields.get(id.slice(1)),
  };
  globalThis.document = {
    createElement: () => panelElement,
    getElementById: () => ({ append() {} }),
  };
  const previews = [],
    writes = [],
    errors = [],
    committed = [];
  let panel;
  try {
    panel = new MusicListeningPanel({
      ui: { text: (value) => value },
      api: {
        setMusicSettings: async (value) => {
          writes.push(value);
          return { settings: value, phase: 'off' };
        },
      },
      onError: (error) => errors.push(error),
      onChange: () => previews.push(panel.draft()),
      onCommitted: (value) => committed.push(value),
    });
    assert.equal(panel.get('autoBpm').checked, true);
    panel.show({ settings: { enabled: true, notes: false, motion: true }, phase: 'off' });
    assert.deepEqual(panel.draft(), { enabled: true, notes: false, motion: true, autoBpm: true });
    panel.get('autoBpm').checked = false;
    panel.get('autoBpm').onchange();
    assert.equal(previews.at(-1).autoBpm, false);
    panel.show(
      { settings: { enabled: true, notes: false, motion: true }, phase: 'listening' },
      { preserveDraft: true },
    );
    assert.equal(panel.get('autoBpm').checked, false);
    assert.equal(await panel.save(), true);
    assert.deepEqual(writes, [{ enabled: true, notes: false, motion: true, autoBpm: false }]);
    assert.equal(panel.get('autoBpm').checked, false);
    assert.equal(committed.length, 1);
    assert.deepEqual(errors, []);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
