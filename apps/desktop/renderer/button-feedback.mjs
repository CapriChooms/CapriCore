// SPDX-License-Identifier: GPL-3.0-only
/** A brief visual acknowledgement of input, independent from operation success. */
export class ButtonFeedback {
  constructor() {
    this.enabled = true;
    this.animations = new Map();
    this.onClick = (event) => {
      const button = event.target.closest?.('button');
      if (!event.isTrusted || !button) return;
      // The preview follows the checkbox draft without saving unrelated settings.
      const preview = document.getElementById(button.dataset.feedbackSetting);
      this.press(button, preview?.type === 'checkbox' ? preview.checked : this.enabled);
    };
    this.onVisibility = () => {
      if (document.hidden) this.clear();
    };
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('visibilitychange', this.onVisibility);
  }
  press(button, enabled = this.enabled) {
    if (
      !enabled ||
      !button.isConnected ||
      button.disabled ||
      button.getAttribute('aria-disabled') === 'true'
    )
      return;
    this.animations.get(button)?.cancel();
    const style = getComputedStyle(button);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Animate only paint: no layout shifts, extra outline, sound or global glitch.
    // Sampling each button's ink preserves pink support and red destructive actions.
    const lit = {
      backgroundColor: `color-mix(in srgb, ${style.color} 38%, ${style.backgroundColor})`,
      boxShadow: `inset 0 0 0 1px ${style.color}, inset 0 0 18px color-mix(in srgb, ${style.color} 28%, transparent)`,
    };
    const base = { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow };
    const animation = button.animate(
      reduced
        ? [lit, lit]
        : [
            { ...lit, offset: 0 },
            { ...lit, offset: 0.18 },
            { ...base, offset: 1 },
          ],
      { duration: reduced ? 220 : 520, easing: 'ease-out' },
    );
    animation.id = 'capri-button-feedback';
    this.animations.set(button, animation);
    button.classList.add('button-acknowledged');
    const finish = () => {
      if (this.animations.get(button) !== animation) return;
      this.animations.delete(button);
      button.classList.remove('button-acknowledged');
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }
  clear() {
    for (const [button, animation] of this.animations) {
      animation.cancel();
      button.classList.remove('button-acknowledged');
    }
    this.animations.clear();
  }
  configure(value) {
    this.enabled = value !== false;
    if (!this.enabled) this.clear();
  }
  destroy() {
    this.clear();
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
