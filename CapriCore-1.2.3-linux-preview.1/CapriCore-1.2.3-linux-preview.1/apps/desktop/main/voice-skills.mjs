// SPDX-License-Identifier: GPL-3.0-only
import {
  isVoiceTurnType,
  speechSettingsSkill,
  voiceCallsSkill,
  voiceOutputSkill,
} from '../../../packages/skills/src/voice.mjs';
import { callAudioCommand } from './call-audio.mjs';

/** The host owns audio, device grants and live call routing. */
export function createVoiceSkills(
  core,
  {
    setVoiceEnabled,
    onVoiceTurn,
    readCallAudio,
    canConfigureCallAudio,
    configureCallAudio,
    configureSpeech,
  },
) {
  core.register(voiceOutputSkill, { setEnabled: setVoiceEnabled, turn: onVoiceTurn });
  core.register(speechSettingsSkill, { configure: configureSpeech });
  core.register(voiceCallsSkill, {
    command(value) {
      const command = callAudioCommand(value);
      if (command.action === 'state') return readCallAudio();
      if (!canConfigureCallAudio()) throw new Error('Call audio requires an open Capri window.');
      return configureCallAudio(command);
    },
  });

  return {
    output: {
      setEnabled: (input, source) =>
        core.call(
          { skillId: voiceOutputSkill.manifest.id, command: 'setEnabled', input },
          { source },
        ),
      turn({ type, turnId, text }) {
        if (!isVoiceTurnType(type)) return;
        return core.call(
          {
            skillId: voiceOutputSkill.manifest.id,
            command: 'turn',
            input: { type, turnId, ...(typeof text === 'string' ? { text } : {}) },
            requestId: turnId,
          },
          { source: 'host' },
        );
      },
    },
    calls: {
      command(input, source) {
        if (source !== 'settings') throw new Error('Open Voice calls in Settings.');
        return core.call(
          { skillId: voiceCallsSkill.manifest.id, command: 'command', input },
          { source },
        );
      },
    },
    speech: {
      configure: (input, source) =>
        core.call(
          { skillId: speechSettingsSkill.manifest.id, command: 'configure', input },
          { source },
        ),
    },
  };
}
