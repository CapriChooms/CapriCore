// SPDX-License-Identifier: GPL-3.0-only
import { TimeConversation as TimerConversation } from '../../packages/skills/src/timers/conversation.mjs';
import { uiText } from './renderer/interface-translations.mjs';

export class TimeConversation extends TimerConversation {
  constructor({ language, ...options }) {
    super({
      ...options,
      formatElapsed: (time) => uiText('Elapsed time: {time}.', language(), { time }),
    });
  }
}
