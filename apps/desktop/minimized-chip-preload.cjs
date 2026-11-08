// SPDX-License-Identifier: GPL-3.0-only
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'capriChip',
  Object.freeze({
    restore: () => ipcRenderer.invoke('capri:chip-restore'),
    drag: (action) => ipcRenderer.invoke('capri:chip-drag', action),
    onLabels: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('capri:chip-labels', listener);
      return () => ipcRenderer.removeListener('capri:chip-labels', listener);
    },
  }),
);
