const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'capriAvatarCamera',
  Object.freeze({
    publishFrame: (frame) => ipcRenderer.invoke('capri:avatar-camera-frame', frame),
    publishPreview: (frame) => ipcRenderer.invoke('capri:avatar-camera-preview-frame', frame),
    backgroundImage: (revision) =>
      ipcRenderer.invoke('capri:avatar-camera-background-image', revision),
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('capri:avatar-camera-state', handler);
      return () => ipcRenderer.removeListener('capri:avatar-camera-state', handler);
    },
  }),
);
