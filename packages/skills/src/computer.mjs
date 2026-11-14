// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';
import { REASONING_BUDGETS } from './settings-catalog.mjs';

const boolean = (value) => typeof value === 'boolean';
const accessState = (value) => isRecord(value) && boolean(value.enabled);
const taskState = (value) => isRecord(value) && boolean(value.active);
const taskResult = (value) =>
  isRecord(value) && boolean(value.ok) && typeof value.status === 'string';
const taskInput = (value) =>
  isRecord(value) &&
  Object.keys(value).every((key) =>
    ['goal', 'previousTask', 'ownerRequestedCall', 'planningEffort', 'applicationHint'].includes(
      key,
    ),
  ) &&
  typeof value.goal === 'string' &&
  value.goal.trim().length > 0 &&
  value.goal.length <= 8000 &&
  !value.goal.includes('\0') &&
  (value.previousTask === undefined || isRecord(value.previousTask)) &&
  (value.ownerRequestedCall === undefined || boolean(value.ownerRequestedCall)) &&
  (value.applicationHint === undefined ||
    (typeof value.applicationHint === 'string' && value.applicationHint.length <= 80)) &&
  (value.planningEffort === undefined ||
    (typeof value.planningEffort === 'string' &&
      Object.hasOwn(REASONING_BUDGETS, value.planningEffort)));

export const computerSkill = {
  manifest: {
    id: 'capri.computer',
    apiVersion: SKILL_API_VERSION,
    version: '1.0.0',
    requires: ['access', 'requests', 'agent', 'isApplicationAccessEnabled'],
    ui: { sectionId: 'computer', labelKey: 'Computer control' },
    commands: {
      accessStatus: {
        input: noInput,
        output: accessState,
        sources: ['host', 'companion', 'settings'],
      },
      setAccess: { input: boolean, output: accessState, sources: ['companion', 'settings'] },
      requestAccess: { input: boolean, output: accessState, sources: ['chat', 'tool'] },
      run: { input: taskInput, output: taskResult, sources: ['chat', 'tool'] },
      status: { input: noInput, output: taskState, sources: ['host', 'companion', 'settings'] },
      diagnostics: { input: noInput, output: taskState, sources: ['host'] },
    },
  },
  create({ ports: { access, requests, agent, isApplicationAccessEnabled } }) {
    const commands = {
      accessStatus: () => ({ ...access.snapshot(), paused: !isApplicationAccessEnabled() }),
      setAccess: (enabled, signal) => access.configure(enabled, { signal }),
      requestAccess: (enabled, signal) => requests.configure(enabled, { signal }),
      run: (
        { goal, previousTask, ownerRequestedCall, planningEffort, applicationHint },
        signal,
        source,
      ) =>
        requests.execute(goal, {
          signal,
          previousTask,
          ownerRequestedCall,
          ...(source === 'chat' && planningEffort && { planningEffort }),
          ...(source === 'chat' && applicationHint && { applicationHint }),
        }),
      status: () => agent.snapshot(),
      diagnostics: () => agent.diagnostics(),
    };
    return {
      invoke: (command, input, { signal, source }) => commands[command](input, signal, source),
    };
  },
};
