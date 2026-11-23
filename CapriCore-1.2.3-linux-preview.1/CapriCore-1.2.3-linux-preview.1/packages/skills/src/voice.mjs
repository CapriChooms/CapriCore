// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';

const voiceState = (value) => isRecord(value) && typeof value.enabled === 'boolean';
const callState = (value) => isRecord(value) && typeof value.callOutputReady === 'boolean';
const speechSettings = (value) =>
  isRecord(value) &&
  Object.keys(value).every((key) => ['trailingSilenceSeconds', 'microphoneGain'].includes(key)) &&
  Number.isFinite(value.trailingSilenceSeconds) &&
  (!Object.hasOwn(value, 'microphoneGain') || Number.isInteger(value.microphoneGain));

const turnTypes = new Set([
  'turn.started',
  'turn.preface',
  'turn.delta',
  'turn.completed',
  'turn.cancelled',
  'turn.failed',
]);
export const isVoiceTurnType = (type) => turnTypes.has(type);
const voiceTurn = (value) =>
  isRecord(value) &&
  isVoiceTurnType(value.type) &&
  typeof value.turnId === 'string' &&
  value.turnId.length > 0 &&
  value.turnId.length <= 160 &&
  (value.text === undefined || typeof value.text === 'string') &&
  Object.keys(value).every((key) => ['type', 'turnId', 'text'].includes(key));

function voiceSkill(id, commands, ui) {
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
      return { invoke: (command, input) => ports[command](input) };
    },
  };
}

export const voiceOutputSkill = voiceSkill(
  'capri.voice-output',
  {
    setEnabled: {
      input: (value) => typeof value === 'boolean',
      output: voiceState,
      sources: ['companion', 'settings', 'host'],
    },
    turn: { input: voiceTurn, output: noInput, sources: ['host'] },
  },
  { sectionId: 'general', labelKey: 'Capri voice' },
);

export const voiceCallsSkill = voiceSkill(
  'capri.voice-calls',
  { command: { input: isRecord, output: callState, sources: ['settings'] } },
  { sectionId: 'calls', labelKey: 'Voice calls' },
);

export const speechSettingsSkill = voiceSkill(
  'capri.speech-settings',
  {
    configure: {
      input: speechSettings,
      output: speechSettings,
      sources: ['companion', 'settings'],
    },
  },
  { sectionId: 'microphone', labelKey: 'Microphone settings' },
);
