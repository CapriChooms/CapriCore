// SPDX-License-Identifier: GPL-3.0-only
import { app, dialog, shell } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { DeveloperDiagnostics } from './diagnostics/developer.mjs';
import { createDiagnosticReport } from './diagnostics/report.mjs';
import { saveDiagnosticReport } from './diagnostics/save.mjs';
import { uiText } from './interface-translations.mjs';
import { crashReporter, crashReportInput } from './main/crash-report.mjs';
import { localizedDialog } from './main/localized-dialog.mjs';

// The launcher starts this process after the main Electron process has stopped.
// Only native dialogs and diagnostics are needed, so do not start any renderer.
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(showReport)
  .then(() => app.quit())
  .catch(() => {
    console.error('CAPRI_CRASH_REPORT_FAILED');
    app.exit(1);
  });

function showReport() {
  let language = app.getLocale().split('-')[0];
  try {
    const preferences = JSON.parse(
      readFileSync(path.join(root, 'data/desktop/languages.json'), 'utf8'),
    );
    language = preferences.settings?.interface ?? preferences.interface ?? language;
  } catch {}
  const text = (message) => uiText(message, language);
  const logs = new DeveloperDiagnostics({ root });
  const report = crashReporter({
    dialog,
    text,
    openLogs: async () => !(await shell.openPath(await logs.folder())),
    saveReport: (desktopCrash) =>
      saveDiagnosticReport({
        dialog: localizedDialog(dialog, text),
        shell,
        createReport: () =>
          createDiagnosticReport({
            root,
            input: crashReportInput,
            snapshot: { desktopCrash },
            pythonProbe: async () => ({ available: false }),
          }),
      }),
  });
  const exit = /^--capri-desktop-exit-code=(-?\d{1,10})$/u.exec(process.argv.at(-1) ?? '');
  return report({ surface: 'desktop', exitCode: exit ? Number(exit[1]) : undefined });
}
