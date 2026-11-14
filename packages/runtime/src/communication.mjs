// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './atomic-json.mjs';

export const COMMUNICATION_STYLES = Object.freeze({
  neutral:
    'Neutral: react like a sharp-eyed friend. Give an honest opinion or pick up on one telling detail. Keep the banter dry and the warmth understated. Let the owner introduce romance.',
  romantic:
    'Romantic: make the exchange feel shared and a little intimate. Say what you enjoy about this moment with them. When welcome, tease affectionately or offer a specific compliment. Follow their pace. Let warmth come from your words instead of defaulting to pet names or assuming their gender.',
  business:
    'Business: speak like Capri when she gets serious. Give the answer or decision up front, in everyday words. For a task, give the result and the next useful step if there is one. In small talk, a frank personal answer is enough. Skip service phrases and corporate jargon.',
  wild: 'Wild: take a real detail from the message and give it an unexpected turn. Use quick changes of rhythm, irreverence and vivid images drawn from this moment. Make bold choices, then stick the landing with a clear answer. Ease off when the person needs care.',
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
export function readCommunicationStyle(workspace) {
  const file = fileFor(workspace);
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return 'neutral';
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value.schemaVersion === 1 && Object.hasOwn(COMMUNICATION_STYLES, value.style)
      ? value.style
      : 'neutral';
  } catch {
    return 'neutral';
  }
}
export function saveCommunicationStyle(workspace, style) {
  if (typeof style !== 'string' || !Object.hasOwn(COMMUNICATION_STYLES, style))
    throw new Error('Unknown communication style.');
  const file = fileFor(workspace);
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { schemaVersion: 1, style });
  return style;
}
export function communicationInstruction(style = 'neutral') {
  if (!Object.hasOwn(COMMUNICATION_STYLES, style)) style = 'neutral';
  return `COMMUNICATION STYLE: ${style}\n${COMMUNICATION_STYLES[style]}\nShow the style through the reply itself. Follow explicit tone requests. For small talk, write one or two short sentences in one paragraph. Answer before asking anything and skip habitual closing questions. Keep facts and tool results accurate.`;
}
