// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { CapriCore } from '../../packages/core/src/index.mjs';
import {
  ACTION_SKILLS,
  isUserToolAlias,
  registerActionToolSkills,
} from '../../packages/skills/src/action-tools.mjs';
import { timerClient, timerSkill } from '../../packages/skills/src/timers/index.mjs';
import { TimeService } from '../../packages/runtime/src/time/service.mjs';
import { ActionBroker, ActionApprovals } from './action-broker.mjs';
import { COMPUTER_ACTIONS } from './computer-control.mjs';

/** Main-process owner: survives model unload, never depends on generated conversation. */
export class CompanionActions {
  constructor({
    root,
    emit,
    deliver,
    settings,
    setSetting,
    requestSetting,
    desktop,
    files,
    fullAccess = () => false,
    computer,
    computerAgent,
    requestComputerAccess,
    runComputerTask,
    spotify,
    applications,
    workflows,
    userTools,
    authorizeAction = () => {},
    onResult = () => {},
    formatElapsed = (time) => 'Elapsed time: ' + time + '.',
    skills,
  }) {
    Object.assign(this, { emit, settings, setSetting, requestSetting, desktop });
    Object.assign(this, {
      files,
      onResult,
      fullAccess,
      computer,
      computerAgent,
      requestComputerAccess,
      runComputerTask,
      spotify,
      applications,
      workflows,
      userTools,
      authorizeAction,
    });
    this.approvals = new ActionApprovals({ emit });
    this.skills = skills ?? new CapriCore();
    this.ownsSkills = !skills;
    registerActionToolSkills(this.skills, {
      spotify,
      applications,
      files,
      workflows,
      userTools,
      ...(typeof desktop?.execute === 'function'
        ? {
            trash: (id, args, signal) =>
              desktop.execute(
                id,
                args,
                this.fullAccess() ? { propose: (proposal) => proposal.execute() } : this.approvals,
                signal,
              ),
          }
        : {}),
    });
    this.skills.register(timerSkill, {
      formatElapsed,
      createTimeService: (changed) =>
        new TimeService({ file: path.join(root, 'data/desktop/time.sqlite'), deliver, changed }),
    });
    this.unsubscribeTime = this.skills.subscribe(
      { skillId: timerSkill.manifest.id, event: 'changed' },
      ({ data: objects }) => emit({ type: 'time.changed', objects }),
    );
    this.time = timerClient(this.skills);
    this.broker = new ActionBroker({
      root,
      execute: ({ tool, id, args, signal }) => this.execute(tool, id, args, signal),
    });
  }
  async start() {
    await this.broker.start();
    this.time.start();
  }
  async execute(tool, id, args, signal) {
    const notify = (result) => {
      try {
        this.onResult?.(tool, args, result);
      } catch {
        console.warn('Action result observer failed.');
      }
    };
    try {
      const result = await CompanionActions.prototype.executeAction.call(
        this,
        tool,
        id,
        args,
        signal,
      );
      notify(result);
      return result;
    } catch (error) {
      notify({ ok: false, error: { code: error.code ?? 'action_failed' } });
      throw error;
    }
  }
  async executeAction(tool, id, args, signal) {
    signal?.throwIfAborted();
    // Enforce the active owner's domain before any generated tool can create
    // an overlay, request broader access or send native input.
    this.authorizeAction?.(tool, args);
    const invoke = (skillId, command, input) =>
      this.skills.call({ skillId, command, input, requestId: id }, { source: 'tool', signal });
    if (isUserToolAlias(tool)) {
      if (!this.userTools) throw new Error('User tools are unavailable.');
      return invoke(ACTION_SKILLS.userTools, 'run', { name: tool, parameters: args });
    }
    if (tool === 'workflow_control') {
      if (
        !this.workflows ||
        !args ||
        Object.keys(args).some((key) => !['action', 'id', 'variables'].includes(key))
      )
        throw new Error('Invalid workflow request.');
      if (args.action === 'list') return invoke(ACTION_SKILLS.workflows, 'list');
      if (args.action === 'run')
        return invoke(ACTION_SKILLS.workflows, 'run', {
          id: args.id,
          variables: args.variables ?? {},
        });
      throw new Error('Choose list or run for a saved workflow.');
    }
    if (tool === 'desktop_control' && args?.action === 'run_task') {
      if (Object.keys(args).some((key) => !['action', 'goal'].includes(key)))
        throw new Error('Invalid computer task.');
      if (this.runComputerTask) return this.runComputerTask(args.goal, { signal });
      if (!this.computerAgent) throw new Error('Computer task executor is unavailable.');
      return this.computerAgent.run(args.goal, { signal });
    }
    if (
      this.computerAgent?.running &&
      ['desktop_control', 'filesystem_control', 'application_control'].includes(tool)
    )
      throw new Error('Wait for the current computer task or stop it with Escape.');
    if (['spotify_control', 'application_control'].includes(tool)) {
      const calculation = tool === 'application_control' && args?.action === 'calculate';
      const skillId =
        tool === 'spotify_control'
          ? ACTION_SKILLS.spotify
          : calculation
            ? ACTION_SKILLS.calculator
            : ACTION_SKILLS.applications;
      if (!this.skills?.has(skillId)) throw new Error('The requested application is unavailable.');
      return invoke(skillId, calculation ? 'calculate' : 'execute', args);
    }
    if (tool === 'desktop_control' && COMPUTER_ACTIONS.has(args?.action)) {
      if (!this.computer) throw new Error('Computer control is unavailable.');
      return ['begin_control', 'end_control', 'control_status', 'observe'].includes(args.action)
        ? this.computer.execute(args, signal)
        : this.desktop.operation(id, args, () => this.computer.execute(args, signal), signal);
    }
    if (tool === 'time_control') return this.time.execute(id, args, { source: 'tool', signal });
    if (tool === 'filesystem_control')
      return invoke(ACTION_SKILLS.files, args?.action === 'trash' ? 'trash' : 'execute', args);
    if (tool === 'desktop_control')
      return this.desktop.execute(
        id,
        args,
        this.fullAccess() ? { propose: (proposal) => proposal.execute() } : this.approvals,
        signal,
      );
    if (
      tool !== 'settings_control' ||
      !args ||
      Object.keys(args).some((key) => !['action', 'setting', 'value'].includes(key))
    )
      throw new Error('Invalid settings command.');
    if (args.action === 'status') return { ok: true, settings: this.settings() };
    if (args.action === 'request' && args.setting === 'fullComputerAccess') {
      if (
        (args.value !== undefined && typeof args.value !== 'boolean') ||
        !this.requestComputerAccess
      )
        throw new Error('Invalid full computer access request.');
      return this.requestComputerAccess(args.value ?? true, { signal });
    }
    if (args.action === 'set' && ['glitchEnabled', 'glitchStrength'].includes(args.setting)) {
      const value = args.value;
      if (
        args.setting === 'glitchEnabled'
          ? typeof value !== 'boolean'
          : !Number.isInteger(value) || value < 0 || value > 100
      )
        throw new Error('Invalid setting value.');
      return { ok: true, setting: args.setting, value: await this.setSetting(args.setting, value) };
    }
    if (
      args.action !== 'request' ||
      (args.value !== undefined && args.value !== true) ||
      !['screenObservation', 'notepad', 'calculator', 'spotify', 'languages', 'models'].includes(
        args.setting,
      )
    )
      throw new Error('That setting needs its dedicated controls.');
    if (args.setting === 'screenObservation' && this.settings?.().screenObservation === true)
      return {
        ok: true,
        enabled: true,
        alreadyEnabled: true,
        needsApproval: false,
        captureStarted: false,
        instruction:
          'Screen observation is already active for the owner-selected source. No new approval or picker is needed. Answer from the current read-only scene supplied with this turn. If no current scene is available, say that this update is unavailable; do not invent it or call other tools to obtain permission. This call did not start or stop capture.',
      };
    const result = await this.requestSetting(args.setting, this.approvals);
    if (args.setting !== 'screenObservation' || !result?.needsApproval) return result;
    return {
      ...result,
      effect: 'open_screen_picker',
      captureStarted: false,
      instruction:
        'A real desktop approval is pending. End your reply and wait for the owner to confirm using the buttons or yes/confirm. This is NOT an error. Do not call apps, filesystem or other tools to enable observation. Approval opens Screen snapshot settings only; the owner must then select a window or monitor and press Start observation. No capture has been started by this request. Never ask for terminal commands, tokens or workspace files.',
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.approvals.cancel();
    this.broker.close();
    this.unsubscribeTime();
    if (this.ownsSkills) void this.skills.close();
    void this.files?.close();
    this.spotify?.close();
    void this.applications?.close();
    void Promise.resolve(this.desktop.close()).catch((error) =>
      console.warn('Desktop journal could not close:', error.message),
    );
  }
}
