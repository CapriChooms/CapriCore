// SPDX-License-Identifier: GPL-3.0-only
/** A single timer for the latest reply. Generation and audible completion are separate. */
export class ReplyVisibility {
  constructor({
    onChange,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    Object.assign(this, { onChange, setTimer, clearTimer });
    this.enabled = true;
    this.delayMs = 8000;
    this.holds = new Set();
  }
  cancelTimer() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }
  configure(value = {}) {
    this.enabled = value.replyAutoHide !== false;
    this.delayMs = Math.max(2, Math.min(60, value.replyAutoHideSeconds ?? 8)) * 1000;
    if (!this.enabled && !this.manual) this.setHidden(false);
    this.arm();
  }
  update(message, speechExpected = false) {
    const id = message?.turnId ?? message?.id;
    if (!id || typeof message.text !== 'string') return;
    if (this.current?.id !== id) {
      this.cancelTimer();
      this.current = {
        id,
        text: '',
        complete: false,
        generated: false,
        playing: false,
        speechExpected,
        protected: false,
      };
      this.manual = false;
      this.hidden = false;
      this.onChange({ hidden: false, turnId: id });
    }
    const current = this.current;
    const changed =
      current.text !== message.text || current.complete !== (message.status === 'complete');
    current.text = message.text;
    current.complete = message.status === 'complete';
    if (['error', 'cancelled', 'incomplete'].includes(message.status)) current.protected = true;
    if (changed) this.arm();
  }
  generated(id) {
    if (id !== this.current?.id) return;
    this.current.generated = true;
    this.arm();
  }
  expectSpeech(id) {
    if (id !== this.current?.id) return;
    this.current.speechExpected = true;
    if (!this.manual) this.setHidden(false);
    this.arm();
  }
  playback(id, busy) {
    if (!this.current || (id && id !== this.current.id)) return;
    if (this.current.playing === busy) return;
    this.current.playing = busy;
    this.arm();
  }
  protect(id) {
    if (!this.current || (id && id !== this.current.id)) return;
    this.current.protected = true;
    this.cancelTimer();
    if (!this.manual) this.setHidden(false);
  }
  hold(reason, active) {
    if (this.holds.has(reason) === active) return;
    if (active) this.holds.add(reason);
    else this.holds.delete(reason);
    this.arm();
  }
  reveal() {
    this.manual = true;
    this.cancelTimer();
    this.setHidden(false);
  }
  hide() {
    this.manual = true;
    this.cancelTimer();
    this.setHidden(true);
  }
  setHidden(hidden) {
    if (this.hidden === hidden || !this.current) return;
    this.hidden = hidden;
    this.onChange({ hidden, turnId: this.current.id });
  }
  arm() {
    this.cancelTimer();
    const current = this.current;
    if (
      !this.enabled ||
      !current?.complete ||
      !current.text.trim() ||
      current.protected ||
      current.playing ||
      (current.speechExpected && !current.generated) ||
      this.holds.size ||
      this.manual ||
      this.hidden
    )
      return;
    const id = current.id;
    // Long text-only replies receive bounded extra reading time.
    const delay = current.speechExpected
      ? this.delayMs
      : Math.max(this.delayMs, Math.min(30000, current.text.length * 30));
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (this.current?.id === id) this.setHidden(true);
    }, delay);
    this.timer?.unref?.();
  }
  dispose() {
    this.cancelTimer();
    this.current = null;
    this.holds.clear();
  }
}
