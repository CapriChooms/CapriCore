// SPDX-License-Identifier: GPL-3.0-only
export function settingsAvatarWindowId(view, url) {
  if (!view || view.isDestroyed() || view.webContents.getURL() !== url) return '';
  const handle = view.getNativeWindowHandle();
  if (handle.length !== 4 && handle.length !== 8) return '';
  return String(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE());
}

/** Own Settings needs no global mouse hook or periodic native discovery to follow its window. */
export function watchAvatarSettingsWindow(view, record, { processId, url, onChange }) {
  if (
    record.processId !== String(processId) ||
    !record.windowId ||
    record.windowId !== settingsAvatarWindowId(view, url)
  )
    return null;
  let stopped = false;
  const update = () => {
    if (stopped) return;
    onChange(
      view.isDestroyed()
        ? { state: 'closed' }
        : view.isVisible() && !view.isMinimized()
          ? { state: 'visible', dipBounds: view.getBounds() }
          : { state: 'hidden' },
    );
  };
  const events = ['move', 'resize', 'show', 'focus', 'hide', 'minimize', 'restore', 'closed'];
  for (const event of events) view.on(event, update);
  update();
  return () => {
    stopped = true;
    for (const event of events) view.off(event, update);
  };
}
