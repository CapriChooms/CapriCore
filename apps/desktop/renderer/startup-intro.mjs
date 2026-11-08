// SPDX-License-Identifier: GPL-3.0-only
import { drawStartupIntro } from './startup-intro-motion.mjs';

/** One local presentation, driven by the existing render loop. No model, audio or network. */
export class StartupIntro {
  constructor({
    canvas,
    api,
    eligible,
    readyImage = () => null,
    interrupted = () => false,
    onChange = () => {},
  }) {
    Object.assign(this, { canvas, api, eligible, readyImage, interrupted, onChange });
    this.context = canvas.getContext('2d', { alpha: true });
    this.images = [];
    this.pending = true;
    this.active = false;
    this.terminal = false;
    this.generation = 0;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.onInput = () => this.cancel();
    this.onVisibility = () => {
      if (document.hidden && this.active) this.cancel();
    };
    this.onMotion = () => {
      if (this.motion.matches) this.cancel();
    };
    document.addEventListener('pointerdown', this.onInput, true);
    document.addEventListener('keydown', this.onInput, true);
    document.addEventListener('wheel', this.onInput, { capture: true, passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motion.addEventListener('change', this.onMotion);
  }
  get texture() {
    return this.active ? this.canvas : null;
  }
  configure(config) {
    if (this.terminal) return;
    this.config = config;
    if (!config || !this.context || this.motion.matches) return this.cancel();
    this.run().catch(() => this.cancel());
  }
  async wait() {
    await new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(resolve, 120);
    });
    this.wake = null;
    this.timer = null;
  }
  alive(generation) {
    return !this.terminal && generation === this.generation;
  }
  async waitForPortrait(generation) {
    while (this.alive(generation) && (document.hidden || !this.eligible())) {
      if (this.interrupted()) {
        this.cancel();
        return false;
      }
      await this.wait();
    }
    return this.alive(generation);
  }
  async run() {
    const generation = ++this.generation;
    if (!(await this.waitForPortrait(generation))) return;
    const images = this.config.frames.map(({ url }) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      return image;
    });
    this.images = images;
    let timeout;
    try {
      await Promise.race([
        Promise.all(images.map((image) => image.decode())),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Intro artwork unavailable')), 2200);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    if (!this.alive(generation)) return;
    if (
      images.length !== 7 ||
      images.some((image) => image.naturalWidth !== 1254 || image.naturalHeight !== 1254)
    )
      return this.cancel();
    while (await this.waitForPortrait(generation)) {
      const result = await this.api.startupIntro('play');
      if (!this.alive(generation)) return;
      if (result === 'wait') {
        await this.wait();
        continue;
      }
      if (result !== 'play' || document.hidden || !this.eligible() || this.interrupted())
        return this.cancel(false);
      this.pending = false;
      this.active = true;
      // Match the already decoded, restored expression underneath the intro.
      // Keep ownership separate: this image belongs to the normal avatar layer.
      this.drawings = this.images.slice();
      const ready = this.readyImage();
      if (
        (ready?.naturalWidth || ready?.width) === 1254 &&
        (ready?.naturalHeight || ready?.height) === 1254
      )
        this.drawings[6] = ready;
      // Start the exposure sheet on the first actual compositor tick, after
      // window restoration/GPU warm-up, so the short signal pose is not skipped.
      this.startedAt = null;
      this.canvas.hidden = false;
      this.draw(0);
      document.body.dataset.startupIntro = 'playing';
      this.onChange();
      return;
    }
  }
  draw(time) {
    // Upload at most a 768-square texture, even on high-DPI and oversized portraits.
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.min(
      768,
      Math.max(256, Math.ceil(rect.width * Math.min(devicePixelRatio || 1, 1.5))),
    );
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size;
    const result = drawStartupIntro(this.context, {
      time,
      width: size,
      height: size,
      images: this.drawings,
      seed: 0x43415052,
      durationMs: this.config.durationMs,
    });
    this.canvas.avatarTextureRevision = (this.canvas.avatarTextureRevision || 0) + 1;
    this.canvas.avatarIntroTime = time;
    this.canvas.dataset.phase = result.phase;
    this.canvas.dataset.frame = String(result.index);
    return result;
  }
  tick(now) {
    if (!this.active) return;
    if (document.hidden || !this.eligible() || this.interrupted() || this.motion.matches)
      return this.cancel(false);
    this.startedAt ??= now;
    const time = Math.max(0, now - this.startedAt);
    this.draw(Math.min(time, this.config.durationMs));
    if (time >= this.config.durationMs) this.finish('completed');
  }
  cancel(claim = true) {
    if (this.terminal) return;
    if (claim) void this.api.startupIntro('skip').catch(() => {});
    this.finish('skipped');
  }
  finish(result) {
    if (this.terminal) return;
    this.generation++;
    this.pending = this.active = false;
    this.terminal = true;
    clearTimeout(this.timer);
    this.wake?.();
    this.wake = null;
    this.canvas.hidden = true;
    this.canvas.width = this.canvas.height = 1;
    for (const image of this.images) image.src = '';
    this.images = [];
    this.drawings = [];
    document.body.dataset.startupIntro = result;
    this.onChange();
    this.disposeListeners();
  }
  disposeListeners() {
    document.removeEventListener('pointerdown', this.onInput, true);
    document.removeEventListener('keydown', this.onInput, true);
    document.removeEventListener('wheel', this.onInput, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motion.removeEventListener('change', this.onMotion);
  }
  destroy() {
    this.cancel(false);
    this.disposeListeners();
  }
}
