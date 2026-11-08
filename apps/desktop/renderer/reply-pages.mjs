// SPDX-License-Identifier: GPL-3.0-only
import { sentenceSubtitleCues } from './subtitles.mjs';

const maximumReplies = 30;
const maximumReply = 16000;
const maximumHistory = 64000;
const maximumCue = 512;
const defaultFits = (value) => Array.from(value).length <= 240;
const field = (value, key) =>
  value && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
const messageId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  !/[\x00-\x1f\x7f]/u.test(value)
    ? value
    : null;

function boundedText(value, maximum) {
  if (typeof value !== 'string') return '';
  let result = value.slice(0, maximum);
  if (/[\uD800-\uDBFF]$/u.test(result)) result = result.slice(0, -1);
  return result
    .toWellFormed()
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, '')
    .trim();
}
const normalized = (value) => value.replace(/\s+/gu, ' ').trim();

/** Recent assistant text only. Never forward the transcript's user data or metadata. */
export function replyHistory(messages) {
  if (!Array.isArray(messages)) return [];
  const replies = [],
    seen = new Set();
  let remaining = maximumHistory;
  for (
    let index = messages.length - 1;
    index >= 0 && remaining && replies.length < maximumReplies;
    index--
  ) {
    const message = Object.getOwnPropertyDescriptor(messages, String(index))?.value;
    if (field(message, 'role') !== 'assistant') continue;
    const id = messageId(field(message, 'id'));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const text = boundedText(field(message, 'text'), Math.min(maximumReply, remaining));
    if (!text) continue;
    replies.push({ id, text });
    remaining -= text.length;
  }
  return replies.reverse();
}

function compactHistory(history) {
  if (!Array.isArray(history)) return [];
  return replyHistory(
    history.map((record) => {
      const role = field(record, 'role');
      if (role !== undefined && role !== 'assistant') return null;
      if (record && Object.hasOwn(record, 'role') && role === undefined) return null;
      return { role: 'assistant', id: field(record, 'id'), text: field(record, 'text') };
    }),
  );
}

/** A presentation-only pager. The live cue remains owned by speech/subtitle timing. */
export class ReplyPages {
  constructor() {
    this.fits = defaultFits;
    this.layoutKey = undefined;
    this.cache = new Map();
    this.records = [];
    this.pages = [];
    this.turnId = null;
    this.cue = '';
    this.selection = null;
    this.liveIndex = 0;
    this.liveOffset = 0;
    this.previousCue = '';
    this.measuredCue = null;
    this.cueFits = true;
  }

  update(value = {}, fits = this.fits, layoutKey = this.layoutKey) {
    const cue = boundedText(field(value, 'text'), maximumCue);
    const id = messageId(field(value, 'turnId')) || (cue ? '__capri-live__' : null);
    if (typeof fits === 'function' && (fits !== this.fits || layoutKey !== this.layoutKey)) {
      this.fits = fits;
      this.layoutKey = layoutKey;
      this.cache.clear();
      this.measuredCue = null;
    }
    if (!id && !cue) {
      this.records = [];
      this.pages = [];
      this.cache.clear();
      this.turnId = null;
      this.cue = '';
      this.selection = null;
      this.previousCue = '';
      this.liveOffset = 0;
      this.liveIndex = 0;
      return this.view();
    }
    if (id !== this.turnId) {
      this.selection = null;
      this.liveOffset = 0;
      this.previousCue = '';
    }
    this.turnId = id;
    this.cue = cue;
    const history = field(value, 'history');
    if (Array.isArray(history) && (history.length || cue)) {
      this.records = compactHistory(history);
      if (cue && !this.records.some((record) => record.id === id))
        this.records = compactHistory([...this.records, { id, text: cue }]);
    } else if (cue) {
      // Fixtures without a transcript replace this record; streaming cues are
      // never appended as separate historical replies.
      this.records = [{ id, text: cue }];
    }
    this.rebuild();
    return this.view();
  }

  rebuild() {
    const present = new Set(this.records.map((record) => record.id));
    for (const id of this.cache.keys()) if (!present.has(id)) this.cache.delete(id);
    this.pages = this.records.flatMap((record) => {
      let cached = this.cache.get(record.id);
      if (!cached || cached.text !== record.text) {
        const text = normalized(record.text);
        let cursor = 0;
        const pages = sentenceSubtitleCues(
          text,
          240,
          (candidate) => Array.from(candidate).length <= 240 && this.fits(candidate),
        ).map((page, index) => {
          const found = text.indexOf(page, cursor);
          const start = found >= 0 ? found : cursor;
          cursor = start + page.length;
          return { id: record.id, page: index, text: page, start, end: cursor };
        });
        cached = { text: record.text, normalized: text, pages };
        this.cache.set(record.id, cached);
      }
      return cached.pages;
    });
    const current = this.cache.get(this.turnId);
    if (current?.pages.length) {
      const cue = normalized(this.cue);
      let offset = -1;
      if (cue) {
        offset = current.normalized.indexOf(cue, this.liveOffset);
        if (offset < 0) offset = current.normalized.indexOf(cue);
      }
      if (offset >= 0) this.liveOffset = offset;
      else if (cue && cue !== this.previousCue) this.liveOffset = current.pages.at(-1).start;
      this.liveIndex = this.findPage(this.turnId, this.liveOffset);
    } else this.liveIndex = Math.max(0, this.pages.length - 1);
    if (this.cue) this.previousCue = this.cue;
    if (this.measuredCue !== this.cue) {
      this.cueFits = Boolean(this.fits(this.cue));
      this.measuredCue = this.cue;
    }
    if (this.selection && !present.has(this.selection.id)) this.selection = null;
  }

  findPage(id, offset) {
    let nearest = -1;
    for (let index = 0; index < this.pages.length; index++) {
      const page = this.pages[index];
      if (page.id !== id) continue;
      if (nearest < 0 || page.start <= offset) nearest = index;
      if (offset < page.end) break;
    }
    return nearest >= 0 ? nearest : this.liveIndex;
  }

  refresh(fits = this.fits) {
    if (typeof fits === 'function') this.fits = fits;
    this.cache.clear();
    this.measuredCue = null;
    this.rebuild();
    return this.view();
  }

  step(direction) {
    if (![-1, 1].includes(direction) || !this.cue || !this.pages.length) return this.view();
    const current = this.selection
      ? this.findPage(this.selection.id, this.selection.offset)
      : this.liveIndex;
    const index = Math.max(0, Math.min(this.pages.length - 1, current + direction));
    if (index !== current) {
      const page = this.pages[index];
      this.selection = { id: page.id, offset: page.start };
    }
    return this.view();
  }

  view() {
    if (!this.cue || !this.pages.length)
      return { text: '', index: 0, total: 0, previous: false, next: false };
    const index = this.selection
      ? this.findPage(this.selection.id, this.selection.offset)
      : this.liveIndex;
    return {
      text: this.selection || !this.cueFits ? this.pages[index].text : this.cue,
      index,
      total: this.pages.length,
      previous: index > 0,
      next: index + 1 < this.pages.length,
    };
  }
}
