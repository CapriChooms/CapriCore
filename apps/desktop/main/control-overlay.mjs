// SPDX-License-Identifier: GPL-3.0-only
/** Transparent, click-through monitor indicators, including the taskbar area. */
import { computerPreferences } from '../computer-preferences.mjs';
export class ControlOverlay {
  constructor({
    BrowserWindow,
    screen,
    owner,
    url = 'capri://desktop/control-overlay.html',
    onLost = () => {},
  }) {
    Object.assign(this, { BrowserWindow, screen, owner, url, onLost });
    this.windows = [];
    this.closed = false;
    this.controller = new AbortController();
    this.settings = computerPreferences();
  }
  configure(value) {
    this.settings = computerPreferences(value);
    this.script('configure', this.settings);
  }
  script(method, value, target = this.windows) {
    if (this.closed) return;
    for (const border of target)
      if (!border.isDestroyed()) {
        try {
          void Promise.resolve(
            border.webContents.executeJavaScript(
              'globalThis.capriControl?.' + method + '(' + JSON.stringify(value) + ')',
            ),
          ).catch(() => this.lost('renderer_script_failed'));
        } catch {
          this.lost('renderer_script_failed');
        }
      }
  }
  lost(reason = 'indicator_closed') {
    if (this.closed) return;
    this.hide();
    void Promise.resolve()
      .then(() => this.onLost(reason))
      .catch(() => {});
  }
  pulse(action) {
    this.script('pulse', action);
  }
  phase(value) {
    this.script('phase', value);
  }
  assertOpen(border) {
    if (this.closed || border?.isDestroyed()) throw Error('Computer control indicator closed.');
  }
  async wait(operation, border) {
    const pending = Promise.resolve(operation);
    const { signal } = this.controller;
    if (signal.aborted) {
      void pending.catch(() => {});
      throw signal.reason;
    }
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const result = await Promise.race([pending, cancelled]);
      this.assertOpen(border);
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  show(caption) {
    if (this.closed) return Promise.reject(Error('Computer control indicator closed.'));
    if (!this.showPromise) this.showPromise = this.showWindows(caption);
    return this.showPromise;
  }
  async showWindows(caption) {
    try {
      const displays = this.screen.getAllDisplays();
      if (!displays.length) throw Error('Computer control indicator has no display.');
      for (const display of displays) {
        this.assertOpen();
        const border = new this.BrowserWindow({
          ...display.bounds,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          focusable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          resizable: false,
          fullscreenable: true,
          fullscreen: true,
          parent: this.owner,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        this.windows.push(border);
        border.webContents.once('render-process-gone', (_event, details) =>
          this.lost(
            ['oom', 'crashed', 'killed'].includes(details?.reason)
              ? 'renderer_' + details.reason
              : 'renderer_gone',
          ),
        );
        border.once('closed', () => this.lost('indicator_closed'));
        border.setIgnoreMouseEvents(true);
        border.setAlwaysOnTop(true, 'screen-saver');
        await this.wait(border.loadURL(this.url), border);
        if (
          !(await this.wait(
            border.webContents.executeJavaScript('Boolean(globalThis.capriControl)'),
            border,
          ))
        )
          throw Error('Computer control indicator did not initialize.');
        await this.wait(
          border.webContents.executeJavaScript(
            'document.querySelector(".control-label").textContent = ' + JSON.stringify(caption),
          ),
          border,
        );
        await this.wait(
          border.webContents.executeJavaScript(
            'globalThis.capriControl?.configure(' + JSON.stringify(this.settings) + ')',
          ),
          border,
        );
        border.setBounds(display.bounds, false);
        border.setFullScreen(true);
        this.assertOpen(border);
        border.showInactive();
        await this.wait(
          border.webContents.executeJavaScript(
            'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
          ),
          border,
        );
        const actual = border.getBounds();
        if (
          this.closed ||
          border.isDestroyed() ||
          !border.isVisible() ||
          !['x', 'y', 'width', 'height'].every((key) => actual[key] === display.bounds[key])
        )
          throw Error('Computer control indicator could not cover the complete display.');
      }
      this.tracker = setInterval(() => {
        if (this.closed) return;
        try {
          const point = this.screen.getCursorScreenPoint();
          if (this.previous?.x === point.x && this.previous?.y === point.y) return;
          this.previous = point;
          for (const border of this.windows)
            if (!border.isDestroyed()) {
              const bounds = border.getBounds();
              this.script(
                'pointer',
                point.x >= bounds.x &&
                  point.y >= bounds.y &&
                  point.x < bounds.x + bounds.width &&
                  point.y < bounds.y + bounds.height
                  ? { x: point.x - bounds.x, y: point.y - bounds.y }
                  : null,
                [border],
              );
            }
        } catch {
          this.lost('cursor_tracking_failed');
        }
      }, 33);
      this.tracker.unref?.();
    } catch (error) {
      this.hide();
      throw error;
    }
  }
  hide() {
    this.closed = true;
    this.controller.abort(Error('Computer control indicator closed.'));
    clearInterval(this.tracker);
    this.tracker = null;
    const windows = this.windows;
    this.windows = [];
    for (const border of windows) {
      if (border.isDestroyed()) continue;
      // Hide every monitor immediately, even if destroying a different native
      // window fails. A single teardown error must never strand a visible border.
      try {
        border.hide?.();
      } catch {}
      try {
        border.destroy();
      } catch {
        try {
          border.close?.();
        } catch {}
      }
    }
  }
}
