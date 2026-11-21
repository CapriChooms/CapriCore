// SPDX-License-Identifier: GPL-3.0-only
import { interfaceLocale, uiText } from '../interface-translations.mjs';
import { silentChessTrace } from './diagnostics.mjs';
import { reactionCandidates, reactionLabels } from './reaction-copy.mjs';

const maximumWait = 3000;

export class ChessReactions {
  constructor({
    preferences,
    allowed,
    language = () => 'en',
    style = () => 'neutral',
    deliver,
    trace = silentChessTrace,
    now = Date.now,
    random = Math.random,
  }) {
    Object.assign(this, { preferences, allowed, language, style, deliver, trace, now, random });
    this.pending = [];
    this.usedLines = new Set();
    this.recentAsides = [];
  }

  get active() {
    return this.pending.length > 0;
  }

  submit(moves, signal) {
    if (signal?.aborted) return;
    const { enabled, events: selected } = this.preferences();
    if (!enabled) return;
    for (const move of moves) {
      if (move.events.some(({ type }) => type === 'start'))
        this.usedLines = new Set([...this.usedLines].slice(-24));
      const relevant = move.events.filter(
        ({ type }) => Object.hasOwn(reactionLabels, type) && selected[type],
      );
      if (!relevant.length) continue;
      const traces = relevant.map(({ type }) => this.trace('reaction', { reactionEvent: type }));
      this.pending.push({
        move: { ...move, events: relevant },
        signal,
        traces,
        expiresAt: this.now() + maximumWait,
      });
    }
    this.drain();
  }

  drain() {
    clearTimeout(this.timer);
    const { enabled, spoken } = this.preferences();
    const now = this.now();
    this.pending = this.pending.filter(({ signal, traces, expiresAt }) => {
      if (enabled && !signal?.aborted && expiresAt > now) return true;
      for (const trace of traces) trace('cancelled', { reason: 'reaction_expired' });
      return false;
    });
    if (!this.pending.length) return;
    if (!this.allowed()) {
      this.timer = setTimeout(() => this.drain(), 80);
      this.timer.unref?.();
      return;
    }
    const pending = this.pending.splice(0);
    const language = interfaceLocale(this.language()).id;
    const style = this.style();
    const lines = [];
    for (const { move, traces } of pending) {
      const line = this.nextLine(move, language, style);
      if (line) lines.push(line);
      for (const trace of traces)
        trace('completed', { reason: line ? 'reaction_delivered' : 'reaction_duplicate' });
    }
    if (lines.length) this.deliver(lines.join(' '), spoken);
  }

  nextLine(move, language, style) {
    const candidates = reactionCandidates(move, language, style);
    let fresh = candidates.filter(({ text }) => !this.usedLines.has(text));
    if (!fresh.length && Number.isSafeInteger(move.moveNumber)) {
      const number = new Intl.NumberFormat(language, { useGrouping: false }).format(
        move.moveNumber,
      );
      const introduction = uiText('Move', language) + ' ' + number + '.';
      fresh = candidates
        .map((line) => ({ ...line, text: introduction + ' ' + line.text }))
        .filter(({ text }) => !this.usedLines.has(text));
    }
    if (!fresh.length) return null;
    const withFreshAside = fresh.filter(({ aside }) => aside && !this.recentAsides.includes(aside));
    const factual = fresh.filter(({ aside }) => !aside);
    const choices = withFreshAside.length ? withFreshAside : factual.length ? factual : fresh;
    const { text, aside } = choices[Math.floor(this.random() * choices.length)];
    this.usedLines.add(text);
    this.recentAsides = [...this.recentAsides.slice(-3), aside];
    return text;
  }

  cancel() {
    clearTimeout(this.timer);
    this.pending = [];
  }
}
