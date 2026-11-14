// SPDX-License-Identifier: GPL-3.0-only

// Native candidates already belong to the verified requested application and
// retain Windows' front-to-back order. App launch only activates a window; text
// entry still needs the currently observed window or one unambiguous candidate.
export function chooseApplicationWindow(
  result,
  { action, observedWindowId, ownerWindowTitle = '', requireUnique = false } = {},
) {
  if (
    result?.ok !== true ||
    result.needsWindow !== true ||
    result.inputPerformed !== false ||
    ownerWindowTitle ||
    !Array.isArray(result.windows)
  )
    return null;

  const candidates = result.windows.filter(
    (window) =>
      window && typeof window.windowId === 'string' && /^[1-9][0-9]{0,19}$/.test(window.windowId),
  );
  const observed = candidates.find((window) => window.windowId === observedWindowId);
  if (observed) return observed;
  if (candidates.length === 1 || (action === 'launch' && !requireUnique))
    return candidates[0] ?? null;
  return null;
}
