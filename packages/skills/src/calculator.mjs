// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';

export const calculatorSkill = {
  manifest: {
    id: 'capri.calculator',
    version: '1.0.0',
    apiVersion: SKILL_API_VERSION,
    requires: ['executeCalculation'],
    commands: {
      calculate: {
        input: (value) => isRecord(value) && value.action === 'calculate',
        output: (value) => isRecord(value) && typeof value.ok === 'boolean',
        sources: ['tool'],
      },
    },
    ui: { sectionId: 'applications', labelKey: 'Application access' },
  },
  create: ({ ports }) => ({
    invoke(_command, args, { requestId, signal }) {
      return ports.executeCalculation(requestId, args, signal);
    },
  }),
};
