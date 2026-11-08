// SPDX-License-Identifier: GPL-3.0-only
import { callSetupDiagnosticState } from '../call-audio-setup.mjs';
const emptySpeech = () => ({
  requested: false,
  explicit: false,
  model: false,
  toCall: false,
  toOwner: false,
  started: false,
  audioGenerated: false,
  generationCompleted: false,
  playbackReported: false,
  playbackEnded: false,
  cancelled: false,
  failed: false,
  rejected: false,
});

/** One volatile, text-free receipt. Playback is a renderer report, not proof of audibility. */
export class CallAudioDiagnostics {
  #id = null;
  #active = false;
  #speech = emptySpeech();

  request(id, { explicit = false, model = false, toCall = false, toOwner = true } = {}) {
    this.#id = id;
    this.#active = true;
    this.#speech = {
      ...emptySpeech(),
      requested: true,
      explicit: explicit === true,
      model: model === true,
      toCall: toCall === true,
      toOwner: toOwner === true,
    };
  }

  start(id, { toCall, toOwner } = {}) {
    if (!this.#active || id !== this.#id) return;
    this.#speech.started = true;
    if (typeof toCall === 'boolean') this.#speech.toCall = toCall;
    if (typeof toOwner === 'boolean') this.#speech.toOwner = toOwner;
  }

  reject(id) {
    if (!this.#active || id !== this.#id) return;
    this.#speech.rejected = true;
    this.#active = false;
  }

  cancel(id) {
    if (!this.#active || id !== this.#id) return;
    this.#speech.cancelled = true;
    this.#active = false;
  }

  fail(id) {
    if (id !== this.#id || !this.#speech.requested) return;
    this.#speech.failed = true;
    this.#active = false;
  }

  observe(event) {
    if (!this.#active || event?.turnId !== this.#id) return;
    if (event.type === 'voice.call-started') {
      this.start(event.turnId, {
        toCall: event.route === 'owner-and-call',
        toOwner: true,
      });
    } else if (event.type === 'voice.audio') {
      this.#speech.started = true;
      this.#speech.audioGenerated = true;
    } else if (event.type === 'voice.generated') this.#speech.generationCompleted = true;
    else if (event.type === 'voice.cancelled') this.cancel(event.turnId);
  }

  playback(busy, id) {
    if (!this.#active || id !== this.#id || !this.#speech.audioGenerated) return;
    if (busy === true) this.#speech.playbackReported = true;
    else if (busy === false && this.#speech.playbackReported) {
      this.#speech.playbackEnded = true;
      this.#active = false;
    }
  }

  snapshot(state = {}) {
    return {
      supported: state.supported === true,
      outputReady: state.callOutputReady === true,
      mixingMic: state.mixingMic === true,
      allowModel: state.allowModel === true,
      shareReplies: state.shareReplies === true,
      voiceEnabled: state.voiceEnabled === true,
      setup: callSetupDiagnosticState(state.setup),
      lastSpeech: { ...this.#speech },
    };
  }
}
