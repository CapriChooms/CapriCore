/** Attention gate over accurate Parakeet results; no inference or recordings here. */
const greetings = new Set(['hey', 'hay', 'hi', 'эй', 'хей', 'хэй', 'эи', 'хеи', 'хэи']);
const weakGreetings = new Set(['a', 'ay', 'eh', 'he', 'okay', 'ok']);
const tokens = (text) =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)].slice(0, 256).map((match) => ({
    word: match[0].normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));

function phonetic(word) {
  const cyrillic = {
    к: 'k',
    а: 'a',
    э: 'a',
    е: 'e',
    п: 'p',
    р: 'r',
    и: 'i',
    й: 'i',
    ы: 'i',
    ф: 'f',
  };
  return [...word]
    .map((character) => cyrillic[character] ?? character)
    .join('')
    .replace(/ce$/g, 's')
    .replace(/ee|ie|ea/g, 'i')
    .replace(/y$/g, 'i')
    .replace(/[cq]/g, 'k')
    .replace(/[bf]/g, 'p')
    .replace(/([a-z])\1+/g, '$1');
}

// Bounded Damerau distance: the candidate is at most ten letters long.
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}

function nameMatch(word, relaxed = false) {
  const sound = phonetic(word);
  if (
    sound.length < 3 ||
    sound.length > 9 ||
    !sound.startsWith('k') ||
    !sound.slice(0, 4).includes('p')
  )
    return null;
  const edits = distance(sound, 'kapri');
  return edits <= (relaxed ? 2 : 1) ? { exact: edits === 0 } : null;
}

export function findWakePhrase(text, relaxed = false) {
  const parts = tokens(text);
  // A bare name must start the address, rather than be mentioned in background speech.
  // Stay strict when stripping corrected transcripts: "copy" is a command, not a name.
  for (const count of [1, 2]) {
    if (!parts[count - 1]) continue;
    const match = nameMatch(
      parts
        .slice(0, count)
        .map((part) => part.word)
        .join(''),
    );
    if (match) {
      const end = parts[count - 1].end;
      return {
        start: parts[0].start,
        end,
        exact: match.exact,
        body: text.slice(end).replace(/^[\s,.!?;:—–-]+/u, ''),
      };
    }
  }
  for (let i = 0; i < parts.length; i++) {
    let greeting = parts[i].word,
      compound;
    for (const prefix of ['hey', 'hay', 'эй', 'эи'])
      if (greeting.startsWith(prefix) && greeting.length > prefix.length)
        compound = nameMatch(greeting.slice(prefix.length), relaxed);
    if (compound)
      return {
        start: parts[i].start,
        end: parts[i].end,
        exact: compound.exact,
        body: text.slice(parts[i].end).replace(/^[\s,.!?;:—–-]+/u, ''),
      };
    if (!greetings.has(greeting) && !weakGreetings.has(greeting)) continue;
    for (const count of [1, 2]) {
      if (!parts[i + count]) continue;
      const match = nameMatch(
        parts
          .slice(i + 1, i + count + 1)
          .map((part) => part.word)
          .join(''),
        relaxed,
      );
      if (!match || (weakGreetings.has(greeting) && !match.exact && !relaxed)) continue;
      const end = parts[i + count].end;
      return {
        start: parts[i].start,
        end,
        exact: match.exact && greetings.has(greeting),
        body: text.slice(end).replace(/^[\s,.!?;:—–-]+/u, ''),
      };
    }
  }
  return null;
}

function stripActivatedPrefix(text) {
  const match = findWakePhrase(text, true);
  if (match) return match.body;
  const parts = tokens(text);
  // The full-utterance recognition can omit the greeting but keep the name.
  for (const count of [1, 2])
    if (
      parts[count - 1] &&
      nameMatch(
        parts
          .slice(0, count)
          .map((part) => part.word)
          .join(''),
      )
    )
      return text.slice(parts[count - 1].end).replace(/^[\s,.!?;:—–-]+/u, '');
  return text;
}

