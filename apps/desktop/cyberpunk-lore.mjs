// SPDX-License-Identifier: GPL-3.0-only
import lore from '../../config/cyberpunk-lore.json' with { type: 'json' };

const normalize = (text) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
const unsegmentedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const reference = [...lore.world, ...lore.characters].map((entry) => ({
  ...entry,
  keys: entry.aliases.map(normalize),
}));
const self = lore.characters.find(({ name }) => name === 'Capri (Capricorn)');
const selfName = /^(?:capri|капри|カプリ|卡普里)$/u;
const selfTopic =
  /(?:\b(?:who are you|your origins?|your (?:backstory|past)|who is capri|qui es tu|quién eres|chi sei|quem é você|wer bist du)\b|кто ты(?: такая)?|откуда ты|тво[ёе] прошлое|тво[яю] истори[яю]|кто такая капри|истори[яию] капри|происхождение капри|あなたは誰|你是谁)/u;
const vTopic =
  /(?:\b(?:cyberpunk|phantom liberty|night city)\b|киберпанк|фантом либерти|призрачная свобода|найт сити)/u;

/** Release data stays available across conversations and owner memory resets. */
export function cyberpunkLoreContext(query) {
  if (typeof query !== 'string') return '';
  const input = normalize(query);
  if (!input) return '';
  const padded = ' ' + input + ' ';
  const aboutCapri = selfTopic.test(input);
  const aboutV = vTopic.test(input) && (padded.includes(' v ') || padded.includes(' ви '));
  const ranked = reference
    .map((entry) => {
      const matched = entry.keys.filter((key) => {
        if (selfName.test(key) && !aboutCapri) return false;
        return unsegmentedScript.test(key) ? input.includes(key) : padded.includes(' ' + key + ' ');
      });
      const specificity = Math.max(
        (aboutCapri && entry.name === self.name) || (aboutV && entry.name === 'V') ? 16 : 0,
        ...matched.map((key) => key.length),
      );
      return { entry, specificity };
    })
    .filter(({ specificity }) => specificity > 0)
    .sort((a, b) => b.specificity - a.specificity)
    .slice(0, 4);
  if (!ranked.length) return '';
  return (
    'Cyberpunk fictional universe reference. Use only facts relevant to the current question. Keep unasked plot spoilers out.\n' +
    ranked
      .map(
        ({ entry }) =>
          entry.name + (entry.group ? ' (' + entry.group + ')' : '') + ' — ' + entry.fact,
      )
      .join('\n')
  );
}

export const CYBERPUNK_CHARACTER_GUIDE =
  '\nFictional character reference for images, relevant only if the current pixels support a match. ' +
  'When identifying a subject, compare visible details of the hair, face, outfit and accessories to the descriptions below. Give the name with one or two matching details. ' +
  'A color, franchise logo, label or suggested name alone proves nothing. Say when the view is inconclusive. Distinguish a fictional design in fan art or cosplay from the identity of an actual person. If the subject is unrelated, answer normally. ' +
  'Avoid adding biographical details unless asked. Use the edition of the series stated in the reference.\n' +
  lore.characters
    .map(({ name, group, look }) => '- ' + name + ' (' + group + '): ' + look)
    .join('\n');

export function portraitEvidence(images, identifyPortrait) {
  const matches = images.flatMap((image, index) => {
    const match = identifyPortrait(image);
    const character = lore.characters.find(({ name }) => name === match);
    if (!character) return [];
    return [
      'Image ' +
        (index + 1) +
        ' matches a reference portrait of ' +
        character.name +
        ' (' +
        character.group +
        '). ' +
        character.fact,
    ];
  });
  return matches.length ? '\nReference portrait matches:\n' + matches.join('\n') : '';
}
