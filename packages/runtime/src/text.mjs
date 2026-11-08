/** Remove emoji as complete Unicode graphemes, preserving words and punctuation. */
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const emoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u;
const orphanControls = /[\u200d\ufe0e\ufe0f\u{e0020}-\u{e007f}]/gu;

export function withoutEmoji(text) {
  let output = '';
  for (const { segment } of graphemes.segment(text)) {
    if (!emoji.test(segment)) output += segment.replace(orphanControls, '');
  }
  return output;
}

export class EmojiFreeStream {
  constructor() {
    this.pending = '';
  }
  push(text, final = false) {
    const parts = [...graphemes.segment(this.pending + text)].map((part) => part.segment);
    // Keep the final grapheme: the next packet may contain its skin tone, ZWJ,
    // second flag indicator, keycap mark or low UTF-16 surrogate.
    this.pending = final ? '' : (parts.pop() ?? '');
    return withoutEmoji(parts.join(''));
  }
}

/** Remove accidental emphasis/code delimiters, never the words they surround. */
export function plainDialogueText(text) {
  return withoutEmoji(text).replace(/[*`]/g, '');
}

export class PlainTextStream extends EmojiFreeStream {
  push(text, final = false) {
    return super.push(text, final).replace(/[*`]/g, '');
  }
}