export class WakePhraseGate {
  constructor(
    { enabled = false, commandWindowMs = 10000, ambiguityHoldMs = 120 } = {},
    { onWake = () => {}, onReady = () => {}, onSleep = () => {} } = {},
  ) {
    if (
      typeof enabled !== 'boolean' ||
      !Number.isInteger(commandWindowMs) ||
      commandWindowMs < 3000 ||
      commandWindowMs > 30000 ||
      !Number.isInteger(ambiguityHoldMs) ||
      ambiguityHoldMs < 0 ||
      ambiguityHoldMs > 500
    )
      throw new Error('Invalid wake phrase settings');
    Object.assign(this, { enabled, commandWindowMs, ambiguityHoldMs, onWake, onReady, onSleep });
    this.state = enabled ? 'waiting' : 'disabled';
    this.floor = 0;
    this.lastUtterance = -1;
  }
  snapshot() {
    return { wakeState: this.state, wakePhrase: this.enabled ? 'Capri / Hey, Capri' : null };
  }
  cancelCandidate() {
    clearTimeout(this.candidateTimer);
    this.candidateTimer = null;
    this.candidate = null;
  }
  armTimeout(refining = false, processingBudgetMs = 20000) {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(
      () => this.rearm(this.lastUtterance, 'timeout'),
      refining
        ? Math.max(this.commandWindowMs, Math.min(90000, Math.max(20000, processingBudgetMs)))
        : this.commandWindowMs,
    );
    this.expiryTimer.unref?.();
  }
  activate(event, delayed = false) {
    this.cancelCandidate();
    this.state = 'command';
    this.wakeUtterance = event.utterance;
    this.lastUtterance = event.utterance;
    this.armTimeout();
    const match = findWakePhrase(event.text);
    const boundary = event.boundaries?.find(
      (word) => word.start < match?.end && word.end >= match.end,
    );
    this.onWake({ ...event, ...(boundary ? { wakeEndSample: boundary.endSample } : {}) });
    if (delayed) this.onReady(event);
  }
  observe(event) {
    if (!this.enabled) return { accepted: true, text: event.text.trim() };
    if (event.utterance < this.floor) return { accepted: false };
    if (this.state === 'waiting') {
      const match = findWakePhrase(event.text);
      if (!match) {
        this.cancelCandidate();
        return { accepted: false };
      }
      if (match.exact || event.final || !this.ambiguityHoldMs) this.activate(event);
      else {
        if (this.candidate?.utterance !== event.utterance) {
          this.cancelCandidate();
          this.candidate = event;
          this.candidateTimer = setTimeout(() => {
            if (this.candidate) this.activate(this.candidate, true);
          }, this.ambiguityHoldMs);
          this.candidateTimer.unref?.();
        } else this.candidate = event;
        return { accepted: false, pending: true };
      }
    }
    this.lastUtterance = Math.max(this.lastUtterance, event.utterance);
    // Only the utterance that opened the gate contains an activation prefix.
    // Manual/follow-up listening and later utterances already have attention:
    // names in them are ordinary speech, never a new wake or a text boundary.
    const text = event.prefixRemoved
      ? event.text
      : event.utterance === this.wakeUtterance
        ? stripActivatedPrefix(event.text)
        : event.text;
    if (text.trim()) this.armTimeout(Boolean(event.refining));
    return { accepted: true, text: text.trim() };
  }
  rearm(utterance = this.lastUtterance, reason = 'submitted') {
    if (!this.enabled) return;
    this.cancelCandidate();
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.floor = Math.max(this.floor, utterance + 1);
    this.state = 'waiting';
    this.onSleep(reason);
  }
  continueListening(milliseconds = 12000) {
    if (!this.enabled || this.state !== 'waiting') return false;
    this.cancelCandidate();
    this.state = 'command';
    this.wakeUtterance = -1;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(
      () => this.rearm(this.lastUtterance, 'timeout'),
      Math.max(5000, Math.min(30000, milliseconds)),
    );
    this.expiryTimer.unref?.();
    return true;
  }
  close() {
    this.cancelCandidate();
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
}
