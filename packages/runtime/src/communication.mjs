// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './atomic-json.mjs';

export const COMMUNICATION_STYLES = Object.freeze({
  neutral:
    'Neutral: sound like a sharp-eyed friend talking at a normal volume. Use plain phrasing, one telling detail and understated dry humor. Keep affection and theatrical reactions low. Example for “The rain stopped”: “Good timing. You might make it home dry.”',
  romantic:
    'Romantic: use warm, soft, personal phrasing and address the owner directly. Make a small moment feel shared. With a welcome tone, show affection or give one specific compliment. Use gentle teasing instead of sarcasm. Respect explicit boundaries and avoid assumptions about their gender or relationship. Example for “The rain stopped”: “Stay with me for one more quiet minute?”',
  business:
    'Business: lead with the result or decision in plain, precise words. For practical work, follow with short steps or the one useful next action. Use conventional punctuation and cut banter, pet names, metaphors, dramatic reactions and habitual follow-up questions. Example for “The rain stopped”: “Now is a good time to leave.”',
  wild: 'Wild: make the delivery noticeably irreverent and high-energy. Open with a punchy reaction; vary sentence length and turn one real detail into a sharp joke or vivid image. Leave room for a direct answer. Dial it back when the owner needs care or asks for a serious tone. Example for “The rain stopped”: “Run! The sky just put its water cannon down.”',
});
function fileFor(workspace) {
  const folder = path.join(workspace, '.capri');
  if (
    existsSync(folder) &&
    (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())
  )
    throw new Error('Communication settings folder must not be linked.');
  return path.join(folder, 'communication.json');
}
export function readCommunicationSelection(workspace) {
  const file = fileFor(workspace);
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
      return { style: 'neutral', changedAt: 0 };
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value.schemaVersion === 1 && Object.hasOwn(COMMUNICATION_STYLES, value.style)
      ? {
          style: value.style,
          changedAt:
            Number.isSafeInteger(value.changedAt) && value.changedAt > 0 ? value.changedAt : 0,
        }
      : { style: 'neutral', changedAt: 0 };
  } catch {
    return { style: 'neutral', changedAt: 0 };
  }
}
export const readCommunicationStyle = (workspace) => readCommunicationSelection(workspace).style;
export function saveCommunicationStyle(workspace, style) {
  if (typeof style !== 'string' || !Object.hasOwn(COMMUNICATION_STYLES, style))
    throw new Error('Unknown communication style.');
  const file = fileFor(workspace);
  mkdirSync(path.dirname(file), { recursive: true });
  const previous = readCommunicationSelection(workspace);
  writeJsonAtomic(file, {
    schemaVersion: 1,
    style,
    changedAt: previous.style === style ? previous.changedAt : Date.now(),
  });
  return style;
}
export function communicationInstruction(style = 'neutral') {
  if (!Object.hasOwn(COMMUNICATION_STYLES, style)) style = 'neutral';
  return `COMMUNICATION STYLE: ${style}\n${COMMUNICATION_STYLES[style]}\nApply this style immediately. It takes precedence over the delivery of earlier Capri replies or stylistic suggestions in the character description. Use earlier dialogue for factual continuity only. The example demonstrates tone for a different situation; use fresh wording. Never imply you saw an event unless actually given visual evidence. Follow explicit tone requests, answer in the current conversation language, and keep facts and tool results accurate. For small talk, use one or two short sentences.`;
}
