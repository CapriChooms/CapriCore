// SPDX-License-Identifier: GPL-3.0-only
import { uiText } from './renderer/interface-translations.mjs';
import { callTaskNeedsOwner, callTaskRequest } from './call-computer-task.mjs';

/** Shared host entry point for chat and tools. A cancelled grant never runs a task. */
export class ComputerRequests {
  constructor({ access, run, language = () => 'en' }) {
    Object.assign(this, { access, run, language });
  }
  async configure(enabled, { signal } = {}) {
    signal?.throwIfAborted();
    const state = await this.access.configure(enabled, { signal });
    signal?.throwIfAborted();
    const applied = state.enabled === enabled;
    const summary = uiText(
      !applied
        ? 'Cancelled.'
        : enabled
          ? 'Full computer access is enabled.'
          : 'Full computer access is off.',
      this.language(),
    );
    return {
      ok: applied,
      enabled: state.enabled,
      cancelled: !applied,
      status: applied ? 'completed' : 'cancelled',
      steps: 0,
      confirmation: summary,
      summary,
      instruction: applied
        ? 'Report this actual access state. If a computer task was requested, pass the complete original goal to desktop_control run_task. Access alone does not complete the task.'
        : 'The owner did not grant access. Stop this task; do not repeat the request or switch to another tool.',
    };
  }
  async execute(
    goal,
    { signal, previousTask, ownerRequestedCall, planningEffort, applicationHint } = {},
  ) {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 8000 || goal.includes('\0'))
      throw new Error('Describe the computer task in at most 8000 characters.');
    signal?.throwIfAborted();
    const callTask = callTaskRequest(goal);
    if (callTask && (!ownerRequestedCall || callTask.action === 'clarify'))
      return callTaskNeedsOwner(this.language());
    const result = await this.configure(true, { signal });
    if (!result.ok) return result;
    signal?.throwIfAborted();
    return this.run(goal, {
      signal,
      previousTask,
      ...(planningEffort && { planningEffort }),
      ...(applicationHint && { applicationHint }),
      ...(ownerRequestedCall && { ownerRequestedCall }),
    });
  }
}
