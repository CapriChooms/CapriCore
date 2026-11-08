// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { setWindowAlwaysOnTop } from './window-topmost.mjs';
/** Security choices are centralized, including for isolated verification windows. */
export function createSecureWindow(
  BrowserWindow,
  { bounds, directory, verification, alwaysOnTop },
) {
  const window = new BrowserWindow({
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
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: verification,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
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
  return window;
}
