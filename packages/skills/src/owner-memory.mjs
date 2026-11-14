// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';

const string = (value) => typeof value === 'string';
const memorySnapshot = (value) =>
  isRecord(value) &&
  Array.isArray(value.items) &&
  typeof value.truncated === 'boolean' &&
  typeof value.unavailable === 'boolean';

export const ownerMemorySkill = {
  manifest: {
    id: 'capri.owner-memory',
    apiVersion: SKILL_API_VERSION,
    version: '1.0.0',
    requires: ['save', 'recall', 'read', 'clear'],
    commands: {
      save: {
        input: string,
        output: (value) => isRecord(value) && value.saved === true,
        sources: ['chat', 'settings'],
      },
      recall: {
        input: string,
        output: (value) => value === null || string(value),
        sources: ['chat'],
      },
      read: { input: noInput, output: memorySnapshot, sources: ['settings'] },
      clear: { input: noInput, output: noInput, sources: ['host'] },
    },
  },
  create: ({ ports }) => ({
    invoke(command, input) {
      return ports[command](input);
    },
  }),
};
