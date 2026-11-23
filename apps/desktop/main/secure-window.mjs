// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { setWindowAlwaysOnTop } from './window-topmost.mjs';
import { WindowResizeSurface } from './window-resize-surface.mjs';

/** Security choices are centralized, including for isolated verification windows. */
export function createSecureWindow(
  { BaseWindow, BrowserWindow, WebContentsView },
  { bounds, directory, verification, alwaysOnTop, softwareRendering = false },
) {
  const options = {
    ...bounds,
    title: verification ? 'Capri Verification' : 'Capri',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop,
    focusable: !verification,
    autoHideMenuBar: true,
    hasShadow: false,
  };
  const webPreferences = {
    preload: path.join(directory, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    devTools: verification,
    // In software mode the portrait uses its CSS renderer instead of CPU WebGL.
    webgl: !softwareRendering,
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',
  };
  let window, resizeSurface;
  if (process.platform === 'win32') {
    window = new BaseWindow(options);
    const view = new WebContentsView({ webPreferences });
    view.setBackgroundColor('#00000000');
    window.contentView.addChildView(view);
    window.webContents = view.webContents;
    resizeSurface = new WindowResizeSurface(window, view);
    window.on('closed', () => {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    });
  } else {
    window = new BrowserWindow({ ...options, webPreferences });
  }
  setWindowAlwaysOnTop(window, Boolean(alwaysOnTop));
  window.setMenu(null);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-attach-webview'])
    window.webContents.on(event, (value) => value.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' || (input.control && ['r', 'R'].includes(input.key)))
      event.preventDefault();
  });
  return { window, resizeSurface };
}
