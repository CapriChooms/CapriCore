// SPDX-License-Identifier: GPL-3.0-only
import { uiText } from '../renderer/language-settings.mjs';
import { validateApplications } from '../../../integrations/desktop-actions/settings.mjs';

/** Capability changes stay explicit and are persisted before UI notification. */
export function registerAccessIpc(
  handle,
  { dialog, getWindow, getInterfaceLanguage, files, applications, ensureDesktopActions, emit },
) {
  handle('capri:file-folder-add', async (_value, { role }) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: uiText('Choose a folder Capri may read', getInterfaceLanguage()),
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    const settings =
      !result.canceled && result.filePaths.length === 1
        ? files.grant(result.filePaths[0], role)
        : files.snapshot();
    emit({ type: 'file-access', settings });
    return settings;
  });
  handle('capri:file-folder-write', (value, { role }) => {
    if (typeof value?.write !== 'boolean') throw new Error('Invalid folder permission');
    if (typeof value.id !== 'string' || value.id.length > 80)
      throw new Error('Folder permission no longer exists');
    const settings = files.write({ id: value.id, write: value.write }, role);
    emit({ type: 'file-access', settings });
    return settings;
  });
  handle('capri:file-folder-revoke', (id, { role }) => {
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid folder ID');
    const settings = files.revoke(id, role);
    emit({ type: 'file-access', settings });
    return settings;
  });
  handle('capri:file-folders-clear', (_value, { role }) => {
    const settings = files.clear(role);
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
