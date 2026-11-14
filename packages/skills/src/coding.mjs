// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';

const boolean = (value) => typeof value === 'boolean';
const modeState = (value) => isRecord(value) && boolean(value.enabled);
const projectState = (value) => modeState(value) && isRecord(value.config);
const taskResult = (value) =>
  isRecord(value) && typeof value.summary === 'string' && Array.isArray(value.changes);
const goal = (value) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 8000 &&
  !value.includes('\0');
const uiSources = ['companion', 'settings'];

export const codingSkill = {
  manifest: {
    id: 'capri.coding',
    apiVersion: SKILL_API_VERSION,
    version: '1.0.0',
    requires: ['service', 'agent', 'assertModelIdle', 'installBridge'],
    ui: { sectionId: 'coding', labelKey: 'Coding mode' },
    commands: {
      status: { input: noInput, output: projectState, sources: ['host', ...uiSources] },
      enabled: { input: noInput, output: boolean, sources: ['host'] },
      resetMode: { input: noInput, output: modeState, sources: ['host'] },
      mode: { input: boolean, output: modeState, sources: uiSources },
      save: { input: isRecord, output: projectState, sources: uiSources },
      installBridge: { input: noInput, output: boolean, sources: uiSources },
      run: { input: goal, output: taskResult, sources: ['chat'] },
    },
    events: { settings: modeState },
  },
  create({ ports: { service, agent, assertModelIdle, installBridge } }) {
    let enabled = false;
    let installing = false;
    const commands = {
      status: () => ({ config: service.snapshot(), enabled }),
      enabled: () => enabled,
      resetMode: (_value, { emit }) => {
        enabled = false;
        const state = { enabled };
        emit('settings', state);
        return state;
      },
      mode: (value, { emit }) => {
        assertModelIdle();
        if (value && !service.snapshot().available) return { enabled, projectRequired: true };
        enabled = value;
        emit('settings', { enabled });
        return { enabled };
      },
      save: (value, { emit }) => {
        assertModelIdle();
        const config = service.save(value);
        if (!config.available) enabled = false;
        emit('settings', { enabled });
        return { config, enabled };
      },
      installBridge: async (_input, { signal }) => {
        assertModelIdle();
        if (installing) throw Error('Editor bridge installation is already running.');
        const { editor } = service.snapshot();
        if (editor?.kind !== 'vscode')
          throw Error('Save a VS Code-compatible editor in project settings first.');
        installing = true;
        try {
          await installBridge(editor, { signal });
          return true;
        } finally {
          installing = false;
        }
      },
      run: (text, { signal }) => agent.run(text, { signal }),
    };
    return {
      invoke: (command, input, operation) => commands[command](input, operation),
    };
  },
};
