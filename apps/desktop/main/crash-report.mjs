// SPDX-License-Identifier: GPL-3.0-only

export const rendererCrashReasons = Object.freeze([
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'memory-eviction',
]);
export const crashReportInput = Object.freeze({
  category: 'startup',
  title: 'Capri closed unexpectedly',
  includeLogs: true,
});

export function crashReporter({
  dialog,
  openLogs,
  saveReport,
  text = (key) => key,
  enabled = () => true,
  now = Date.now,
}) {
  let active = false;
  let lastPrompt = -Infinity;
  return async ({ surface, reason, exitCode }) => {
    if (
      active ||
      now() - lastPrompt < 60_000 ||
      !enabled() ||
      (surface !== 'desktop' && !rendererCrashReasons.includes(reason))
    )
      return;
    active = true;
    lastPrompt = now();
    const crash = {
      crashSurface: surface,
      crashReason: surface === 'desktop' ? 'process-exit' : reason,
      timeMs: lastPrompt,
      ...(Number.isSafeInteger(exitCode) ? { exitCode } : {}),
    };
    try {
      // Ask the shell before showing the message so the user can find the logs
      // even if they close the prompt instead of saving the diagnostic archive.
      const logsOpened = await Promise.resolve()
        .then(openLogs)
        .catch(() => false);
      if (!enabled()) return;
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Capri',
        message: text('Capri closed unexpectedly.'),
        detail: [
          logsOpened ? 'The logs folder is open.' : 'The logs folder could not be opened.',
          'Save and review a diagnostic ZIP, then send it to Overyx in a Discord direct message.',
        ]
          .map(text)
          .join('\n\n'),
        buttons: ['Save report', 'Dismiss'].map(text),
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0 && enabled()) await saveReport(crash);
    } catch {
      if (enabled())
        await dialog
          .showMessageBox({
            type: 'error',
            title: 'Capri',
            message: text('The crash report could not be saved.'),
            detail: text('You can try saving a report from Report a bug after restarting Capri.'),
          })
          .catch(() => {});
    } finally {
      active = false;
    }
  };
}
