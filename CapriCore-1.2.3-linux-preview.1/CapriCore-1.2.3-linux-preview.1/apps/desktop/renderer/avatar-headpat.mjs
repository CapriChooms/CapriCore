// SPDX-License-Identifier: GPL-3.0-only
import { avatarFacePose } from './avatar-face-rig.mjs';
import { AvatarMouthLayer } from './avatar-mouth.mjs';

const expressions = {
  affectionate: 'idle-laughing',
  curious: 'skeptical',
  neutral: 'attentive',
  boundary: 'annoyed',
};

export class AvatarHeadpat {
  constructor(host, onFaceChange = () => {}) {
    this.host = host;
    this.onFaceChange = onFaceChange;
  }

  play(sprite, { x, y }, bounds, showFace = true, frameId) {
    if (!sprite || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (showFace) this.setFace(sprite, frameId, 'affectionate');
    if (!this.hearts || performance.now() - this.burstAt >= 220) this.burst(x, y, bounds);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), 1450);
  }

  react(sprite, frameId, tone) {
    if (!this.setFace(sprite, frameId, tone)) return false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), 740);
    return true;
  }

  setFace(sprite, frameId, tone) {
    if (!avatarFacePose(frameId) || !Object.hasOwn(expressions, tone)) return false;
    if (sprite !== this.sprite) {
      this.clear();
      this.sprite = sprite;
      this.layer = new AvatarMouthLayer(sprite, {
        className: 'avatar-headpat-plate',
        onReady: () => this.refresh(),
      });
    }
    this.frameId = frameId;
    this.sourceUrl = sprite.currentSrc || sprite.src;
    this.expression = expressions[tone];
    this.layer.canvas.dataset.expression = tone;
    this.refresh();
    return true;
  }

  refresh() {
    if (!this.layer) return;
    if ((this.sprite.currentSrc || this.sprite.src) !== this.sourceUrl) return this.clear();
    this.layer.update(this.sprite, 'closed', this.frameId, this.expression);
    this.onFaceChange();
  }

  burst(x, y, bounds) {
    this.hearts?.remove();
    this.burstAt = performance.now();
    const host = this.host.getBoundingClientRect();
    const {
      x: left,
      y: top,
      width,
      height,
    } = bounds ?? {
      x: 0,
      y: 0,
      width: host.width,
      height: host.height,
    };
    const hearts = document.createElement('span');
    hearts.className = 'avatar-headpat-hearts';
    hearts.setAttribute('aria-hidden', 'true');
    // Keep space for the burst even when the crown is up against the frame edge.
    hearts.style.left = `${left + Math.max(43, Math.min(width - 43, x - host.left - left))}px`;
    hearts.style.top = `${top + Math.max(54, Math.min(height - 10, y - host.top - top))}px`;
    for (let i = 0; i < 4; i++) hearts.append(document.createElement('i'));
    this.host.append(hearts);
    this.hearts = hearts;
  }

  clear() {
    const faceVisible = Boolean(this.frameId);
    clearTimeout(this.timer);
    this.layer?.canvas.remove();
    this.hearts?.remove();
    this.layer = this.sprite = this.hearts = null;
    this.expression = null;
    this.frameId = null;
    if (faceVisible) this.onFaceChange();
  }
}
