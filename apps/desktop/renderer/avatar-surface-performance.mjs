// SPDX-License-Identifier: GPL-3.0-only
import { prepareRegisteredCel } from './hanging-cels.mjs';
import {
  createScreenInteractionRenderer,
  getScreenInteraction,
  sampleScreenInteraction,
} from './screen-interaction-motion.mjs';

export class AvatarSurfacePerformance {
  constructor(stage, { canPlay, onChange }) {
    Object.assign(this, { stage, canPlay, onChange });
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'avatar-surface-performance';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    stage.append(this.canvas);
  }

  get active() {
    return Boolean(this.run);
  }

  stop() {
    if (!this.run) return;
    cancelAnimationFrame(this.run.frame);
    this.run = null;
    this.canvas.hidden = true;
    delete this.stage.dataset.surfacePerformance;
    this.renderer?.clear();
    this.onChange();
  }

  async play(action, image, frameId, side) {
    const options = { frameId, side };
    const entry = getScreenInteraction(action, options);
    if (!entry || !this.canPlay()) return false;
    this.stop();
    const run = (this.run = {});
    try {
      this.onChange();
      if (!(await prepareRegisteredCel(action)) || this.run !== run || !this.canPlay()) {
        if (this.run === run) this.stop();
        return false;
      }
      this.renderer ??= createScreenInteractionRenderer(this.canvas);
      const started = performance.now();
      let exposure = -1;
      const tick = (now) => {
        if (this.run !== run) return;
        const elapsed = now - started;
        if (elapsed >= entry.clip.durationMs || !this.canPlay()) {
          this.stop();
          return;
        }
        const current = Math.floor(elapsed / (1000 / 24));
        if (current !== exposure) {
          exposure = current;
          try {
            this.renderer.setAction(action, elapsed, options);
            const channels = sampleScreenInteraction(action, elapsed, options);
            if (this.renderer.draw(image, channels, { bounds: entry.bounds })) {
              this.canvas.hidden = false;
              this.stage.dataset.surfacePerformance = action;
            }
          } catch {
            this.stop();
            return;
          }
        }
        run.frame = requestAnimationFrame(tick);
      };
      tick(started);
      return this.run === run && !this.canvas.hidden;
    } catch {
      if (this.run === run) this.stop();
      return false;
    }
  }
}
