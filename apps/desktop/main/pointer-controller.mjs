// SPDX-License-Identifier: GPL-3.0-only
import { pointInRect, spriteDragHit, spritePressKind } from '../geometry.mjs';
/** Native click-through and bounded drag gestures are independent of visual effects. */
export class PointerController {
  constructor({
    window,
    screen,
    getRegions,
    getMask,
    onEnd,
    onAvatarTether = () => {},
    placeDrag = (bounds) => bounds,
    verification = false,
    now = Date.now,
  }) {
    Object.assign(this, {
      window,
      screen,
      getRegions,
      getMask,
      onEnd,
      onAvatarTether,
      placeDrag,
      verification,
      now,
    });
    this.drag = null;
    this.avatarPress = null;
    this.ignored = true;
  }
  beginWindow() {
    this.endAvatar();
    this.drag = {
      cursor: this.screen.getCursorScreenPoint(),
      bounds: this.window.getBounds(),
      started: this.now(),
    };
    this.drag.last = { x: this.drag.bounds.x, y: this.drag.bounds.y };
  }
  endWindow() {
    const drag = this.drag;
    this.drag = null;
    this.onEnd(drag);
  }
  beginAvatar(point, sprite, mask, headpat) {
    if (this.drag || this.avatarPress || !point) return false;
    const kind = spritePressKind(point, sprite, mask, headpat);
    if (!kind && !spriteDragHit(point, sprite, mask)) return false;
    this.avatarPress = { at: this.now(), point, sprite, mask, kind, headpat };
    return true;
  }
  endAvatar(point, onClick) {
    const press = this.avatarPress;
    this.avatarPress = null;
    if (press) this.onAvatarTether();
    const duration = press && this.now() - press.at;
    if (!press || duration > 30000) return false;
    if (
      press.kind &&
      duration < 800 &&
      Number.isFinite(point?.x) &&
      Number.isFinite(point?.y) &&
      Math.hypot(point.x - press.point.x, point.y - press.point.y) < 5 &&
      spritePressKind(point, press.sprite, press.mask, press.headpat) === press.kind
    )
      onClick?.(press.kind, point);
    return true;
  }
  cancel() {
    this.drag = null;
    this.endAvatar();
  }
  tick() {
    if (this.verification || this.window.isDestroyed() || !this.window.isVisible()) return;
    const cursor = this.screen.getCursorScreenPoint(),
      time = this.now();
    if (this.avatarPress && time - this.avatarPress.at > 30000) this.endAvatar();
    if (this.drag) {
      if (time - this.drag.started > 30000) this.endWindow();
      else {
        const bounds = this.placeDrag(
          {
            ...this.drag.bounds,
            x: Math.round(this.drag.bounds.x + cursor.x - this.drag.cursor.x),
            y: Math.round(this.drag.bounds.y + cursor.y - this.drag.cursor.y),
          },
          cursor,
        );
        const { x, y } = bounds;
        // setPosition can accumulate native DIP rounding while a transparent
        // Windows window is dragged at fractional scaling. Preserve its size in
        // the same operation, and make no native call for a stationary cursor.
        if (x !== this.drag.last.x || y !== this.drag.last.y) {
          this.window.setBounds(bounds, false);
          this.drag.last = { x, y };
        }
      }
    }
    const regions = this.getRegions();
    if (!regions) return;
    const bounds = this.window.getContentBounds(),
      point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y },
      mask = this.getMask();
    if (this.avatarPress) this.onAvatarTether(this.avatarPress, cursor, bounds, time);
    const interactive =
      this.drag !== null ||
      this.avatarPress !== null ||
      regions.controls.some((rect) => pointInRect(point, rect)) ||
      spriteDragHit(point, regions.sprite, mask);
    if (this.ignored === interactive) {
      this.ignored = !interactive;
      this.window.setIgnoreMouseEvents(this.ignored, { forward: true });
    }
  }
  start() {
    this.timer = setInterval(() => this.tick(), 16);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
    this.cancel();
  }
}
