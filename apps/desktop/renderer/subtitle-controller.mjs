// SPDX-License-Identifier: GPL-3.0-only
import {
  sentenceSubtitleCues,
  subtitleReadingMs,
  locateSubtitleSpeech,
  subtitleSpeechPlan,
  subtitleSpeechRanges,
} from './subtitles.mjs';

const empty = () => ({
  id: null,
  turnId: null,
  text: '',
  status: 'complete',
  cues: [],
  index: 0,
  paused: false,
  since: 0,
  followVoice: false,
  speechCursor: 0,
  speech: null,
  spokenPosition: null,
});

/** Owns subtitle pagination and its timers; the app only delivers messages/playback. */
export class SubtitleController {
  constructor({
    elements,
    ui,
    presence,
    getVoice,
    getVoiceSettings,
    onLayout,
    onCue = () => {},
    now = () => performance.now(),
  }) {
    Object.assign(this, {
      elements,
      ui,
      presence,
      getVoice,
      getVoiceSettings,
      onLayout,
      onCue,
      now,
    });
    this.state = empty();
    this.hidden = false;
    this.measure = document.createElement('canvas').getContext('2d');
    this.revision = 0;
  }
  fits(text) {
    const element = this.elements['subtitle-text'],
      style = getComputedStyle(element);
    this.measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const width = Math.max(1, element.clientWidth - 10),
      spacing = parseFloat(style.letterSpacing) || 0;
    let lines = 1,
      used = 0;
    for (const word of text.split(' ')) {
      const segment = (used ? ' ' : '') + word,
        advance = this.measure.measureText(segment).width + Array.from(segment).length * spacing;
      if (used + advance <= width) {
        used += advance;
        continue;
      }
      if (used) {
        lines++;
        used = 0;
      }
      for (const character of word) {
        const next = this.measure.measureText(character).width + spacing;
        if (used && used + next > width) {
          lines++;
          used = 0;
        }
        used += next;
      }
      if (lines > 3) return false;
    }
    return lines <= 3;
  }
  update(message, reset = false) {
    if (!message) {
      this.render();
      return;
    }
    if (reset || message.id !== this.state.id) {
      const voice = this.getVoice(),
        settings = this.getVoiceSettings();
      this.state = {
        ...empty(),
        id: message.id,
        turnId: message.turnId,
        status: message.status,
        since: this.now(),
        followVoice:
          settings.enabled && settings.language !== 'off' && voice.turnId === message.turnId,
      };
    }
    const state = this.state;
    if (!state.text && message.text) state.since = this.now();
    state.text = message.text;
    state.status = message.status;
    if (['interrupted', 'error'].includes(message.status)) state.paused = true;
    if (!this.hidden) this.paginate();
    this.render();
  }
  paginate() {
    const state = this.state;
    const limit = Math.max(
      48,
      Math.min(144, Math.floor(this.elements['subtitle-stage'].clientWidth / 10) * 3),
    );
    state.cues = sentenceSubtitleCues(
      state.text,
      limit,
      (text) => this.fits(text),
      state.status !== 'streaming' || !state.followVoice,
    );
    state.index = Math.min(state.index, Math.max(0, state.cues.length - 1));
  }
  setHidden(hidden) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    clearTimeout(this.timer);
    this.timer = null;
    this.revision++;
    if (hidden) return;
    // Reading time starts again on reveal. Speech position remains independent
    // and render() catches up to the current playback after one visible layout.
    this.state.since = this.now();
    if (this.state.id) this.paginate();
    this.render();
  }
  playback(event) {
    const state = this.state;
    if (!state.id || event.turnId !== state.turnId) return;
    if (event.type === 'started') {
      const range = locateSubtitleSpeech(state.text, event.text, state.speechCursor);
      Object.assign(state, {
        followVoice: true,
        speechCursor: range.end,
        speech: { ...event, ...range },
        spokenPosition: range.start,
      });
    } else if (event.type === 'ended' && state.speech?.sequence === event.sequence) {
      state.spokenPosition = Math.max(state.speech.start, state.speech.end - 0.001);
      state.speech = null;
    } else if (event.type === 'stopped')
      Object.assign(state, {
        followVoice: false,
        speech: null,
        spokenPosition: null,
        since: this.now(),
      });
    this.render();
  }
  schedule(delay, advance) {
    const revision = this.revision;
    this.timer = setTimeout(
      () => {
        if (revision !== this.revision) return;
        if (this.presence.expanded) this.presence.touch();
        advance?.();
        this.render();
      },
      Math.max(0, delay),
    );
  }
  render() {
    clearTimeout(this.timer);
    this.timer = null;
    this.revision++;
    if (this.hidden) {
      // Keep the detached reply's full-text snapshot current without measuring
      // hidden text or scheduling pagination against a zero-width frame.
      const cue = this.state.cues[this.state.index] || this.state.text.slice(0, 144).toWellFormed();
      this.onCue(cue, this.state.id);
      return;
    }
    const state = this.state,
      elements = this.elements,
      automatic = !state.paused && elements['history-panel'].hidden;
    let delay;
    if (automatic && state.followVoice) {
      if (state.speech) {
        for (const step of subtitleSpeechPlan(state.text, state.cues, state.speech)) {
          if (step.atMs <= this.getVoice().playbackElapsedMs) state.index = step.index;
          else {
            delay = step.atMs - this.getVoice().playbackElapsedMs;
            break;
          }
        }
      } else if (state.spokenPosition !== null) {
        const index = subtitleSpeechRanges(state.text, state.cues).findIndex(
          (range) => range.end > state.spokenPosition,
        );
        state.index = index < 0 ? Math.max(0, state.cues.length - 1) : index;
      }
    }
    const cue = state.cues[state.index] || '';
    elements.welcome.hidden = Boolean(state.id);
    elements['subtitle-text'].textContent = cue;
    this.onCue(cue, state.id);
    elements['subtitle-text'].dataset.index = String(state.index);
    const status =
      state.status === 'streaming'
        ? cue
          ? 'REPLYING'
          : 'THINKING…'
        : state.status === 'interrupted'
          ? 'STOPPED'
          : state.status === 'error'
            ? 'RESPONSE INCOMPLETE'
            : '';
    elements['subtitle-state'].textContent = this.ui.text(status);
    elements['subtitle-state'].hidden = !status;
    elements['subtitle-controls'].hidden = state.cues.length < 2;
    elements['subtitle-position'].textContent = `${state.index + 1} / ${state.cues.length}`;
    elements['subtitle-previous'].disabled = state.index === 0;
    elements['subtitle-next'].disabled = state.index >= state.cues.length - 1;
    if (automatic && state.followVoice && delay !== undefined) this.schedule(Math.max(12, delay));
    else if (automatic && !state.followVoice && state.index < state.cues.length - 1)
      this.schedule(state.since + subtitleReadingMs(cue) - this.now(), () => {
        state.index++;
        state.since = this.now();
      });
    this.onLayout();
  }
  step(direction) {
    this.presence.touch();
    this.state.index = Math.max(
      0,
      Math.min(this.state.cues.length - 1, this.state.index + direction),
    );
    this.state.paused = true;
    this.activity();
  }
  activity() {
    this.state.since = this.now();
    this.render();
  }
  dispose() {
    clearTimeout(this.timer);
    this.revision++;
  }
  clear() {
    this.dispose();
    this.state = empty();
    this.elements['subtitle-controls'].hidden = true;
    this.elements['subtitle-text'].textContent = '';
    this.onCue('');
  }
}
