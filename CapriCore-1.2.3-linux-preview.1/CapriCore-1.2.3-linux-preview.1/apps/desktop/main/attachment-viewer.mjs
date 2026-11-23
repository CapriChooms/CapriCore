// SPDX-License-Identifier: GPL-3.0-only
import { validateInterfaceTheme } from '../renderer/interface-theme.mjs';
import { ATTACHMENT_ID } from '../attachment-history.mjs';

const URL = 'capri://desktop/attachment-viewer.html';

/** A separate image-only surface: no preload, IPC bridge or application tools. */
export class AttachmentViewer {
  constructor({ BrowserWindow, screen, history, getOwner, getTheme, getLabels }) {
    Object.assign(this, { BrowserWindow, screen, history, getOwner, getTheme, getLabels });
    this.window = null;
    this.id = null;
    this.revision = 0;
  }
  async open(id) {
    if (typeof id !== 'string' || !ATTACHMENT_ID.test(id)) return false;
    const metadata = this.history.metadata(id);
    if (!metadata?.preview || !this.history.read(id, 'preview')) return false;
    this.close();
    const revision = this.revision;
    const owner = this.getOwner();
    const display =
      owner && !owner.isDestroyed()
        ? this.screen.getDisplayMatching(owner.getBounds())
        : this.screen.getPrimaryDisplay();
    const view = new this.BrowserWindow({
      ...display.bounds,
      title: 'Capri · ' + (this.getLabels().preview ?? 'Preview'),
      fullscreen: true,
      frame: false,
      show: false,
      backgroundColor: '#07131c',
      autoHideMenuBar: true,
      alwaysOnTop: Boolean(owner && !owner.isDestroyed() && owner.isAlwaysOnTop()),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        devTools: false,
      },
    });
    this.window = view;
    this.id = id;
    view.setMenu(null);
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview'])
      view.webContents.on(event, (value) => value.preventDefault());
    view.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape') {
        event.preventDefault();
        if (this.window === view) this.close();
      } else if (input.key === 'F5' || (input.control && /^(?:r|R)$/.test(input.key)))
        event.preventDefault();
    });
    view.webContents.on('render-process-gone', () => {
      if (this.window === view) this.close();
    });
    view.on('closed', () => {
      if (this.window === view) {
        this.window = null;
        this.id = null;
      }
    });
    try {
      await view.loadURL(URL);
      if (revision !== this.revision || view.isDestroyed() || this.window !== view) return false;
      if (!this.history.read(id, 'preview')) {
        this.close();
        return false;
      }
      const payload = {
        id,
        name: metadata.name,
        theme: validateInterfaceTheme(this.getTheme()),
        labels: this.getLabels(),
      };
      const ready = await view.webContents.executeJavaScript(
        'globalThis.capriAttachmentViewer.show(' + JSON.stringify(payload) + ')',
      );
      if (revision !== this.revision || view.isDestroyed() || this.window !== view) return false;
      if (ready !== true) {
        this.close();
        return false;
      }
      view.show();
      view.focus();
      return true;
    } catch {
      if (this.window === view) this.close();
      return false;
    }
  }
  closeIfUnavailable() {
    if (this.id && !this.history.read(this.id, 'preview')) this.close();
  }
  close() {
    this.revision++;
    const view = this.window;
    this.window = null;
    this.id = null;
    if (view && !view.isDestroyed()) view.destroy();
  }
}
