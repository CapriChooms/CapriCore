import { findWakePhrase } from './wake-phrase.mjs';

/** Deliberate commands only; questions, quotations and negations stay ordinary conversation. */
export function isClipCommand(value) {
  if (typeof value !== 'string' || value.length > 200 || /["“”«»`]/u.test(value)) return false;
  const wake = findWakePhrase(value);
  if (wake && value.slice(0, wake.start).trim()) return false;
  const text = (wake?.body ?? value)
    .trim()
    .replace(/[.!?,;:]+$/u, '')
    .trim();
  return /^(?:please\s+)?(?:clip\s+(?:that|this|it)|(?:take|save)\s+(?:a\s+)?(?:screenshot|screen\s+shot))(?:\s+please)?$/i.test(
    text,
  );
}
