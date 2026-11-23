// SPDX-License-Identifier: GPL-3.0-only
import { fileURLToPath } from 'node:url';

export const avatarComposerUrl = 'capri://desktop/avatar-composer.html';
export const avatarComposerStateChannel = 'capri:avatar-composer-state';
const defaultPreload = fileURLToPath(new URL('../avatar-composer-preload.cjs', import.meta.url));
const width = 344;
const compactWidth = 124;
const compactHeight = 44;
const minimumHeight = 60;
const maximumHeight = 240;
const gap = 8;
const stackingInterval = 750;
const fadeDuration = 180;
const proximityRadius = 90;
const rectKeys = ['x', 'y', 'width', 'height'];
const isRect = (value) =>
  value &&
  rectKeys.every((key) => Number.isFinite(value[key])) &&
  value.width > 0 &&
  value.height > 0;
const isPoint = (value) => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const overlaps = (a, b, padding = gap) =>
  a.x < b.x + b.width + padding &&
  a.x + a.width + padding > b.x &&
  a.y < b.y + b.height + padding &&
  a.y + a.height + padding > b.y;

export function avatarComposerProximity(pointer, bounds, radius = proximityRadius) {
  if (!isPoint(pointer) || !isRect(bounds) || !Number.isFinite(radius) || radius < 0) return false;
  const dx = Math.max(bounds.x - pointer.x, 0, pointer.x - bounds.x - bounds.width);
  const dy = Math.max(bounds.y - pointer.y, 0, pointer.y - bounds.y - bounds.height);
  return Math.hypot(dx, dy) <= radius;
}

/** The sprite and monitor coordinates supplied by main are all desktop DIP. */
export function avatarComposerBounds({
  body,
  face,
  hud,
  workArea,
  height = minimumHeight,
  width: requestedWidth = width,
} = {}) {
  if (!isRect(body) || !isRect(workArea) || !Number.isFinite(height)) return null;
  const left = Math.ceil(workArea.x);
  const top = Math.ceil(workArea.y);
  const right = Math.floor(workArea.x + workArea.width);
  const bottom = Math.floor(workArea.y + workArea.height);
  if (right <= left || bottom <= top) return null;
  if (!Number.isFinite(requestedWidth) || requestedWidth < compactWidth || requestedWidth > width)
    return null;
  const boundedWidth = Math.min(requestedWidth, right - left);
  const boundedHeight = Math.min(
    Math.round(clamp(height, compactHeight, maximumHeight)),
    bottom - top,
  );
  const center = isPoint(face) ? face.x : body.x + body.width / 2;
  const below = Math.ceil(body.y + body.height + gap);
  const above = Math.floor(body.y - gap - boundedHeight);
  let x = Math.round(center - boundedWidth / 2);
  let y = below;
  if (below + boundedHeight > bottom) {
    const besideRight = Math.ceil(body.x + body.width + gap);
    const besideLeft = Math.floor(body.x - gap - boundedWidth);
    // Preserve the reply bubble above a floor perch by using an empty side first.
    if (besideRight >= left && besideRight + boundedWidth <= right) {
      x = besideRight;
      y = bottom - boundedHeight;
    } else if (besideLeft >= left && besideLeft + boundedWidth <= right) {
      x = besideLeft;
      y = bottom - boundedHeight;
    } else if (above >= top) y = above;
  }
  const preferred = {
    x: clamp(x, left, right - boundedWidth),
    y: clamp(y, top, bottom - boundedHeight),
    width: boundedWidth,
    height: boundedHeight,
  };
  if (!isRect(hud) || !overlaps(preferred, hud)) return preferred;
  // The status/tab may be below an inverted face. Reserve its entire visible
  // rectangle, including an expanded reply, instead of placing input over it.
  const occupied = {
    x: Math.min(body.x, hud.x),
    y: Math.min(body.y, hud.y),
    width: Math.max(body.x + body.width, hud.x + hud.width) - Math.min(body.x, hud.x),
    height: Math.max(body.y + body.height, hud.y + hud.height) - Math.min(body.y, hud.y),
  };
  const combined = avatarComposerBounds({
    body: occupied,
    face: { x: center, y: body.y },
    workArea,
    height,
    width: requestedWidth,
  });
  if (!overlaps(combined, hud)) return combined;
  // A small working area can prevent a placement around the combined body.
  // Prefer clear interface space even if that leaves input beside the sprite.
  for (const [candidateX, candidateY] of [
    [preferred.x, hud.y + hud.height + gap],
    [preferred.x, hud.y - gap - boundedHeight],
    [hud.x + hud.width + gap, preferred.y],
    [hud.x - gap - boundedWidth, preferred.y],
  ]) {
    const candidate = {
      ...preferred,
      x: clamp(Math.round(candidateX), left, right - boundedWidth),
      y: clamp(Math.round(candidateY), top, bottom - boundedHeight),
    };
    if (!overlaps(candidate, hud)) return candidate;
  }
  return combined;
}

