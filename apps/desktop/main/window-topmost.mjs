// SPDX-License-Identifier: GPL-3.0-only
/** Electron 45's default floating level can leave Windows HWNDs non-topmost.
 * Keep ordinary pinned UI at the tested normal level; special avatar/indicator
 * layers retain their separate policies. This never changes focus or position. */
export function setWindowAlwaysOnTop(view, value, platform = process.platform) {
  if (value && platform === 'win32') view.setAlwaysOnTop(true, 'normal');
  else view.setAlwaysOnTop(value);
}
