// SPDX-License-Identifier: GPL-3.0-only
import { pointInRect, resizeWindowBounds, spriteDragHit, spritePressKind } from '../geometry.mjs';

export const WINDOW_MOTION_INTERVAL_MS = 8;
const POINTER_POLL_INTERVAL_MS = 16;

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
  beginWindow(resize) {
    this.endAvatar();
    this.drag = {
      cursor: this.screen.getCursorScreenPoint(),
      bounds: this.window.getBounds(),
      resize,
      started: this.now(),
    };
    this.drag.last = this.drag.bounds;
    if (this.timer) this.pollEvery(WINDOW_MOTION_INTERVAL_MS);
  }
  clearWindowDrag() {
    const drag = this.drag;
    this.drag = null;
    if (drag && this.timer) this.pollEvery(POINTER_POLL_INTERVAL_MS);
    return drag;
  }
  endWindow() {
    const drag = this.clearWindowDrag();
    if (drag) this.onEnd?.(drag);
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
    this.clearWindowDrag();
    this.endAvatar();
  }
  setInteractive(interactive) {
    if (this.ignored === interactive) {
      this.ignored = !interactive;
      this.window.setIgnoreMouseEvents(this.ignored, { forward: true });
    }
  }
  tick() {
    if (this.verification || this.window.isDestroyed() || !this.window.isVisible()) return;
    const cursor = this.screen.getCursorScreenPoint(),
      time = this.now();
    if (this.avatarPress && time - this.avatarPress.at > 30000) this.endAvatar();
    if (this.drag) {
      if (time - this.drag.started > 30000) this.endWindow();
      else {
        const { bounds: start, resize, last } = this.drag;
        const movement = { x: cursor.x - this.drag.cursor.x, y: cursor.y - this.drag.cursor.y };
        const bounds = resize
          ? resizeWindowBounds(start, resize.edge, movement, resize.workArea, resize.minimum)
          : this.placeDrag(
              {
                ...start,
                x: Math.round(start.x + movement.x),
                y: Math.round(start.y + movement.y),
              },
              cursor,
            );
        // setPosition can accumulate native DIP rounding while a transparent
        // Windows window is dragged at fractional scaling. Preserve its size in
        // the same operation, and make no native call for a stationary cursor.
        if (['x', 'y', 'width', 'height'].some((key) => bounds[key] !== last[key])) {
          this.window.setBounds(bounds, false);
          this.drag.last = bounds;
        }
        // The whole window remains interactive during the captured gesture.
        if (this.getRegions()) this.setInteractive(true);
        return;
      }
    }
    const regions = this.getRegions();
    if (!regions) return;
    const bounds = this.window.getContentBounds(),
      point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y },
      mask = this.getMask();
    if (this.avatarPress) this.onAvatarTether(this.avatarPress, cursor, bounds, time);
    this.setInteractive(
      this.avatarPress !== null ||
        regions.controls.some((rect) => pointInRect(point, rect)) ||
        spriteDragHit(point, regions.sprite, mask),
    );
  }
  pollEvery(interval) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), interval);
    this.timer.unref();
  }
  start() {
    if (!this.timer)
      this.pollEvery(this.drag ? WINDOW_MOTION_INTERVAL_MS : POINTER_POLL_INTERVAL_MS);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.cancel();
  }
}
