// SPDX-License-Identifier: GPL-3.0-only
import { languageName } from './renderer/language-settings.mjs';
import {
  prepareReasoning,
  REASONING_SKILL_ID,
} from '../../packages/skills/src/reasoning/index.mjs';
export {
  THINKING_INSTRUCTION,
  validateThinkingBriefing,
  VisibleAnswerStream,
} from '../../packages/skills/src/reasoning/index.mjs';

export const thinkingLanguage = (languages) =>
  languages?.conversation === 'custom'
    ? languages.customConversation
    : languageName(languages?.conversation ?? 'en');

export function reasoningForTurn({
  skills,
  text,
  languages,
  requestId,
  source,
  signal,
  prepareThinking,
}) {
  const language = thinkingLanguage(languages);
  if (skills?.has(REASONING_SKILL_ID))
    return skills.call(
      { skillId: REASONING_SKILL_ID, command: 'prepare', input: { text, language }, requestId },
      { source, signal },
    );
  return prepareReasoning({ text, language, signal, prepareThinking });
}
