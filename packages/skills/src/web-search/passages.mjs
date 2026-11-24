// SPDX-License-Identifier: GPL-3.0-only
//
// Turns a fetched web page into a few short passages that match the question,
// so the model reads the relevant paragraph and its neighbours, not the page.

export const MAX_PASSAGE_CHARS = 1100;
const MAX_PARAGRAPH_CHARS = 700;
const MAX_PARAGRAPHS = 400;
/** Shortest passage worth showing in place of a search snippet. */
export const MIN_PASSAGE_CHARS = 150;
// Lines a page shows when it needs JavaScript, cookies or a login to say anything.
const BOILERPLATE =
  /skip to (?:main |right )?(?:content|navigation|column)|something went wrong|enable javascript|javascript is (?:disabled|required)|accept (?:all )?cookies|use of cookies|sign in to continue|verify you are (?:a )?human|access denied|unusual traffic/iu;

const STOP_WORDS = new Set(
  (
    'a an and are as at be by can did do does for from had has have how i if in is it its me my of on or ' +
    'please tell that the their there these this to was were what when where which who whom whose why ' +
    'will with would you your about current currently latest now today right'
  ).split(' '),
);

const NAMED_ENTITIES = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  bull: '*',
  copy: '(c)',
  reg: '(R)',
  euro: 'EUR',
  pound: 'GBP',
  yen: 'JPY',
  cent: 'c',
  deg: ' degrees',
  times: 'x',
};

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,8});/giu, (original, entity) => {
    if (!entity.startsWith('#')) return NAMED_ENTITIES[entity.toLowerCase()] ?? original;
    const hexadecimal = entity[1].toLowerCase() === 'x';
    const point = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return point > 31 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : ' ';
  });
}

const tidy = (value) =>
  value
    .replace(/[\x00-\x1f\x7f​-‏‪-‮⁦-⁩﻿]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

/** The words of a question that are worth looking for in a page. */
export function queryTerms(query) {
  if (typeof query !== 'string') return [];
  const terms = [];
  for (const word of query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (word.length < 2 || STOP_WORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length === 12) break;
  }
  return terms;
}

/** Readable paragraphs of an HTML page, without scripts, menus or markup. */
export function pageParagraphs(html) {
  if (typeof html !== 'string' || !html) return [];
  const body = html
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(
      /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select|figure)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      '\n',
    )
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*$/iu, ' ')
    .replace(
      /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|main|blockquote|pre|dd|dt|hr)\b[^>]*>/giu,
      '\n',
    )
    .replace(/<\/t[dh]\s*>/giu, ' | ')
    .replace(/<[^>]*>/gu, ' ');
  const paragraphs = [];
  const seen = new Set();
  for (const line of decodeEntities(body).split('\n')) {
    const text = tidy(line).replace(/(?:\s*\|\s*)+$/u, '');
    // Menus and buttons are short; keep a short line only when it carries a figure.
    if (text.length < 25 && !/\d/u.test(text)) continue;
    if (text.length < 4 || seen.has(text) || BOILERPLATE.test(text)) continue;
    seen.add(text);
    paragraphs.push(text.slice(0, MAX_PARAGRAPH_CHARS));
    if (paragraphs.length === MAX_PARAGRAPHS) break;
  }
  return paragraphs;
}

function score(paragraph, terms) {
  const lower = paragraph.toLowerCase();
  let distinct = 0;
  let total = 0;
  for (const term of terms) {
    let from = 0;
    let count = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at < 0 || count === 5) break;
      count += 1;
      from = at + term.length;
    }
    if (count) distinct += 1;
    total += count;
  }
  // Matching more of the question matters far more than repeating one word.
  return distinct * 10 + Math.min(total, 10);
}

/**
 * The paragraph that best matches the question, with the paragraph before and
 * after it while they fit. Returns '' when nothing on the page matches.
 */
export function bestPassage(paragraphs, query, maximum = MAX_PASSAGE_CHARS) {
  const terms = queryTerms(query);
  if (!Array.isArray(paragraphs) || !paragraphs.length || !terms.length) return '';
  let best = -1;
  let bestScore = 0;
  for (const [index, paragraph] of paragraphs.entries()) {
    const value = score(paragraph, terms);
    if (value > bestScore) {
      best = index;
      bestScore = value;
    }
  }
  // One matching word out of several is usually a menu or footer, not an answer.
  if (best < 0 || bestScore < Math.min(terms.length, 2) * 10) return '';
  const chosen = [best];
  let length = paragraphs[best].length;
  for (const neighbour of [best + 1, best - 1, best + 2]) {
    const text = paragraphs[neighbour];
    if (!text || length + text.length + 1 > maximum) continue;
    chosen.push(neighbour);
    length += text.length + 1;
  }
  return chosen
    .sort((left, right) => left - right)
    .map((index) => paragraphs[index])
    .join('\n')
    .slice(0, maximum);
}

/** Page HTML in, the passage for this question out. */
export function passageFromPage(html, query, maximum = MAX_PASSAGE_CHARS) {
  return bestPassage(pageParagraphs(html), query, maximum);
}
