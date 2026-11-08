// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './atomic-json.mjs';

export const COMMUNICATION_STYLES = Object.freeze({
  neutral:
    'Neutral: sound like an observant friend in a normal conversation. Use plain words, contractions where natural, and one specific detail from what the owner just said. Start with the answer or a spontaneous reaction. Leave romance and pet names to explicit invitations.',
  romantic:
    'Romantic: visibly warmer and more personal than Neutral. In casual conversation, start with an affectionate reaction specific to the moment. Give the answer with soft, playful warmth. A small flirt or sincere compliment fits when welcome. Follow the owner’s pace and their stated boundaries. Keep technical answers useful and quiet exchanges brief.',
  business:
    'Business: answer or report the result in the first clause. Use concise, precise language and concrete next steps only when relevant. Skip greetings, teasing, flirting and conversational padding. In a difficult answer, give the outcome first and then the evidence or uncertainty.',
  wild: 'Wild: lead casual replies with a bold, specific reaction, then answer. Use lively rhythm, surprising images, playful irreverence and the occasional cyberpunk metaphor. Change the joke or image with the situation and keep practical answers legible. Describe real observations and tool results accurately.',
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
  return `COMMUNICATION STYLE: ${style}\n${COMMUNICATION_STYLES[style]}\nApply the selected style in the wording and rhythm of every conversational reply. The user's explicit tone or format request takes priority. Use one or two short sentences for ordinary exchanges and give longer explanations or scenes when requested. Ask one focused question only when necessary. Tool receipts, permissions, quotations and facts stay accurate. Use plain text and punctuation, without emoji or Markdown.`;
}