/** A small keyboard-capable surface; the owner renderer retains chat and draft ownership. */
export class AvatarComposer {
  constructor({
    BrowserWindow,
    screen,
    preload = defaultPreload,
    url = avatarComposerUrl,
    onClose = () => {},
    onError = () => {},
  }) {
    Object.assign(this, { BrowserWindow, screen, preload, url, onClose, onError });
    this.mode = 'compact';
    this.height = compactHeight;
    this.presentationVisible = false;
    this.focused = false;
    this.ready = Promise.resolve(false);
    this.refreshDisplay = () => {
      if (!this.placement || this.disposed) return;
      this.displayAreaCache = null;
      this.appliedBounds = null;
      // A cached workArea can become stale when the taskbar or a monitor moves.
      this.placement = { ...this.placement, workArea: undefined };
      this.update();
    };
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
      screen?.on?.(event, this.refreshDisplay);
  }

  get bounds() {
    if (this.window && !this.window.isDestroyed()) return this.window.getBounds();
    return this.targetBounds ?? null;
  }

  owns(event) {
    const view = this.window;
    if (!view || view.isDestroyed()) return false;
    const contents = view.webContents;
    return (
      event?.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      event.senderFrame?.url === this.url &&
      contents.getURL() === this.url
    );
  }

  sync({
    visible = false,
    phase = 'detached',
    focusMode = false,
    sessionLocked = false,
    pointer,
    keepVisible = false,
    interactiveBusy = false,
    ...placement
  } = {}) {
    if (this.disposed) return false;
    this.placement = placement;
    this.pointer = pointer;
    this.keepVisible = keepVisible === true || interactiveBusy === true;
    this.visibleWanted = visible === true && phase === 'detached' && !focusMode && !sessionLocked;
    return this.update();
  }

  setHeight(height) {
    if (this.disposed || !Number.isFinite(height)) return false;
    this.height = Math.round(clamp(height, compactHeight, maximumHeight));
    return this.update();
  }

  setMode(mode) {
    if (!['compact', 'text', 'expanded'].includes(mode)) throw new Error('Invalid panel mode.');
    if (this.disposed || this.mode === mode) return false;
    this.mode = mode;
    this.height = mode === 'text' ? minimumHeight : compactHeight;
    this.update();
    this.publishState();
    return true;
  }

  sendState(state) {
    if (this.disposed) return false;
    this.state = state;
    this.update();
    return this.publishState();
  }

  publishState() {
    const view = this.window;
    if (!this.loaded || !view || view.isDestroyed() || view.webContents.getURL() !== this.url)
      return false;
    view.webContents.send(avatarComposerStateChannel, {
      ...this.state,
      mode: this.mode,
      composerVisible: this.presentationVisible === true,
    });
    return true;
  }

  setPresentation(visible) {
    if (this.presentationVisible === visible) return;
    this.presentationVisible = visible;
    this.publishState();
  }

  setInteractive(visible) {
    const view = this.window;
    if (!view || view.isDestroyed() || this.mouseInteractive === visible) return;
    this.mouseInteractive = visible;
    view.setIgnoreMouseEvents?.(!visible, { forward: true });
  }

