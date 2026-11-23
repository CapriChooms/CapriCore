// SPDX-License-Identifier: GPL-3.0-only
import { prepareRegisteredCel, registeredCelClip } from './hanging-cels.mjs';
import { loadAvatarFaceRig, loadAvatarGestureFaces } from './avatar-face-rig.mjs';
import {
  createScreenInteractionRenderer,
  getScreenInteraction,
  sampleScreenInteraction,
} from './screen-interaction-motion.mjs';

export class AvatarSurfacePerformance {
  constructor(stage, { canPlay, onChange, shouldLoop = () => false }) {
    Object.assign(this, { stage, canPlay, onChange, shouldLoop });
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

  dispose() {
    this.stop();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas.remove();
  }

  async play(action, image, frameId, side) {
    const options = { frameId, side };
    const entry = getScreenInteraction(action, options);
    if (!entry || !this.canPlay()) return false;
    this.stop();
    const run = (this.run = {});
    try {
      this.onChange();
      const [ready, faceRig, gestures] = await Promise.all([
        prepareRegisteredCel(action),
        loadAvatarFaceRig().catch(() => null),
        registeredCelClip(action) ? loadAvatarGestureFaces().catch(() => null) : null,
      ]);
      if (!ready || this.run !== run || !this.canPlay()) {
        if (this.run === run) this.stop();
        return false;
      }
      if (gestures) this.gestureFaces = gestures;
      this.renderer ??= createScreenInteractionRenderer(this.canvas, {
        faceRig,
        drawGestureFace: (...args) => this.gestureFaces?.(...args),
      });
      const started = performance.now();
      let exposure = -1;
      let cycle = 0;
      const tick = (now) => {
        if (this.run !== run) return;
        const elapsed = Math.max(0, now - started);
        const nextCycle = Math.floor(elapsed / entry.clip.durationMs);
        if (!this.canPlay() || (nextCycle !== cycle && !this.shouldLoop())) {
          this.stop();
          return;
        }
        cycle = nextCycle;
        const current = Math.floor(elapsed / (1000 / 24));
        if (current !== exposure) {
          exposure = current;
          try {
            const time = elapsed % entry.clip.durationMs;
            this.renderer.setAction(action, time, options);
            const channels = sampleScreenInteraction(action, time, options);
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
