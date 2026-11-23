// SPDX-License-Identifier: GPL-3.0-only
import { pointInRect, resizeWindowBounds, spriteDragHit, spritePressKind } from '../geometry.mjs';

const activePointerInterval = 8;
const idlePointerInterval = 32;
const gestureTimeout = 30_000;

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
    applyWindowBounds = (bounds) => window.setBounds(bounds, false),
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
      applyWindowBounds,
      verification,
      now,
    });
    this.drag = null;
    this.avatarPress = null;
    this.ignored = true;
  }
  beginWindow(resize, frameDriven = false) {
    if (this.drag) return false;
    this.endAvatar();
    const cursor = this.screen.getCursorScreenPoint();
    const bounds = this.window.getBounds();
    this.drag = {
      cursor,
      bounds,
      resize,
      frameDriven,
      started: this.now(),
      lastCursor: cursor,
      last: bounds,
    };
    if (this.timer && !frameDriven) this.scheduleTick(activePointerInterval);
    return true;
  }
  endWindow(commit = false) {
    const drag = this.drag;
    if (!drag) return;
    if (
      commit &&
      this.now() - drag.started <= gestureTimeout &&
      !this.window.isDestroyed() &&
      this.window.isVisible()
    )
      this.updateWindowDrag(this.screen.getCursorScreenPoint());
    this.drag = null;
    this.invalidateHitTest();
    return this.onEnd?.(drag);
  }
  sampleWindow() {
    if (!this.drag || this.window.isDestroyed() || !this.window.isVisible()) return false;
    this.updateWindowDrag(this.screen.getCursorScreenPoint());
    return true;
  }
  beginAvatar(point, sprite, mask, headpat) {
    if (this.drag || this.avatarPress || !point) return false;
    const kind = spritePressKind(point, sprite, mask, headpat);
    if (!kind && !spriteDragHit(point, sprite, mask)) return false;
    this.avatarPress = { at: this.now(), point, sprite, mask, kind, headpat };
    if (this.timer) this.scheduleTick(activePointerInterval);
    return true;
  }
  endAvatar(point, onClick) {
    const press = this.avatarPress;
    this.avatarPress = null;
    if (press) {
      this.invalidateHitTest();
      this.onAvatarTether();
    }
    const duration = press && this.now() - press.at;
    if (!press || duration > gestureTimeout) return false;
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
    this.invalidateHitTest();
  }
  invalidateHitTest() {
    this.hitTest = null;
  }
  updateWindowDrag(cursor) {
    const { cursor: origin, bounds: start, resize, last, lastCursor } = this.drag;
    if (cursor.x === lastCursor.x && cursor.y === lastCursor.y) return;
    this.drag.lastCursor = cursor;
    const movement = { x: cursor.x - origin.x, y: cursor.y - origin.y };
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
    // Commit the whole rectangle together, keeping the opposite edge fixed.
    if (['x', 'y', 'width', 'height'].some((key) => bounds[key] !== last[key])) {
      this.applyWindowBounds(bounds, this.drag);
      this.drag.last = bounds;
    }
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
    if (this.avatarPress && time - this.avatarPress.at > gestureTimeout) this.endAvatar();
    if (this.drag) {
      if (time - this.drag.started > gestureTimeout) this.endWindow();
      else {
        if (!this.drag.frameDriven) this.updateWindowDrag(cursor);
        if (this.getRegions()) this.setInteractive(true);
        return;
      }
    }
    const regions = this.getRegions();
    if (!regions) return;
    const mask = this.getMask();
    const previous = this.hitTest;
    if (
      !this.avatarPress &&
      previous?.x === cursor.x &&
      previous.y === cursor.y &&
      previous.regions === regions &&
      previous.mask === mask
    )
      return;
    this.hitTest = { ...cursor, regions, mask };
    const bounds = this.window.getContentBounds(),
      point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    if (this.avatarPress) this.onAvatarTether(this.avatarPress, cursor, bounds, time);
    this.setInteractive(
      this.avatarPress !== null ||
        regions.controls.some((rect) => pointInRect(point, rect)) ||
        spriteDragHit(point, regions.sprite, mask),
    );
  }
  scheduleTick(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleTick(
        (this.drag && !this.drag.frameDriven) || this.avatarPress
          ? activePointerInterval
          : idlePointerInterval,
      );
    }, delay);
    this.timer.unref();
  }
  start() {
    if (!this.timer && !this.verification) this.scheduleTick(idlePointerInterval);
  }
  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.cancel();
  }
}