  update() {
    if (this.disposed) return false;
    const { body, face, hud, workArea, displayId } = this.placement ?? {};
    let displayArea = workArea;
    if (!displayArea && isRect(body)) {
      // Main supplies the avatar's display identity. Its working area changes
      // only on a display event, not on every pixel of a window drag.
      const key =
        displayId !== undefined ? `display:${displayId}` : rectKeys.map((k) => body[k]).join(':');
      if (this.displayAreaCache?.key !== key) {
        this.displayAreaCache = { key, area: this.screen?.getDisplayMatching?.(body)?.workArea };
      }
      displayArea = this.displayAreaCache.area;
    }
    this.targetBounds = avatarComposerBounds({
      body,
      face,
      hud,
      workArea: displayArea,
      height: this.height,
      width: this.mode === 'text' ? width : compactWidth,
    });
    if (!this.visibleWanted || !this.targetBounds) {
      this.hideWindow();
      return false;
    }
    const pointer = isPoint(this.pointer) ? this.pointer : this.screen?.getCursorScreenPoint?.();
    const pinned = Boolean(
      this.keepVisible ||
        this.focused ||
        this.state?.draft?.length ||
        this.state?.attachments?.length ||
        this.state?.microphone?.listening ||
        this.state?.microphone?.loading,
    );
    const visible = pinned || avatarComposerProximity(pointer, this.targetBounds);
    this.setPresentation(visible);
    if (!visible && (!this.window || this.window.isDestroyed())) return false;
    const view = this.ensureWindow();
    const current = this.appliedBounds ?? view.getBounds();
    this.appliedBounds ??= { ...current };
    if (
      (visible || view.isVisible()) &&
      rectKeys.some((key) => current[key] !== this.targetBounds[key])
    ) {
      this.applyingBounds = true;
      this.nativeResizeDuringApply = false;
      try {
        // setPosition reuses outward-rounded native DIP sizes. Reusing that
        // rectangle can grow the bar on every move at fractional display scales.
        // Keep its logical dimensions explicit, without another JS bounds read.
        view.setBounds(this.targetBounds, false);
        // Windows can adjust a transparent window's size during a move (for
        // example across DPI boundaries). Reconcile that native resize on the
        // next update instead of treating the requested rectangle as applied.
        this.appliedBounds = this.nativeResizeDuringApply ? null : { ...this.targetBounds };
      } finally {
        this.applyingBounds = false;
        this.nativeResizeDuringApply = false;
      }
    }
    if (this.loaded) {
      this.setInteractive(visible);
      if (visible) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
        if (!view.isVisible()) view.showInactive();
      } else if (view.isVisible() && !this.fadeTimer) {
        this.fadeTimer = setTimeout(() => {
          this.fadeTimer = null;
          if (!this.presentationVisible) this.hideWindow();
        }, fadeDuration);
        this.fadeTimer.unref?.();
      }
    }
    return visible;
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const view = new this.BrowserWindow({
      ...(this.targetBounds ?? {
        width: this.mode === 'text' ? width : compactWidth,
        height: this.height,
      }),
      title: 'Capri',
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false,
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        backgroundThrottling: false,
      },
    });
    this.window = view;
    this.appliedBounds = null;
    this.loaded = false;
    this.mouseInteractive = undefined;
    this.setInteractive(false);
    view.setMenu(null);
    view.setAlwaysOnTop?.(true, 'screen-saver');
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview'])
      view.webContents.on(event, (value) => value.preventDefault());
    view.on('close', (event) => {
      if (this.disposed) return;
      event.preventDefault();
      this.hide();
      this.onClose('close');
    });
    view.on('minimize', () => {
      if (this.disposed) return;
      this.hide();
      this.onClose('minimize');
    });
    view.on('show', () => {
      this.raise();
      this.stopStacking();
      this.stackingTimer = setInterval(() => this.raise(), stackingInterval);
      this.stackingTimer.unref?.();
    });
    view.on('hide', () => this.stopStacking());
    const boundsChanged = (resized) => {
      if (this.window !== view) return;
      if (this.applyingBounds) {
        if (resized) this.nativeResizeDuringApply = true;
      } else this.appliedBounds = null;
    };
    view.on('move', () => boundsChanged(false));
    view.on('resize', () => boundsChanged(true));
    view.on('focus', () => {
      this.focused = true;
      this.update();
    });
    view.on('blur', () => {
      this.focused = false;
      this.update();
    });
    view.once('closed', () => {
      this.stopStacking();
      if (this.window === view) {
        this.window = null;
        this.appliedBounds = null;
        this.loaded = false;
        this.focused = false;
      }
    });
    view.webContents.once('render-process-gone', () => {
      if (this.disposed || this.window !== view) return;
      this.loaded = false;
      this.hide();
      // A crashed WebContents cannot accept state. Release only this failed
      // surface; main suppresses retries until the next deliberate avatar action.
      if (!view.isDestroyed()) view.destroy();
      this.onClose('renderer-lost');
    });
    this.ready = Promise.resolve(view.loadURL(this.url))
      .then(() => {
        if (this.disposed || view.isDestroyed() || this.window !== view) return false;
        if (view.webContents.getURL() !== this.url) throw new Error('Unexpected composer page.');
        this.loaded = true;
        this.publishState();
        this.update();
        return true;
      })
      .catch((error) => {
        if (!this.disposed && this.window === view) {
          this.hide();
          if (!view.isDestroyed()) view.destroy();
          this.onClose('load-failed');
          this.onError(error);
        }
        return false;
      });
    return view;
  }

  raise() {
    const view = this.window;
    if (!view || view.isDestroyed() || !view.isVisible() || !this.presentationVisible) return false;
    view.setAlwaysOnTop?.(true, 'screen-saver');
    view.moveTop?.();
    return true;
  }

  stopStacking() {
    clearInterval(this.stackingTimer);
    this.stackingTimer = null;
  }

  hideWindow() {
    clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    this.focused = false;
    this.setPresentation(false);
    this.setInteractive(false);
    this.stopStacking();
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
  }

  hide() {
    this.visibleWanted = false;
    this.hideWindow();
  }

  /** Main calls this once during application shutdown, never for ordinary close/hide. */
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.visibleWanted = false;
    this.stopStacking();
    clearTimeout(this.fadeTimer);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
      this.screen?.off?.(event, this.refreshDisplay);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
