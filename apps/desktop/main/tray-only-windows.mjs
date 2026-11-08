// SPDX-License-Identifier: GPL-3.0-only
/** Apply after native window construction, including its focusability options.
 * Keep companion surfaces out of the taskbar across native visibility changes.
 * Restoring Capri remains the responsibility of the existing tray/chip handlers. */
export function installTrayOnlyWindows(app) {
  const configure = (_event, view) => {
    const enforce = () => {
      if (!view.isDestroyed()) view.setSkipTaskbar(true);
    };
    enforce();
    for (const event of ['show', 'hide', 'minimize', 'restore']) view.on(event, enforce);
  };
  app.on('browser-window-created', configure);
  return () => app.removeListener('browser-window-created', configure);
}
