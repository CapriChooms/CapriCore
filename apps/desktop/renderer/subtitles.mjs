/** Presentation only: the original transcript and model context stay intact. */
export function subtitleCues(text, limit = 126, fits = () => true) {
  if (!Number.isInteger(limit) || limit < 24 || limit > 240)
    throw new Error('Invalid subtitle length');
  const characters = Array.from(String(text).replace(/\s+/gu, ' ').trim());
  const cues = [];
  let start = 0;
  while (start < characters.length) {
    let end = Math.min(start + limit, characters.length);
    if (!fits(characters.slice(start, end).join(''))) {
      let low = start + 1,
        high = end;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(characters.slice(start, middle).join(''))) low = middle;
        else high = middle - 1;
      }
      end = low;
    }
    if (end < characters.length) {
      let space = -1,
        sentence = -1;
      for (let index = start; index < end; index++) {
        if (characters[index] !== ' ') continue;
        space = index;
        if (/[.!?…]/u.test(characters[index - 1] ?? '') && index - start >= limit * 0.5)
          sentence = index;
      }
      if (sentence > start) end = sentence;
      else if (space > start) end = space;
    }
    const cue = characters.slice(start, end).join('').trim();
    if (cue) cues.push(cue);
    start = end;
    while (characters[start] === ' ') start++;
  }
  return cues;
}

export function subtitleReadingMs(text) {
  return Math.max(3600, Math.min(11000, 2200 + Array.from(text).length * 48));
}
import { findSentenceEnd, spokenText } from './speech-text.mjs';

/** Pack complete sentences using the actual caption width before splitting one. */
export function sentenceSubtitleCues(
  text,
  limit = 126,
  fits = (value) => Array.from(value).length <= limit,
  final = true,
) {
  if (!Number.isInteger(limit) || limit < 24 || limit > 240)
    throw new Error('Invalid subtitle length');
  let rest = String(text).replace(/\s+/gu, ' ').trim(),
    page = '',
    separator = '';
  const cues = [];
  let complete = false;
  const flush = () => {
    if (page) cues.push(page);
    page = '';
  };
  while (rest) {
    const end = findSentenceEnd(rest, final);
    // While speaking, don't reflow a completed page for an unfinished next thought.
    if (end === undefined && !final && complete) break;
    const sentence = rest.slice(0, end ?? rest.length).trim();
    const tail = end === undefined ? '' : rest.slice(end);
    const nextSeparator = /^\s/u.test(tail) ? ' ' : '';
    rest = tail.trimStart();
    complete ||= end !== undefined;
    const combined = page ? page + separator + sentence : sentence;
    if (fits(combined)) page = combined;
    else {
      flush();
      if (fits(sentence)) page = sentence;
      else {
        const fragments = subtitleCues(sentence, limit, fits);
        cues.push(...fragments.slice(0, -1));
        page = fragments.at(-1) ?? '';
      }
    }
    separator = nextSeparator;
  }
  flush();
  return cues;
}

/** Locate a spoken sentence in the shared display text, including repeated lines. */
export function locateSubtitleSpeech(text, sentence, cursor = 0) {
  const clean = spokenText(text),
    phrase = spokenText(sentence);
  const found = clean.indexOf(phrase, cursor),
    start = found >= 0 ? found : Math.min(cursor, clean.length);
  return { start, end: Math.min(clean.length, start + phrase.length) };
}

export function subtitleSpeechRanges(text, cues) {
  const clean = spokenText(text);
  let cursor = 0;
  return cues.map((cue) => {
    const phrase = spokenText(cue),
      found = phrase ? clean.indexOf(phrase, cursor) : -1;
    const start = found >= 0 ? found : cursor,
      end = found >= 0 ? start + phrase.length : start;
    cursor = end;
    return { start, end };
  });
}

/** Sentence starts use real playback; splits within one sentence use PCM duration. */
export function subtitleSpeechPlan(text, cues, { start, end, durationMs }) {
  const ranges = subtitleSpeechRanges(text, cues),
    length = Math.max(1, end - start);
  let index = ranges.findIndex((range) => range.end > start);
  if (index < 0) index = Math.max(0, cues.length - 1);
  const steps = [{ index, atMs: 0 }];
  for (let i = index + 1; i < ranges.length; i++) {
    if (ranges[i].start >= end) break;
    if (ranges[i].end > start)
      steps.push({
        index: i,
        atMs: Math.max(0, ((ranges[i].start - start) / length) * durationMs),
      });
  }
  return steps;
}
