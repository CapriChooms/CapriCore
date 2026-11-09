import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../host/paths.mjs';
import { MIN_COMPANION_CONTEXT, isManagedCapriModel } from './context-policy.mjs';
import { deviceSettingsFile, readModelDevices } from '../model-device-settings.mjs';

export function generationParams(value = { temperature: 0.85, repeat_last_n: 512 }) {
  if (
    !value ||
    !Number.isFinite(value.temperature) ||
    value.temperature < 0 ||
    value.temperature > 1.5 ||
    !Number.isInteger(value.repeat_last_n) ||
    value.repeat_last_n < 0 ||
    value.repeat_last_n > 2048
  )
    throw new Error('Invalid local generation settings');
  return { temperature: value.temperature, repeat_last_n: value.repeat_last_n };
}
export function reasoningBudget(value = 64) {
  if (!Number.isInteger(value) || value < 0 || value > 4096)
    throw new Error('Invalid local reasoning budget');
  return value;
}
export function validateCoreSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Core settings must be an object');
  const result = structuredClone(value);
  if (result.modelSetupRequired !== undefined && typeof result.modelSetupRequired !== 'boolean')
    throw new Error('Invalid model setup state');
  if (
    typeof result.name !== 'string' ||
    !result.name.trim() ||
    result.name.length > 100 ||
    typeof result.sessionKey !== 'string' ||
    result.sessionKey.length > 160 ||
    !/^[a-z0-9:_-]+$/i.test(result.sessionKey)
  )
    throw new Error('Invalid assistant identity');
  for (const key of ['gatewayPort', 'ollamaPort'])
    if (!Number.isInteger(result[key]) || result[key] < 1024 || result[key] > 65535)
      throw new Error('Invalid ' + key);
  if (result.gatewayPort === result.ollamaPort) throw new Error('Service ports must be different');
  for (const key of ['model', 'embeddingModel', 'agentId'])
    if (
      typeof result[key] !== 'string' ||
      !result[key] ||
      result[key].length > 128 ||
      /[\s\x00-\x1f]/.test(result[key])
    )
      throw new Error('Invalid ' + key);
  if (
    !Number.isInteger(result.contextTokens) ||
    result.contextTokens < 8192 ||
    result.contextTokens > 262144
  )
    throw new Error('Unsupported local context size');
  if (isManagedCapriModel(result.model))
    result.contextTokens = Math.max(MIN_COMPANION_CONTEXT, result.contextTokens);
  if (
    typeof result.preloadModels !== 'boolean' ||
    !Number.isInteger(result.keepAlive) ||
    result.keepAlive < -1 ||
    result.keepAlive > 86400
  )
    throw new Error('Invalid model residency settings');
  for (const key of ['nodeVersion', 'ollamaVersion', 'openclawVersion'])
    if (typeof result[key] !== 'string' || !/^\d+\.\d+\.\d+$/.test(result[key]))
      throw new Error('Invalid ' + key);
  if (
    result.cpuThreads !== undefined &&
    (!Number.isInteger(result.cpuThreads) || result.cpuThreads < 1 || result.cpuThreads > 16)
  )
    throw new Error('Invalid CPU thread budget');
  if (result.acceleration !== undefined && !['auto', 'cpu'].includes(result.acceleration))
    throw new Error('Invalid acceleration preference');
  result.generation = generationParams(result.generation);
  result.reasoningBudget = reasoningBudget(result.reasoningBudget);
  if (
    result.modelCapabilities !== undefined &&
    (!Array.isArray(result.modelCapabilities) ||
      result.modelCapabilities.some(
        (capability) => !['tools', 'vision', 'thinking'].includes(capability),
      ))
  )
    throw new Error('Invalid model capabilities');
  if (
    result.modelContextLimit !== undefined &&
    (!Number.isInteger(result.modelContextLimit) ||
      result.modelContextLimit < 8192 ||
      result.modelContextLimit > 262144 ||
      result.contextTokens > result.modelContextLimit)
  )
    throw new Error('Invalid model context limit');
  return result;
}
export function loadCoreSettings(directory = path.join(root, 'config')) {
  const read = (file) => {
    const bytes = readFileSync(file);
    if (bytes.length > 65536) throw new Error('Core settings exceed limit');
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Core settings must be a JSON object');
    return value;
  };
  const base = read(path.join(directory, 'core.json')),
    file = path.join(directory, 'core.local.json'),
    local = existsSync(file) ? read(file) : {};
  return validateCoreSettings({
    ...base,
    ...local,
    ...(existsSync(deviceSettingsFile(path.dirname(directory)))
      ? {
          acceleration:
            readModelDevices(path.dirname(directory)).language === 'cpu' ? 'cpu' : 'auto',
        }
      : {}),
    generation: { ...base.generation, ...local.generation },
  });
}
export const settings = Object.freeze(loadCoreSettings());
