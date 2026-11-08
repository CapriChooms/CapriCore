// SPDX-License-Identifier: GPL-3.0-only
import { uiText } from '../renderer/language-settings.mjs';
import { validateApplications } from '../../../integrations/desktop-actions/settings.mjs';

/** Capability changes stay explicit and are persisted before UI notification. */
export function registerAccessIpc(
  handle,
  {
    dialog,
    getWindow,
    getInterfaceLanguage,
    filePermissions,
    fileAccessSnapshot,
    applications,
    ensureDesktopActions,
    emit,
  },
) {
  handle('capri:file-folder-add', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: uiText('Choose a folder Capri may read', getInterfaceLanguage()),
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    if (!result.canceled && result.filePaths.length === 1)
      filePermissions.grant(result.filePaths[0]);
    const settings = fileAccessSnapshot();
    emit({ type: 'file-access', settings });
    return settings;
  });
  handle('capri:file-folder-write', (value) => {
    filePermissions.update(value?.id, value?.write);
    const settings = fileAccessSnapshot();
    emit({ type: 'file-access', settings });
    return settings;
  });
  handle('capri:file-folder-revoke', (id) => {
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid folder ID');
    filePermissions.revoke(id);
    const settings = fileAccessSnapshot();
    emit({ type: 'file-access', settings });
    return settings;
  });
  handle('capri:file-folders-clear', () => {
    filePermissions.save([]);
    const settings = fileAccessSnapshot();
    emit({ type: 'file-access', settings });
    return settings;
  });
  handle('capri:applications', (value) => {
    const next = validateApplications(value);
    if (next.notepad || next.calculator) ensureDesktopActions();
    const settings = applications.set(next);
    emit({ type: 'applications', settings });
    return settings;
  });
}
