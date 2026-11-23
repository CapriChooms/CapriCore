// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../../skill-sdk/src/index.mjs';
import { desktopAvatarCommand } from './commands.mjs';

export const avatarSkill = {
  manifest: {
    id: 'capri.avatar-interaction',
    version: '1.0.0',
    apiVersion: SKILL_API_VERSION,
    requires: ['react'],
    commands: {
      interpret: {
        input: (value) => typeof value === 'string',
        output: (value) => value === null || isRecord(value),
        sources: ['host'],
      },
      react: {
        input: (value) => typeof value === 'string',
        output: noInput,
        sources: ['host'],
      },
    },
    ui: { sectionId: 'appearance', labelKey: 'Appearance and animations' },
  },
  create({ ports }) {
    return {
      invoke(command, input) {
        if (command === 'interpret') return desktopAvatarCommand(input);
        ports.react(input);
      },
    };
  },
};
