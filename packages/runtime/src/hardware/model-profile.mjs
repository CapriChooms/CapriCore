// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { selectModelChoice } from './model-catalog.mjs';
import { loadCoreSettings } from '../config/settings.mjs';
import { applyModelProfile } from '../context.mjs';
import { writeJsonAtomic } from '../atomic-json.mjs';
import {
  EXPERIMENTAL_COMPANION_CONTEXT,
  MIN_COMPANION_CONTEXT,
  validateContextChoice,
  contextChoicesFor,
} from '../config/context-policy.mjs';
import { validateImportedProfile } from './imported-model.mjs';
import { cpuExecutionProfile } from './cpu-execution.mjs';

export function profileOverrides(profile) {
  return {
    model: profile.alias,
    modelSetupRequired: false,
    upstreamModel: profile.model,
    contextTokens: profile.contextTokens,
    cpuThreads: profile.cpuThreads,
    preloadModels: profile.id === 'quality',
    keepAlive: 300,
    resourceProfile: profile.id,
    modelCapabilities: profile.capabilities,
    modelContextLimit: profile.contextLimit,
    thinkingDefault:
      profile.capabilities && !profile.capabilities.includes('thinking') ? 'off' : 'low',
    skipLocalModels: profile.id === 'api',
  };
}

export function modelProfileContext(current, profile) {
  const choices = contextChoicesFor({
    model: profile.alias,
    modelContextLimit: profile.contextLimit,
  });
  const available =
    !current.experimentalContext &&
    choices[0] === EXPERIMENTAL_COMPANION_CONTEXT &&
    choices[1] === MIN_COMPANION_CONTEXT
      ? choices.slice(1)
      : choices;
  return available.filter((tokens) => tokens <= current.contextTokens).at(-1) ?? available[0];
}

/** Called only after the owning core has stopped. Retains unrelated overrides and shared memory. */
export function saveModelProfile({
  root,
  rt,
  id,
  hardware,
  importedProfiles = [],
  write = writeJsonAtomic,
}) {
  const imported = importedProfiles.find((profile) => profile.id === id);
  const profile = imported ? validateImportedProfile(imported) : selectModelChoice(id, hardware);
  const current = loadCoreSettings(path.join(root, 'config'));
  const contextTokens = modelProfileContext(current, profile);
  return {
    ...saveInferenceSettings({
      root,
      rt,
      overrides: {
        ...profileOverrides(profile),
        contextTokens,
        experimentalContext:
          current.experimentalContext === true && contextTokens === EXPERIMENTAL_COMPANION_CONTEXT,
      },
      write,
    }),
    profile,
  };
}

export function saveContextWindow({ root, rt, contextTokens, write = writeJsonAtomic }) {
  validateContextChoice(contextTokens, loadCoreSettings(path.join(root, 'config')));
  return saveInferenceSettings({
    root,
    rt,
    overrides: {
      contextTokens,
      experimentalContext: contextTokens === EXPERIMENTAL_COMPANION_CONTEXT,
    },
    write,
  });
}

export function saveInferenceSettings({ root, rt, overrides, write = writeJsonAtomic }) {
  const file = path.join(root, 'config/core.local.json');
  const read = (name) => {
    if (!existsSync(name)) return null;
    const bytes = readFileSync(name);
    if (bytes.length > 2 * 1024 ** 2) throw new Error('Model configuration is too large');
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  };
  const beforeLocal = read(file),
    beforeGateway = read(rt.configPath);
  const current = loadCoreSettings(path.join(root, 'config'));
  const next = { ...(beforeLocal ?? {}), ...overrides };
  const restore = () => {
    if (beforeGateway) write(rt.configPath, beforeGateway);
    if (beforeLocal) write(file, beforeLocal);
    else if (existsSync(file)) unlinkSync(file);
  };
  try {
    if (beforeGateway)
      write(
        rt.configPath,
        applyModelProfile(
          beforeGateway,
          rt,
          cpuExecutionProfile({
            ...current,
            ...next,
            generation: { ...current.generation, ...next.generation },
          }),
        ),
      );
    write(file, next);
  } catch (error) {
    restore();
    throw error;
  }
  return { restore };
}
