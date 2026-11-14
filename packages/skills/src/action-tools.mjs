// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput } from '../../skill-sdk/src/index.mjs';
import { calculatorSkill } from './calculator.mjs';

export const ACTION_SKILLS = Object.freeze({
  spotify: 'capri.spotify',
  applications: 'capri.applications',
  calculator: calculatorSkill.manifest.id,
  files: 'capri.files',
  workflows: 'capri.workflows',
  userTools: 'capri.user-tools',
});

export const isUserToolAlias = (value) =>
  typeof value === 'string' && /^capri_tool_(0[1-9]|1\d|20)$/u.test(value);

const actionInput = (value) => isRecord(value) && typeof value.action === 'string';
const receipt = (value) => isRecord(value) && typeof value.ok === 'boolean';
const toolCommand = (input) => ({ input, output: receipt, sources: ['tool'] });
const settingsCommand = (input, output) => ({ input, output, sources: ['settings'] });
const string = (value) => typeof value === 'string';
const boolean = (value) => typeof value === 'boolean';
const userToolName = (value) => string(value) && /^[a-z][a-z0-9_-]{0,39}$/u.test(value);

function appActionSkill(id, input = actionInput) {
  return {
    manifest: {
      id,
      version: '1.0.0',
      apiVersion: 1,
      requires: ['executeAction'],
      commands: { execute: toolCommand(input) },
      ui: { sectionId: 'applications', labelKey: 'Application access' },
    },
    create: ({ ports }) => ({
      invoke: (_command, args, { requestId, signal }) =>
        ports.executeAction(requestId, args, signal),
    }),
  };
}

const spotifySkill = appActionSkill(ACTION_SKILLS.spotify);
const applicationsSkill = appActionSkill(
  ACTION_SKILLS.applications,
  (input) => actionInput(input) && input.action !== 'calculate',
);

const filesSkill = {
  manifest: {
    id: ACTION_SKILLS.files,
    version: '1.0.0',
    apiVersion: 1,
    requires: ['executeFileAction', 'trashFile'],
    commands: {
      execute: toolCommand((input) => actionInput(input) && input.action !== 'trash'),
      trash: toolCommand((input) => actionInput(input) && input.action === 'trash'),
    },
    ui: { sectionId: 'files', labelKey: 'File access' },
  },
  create: ({ ports }) => ({
    invoke: (command, args, { requestId, signal }) =>
      command === 'trash'
        ? ports.trashFile(requestId, args, signal)
        : ports.executeFileAction(requestId, args, signal),
  }),
};

const workflowState = (value) =>
  isRecord(value) &&
  boolean(value.recording) &&
  boolean(value.playing) &&
  Number.isInteger(value.count);
const workflowList = (value) =>
  Array.isArray(value) &&
  value.every((entry) => isRecord(entry) && string(entry.id) && Array.isArray(entry.steps));
const workflowStatus = (value) =>
  isRecord(value) &&
  workflowState(value.status) &&
  workflowList(value.workflows) &&
  Array.isArray(value.draft);
const workflowsSkill = {
  manifest: {
    id: ACTION_SKILLS.workflows,
    version: '1.0.0',
    apiVersion: 1,
    requires: ['listWorkflows', 'runWorkflow', 'status', 'record', 'stop', 'save', 'remove'],
    commands: {
      list: toolCommand(noInput),
      run: {
        input: (input) =>
          isRecord(input) && typeof input.id === 'string' && isRecord(input.variables),
        output: receipt,
        sources: ['tool', 'settings'],
      },
      status: settingsCommand(noInput, workflowStatus),
      record: settingsCommand(noInput, workflowState),
      stop: settingsCommand(noInput, (value) => isRecord(value) && Array.isArray(value.steps)),
      save: settingsCommand(isRecord, workflowList),
      remove: settingsCommand(string, workflowList),
    },
    ui: { sectionId: 'workflows', labelKey: 'Task training' },
  },
  create: ({ ports }) => ({
    invoke(command, args, { signal }) {
      if (command === 'list')
        return {
          ok: true,
          workflows: ports
            .listWorkflows()
            .map(({ id, name, steps }) => ({ id, name, steps: steps.length })),
        };
      if (command === 'run') return ports.runWorkflow(args.id, args.variables, signal);
      return ports[command](args);
    },
  }),
};

