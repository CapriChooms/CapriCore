// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { CapriCore } from '../packages/core/src/index.mjs';
import {
  SKILL_SETTINGS,
  showComposerSkill,
  skillPreferences,
} from '../packages/skills/src/settings-catalog.mjs';
import { SkillSettings } from '../apps/desktop/main/skill-settings.mjs';
import { SETTINGS_GROUPS, settingsSection } from '../apps/desktop/renderer/settings-registry.mjs';

function fixture(t) {
  const parent = path.resolve('.runtime/skill-settings-tests');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'skills.json');
}

test('all user-facing skills have ordered settings pages and distinct icons', () => {
  const skills = SETTINGS_GROUPS.find(({ id }) => id === 'skills');
  assert.deepEqual(
    skills.sections.map(([section]) => section),
    SKILL_SETTINGS.map(({ section }) => section),
  );
  assert.equal(new Set(SKILL_SETTINGS.map(({ icon }) => icon)).size, SKILL_SETTINGS.length);
  assert.ok(SKILL_SETTINGS.every(({ name, description }) => name && description));
  assert.equal(settingsSection('voice-api'), 'voice');
  assert.deepEqual(
    Object.entries(skillPreferences())
      .filter(([, value]) => value.showButton)
      .map(([id]) => id),
    ['capri.microphone', 'capri.voice-output'],
  );
});

test('Avatar interaction starts enabled and respects a saved opt-out', (t) => {
  const file = fixture(t);
  const id = 'capri.avatar-interaction';
  const settings = new SkillSettings(file);
  assert.equal(settings.enabled(id), true);
  assert.equal(settings.operationSignal({ skillId: id, command: 'react' }).aborted, false);
  settings.set({ id, enabled: false });
  assert.equal(new SkillSettings(file).enabled(id), false);
});

test('Attachments starts enabled in the composer and respects saved choices', (t) => {
  const file = fixture(t);
  const id = 'capri.attachment-viewer';
  const settings = new SkillSettings(file);
  assert.equal(settings.enabled(id), true);
  assert.equal(showComposerSkill(settings.snapshot(), id), true);
  settings.set({ id, showComposer: false });
  const restored = new SkillSettings(file);
  assert.equal(restored.enabled(id), true);
  assert.equal(showComposerSkill(restored.snapshot(), id), false);
  restored.set({ id, showComposer: true });
  restored.set({ id, enabled: false });
  assert.equal(showComposerSkill(new SkillSettings(file).snapshot(), id), false);
});

test('skill activation gates operations and aborts in-flight work without blocking configuration', async (t) => {
  const file = fixture(t);
  const settings = new SkillSettings(file);
  const id = 'capri.coding';
  const core = new CapriCore({ operationSignal: (request) => settings.operationSignal(request) });
  t.after(() => core.close());
  core.register({
    manifest: {
      id,
      version: '1.0.0',
      apiVersion: 1,
      commands: {
        save: { input: (value) => typeof value === 'string', output: (value) => value === true },
        run: { input: (value) => typeof value === 'string', output: (value) => value === true },
      },
    },
    create: () => ({
      invoke(command, _input, { signal }) {
        if (command === 'save') return true;
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve(true), { once: true }),
        );
      },
    }),
  });
  const call = (command) =>
    core.dispatch({ skillId: id, command, input: 'Project' }, { source: 'settings' });
  assert.deepEqual(await call('run'), { status: 'failed', code: 'skill_disabled' });
  assert.deepEqual(await call('save'), { status: 'ok', value: true });
  settings.set({ id, showButton: true });
  assert.deepEqual(settings.snapshot()[id], { enabled: false, showButton: true });
  settings.set({ id, enabled: true });
  const running = call('run');
  settings.set({ id, enabled: false });
  assert.deepEqual(await running, { status: 'cancelled' });
  assert.deepEqual(new SkillSettings(file).snapshot()[id], { enabled: false, showButton: true });
  assert.throws(
    () => settings.set({ id: 'capri.unknown', enabled: true }),
    /Invalid skill setting/,
  );
});
