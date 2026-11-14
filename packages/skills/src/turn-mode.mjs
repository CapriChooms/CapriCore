// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput } from '../../skill-sdk/src/index.mjs';

const boolean = (value) => typeof value === 'boolean';
export const enabledSetting = (value) => isRecord(value) && boolean(value.enabled);

export const turnModeCommands = {
  mode: { sources: ['host'], input: noInput, output: boolean },
  setMode: { sources: ['companion', 'host'], input: boolean, output: enabledSetting },
};

export function withTurnMode(run) {
  let enabled = false;
  return {
    invoke(command, input, operation) {
      if (command === 'mode') return enabled;
      if (command === 'setMode') {
        enabled = input;
        const settings = { enabled };
        operation.emit('settings', settings);
        return settings;
      }
      return run(command, input, operation);
    },
  };
}
