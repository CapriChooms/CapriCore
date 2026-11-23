// SPDX-License-Identifier: GPL-3.0-only
import { fileURLToPath } from 'node:url';
import { setWindowAlwaysOnTop } from './window-topmost.mjs';
export const chipUrl = 'capri://desktop/minimized-chip.html';
const dragActions = new Set(['start', 'move', 'end', 'cancel']);
const point = (value) => Number.isFinite(value?.x) && Number.isFinite(value?.y);
/** Event-driven restore affordance. No idle cursor tracking or model initialization. */
export class MinimizedChip {
  constructor({
    BrowserWindow,
    screen,
    ipcMain,
    restore,
    url = chipUrl,
    channel = 'capri:chip-restore',
    preload = fileURLToPath(new URL('../minimized-chip-preload.cjs', import.meta.url)),
    width = 52,
    height = 52,
    top = false,
    getLabels = () => null,
    onClose = () => {},
    onUnavailable = () => {},
  }) {
    Object.assign(this, {
      BrowserWindow,
      screen,
      restore,
      url,
      preload,
      width,
      height,
      top,
      getLabels,
      onClose,
      onUnavailable,
    });
    this.draggable = url === chipUrl && channel === 'capri:chip-restore';
    ipcMain.handle(channel, (event) => {
      this.requireOwner(event);
      this.hide();
      restore();
      return true;
    });
    if (this.draggable)
      ipcMain.handle('capri:chip-drag', (event, action) => {
        this.requireOwner(event);
        if (!dragActions.has(action)) throw new Error('Invalid chip drag action.');
        return this.dragAction(action);
      });
    this.reposition = () => {
      this.cancelDrag();
      this.place();
    };
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
      screen.on(event, this.reposition);
  }
  requireOwner(event) {
    const contents = this.window && !this.window.isDestroyed() && this.window.webContents;
    if (
      !contents ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame ||
      contents.getURL() !== this.url
    )
      throw new Error('Invalid chip owner.');
  }
  areaAt(cursor) {
    return (this.screen.getDisplayNearestPoint?.(cursor) ?? this.screen.getPrimaryDisplay())
      .workArea;
  }
  clamp(bounds, area) {
    return {
      ...bounds,
      x: Math.round(
        Math.min(Math.max(bounds.x, area.x), area.x + Math.max(0, area.width - bounds.width)),
      ),
      y: Math.round(
        Math.min(Math.max(bounds.y, area.y), area.y + Math.max(0, area.height - bounds.height)),
      ),
    };
  }
  cancelDrag() {
    const moved = this.drag?.moved === true;
    this.drag = null;
    return { active: false, moved, cancelled: true };
  }
  dragAction(action) {
    if (action === 'cancel') return this.cancelDrag();
    if (!this.draggable || !this.window || this.window.isDestroyed() || !this.window.isVisible())
      return this.cancelDrag();
    const cursor = this.screen.getCursorScreenPoint();
    if (!point(cursor)) return this.cancelDrag();
    if (action === 'start') {
      this.cancelDrag();
      const bounds = this.window.getBounds();
      this.drag = { bounds, cursor: { ...cursor }, started: Date.now(), moved: false };
      return { active: true, moved: false, cancelled: false };
    }
    const gesture = this.drag;
    if (!gesture || Date.now() - gesture.started > 30000) return this.cancelDrag();
    const dx = cursor.x - gesture.cursor.x,
      dy = cursor.y - gesture.cursor.y;
    if (Math.hypot(dx, dy) >= 4) gesture.moved = true;
    if (gesture.moved) {
      const bounds = this.clamp(
        { ...gesture.bounds, x: gesture.bounds.x + dx, y: gesture.bounds.y + dy },
        this.areaAt(cursor),
      );
      if (!this.position || this.position.x !== bounds.x || this.position.y !== bounds.y) {
        this.window.setBounds(bounds, false);
        this.position = { x: bounds.x, y: bounds.y };
      }
    }
    const moved = gesture.moved;
    if (action === 'end') this.drag = null;
    return { active: action !== 'end', moved, cancelled: false };
  }
  place() {
    if (!this.window || this.window.isDestroyed()) return;
    const saved = this.position;
    const area = saved
      ? this.areaAt({ x: saved.x + this.width / 2, y: saved.y + this.height / 2 })
      : this.screen.getPrimaryDisplay().workArea;
    const bounds = this.clamp(
      {
        x: saved?.x ?? area.x + Math.max(0, area.width - this.width - 16),
        y: saved?.y ?? area.y + (this.top ? 12 : Math.max(0, area.height - this.height - 16)),
        width: this.width,
        height: this.height,
      },
      area,
    );
    this.window.setBounds(bounds, false);
    if (saved) this.position = { x: bounds.x, y: bounds.y };
  }
  async show() {
    this.cancelDrag();
    const generation = (this.generation = (this.generation ?? 0) + 1);
    if (!this.window || this.window.isDestroyed()) {
      const view = (this.window = new this.BrowserWindow({
        width: this.width,
        height: this.height,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: this.preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: true,
        },
      }));
      setWindowAlwaysOnTop(view, true);
      view.setMenu(null);
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.on('will-navigate', (event) => event.preventDefault());
      view.webContents.on('render-process-gone', () => view.destroy());
      view.on('hide', () => {
        if (this.window === view) this.cancelDrag();
      });
      view.on('closed', () => {
        if (this.window === view) {
          this.cancelDrag();
          this.window = null;
        }
        this.onClose();
      });
      this.ready = view.loadURL(this.url);
    }
    try {
      await this.ready;
      if (generation !== this.generation || !this.window || this.window.isDestroyed()) return;
      this.place();
      this.refreshLabels();
      this.window.showInactive();
    } catch {
      this.hide();
      this.onUnavailable();
    }
  }
  refreshLabels() {
    const value = this.getLabels();
    if (value && this.window && !this.window.isDestroyed())
      this.window.webContents.send('capri:chip-labels', value);
  }
  hide() {
    this.cancelDrag();
    this.generation = (this.generation ?? 0) + 1;
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }
  destroy() {
    this.hide();
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
      this.screen.removeListener(event, this.reposition);
    this.window?.destroy();
    this.window = null;
  }
}
