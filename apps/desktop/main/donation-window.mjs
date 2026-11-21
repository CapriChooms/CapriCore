// SPDX-License-Identifier: GPL-3.0-only
import { LAVA_DONATION_URL } from '../community-links.mjs';

const lavaOrigin = new URL(LAVA_DONATION_URL).origin;
const canNavigate = (value, mainFrame) => {
  const url = URL.parse(value);
  return (
    url?.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (!mainFrame || url.origin === lavaOrigin)
  );
};

export class DonationWindow {
  constructor({ BrowserWindow, session, shell, dialog, text }) {
    Object.assign(this, { BrowserWindow, session, shell, dialog, text });
  }

  async open(parent) {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      return this.loading ?? true;
    }
    if (!parent || parent.isDestroyed()) return false;
    const checkout = this.session.fromPartition('capri-donation', { cache: false });
    checkout.setPermissionCheckHandler(() => false);
    checkout.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const view = new this.BrowserWindow({
      parent,
      width: 700,
      height: 780,
      autoHideMenuBar: true,
      backgroundColor: '#10151e',
      title: 'Lava.top — Capri',
      webPreferences: {
        session: checkout,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        navigateOnDragDrop: false,
        devTools: false,
      },
    });
    this.window = view;
    view.setContentProtection(true);
    view.once('closed', () => {
      this.window = undefined;
      this.loading = undefined;
    });
    view.on('page-title-updated', (event) => event.preventDefault());

    let offeredBrowser = false;
    const offerBrowser = async () => {
      if (offeredBrowser || view.isDestroyed()) return;
      offeredBrowser = true;
      const label = this.text('Open donation in browser');
      try {
        const result = await this.dialog.showMessageBox(view, {
          title: 'Lava.top',
          message: label + '?',
          buttons: [label, this.text('Cancel')],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (result.response === 0 && !view.isDestroyed())
          await this.shell.openExternal(LAVA_DONATION_URL);
      } catch {
        // The Support page retains a browser button if this dialog could not open it.
      }
    };
    const contents = view.webContents;
    for (const eventName of ['will-frame-navigate', 'will-redirect']) {
      contents.on(eventName, (event) => {
        if (canNavigate(event.url, event.isMainFrame)) return;
        event.preventDefault();
        if (event.isMainFrame && canNavigate(event.url, false)) void offerBrowser();
      });
    }
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (canNavigate(url, false)) void offerBrowser();
      return { action: 'deny' };
    });

    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Donation page timed out')), 20000);
    });
    this.loading = Promise.race([view.loadURL(LAVA_DONATION_URL), deadline])
      .then(() => true)
      .catch(() => {
        if (view.isDestroyed()) return true;
        view.destroy();
        return false;
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.window === view) this.loading = undefined;
      });
    return this.loading;
  }
}
