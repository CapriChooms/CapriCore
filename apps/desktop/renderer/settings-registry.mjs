// SPDX-License-Identifier: GPL-3.0-only
import {
  SKILL_SETTINGS,
  SKILL_BY_SECTION,
} from '../../../packages/skills/src/settings-catalog.mjs';
export { SKILL_BY_SECTION };

const skillPanels = {
  microphone: 'speech-panel',
  voice: 'voice-effects-panel',
  dialogue: 'companion-settings',
  time: 'time-panel',
  screen: 'screen-panel',
  applications: 'applications-panel',
  music: 'music-listening-panel',
  'avatar-skill': 'companion-settings',
  initiative: 'initiative-panel',
  calls: 'call-audio-panel',
  computer: 'computer-access-panel',
  coding: 'coding-panel',
  files: 'file-access-panel',
  knowledge: 'knowledge-panel',
  'private-memory': 'private-memory-panel',
  discord: 'discord-panel',
  workflows: 'workflows-panel',
  'user-tools': 'user-tools-panel',
};
export const SETTINGS_GROUPS = Object.freeze([
  {
    id: 'capri',
    labels: ['CapriCore'],
    icon: 'M10 2l7 8-7 8-7-8zM10 6v8M6 10h8',
    sections: [
      ['general', 'General', 'general-panel'],
      ['languages', 'Languages', 'language-panel'],
      ['personality', 'Conversation and personality', 'companion-settings'],
      ['appearance', 'Appearance and animations', 'companion-settings'],
      ['window', 'Window', 'companion-settings'],
      ['models', 'Language model', 'models-panel'],
      ['api', 'API connections', 'inference-panel'],
    ],
  },
  {
    id: 'skills',
    labels: ['Skills'],
    icon: 'M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z',
    sections: SKILL_SETTINGS.map(({ section, name }) => [
      section,
      name,
      skillPanels[section] ?? section + '-panel',
    ]),
  },
  {
    id: 'community',
    labels: ['Updates', 'Community'],
    icon: 'M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM2 17v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1M14 3a3 3 0 0 1 0 6m1 3a4 4 0 0 1 3 4v1',
    sections: [
      ['updates', 'Updates', 'updates-panel'],
      ['bug', 'Report a bug', 'companion-settings'],
      ['support', 'Support the author', 'companion-settings'],
      ['credits', 'Credits', 'credits-panel'],
    ],
  },
  {
    id: 'development',
    labels: ['Developer'],
    icon: 'M7 5l-5 5 5 5m6-10l5 5-5 5M12 2L8 18',
    sections: [['developer', 'For developers', 'developer-panel']],
  },
]);
export const SETTINGS_SECTIONS = Object.freeze(SETTINGS_GROUPS.flatMap(({ sections }) => sections));
export const PANEL_SECTIONS = Object.fromEntries(
  SETTINGS_SECTIONS.map(([id, , panel]) => [panel, id]),
);
Object.assign(PANEL_SECTIONS, {
  'applications-panel': 'applications',
  'companion-settings': 'appearance',
  'speech-panel': 'microphone',
  'file-access-panel': 'files',
  'dimming-panel': 'window',
  'external-tts-panel': 'voice',
});
export function settingsSection(id) {
  if (id === 'memory') return 'dialogue';
  if (id === 'voice-api') return 'voice';
  return ['dimming', 'motion'].includes(id) ? 'window' : id;
}
