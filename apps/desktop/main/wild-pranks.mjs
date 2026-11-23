// SPDX-License-Identifier: GPL-3.0-only

const duration = 1150;
const prankDelay = (random) => (120 + 120 * random()) * 1000;
const retryDelay = 10_000;

export function prankGeometry(point, display) {
  const width = Math.min(192, display.width);
  const height = Math.min(132, display.height);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const x = clamp(point.x - Math.floor(width / 2), display.x, display.x + display.width - width);
  const y = clamp(point.y - Math.floor(height / 2), display.y, display.y + display.height - height);
  const anchorX = clamp(point.x - x, 0, width - 1);
  const anchorY = clamp(point.y - y, 0, height - 1);
  const direction = anchorX <= width / 2 ? 1 : -1;
  return {
    bounds: { x, y, width, height },
    anchorX,
    anchorY,
    dx: direction * Math.min(75, Math.floor(width / 2)),
    dy:
      anchorY <= height / 2
        ? Math.min(32, Math.floor(height / 3))
        : -Math.min(32, Math.floor(height / 3)),
  };
}

/** Plays a short, click-through effect using the existing desktop tick. */
export class WildPranks {
  constructor({ BrowserWindow, screen, now = Date.now, random = Math.random }) {
    Object.assign(this, { BrowserWindow, screen, now, random });
  }

  tick(enabled, eligible) {
    if (!enabled) {
      this.nextAt = undefined;
      if (this.run?.automatic) this.stop();
      return;
    }
    this.nextAt ??= this.now() + prankDelay(this.random);
    if (this.run) {
      if (this.run.automatic && !eligible()) this.stop();
      return;
    }
    if (this.now() < this.nextAt) return;
    if (!eligible()) {
      this.nextAt = this.now() + retryDelay;
      return;
    }
    this.nextAt = this.now() + prankDelay(this.random);
    void this.play(true, eligible);
  }

  pause() {
    this.stop();
    this.nextAt = undefined;
  }

  stop() {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    clearTimeout(run.timer);
    if (!run.view.isDestroyed()) run.view.destroy();
  }

  async play(automatic, eligible) {
    let run;
    try {
      if (this.run || !eligible()) return false;
      const point = this.screen.getCursorScreenPoint();
      const { bounds, ...position } = prankGeometry(
        point,
        this.screen.getDisplayNearestPoint(point).bounds,
      );
      const variant = this.random() < 0.5 ? 'snatch' : 'glitch';
      const view = new this.BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      run = this.run = { view, automatic };
      run.timer = setTimeout(() => this.stop(), 3500);
      run.timer.unref();
      view.on('closed', () => {
        if (this.run === run) this.stop();
      });
      view.setIgnoreMouseEvents(true);
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.on('will-navigate', (event) => event.preventDefault());
      await view.loadURL('capri://desktop/wild-prank.html');
      if (this.run !== run) return false;
      if (!eligible()) {
        this.stop();
        return false;
      }
      view.showInactive();
      const rendered = await view.webContents.executeJavaScript(
        `globalThis.playWildPrank(${JSON.stringify({ ...position, variant, duration })})`,
      );
      if (this.run !== run) return false;
      if (rendered !== true) {
        this.stop();
        return false;
      }
      clearTimeout(run.timer);
      run.timer = setTimeout(() => this.stop(), duration + 80);
      run.timer.unref();
      return true;
    } catch {
      if (run && this.run === run) this.stop();
      return false;
    }
  }
}
