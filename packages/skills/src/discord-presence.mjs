// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';

const presence = (value) =>
  isRecord(value) && typeof value.enabled === 'boolean' && typeof value.phase === 'string';

export const discordPresenceSkill = {
  manifest: {
    id: 'capri.discord-presence',
    version: '1.0.0',
    apiVersion: SKILL_API_VERSION,
    requires: ['start', 'stop', 'snapshot', 'configure'],
    commands: {
      start: { input: noInput, output: noInput, sources: ['host'] },
      snapshot: { input: noInput, output: presence, sources: ['host', 'settings', 'companion'] },
      configure: { input: isRecord, output: presence, sources: ['settings', 'companion'] },
    },
    ui: { sectionId: 'discord', labelKey: 'Discord presence' },
  },
  create({ ports }) {
    return {
      invoke: (command, input) => ports[command](input),
      dispose: () => ports.stop(),
    };
  },
};
