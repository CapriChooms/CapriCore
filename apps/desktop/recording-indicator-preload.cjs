// SPDX-License-Identifier: GPL-3.0-only
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'capriRecording',
  Object.freeze({
    stop: () => ipcRenderer.invoke('capri:recording-stop'),
    onLabels: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('capri:chip-labels', listener);
      return () => ipcRenderer.removeListener('capri:chip-labels', listener);
    },
  }),
);
