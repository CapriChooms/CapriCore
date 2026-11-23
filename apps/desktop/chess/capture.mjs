// SPDX-License-Identifier: GPL-3.0-only
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { chessRectInside, scaleChessRect } from './source.mjs';
import { DEFAULT_CHESS_ARROW } from '../renderer/chess-arrow-style.mjs';
import {
  CHESS_FRAME_INWARD_PADDING,
  CHESS_FRAME_OUTER_PADDING,
  CHESS_FRAME_OUTSET,
  DEFAULT_CHESS_FRAME,
} from '../renderer/chess-frame-style.mjs';
import { CHESS_LIGHTNING_MS } from '../renderer/chess-move-lightning.mjs';
import { teleportLightningSettings } from '../renderer/teleport-effects.mjs';

const OVERLAY = 'capri://desktop/chess-overlay.html';
const MAX_FRAME_EDGE = 1600;
const dimensions = (r) => ['x', 'y', 'width', 'height'].map((key) => r[key]).join(',');
const windowClient = (view) =>
  view?.hwnd && view.processId ? { hwnd: view.hwnd, processId: view.processId } : undefined;

export class ChessCapture {
  constructor({ BrowserWindow, screen, desktopCapturer, enabled, regionBitmap, teleportEffects }) {
    Object.assign(this, {
      BrowserWindow,
      screen,
      desktopCapturer,
      enabled,
      regionBitmap,
      teleportEffects,
    });
    this.appearance = DEFAULT_CHESS_ARROW;
    this.frameStyle = DEFAULT_CHESS_FRAME;
    this.moveLightning = true;
    this.showArrow = true;
    this.boardFrame = this.frameVisible = false;
    this.onDisplayChange = () => this.drop();
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
      screen.on(event, this.onDisplayChange);
  }

  displays() {
    return this.screen.getAllDisplays().map(({ id, label, bounds }) => ({
      id: String(id),
      label,
      width: bounds.width,
      height: bounds.height,
    }));
  }

  async sources() {
    const displays = this.displays();
    try {
      const windows = await this.desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      return [
        ...displays,
        ...windows
          .filter(
            ({ name, id }) =>
              Boolean(name) &&
              /^window:[1-9]\d{0,19}:\d{1,10}$/.test(id) &&
              !/^Capri\b/i.test(name),
          )
          .slice(0, 60)
          .map(({ name, id }) => ({ id, label: name.slice(0, 100) })),
      ];
    } catch {
      return displays;
    }
  }

  display(id) {
    const display = this.screen.getAllDisplays().find((item) => String(item.id) === id);
    if (!display) throw new Error('The chess display is unavailable');
    return display;
  }

