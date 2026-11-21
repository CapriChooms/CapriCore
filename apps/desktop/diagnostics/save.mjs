// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';

export async function saveDiagnosticReport({ dialog, shell, owner, createReport }) {
  const options = {
    title: 'Save and review bug report',
    defaultPath: `capri-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
    filters: [{ name: 'Diagnostic ZIP archive', extensions: ['zip'] }],
  };
  const destination = await (owner
    ? dialog.showSaveDialog(owner, options)
    : dialog.showSaveDialog(options));
  if (destination.canceled || !destination.filePath) return false;
  const report = await createReport();
  const temporary = `${destination.filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, report.bytes, { flag: 'wx' });
    await rename(temporary, destination.filePath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  shell.showItemInFolder?.(destination.filePath);
  return { saved: true, reportId: report.id, files: report.fileCount, bytes: report.bytes.length };
}