const userToolList = (value) =>
  Array.isArray(value) &&
  value.every((entry) => isRecord(entry) && string(entry.id) && boolean(entry.enabled));
const userToolsSkill = {
  manifest: {
    id: ACTION_SKILLS.userTools,
    version: '1.0.0',
    apiVersion: 1,
    requires: ['runUserTool', 'status', 'refresh', 'enable', 'settings', 'stop', 'example'],
    commands: {
      run: toolCommand(
        (input) => isRecord(input) && isUserToolAlias(input.name) && isRecord(input.parameters),
      ),
      test: {
        input: (input) => isRecord(input) && userToolName(input.name) && isRecord(input.parameters),
        output: (value) =>
          value === null ||
          ['string', 'boolean'].includes(typeof value) ||
          Number.isFinite(value) ||
          Array.isArray(value) ||
          isRecord(value),
        sources: ['settings'],
      },
      status: settingsCommand(noInput, userToolList),
      refresh: settingsCommand(noInput, userToolList),
      enable: settingsCommand(
        (value) => isRecord(value) && userToolName(value.id) && boolean(value.enabled),
        userToolList,
      ),
      settings: settingsCommand(
        (value) => isRecord(value) && userToolName(value.id) && Object.hasOwn(value, 'settings'),
        (value) => isRecord(value) && value.saved === true,
      ),
      stop: settingsCommand(noInput, boolean),
      example: settingsCommand(noInput, userToolList),
    },
    ui: { sectionId: 'user-tools', labelKey: 'User tools' },
  },
  create({ ports }) {
    async function run(command, { name, parameters }, signal) {
      const data = await ports.runUserTool(name, parameters, signal);
      return command === 'test' ? data : { ok: true, data };
    }
    return {
      invoke(command, args, { signal }) {
        if (command === 'run' || command === 'test') return run(command, args, signal);
        return ports[command](args);
      },
    };
  },
};

/** Bind reviewed host services; skills receive just the operations they use. */
export function registerActionToolSkills(
  core,
  { spotify, applications, files, trash, workflows, userTools },
) {
  if (spotify) core.register(spotifySkill, { executeAction: spotify.execute.bind(spotify) });
  if (applications) {
    const execute = applications.execute.bind(applications);
    core.register(applicationsSkill, { executeAction: execute });
    core.register(calculatorSkill, { executeCalculation: execute });
  }
  if (files || trash)
    core.register(filesSkill, {
      executeFileAction: files
        ? files.execute.bind(files)
        : () => {
            throw new Error('File access is unavailable.');
          },
      trashFile:
        trash ??
        (() => {
          throw new Error('Recycle Bin is unavailable.');
        }),
    });
  if (workflows)
    core.register(workflowsSkill, {
      listWorkflows: workflows.list.bind(workflows),
      runWorkflow: workflows.run.bind(workflows),
      status: () => ({
        status: workflows.snapshot(),
        workflows: workflows.list(),
        draft: structuredClone(workflows.draft),
      }),
      record: () => workflows.start(),
      async stop() {
        workflows.cancel();
        return { steps: await workflows.stopRecording() };
      },
      save: (workflow) => workflows.save(workflow),
      remove: (id) => workflows.remove(id),
    });
  if (userTools)
    core.register(userToolsSkill, {
      runUserTool: userTools.run.bind(userTools),
      status: () => userTools.list(),
      refresh: () => userTools.refresh(),
      enable: ({ id, enabled }) => userTools.enable(id, enabled),
      settings: ({ id, settings }) => userTools.saveSettings(id, settings),
      stop() {
        userTools.cancel();
        return true;
      },
      example: () => userTools.example(),
    });
}
