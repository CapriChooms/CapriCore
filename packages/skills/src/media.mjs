// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';

const boolean = (value) => typeof value === 'boolean';
const string = (value) => typeof value === 'string';
const optionalRecord = (value) => noInput(value) || isRecord(value);
const desktopSources = ['host', 'companion', 'settings'];
const sessionId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 160;
const optionalSessionId = (value) => value === undefined || sessionId(value);
const activeState = (value) => isRecord(value) && boolean(value.active);
const enabledState = (value) => isRecord(value) && boolean(value.enabled);
const microphoneDevice = (value) =>
  isRecord(value) && string(value.deviceId) && string(value.deviceLabel);
const microphoneDevices = (value) =>
  isRecord(value) &&
  microphoneDevice(value.selection) &&
  Array.isArray(value.devices) &&
  value.devices.every(microphoneDevice);
const screenContext = (value) => value === null || activeState(value);
const screenPreferences = (value) =>
  isRecord(value) && Number.isInteger(value.intervalMs) && Number.isInteger(value.durationMs);
const captureStart = (value) =>
  isRecord(value) &&
  sessionId(value.sessionId) &&
  Number.isSafeInteger(value.sampleRate) &&
  value.sampleRate > 0;
const microphoneStop = (value) =>
  isRecord(value) &&
  Object.keys(value).every((key) => ['id', 'keepModelWarm'].includes(key)) &&
  (value.id === undefined || typeof value.id === 'string') &&
  boolean(value.keepModelWarm);

function lifecycleSkill(id, commands, ui) {
  return {
    manifest: {
      id,
      apiVersion: SKILL_API_VERSION,
      version: '1.0.0',
      requires: Object.keys(commands),
      commands,
      ui,
    },
    create({ ports }) {
      return {
        invoke(command, input, { signal }) {
          return ports[command](input, { signal });
        },
      };
    },
  };
}

export const microphoneSkill = lifecycleSkill(
  'capri.microphone',
  {
    start: { input: noInput, output: captureStart, sources: ['companion'] },
    confirm: { input: sessionId, output: enabledState, sources: ['companion'] },
    stop: { input: microphoneStop, output: boolean, sources: ['companion', 'host'] },
    listen: { input: noInput, output: boolean, sources: ['companion'] },
    snapshot: { input: noInput, output: enabledState, sources: ['host'] },
    devices: { input: noInput, output: microphoneDevices, sources: desktopSources },
    selectDevice: { input: string, output: microphoneDevice, sources: desktopSources },
  },
  { sectionId: 'microphone', labelKey: 'Microphone settings' },
);

export const musicSkill = lifecycleSkill(
  'capri.music',
  {
    start: { input: noInput, output: captureStart, sources: ['companion'] },
    ready: { input: sessionId, output: boolean, sources: ['companion'] },
    stop: {
      input: optionalSessionId,
      output: enabledState,
      sources: ['companion', 'settings', 'host'],
    },
    snapshot: { input: noInput, output: enabledState, sources: desktopSources },
    configure: { input: optionalRecord, output: enabledState, sources: ['settings'] },
  },
  { sectionId: 'music', labelKey: 'Music listening' },
);

export const screenSkill = lifecycleSkill(
  'capri.screen',
  {
    context: { input: noInput, output: screenContext, sources: ['chat'] },
    prepare: {
      input: (value) => isRecord(value) && string(value.text) && Object.keys(value).length === 1,
      output: (value) => isRecord(value) && screenContext(value.screenObservation),
      sources: ['chat'],
    },
    snapshot: { input: noInput, output: activeState, sources: ['host'] },
    stop: { input: noInput, output: noInput, sources: ['host'] },
    configure: {
      input: optionalRecord,
      output: screenPreferences,
      sources: ['companion', 'settings'],
    },
    preferences: { input: noInput, output: screenPreferences, sources: ['host'] },
  },
  { sectionId: 'screen', labelKey: 'Screen snapshot' },
);
