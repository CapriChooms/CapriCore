// SPDX-License-Identifier: GPL-3.0-only
const waveAsset = 'capri://desktop/capri-wave.webp';
const canvasSize = 627;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class AvatarWave {
  constructor(parent, { canPlay, onChange = () => {} }) {
    Object.assign(this, { parent, canPlay, onChange });
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'avatar-wave';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.width = this.canvas.height = 1;
    this.canvas.hidden = true;
    parent.append(this.canvas);
    const stopIfHidden = () => {
      if (document.hidden || this.motion.matches) this.stop();
    };
    document.addEventListener('visibilitychange', stopIfHidden);
    this.motion.addEventListener('change', stopIfHidden);
  }

  get image() {
    return this.canvas.hidden ? null : this.canvas;
  }

  available() {
    return !this.motion.matches && !document.hidden && this.canPlay();
  }

  stop() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.controller.abort();
    run.decoder?.close();
    if (!this.image) return;
    this.canvas.hidden = true;
    this.canvas.width = this.canvas.height = 1;
    delete this.parent.dataset.avatarWaving;
    this.onChange();
  }

  async play() {
    if (this.run || !this.available() || !globalThis.ImageDecoder) return false;
    const run = (this.run = { controller: new AbortController() });
    const current = () => this.run === run && this.available();
    try {
      const response = await fetch(waveAsset, { signal: run.controller.signal });
      if (!response.ok) throw new Error('Wave artwork unavailable');
      const data = await response.arrayBuffer();
      if (!current()) return false;
      const decoder = (run.decoder = new ImageDecoder({
        type: 'image/webp',
        data,
        preferAnimation: true,
      }));
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack?.frameCount;
      if (!count) return false;
      const context = this.canvas.getContext('2d');
      this.canvas.width = this.canvas.height = canvasSize;
      let started, end;
      for (let frameIndex = 0; frameIndex < count && current(); frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        try {
          const timestamp = image.timestamp / 1000;
          started ??= performance.now();
          end = started + timestamp + image.duration / 1000;
          const delay = started + timestamp - performance.now();
          if (delay > 0) await wait(delay);
          if (!current()) return false;
          // After a slow decode, skip frames whose full display interval has already elapsed.
          if (performance.now() >= end) continue;
          context.clearRect(0, 0, this.canvas.width, this.canvas.height);
          context.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
          this.canvas.avatarTextureRevision = frameIndex;
          if (this.canvas.hidden) {
            this.canvas.hidden = false;
            this.parent.dataset.avatarWaving = 'true';
            this.onChange();
          }
        } finally {
          image.close();
        }
      }
      if (current() && end > performance.now()) await wait(end - performance.now());
      return current();
    } catch (error) {
      if (!run.controller.signal.aborted) console.warn('Capri wave could not play:', error);
      return false;
    } finally {
      if (this.run === run) this.stop();
    }
  }
}
