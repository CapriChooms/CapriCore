// SPDX-License-Identifier: GPL-3.0-only
export const SETTINGS_GROUPS = Object.freeze([
  {
    id: 'capri',
    labels: ['Capri'],
    icon: 'M10 2l7 8-7 8-7-8zM10 6v8M6 10h8',
    sections: [
      ['general', 'General', 'general-panel'],
      ['appearance', 'Appearance and animations', 'companion-settings'],
      ['window', 'Window', 'companion-settings'],
    ],
  },
  {
    id: 'conversation',
    labels: ['Conversation', 'Voice'],
    icon: 'M3 4h14v10H9l-4 3v-3H3zM6 8h8M6 11h5',
    sections: [
      ['dialogue', 'Conversation and personality', 'companion-settings'],
      ['knowledge', 'Brain and private memory', 'knowledge-panel'],
      ['initiative', 'Initiative', 'initiative-panel'],
      ['languages', 'Languages', 'language-panel'],
      ['microphone', 'Microphone settings', 'speech-panel'],
      ['voice', 'Voice effects', 'voice-effects-panel'],
      ['calls', 'Voice calls', 'call-audio-panel'],
      ['music', 'Music listening', 'music-listening-panel'],
    ],
  },
  {
    id: 'models',
    labels: ['Language model'],
    icon: 'M5 5h10v10H5zM8 8h4v4H8zM7 2v3m6-3v3M7 15v3m6-3v3M2 7h3m-3 6h3m10-6h3m-3 6h3',
    sections: [
      ['models', 'Language model', 'models-panel'],
      ['api', 'External AI provider', 'inference-panel'],
    ],
  },
  {
    id: 'capabilities',
    labels: ['Capabilities'],
    icon: 'M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z',
    sections: [
      ['computer', 'Computer control', 'computer-access-panel'],
      ['workflows', 'Task training', 'workflows-panel'],
      ['user-tools', 'User tools', 'user-tools-panel'],
      ['screen', 'Screen snapshot', 'screen-panel'],
      ['applications', 'Application access', 'applications-panel'],
      ['files', 'File access', 'file-access-panel'],
      ['time', 'Timers and reminders', 'time-panel'],
    ],
  },
  {
    id: 'community',
    labels: ['Updates', 'Community'],
    icon: 'M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM2 17v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1M14 3a3 3 0 0 1 0 6m1 3a4 4 0 0 1 3 4v1',
    sections: [
      ['updates', 'Updates', 'updates-panel'],
      ['discord', 'Discord presence', 'discord-panel'],
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
  'companion-settings': 'appearance',
  'speech-panel': 'microphone',
  'file-access-panel': 'files',
  'dimming-panel': 'window',
});
export function settingsSection(id) {
  if (id === 'memory') return 'dialogue';
  return ['dimming', 'motion'].includes(id) ? 'window' : id;
}
