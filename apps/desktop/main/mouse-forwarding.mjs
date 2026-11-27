// SPDX-License-Identifier: GPL-3.0-only
//
// setIgnoreMouseEvents(true, { forward: true }) makes Electron install a
// system-wide low-level mouse hook in this process on Windows. Every mouse
// movement on the computer then waits for this process to answer, so whenever
// it is busy or hung (startup, a crashed graphics process) the whole mouse
// freezes. Capri already decides which parts of its windows are clickable by
// polling the cursor position (PointerController.tick), so forwarding is only
// needed for hover effects while click-through. It is switched off here.

/** Whether click-through windows ask Electron to forward mouse movement. */
export const FORWARD_MOUSE = false;

/** Options for setIgnoreMouseEvents on every click-through Capri window. */
export function ignoreMouseOptions(forward = FORWARD_MOUSE) {
  return { forward: forward === true };
}

/** Sets click-through on a window without ever installing the global hook by accident. */
export function setClickThrough(window, ignored, forward = FORWARD_MOUSE) {
  if (!window || typeof window.setIgnoreMouseEvents !== 'function')
    throw new TypeError('setClickThrough needs a window.');
  window.setIgnoreMouseEvents(ignored === true, ignoreMouseOptions(forward));
}

/**
 * Whether the cursor position from screen.getCursorScreenPoint() can decide which
 * parts of a click-through window are clickable. On a Linux Wayland session Capri
 * runs under XWayland, which only sees pointer motion while the pointer is over an
 * X window. A click-through window is never one, so the reported position goes
 * stale and the window stays click-through for a real mouse. Polling is therefore
 * unreliable there; the caller must keep the window clickable instead.
 */
export function pointerPollingReliable(platform = process.platform, env = process.env) {
  if (platform !== 'linux') return true;
  return env.XDG_SESSION_TYPE !== 'wayland' && !env.WAYLAND_DISPLAY;
}