  async frame(id, signal, { maximumEdge = MAX_FRAME_EDGE, view } = {}) {
    signal.throwIfAborted();
    if (!this.enabled()) throw new Error('Chess capture stopped');
    if (id.startsWith('window:')) {
      const sources = await this.desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1600, height: 1600 },
      });
      signal.throwIfAborted();
      const bitmap = sources.find((item) => item.id === id)?.thumbnail;
      if (!this.enabled() || !bitmap || bitmap.isEmpty())
        throw new Error('The chess window is unavailable');
      return { bitmap, display: null, revision: id };
    }
    const display = this.display(id);
    const revision = dimensions(display.bounds) + '/' + display.scaleFactor;
    const scale = Math.min(
      display.scaleFactor,
      maximumEdge / Math.max(display.bounds.width, display.bounds.height),
    );
    const { width, height } = display.bounds;
    const limit = { width: Math.round(width * scale), height: Math.round(height * scale) };
    // Once a board is bound, capture its browser surface in display coordinates.
    // Capri's click-through overlay stays visible and is outside that surface.
    const bitmap = this.regionBitmap
      ? await this.regionBitmap(
          this.screen.dipToScreenRect(null, display.bounds),
          limit,
          signal,
          windowClient(view),
        )
      : (await this.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: limit })).find(
          (source) => source.display_id === id,
        )?.thumbnail;
    signal.throwIfAborted();
    const current = this.display(id);
    if (
      !this.enabled() ||
      revision !== dimensions(current.bounds) + '/' + current.scaleFactor ||
      !bitmap ||
      bitmap.isEmpty()
    )
      throw new Error('The chess display is unavailable');
    return { bitmap, display, revision };
  }

  async boardSample(frame, rect, signal, view) {
    if (!this.regionBitmap || !this.enabled()) return null;
    const display = this.display(String(frame.display.id));
    if (frame.revision !== dimensions(display.bounds) + '/' + display.scaleFactor) return null;
    const bounds = this.screen.dipToScreenRect(null, this.dip(frame, rect));
    const monitor = this.screen.dipToScreenRect(null, display.bounds);
    if (!chessRectInside(bounds, monitor)) return null;
    try {
      const bitmap = await this.regionBitmap(
        bounds,
        { width: 96, height: 96 },
        signal,
        windowClient(view),
      );
      signal.throwIfAborted();
      return this.enabled() && !bitmap.isEmpty()
        ? createHash('sha256').update(bitmap.toBitmap()).digest('hex')
        : null;
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }

  pixels(frame, relative) {
    const { width, height } = frame.bitmap.getSize();
    const bounds = frame.display.bounds;
    return scaleChessRect(relative, width / bounds.width, height / bounds.height);
  }

  async *pageFrames(view, signal) {
    for (const { id, bounds } of this.screen.getAllDisplays()) {
      const display = this.screen.dipToScreenRect(null, bounds);
      const page = view.bounds;
      const left = Math.max(page.x, display.x);
      const top = Math.max(page.y, display.y);
      const width = Math.min(page.x + page.width, display.x + display.width) - left;
      const height = Math.min(page.y + page.height, display.y + display.height) - top;
      if (Math.min(width, height) < 64) continue;
      const rect = this.screen.screenToDipRect(null, { x: left, y: top, width, height });
      const frame = await this.frame(String(id), signal);
      const crop = this.pixels(frame, { ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y });
      yield { id: String(id), frame, crop };
    }
  }

  dip(frame, rect) {
    const image = frame.bitmap.getSize();
    const bounds = frame.display.bounds;
    const left = Math.round(bounds.x + (rect.x * bounds.width) / image.width);
    const top = Math.round(bounds.y + (rect.y * bounds.height) / image.height);
    return {
      x: left,
      y: top,
      width: Math.round(((rect.x + rect.width) * bounds.width) / image.width + bounds.x) - left,
      height: Math.round(((rect.y + rect.height) * bounds.height) / image.height + bounds.y) - top,
    };
  }

  inView(frame, rect, view) {
    return Boolean(
      view &&
        frame.display &&
        chessRectInside(this.screen.dipToScreenRect(null, this.dip(frame, rect)), view.bounds),
    );
  }

  center(frame, rect) {
    const { x, y, width, height } = this.dip(frame, rect);
    return this.screen.dipToScreenPoint({
      x: Math.floor(x + width / 2),
      y: Math.floor(y + height / 2),
    });
  }

  movePoints(frame, rect, uci, orientation) {
    const { x, y, width, height } = this.dip(frame, rect);
    return [0, 2].map((index) => {
      const file = uci.charCodeAt(index) - 97;
      const rank = Number(uci[index + 1]) - 1;
      const column = orientation === 'white' ? file : 7 - file;
      const row = orientation === 'white' ? 7 - rank : rank;
      return this.screen.dipToScreenPoint({
        x: Math.floor(x + ((column + 0.5) * width) / 8),
        y: Math.floor(y + ((row + 0.5) * height) / 8),
      });
    });
  }

  fingerprint(frame, rect) {
    return createHash('sha256')
      .update(frame.bitmap.crop(rect).resize({ width: 48, height: 48 }).toBitmap())
      .digest('hex');
  }

  async window(bounds, interactive) {
    const window = new this.BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: interactive,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview'])
      window.webContents.on(event, (value) => value.preventDefault());
    window.setIgnoreMouseEvents(!interactive);
    try {
      await window.loadURL(OVERLAY);
      return window;
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  }

  async select(id, prompt, signal) {
    const display = this.display(id),
      window = await this.window(display.bounds, true);
    this.selector = window;
    const cancel = () => {
      window.off('blur', cancel);
      if (window.isDestroyed()) return;
      window.setIgnoreMouseEvents(true);
      window.hide();
      window.destroy();
    };
    const expires = setTimeout(cancel, 45000);
    window.once('blur', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      const chosen = window.webContents
        .executeJavaScript('globalThis.capriChessOverlay.select(' + JSON.stringify(prompt) + ')')
        .catch((error) => {
          if (window.isDestroyed() || signal.aborted) return null;
          throw error;
        });
      const closed = new Promise((resolve) => window.once('closed', () => resolve(null)));
      window.show();
      const relative = await Promise.race([chosen, closed]);
      if (!relative) return null;
      if (
        !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(relative[key])) ||
        relative.width < 64 ||
        relative.width !== relative.height ||
        !chessRectInside(relative, { ...display.bounds, x: 0, y: 0 })
      )
        return null;
      return relative;
    } finally {
      this.selector = null;
      clearTimeout(expires);
      signal.removeEventListener('abort', cancel);
      cancel();
    }
  }

  syncVisibility(window = this.arrow) {
    if (!window || window !== this.arrow || window.isDestroyed()) return;
    if (
      this.enabled() &&
      ((this.showArrow && this.renderedMove) || this.frameVisible || this.flashTimer)
    ) {
      if (!window.isVisible()) {
        window.setIgnoreMouseEvents(true);
        window.showInactive();
      }
    } else if (window.isVisible()) window.hide();
  }

  async overlay(frame, rect, signal) {
    signal.throwIfAborted();
    const board = this.dip(frame, rect);
    const window =
      this.arrow && !this.arrow.isDestroyed() ? this.arrow : await this.window(board, false);
    if (signal.aborted || !this.enabled()) {
      if (window !== this.arrow && !window.isDestroyed()) window.destroy();
      signal.throwIfAborted();
      throw new Error('Chess capture stopped');
    }
    this.arrow = window;
    this.overlayTarget = { board, display: frame.display.bounds };
    await this.layoutOverlay(window, this.requestedFrameVisibility(window));
    return window;
  }

  requestedFrameVisibility(window) {
    return this.frameUpdate?.window === window
      ? this.frameUpdate.visible
      : this.frameRenderedWindow === window && this.frameVisible;
  }

  async layoutOverlay(window, frameVisible) {
    const { board, display } = this.overlayTarget;
    const inwardPadding = this.frameStyle.glow ? CHESS_FRAME_INWARD_PADDING : CHESS_FRAME_OUTSET;
    const framePadding = this.frameStyle.particlesOutward
      ? CHESS_FRAME_OUTER_PADDING
      : inwardPadding;
    const padding = frameVisible ? framePadding : 0;
    const fit = (space) => Math.max(0, Math.min(space, padding));
    const top = fit(board.y - display.y);
    const right = fit(display.x + display.width - board.x - board.width);
    const bottom = fit(display.y + display.height - board.y - board.height);
    const left = fit(board.x - display.x);
    const bounds = {
      x: board.x - left,
      y: board.y - top,
      width: board.width + left + right,
      height: board.height + top + bottom,
    };
    if (dimensions(window.getBounds()) !== dimensions(bounds)) window.setBounds(bounds, false);
    const inset = [top, right, bottom, left].map((value) => `${value}px`).join(' ');
    if (this.overlayLayout?.window === window && this.overlayLayout.inset === inset) return;
    const layout = { window, inset };
    const initialLayout = this.overlayLayout?.window !== window;
    this.overlayLayout = layout;
    if (initialLayout && !top && !right && !bottom && !left) return;
    try {
      await window.webContents.executeJavaScript(
        `globalThis.capriChessOverlay.layout(${JSON.stringify(inset)})`,
      );
    } catch (error) {
      if (this.overlayLayout === layout) this.overlayLayout = null;
      throw error;
    }
  }

  async setFrame(window, visible) {
    if (!this.frameUpdate && this.frameRenderedWindow === window && this.frameVisible === visible)
      return;
    const update = { window, visible };
    this.frameUpdate = update;
    try {
      await this.layoutOverlay(window, visible);
      if (this.frameUpdate !== update || this.arrow !== window || window.isDestroyed()) return;
      await window.webContents.executeJavaScript(
        `globalThis.capriChessOverlay.frame(${visible},${JSON.stringify(this.frameStyle)})`,
      );
      if (this.frameUpdate !== update || this.arrow !== window) return;
      this.frameRenderedWindow = window;
      this.frameVisible = visible;
    } finally {
      if (this.frameUpdate === update) this.frameUpdate = null;
    }
  }

  async showBoardFrame(frame, rect, signal) {
    if (!this.boardFrame) return;
    const window = await this.overlay(frame, rect, signal);
    await this.setFrame(window, this.boardFrame);
    signal.throwIfAborted();
    this.syncVisibility(window);
  }

  configureBoardFrame(enabled) {
    this.boardFrame = enabled;
    if (!enabled && this.arrow && !this.arrow.isDestroyed()) {
      const window = this.arrow;
      void this.setFrame(window, false)
        .then(() => this.syncVisibility(window))
        .catch(() => {});
    }
  }

  configureFrameStyle(value) {
    this.frameStyle = value;
    const window = this.arrow;
    if (!window || window.isDestroyed()) return;
    void this.layoutOverlay(window, this.requestedFrameVisibility(window))
      .then(() => {
        if (this.arrow !== window || window.isDestroyed()) return;
        return window.webContents.executeJavaScript(
          `globalThis.capriChessOverlay.frameAppearance(${JSON.stringify(this.frameStyle)})`,
        );
      })
      .catch(() => {});
  }

  async show(frame, rect, value, signal) {
    const window = await this.overlay(frame, rect, signal);
    try {
      await this.setFrame(window, this.boardFrame);
      this.suggestion = value;
      await this.setMove(window);
      signal.throwIfAborted();
      if (!this.enabled()) throw new Error('Chess capture stopped');
      this.syncVisibility(window);
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      if (this.arrow === window) this.arrow = null;
      throw error;
    }
  }

  async setMove(window) {
    const value = this.showArrow ? this.suggestion : null;
    const key = value ? value.uci + '/' + value.orientation : null;
    if (this.renderedWindow === window && this.renderedMove === key) return;
    this.renderedWindow = window;
    this.renderedMove = key;
    await window.webContents.executeJavaScript(
      'globalThis.capriChessOverlay.move(' +
        JSON.stringify(value && { ...value, appearance: this.appearance }) +
        ')',
    );
  }

  configureShowArrow(enabled) {
    this.showArrow = enabled;
    const window = this.arrow;
    if (!window || window.isDestroyed()) return;
    void this.setMove(window)
      .then(() => this.syncVisibility(window))
      .catch(() => {});
  }

  configureAppearance(appearance) {
    this.appearance = appearance;
    if (this.arrow && !this.arrow.isDestroyed())
      void this.arrow.webContents
        .executeJavaScript(
          'globalThis.capriChessOverlay.appearance(' + JSON.stringify(appearance) + ')',
        )
        .catch(() => {});
  }

  configureMoveLightning(enabled) {
    this.moveLightning = enabled;
    if (!enabled) this.clearMoveLightning();
  }

  async prepareFlash(frame, rect, signal) {
    if (this.moveLightning) await this.overlay(frame, rect, signal);
  }

  async flashMove(frame, rect, move, signal) {
    if (!this.moveLightning || signal.aborted) return;
    const window = await this.overlay(frame, rect, signal);
    const effects = teleportLightningSettings(this.teleportEffects?.());
    const flashed = await window.webContents.executeJavaScript(
      'globalThis.capriChessOverlay.flash(' + JSON.stringify({ ...move, effects }) + ')',
    );
    if (!flashed || window !== this.arrow || window.isDestroyed()) return;
    if (!this.moveLightning || signal.aborted || !this.enabled()) {
      this.clearMoveLightning();
      return;
    }
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.syncVisibility(window);
    }, CHESS_LIGHTNING_MS + 50);
    this.flashTimer.unref?.();
    this.syncVisibility(window);
  }

  clearMoveLightning() {
    clearTimeout(this.flashTimer);
    this.flashTimer = null;
    const window = this.arrow;
    if (!window || window.isDestroyed()) return;
    void window.webContents
      .executeJavaScript('globalThis.capriChessOverlay.clearFlash()')
      .catch(() => {});
    this.syncVisibility(window);
  }

  hideArrow({ keepFrame = false } = {}) {
    const window = this.arrow;
    if (!window || window.isDestroyed()) return;
    this.suggestion = null;
    if (!keepFrame) {
      void this.setFrame(window, false).catch(() => {});
      this.frameVisible = false;
      this.clearMoveLightning();
    }
    void this.setMove(window)
      .then(() => this.syncVisibility(window))
      .catch(() => {});
  }
  drop() {
    clearTimeout(this.flashTimer);
    this.flashTimer = null;
    for (const window of [this.arrow, this.selector])
      if (window && !window.isDestroyed()) window.destroy();
    this.arrow = this.selector = null;
    this.suggestion = null;
    this.renderedWindow = this.renderedMove = null;
    this.frameRenderedWindow = this.frameUpdate = null;
    this.overlayTarget = this.overlayLayout = null;
    this.frameVisible = false;
  }

  async afterOverlay(signal) {
    await delay(140, undefined, { signal });
  }

  close() {
    this.drop();
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
      this.screen.off(event, this.onDisplayChange);
  }
}
