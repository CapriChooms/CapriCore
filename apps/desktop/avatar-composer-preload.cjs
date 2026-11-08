// SPDX-License-Identifier: GPL-3.0-only
const { contextBridge, ipcRenderer } = require('electron');

// Only the mini composer protocol crosses the bridge. Main validates each action
// and delegates to the existing owner renderer; this surface has no file/chat API.
contextBridge.exposeInMainWorld(
  'capriMini',
  Object.freeze({
    bootstrap: () => ipcRenderer.invoke('capri:avatar-composer-bootstrap'),
    action: (value) => ipcRenderer.invoke('capri:avatar-composer-action', value),
    resize: (height) => ipcRenderer.invoke('capri:avatar-composer-resize', height),
    hide: () => ipcRenderer.invoke('capri:avatar-composer-hide'),
    onState: (callback) => {
      if (typeof callback !== 'function') throw new TypeError('A state callback is required.');
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('capri:avatar-composer-state', listener);
      return () => ipcRenderer.removeListener('capri:avatar-composer-state', listener);
    },
  }),
);
