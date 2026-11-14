// SPDX-License-Identifier: GPL-3.0-only
import {
  COMPOSER_SKILLS,
  REASONING_BUDGETS,
  SKILL_BY_ID,
  skillPreferences,
} from '../../../packages/skills/src/settings-catalog.mjs';
import { SkillError } from '../../../packages/skill-sdk/src/index.mjs';
import { Preferences } from '../preferences.mjs';
import { webSearchSettings } from '../../../packages/skills/src/web-search/settings.mjs';

const protectedCommands = {
  'capri.microphone': ['start', 'confirm', 'listen'],
  'capri.music': ['start', 'ready'],
  'capri.reasoning': ['prepare'],
  'capri.web-search': ['prepare'],
  'capri.coding': ['run'],
  'capri.computer': ['run'],
  'capri.avatar-interaction': ['react'],
  'capri.initiative': ['test'],
  'capri.attachment-viewer': ['open'],
  'capri.applications': ['execute'],
  'capri.calculator': ['calculate'],
  'capri.spotify': ['execute'],
  'capri.files': ['execute', 'trash'],
  'capri.workflows': ['list', 'run', 'record'],
  'capri.user-tools': ['run', 'test'],
  'capri.private-memory': ['unlock', 'list', 'add', 'remove'],
};

export class SkillSettings {
  constructor(file) {
    this.preferences = new Preferences(file, skillPreferences(), skillPreferences);
    this.controllers = new Map(
      Object.keys(SKILL_BY_ID)
        .filter((id) => this.enabled(id))
        .map((id) => [id, new AbortController()]),
    );
  }

  snapshot() {
    return this.preferences.snapshot();
  }

  enabled(id) {
    return this.preferences.value[id]?.enabled === true;
  }

  require(id) {
    if (!this.enabled(id))
      throw new SkillError('skill_disabled', 'Enable this skill in Settings → Skills first.');
  }

  set({ id, enabled, showButton, showComposer, effort, search, showWindow, automatic } = {}) {
    const changes = Object.entries({
      enabled,
      showButton,
      showComposer,
      effort,
      search,
      showWindow,
      automatic,
    }).filter(([, value]) => value !== undefined);
    if (
      !Object.hasOwn(SKILL_BY_ID, id) ||
      changes.length !== 1 ||
      (effort !== undefined
        ? id !== 'capri.reasoning' ||
          typeof effort !== 'string' ||
          !Object.hasOwn(REASONING_BUDGETS, effort)
        : search !== undefined
          ? id !== 'capri.web-search' ||
            !search ||
            typeof search !== 'object' ||
            Array.isArray(search)
          : typeof changes[0][1] !== 'boolean') ||
      (showComposer !== undefined && !Object.hasOwn(COMPOSER_SKILLS, id)) ||
      (showWindow !== undefined && id !== 'capri.calculator') ||
      (automatic !== undefined && id !== 'capri.owner-memory')
    )
      throw new SkillError('invalid_skill_input', 'Invalid skill setting.');
    const next = this.snapshot();
    next[id] = { ...next[id], ...Object.fromEntries(changes) };
    if (search !== undefined) next[id].search = webSearchSettings(search);
    return this.replace(next);
  }

  replace(value) {
    const saved = this.preferences.set(value);
    for (const [id, { enabled }] of Object.entries(saved)) {
      if (enabled && !this.controllers.has(id)) this.controllers.set(id, new AbortController());
      if (!enabled && this.controllers.has(id)) {
        this.controllers.get(id).abort();
        this.controllers.delete(id);
      }
    }
    return saved;
  }

  operationSignal({ skillId, command, input }) {
    const operational =
      protectedCommands[skillId]?.includes(command) ||
      (['capri.reasoning', 'capri.web-search'].includes(skillId) &&
        command === 'setMode' &&
        input === true) ||
      (skillId === 'capri.coding' && command === 'mode' && input === true) ||
      (skillId === 'capri.voice-output' && command === 'setEnabled' && input === true) ||
      (skillId === 'capri.computer' && command === 'requestAccess' && input === true) ||
      (skillId === 'capri.owner-memory' && command === 'save') ||
      (skillId === 'capri.timers' &&
        command === 'execute' &&
        !['cancel', 'list', 'stop'].includes(input?.action));
    if (!operational) return;
    this.require(skillId);
    return this.controllers.get(skillId)?.signal;
  }
}
