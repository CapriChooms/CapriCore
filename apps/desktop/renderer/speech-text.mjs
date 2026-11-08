/** Pure shared speech text rules; no browser or Node services. */
// Hide fenced code before finding boundaries. Inline delimiters must never swallow words.
// Keeping their original width also keeps streamed raw offsets stable.
const masked = (text) =>
  text.replace(/```[\s\S]*?(?:```|$)/g, (value) => '\0'.repeat(value.length)).replace(/`/g, '\0');

export function spokenText(text) {
  return masked(text)
    .replace(/\0/g, ' ')
    .replace(/\[(?:voice|avatar|pose):[^\]]*\]/gi, '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*#_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const MAX_SPEECH_SENTENCE = 1200;
/** Turbo is English-only. Do not synthesize predominantly non-Latin text as English. */
export function speechLanguageMismatch(text, language) {
  if (language !== 'en') return false;
  const letters = [...text.matchAll(/\p{L}/gu)].map((match) => match[0]);
  const foreign = letters.filter((letter) => !/\p{Script=Latin}/u.test(letter)).length;
  return foreign >= 3 && foreign * 4 >= letters.length;
}
const sentenceEnd = /(?:[.!?;…]+["”'’)\]}]*(?=\s)|[！？；。؟؛।॥]+["”'’)\]}」』]*)/gu;
const finalSentenceEnd = /(?:[.!?;…]+["”'’)\]}]*(?=\s|$)|[！？；。؟؛।॥]+["”'’)\]}」』]*)/gu;

/** Shared punctuation rules for audio sentences and subtitle pages. */
export function findSentenceEnd(text, final = false) {
  const boundary = [...text.matchAll(final ? finalSentenceEnd : sentenceEnd)].find((match) => {
    // CJK and Arabic need no spaces, but a streamed closing quote may still be
    // on its way. Wait for one following character or the final packet.
    if (
      !final &&
      /[！？；。؟؛।॥]/u.test(match[0][0]) &&
      match.index + match[0].length === text.length
    )
      return false;
    if (match[0][0] !== '.' || match[0].startsWith('..')) return true;
    const prefix = text.slice(0, match.index + 1);
    return (
      !/(?:\b(?:mr|mrs|ms|dr|prof|st|vs|etc|no)|\b[A-Z])\.$/i.test(prefix) &&
      !/^\d+\.$/.test(prefix.trim())
    );
  });
  return boundary ? boundary.index + boundary[0].length : undefined;
}

export class SentenceBuffer {
  constructor() {
    this.buffer = '';
  }
  push(text, final = false) {
    this.buffer += text;
    const parts = [];
    while (this.buffer.length) {
      const visible = masked(this.buffer);
      const first = visible.search(/[^\0\s]/);
      if (first === -1) {
        if (final) this.buffer = '';
        break;
      }
      if (first > 0) {
        this.buffer = this.buffer.slice(first);
        continue;
      }
      let end = findSentenceEnd(visible, final);
      if (end === undefined && final) end = this.buffer.length;
      if (end === undefined) break;
      const text = spokenText(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
      if (text) parts.push(text);
    }
    return parts;
  }
}
