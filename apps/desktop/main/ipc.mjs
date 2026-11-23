// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
export const settingsVersion = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** IPC is admitted only from the current window's exact local main frame. */
export function createIpcHandler(
  ipcMain,
  {
    getWindow,
    url,
    getSettingsWindow = () => null,
    settingsUrl,
    settingsChannels = [],
    revisionReaders = {},
  },
) {
  const writes = new Map();
  return (channel, callback) => {
    if (!/^capri:[a-z-]+$/.test(channel)) throw new Error('Invalid IPC channel');
    ipcMain.handle(channel, (event, value) => {
      let owner = getWindow(),
        role = 'companion',
        expectedUrl = url;
      const settings = getSettingsWindow();
      if (settings && !settings.isDestroyed() && event.sender === settings.webContents) {
        if (!settingsChannels.includes(channel))
          throw new Error('IPC channel unavailable to settings');
        owner = settings;
        role = 'settings';
        expectedUrl = settingsUrl;
      }
      if (
        !owner ||
        owner.isDestroyed() ||
        event.sender !== owner.webContents ||
        event.senderFrame !== owner.webContents.mainFrame ||
        event.senderFrame.url !== expectedUrl
      )
        throw new Error('Untrusted IPC sender');
      if (role === 'settings' && revisionReaders[channel]) {
        const task = Promise.resolve(writes.get(channel))
          .catch(() => {})
          .then(async () => {
            if (!value || value.expectedRevision !== settingsVersion(revisionReaders[channel]()))
              throw new Error('Settings changed elsewhere. Apply or discard your draft.');
            await callback(value.payload, { role });
            const settings = revisionReaders[channel]();
            return { settings, revision: settingsVersion(settings) };
          });
        writes.set(channel, task);
        task
          .finally(() => {
            if (writes.get(channel) === task) writes.delete(channel);
          })
          .catch(() => {});
        return task;
      }
      return callback(value, { role, frame: event.senderFrame });
    });
  };
}
