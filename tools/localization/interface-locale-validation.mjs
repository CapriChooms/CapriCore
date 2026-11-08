/** Build-time localization checks; never run an LLM in the shipped UI. */
export const protectedWords = [
  'Capri',
  'Spotify',
  'OpenClaw',
  'Qwen',
  'Chatterbox',
  'Whisper',
  'Parakeet',
  'Silero',
  'Windows',
  'Live2D',
];
export const placeholders = (value) => value.match(/\{[a-zA-Z]\w*\}/g) ?? [];
// Numeric settings may use native digits and decimal punctuation, but keep their values.
const digitZeros = [
  0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0,
  0xf20, 0x1040, 0x17e0, 0x1810,
];
export function numericValues(text) {
  const latin = text
    .normalize('NFKC')
    .replace(/\p{Nd}/gu, (digit) => {
      const point = digit.codePointAt(0),
        zero = digitZeros.find((start) => point >= start && point < start + 10);
      return zero === undefined ? digit : String(point - zero);
    })
    .replace(/[,٫]/g, '.');
  return (latin.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}
export function validateTranslation(original, translated) {
  if (
    typeof translated !== 'string' ||
    !translated.trim() ||
    translated.length > Math.max(200, original.length * 6) ||
    translated.includes('\0')
  )
    throw new Error('Invalid translation length');
  if (original.length > 120 && translated.length < original.length * 0.2)
    throw new Error('Truncated help text');
  const slots = placeholders(original),
    translatedSlots = translated.match(/\{[\p{L}\p{N}_ -]{1,40}\}/gu) ?? [];
  if (slots.length === 1 && !translated.includes(slots[0]) && translatedSlots.length === 1)
    translated = translated.replace(translatedSlots[0], slots[0]);
  if (JSON.stringify(slots.sort()) !== JSON.stringify(placeholders(translated).sort()))
    throw new Error('Changed placeholders');
  for (const word of protectedWords)
    if (
      (original.includes(word) || (word === 'Capri' && original.includes('CAPRI'))) &&
      !translated.toLowerCase().includes(word.toLowerCase())
    )
      throw new Error('Changed product name ' + word);
  for (const name of original.match(/[\w/-]+\.(?:cmd|mjs|py|json|wav|png|md)\b/g) ?? [])
    if (!translated.includes(name)) throw new Error('Changed filename');
  const numbers = numericValues(translated);
  if (numericValues(original).some((value) => !numbers.includes(value)))
    throw new Error('Changed numeric setting');
  if (/<\/?[a-z][\w-]*(?:\s[^<>]*)?\s*\/?>/i.test(translated)) throw new Error('Unexpected markup');
  return translated.trim();
}

// A complete catalog can still contain fragments accidentally copied from a
// different language. Latin product names and technical terms remain allowed;
// source text that explicitly names another language can keep that script.
const scriptLocales = {
  Cyrillic: ['ru', 'uk', 'bg', 'sr'],
  Han: ['zh', 'ja', 'ko'],
  Hiragana: ['ja'],
  Katakana: ['ja'],
  Hangul: ['ko'],
  Greek: ['el'],
  Hebrew: ['he'],
  Arabic: ['ar', 'fa', 'ur'],
  Devanagari: ['hi', 'mr'],
  Bengali: ['bn'],
  Tamil: ['ta'],
  Telugu: ['te'],
  Gujarati: ['gu'],
  Gurmukhi: ['pa'],
  Thai: ['th'],
};
const languageScripts = Object.entries(scriptLocales).map(([script, locales]) => ({
  script,
  locales: new Set(locales),
  pattern: new RegExp(`\\p{Script=${script}}`, 'u'),
}));

export function validateLocaleTranslation(original, translated, locale) {
  const value = validateTranslation(original, translated);
  const language = String(locale).split('-')[0];
  for (const { script, locales, pattern } of languageScripts)
    if (!locales.has(language) && pattern.test(value) && !pattern.test(original))
      throw new Error(`Unexpected ${script} text in ${language} translation`);
  return value;
}
