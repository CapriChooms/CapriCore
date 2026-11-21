// SPDX-License-Identifier: GPL-3.0-only
// This detector reports placement geometry only. It does not focus or operate an app.

const hwnd = /^[1-9]\d{0,19}$/;
const pid = /^[1-9]\d{0,9}$/;
const sourceWindow = /^window:([1-9]\d{0,19}):\d+$/;
const controlId = /^-?\d{1,10}(?:\.-?\d{1,10}){0,19}$/;
const rectKeys = ['x', 'y', 'width', 'height'];
const targetLimit = 20;
const maximumCoordinate = 2 ** 24;

function rect(value) {
  if (
    !value ||
    !rectKeys.every(
      (key) => Number.isSafeInteger(value[key]) && Math.abs(value[key]) < maximumCoordinate,
    ) ||
    value.width < 1 ||
    value.height < 1
  )
    return null;
  return Object.fromEntries(rectKeys.map((key) => [key, value[key]]));
}

function identity(value) {
  if (
    !value ||
    typeof value.windowId !== 'string' ||
    typeof value.processId !== 'string' ||
    typeof value.startedAtTicks !== 'string' ||
    !hwnd.test(value.windowId) ||
    !pid.test(value.processId) ||
    !hwnd.test(value.startedAtTicks)
  )
    return null;
  return {
    windowId: value.windowId,
    processId: value.processId,
    startedAtTicks: value.startedAtTicks,
  };
}

const sameWindow = (a, b) =>
  a.windowId === b.windowId && a.processId === b.processId && a.startedAtTicks === b.startedAtTicks;

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function containsPoint(bounds, point) {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function containsRect(outer, inner) {
  return (
    containsPoint(outer, inner) &&
    containsPoint(outer, { x: inner.x + inner.width - 1, y: inner.y + inner.height - 1 })
  );
}

function allowedDisplayClips(screen, capture, watchingWindow) {
  const displays = screen.getAllDisplays();
  if (!Array.isArray(displays) || displays.length < 1 || displays.length > 8) return [];
  let allowed;
  if (watchingWindow) allowed = displays;
  else if (capture.allMonitors === true) {
    if (!Array.isArray(capture.displayIds) || capture.displayIds.length < 2) return [];
    allowed = displays.filter(({ id }) => capture.displayIds.includes(String(id)));
    if (allowed.length !== capture.displayIds.length) return [];
  } else if (capture.displayId) {
    allowed = displays.filter(({ id }) => String(id) === String(capture.displayId));
  } else {
    // Without a display ID, only a sole monitor can be the selected monitor.
    allowed = displays.length === 1 ? displays : [];
  }
  return allowed.flatMap((display) => {
    const dip = rect(display.bounds);
    if (!dip || !Number.isSafeInteger(display.id)) return [];
    const physical = rect(screen.dipToScreenRect(null, dip));
    return physical ? [{ id: display.id, dip, physical }] : [];
  });
}

function projectPoint(point, { dip, physical }) {
  return {
    x: Math.round(dip.x + ((point.x - physical.x) * dip.width) / physical.width),
    y: Math.round(dip.y + ((point.y - physical.y) * dip.height) / physical.height),
  };
}

function projectRect(bounds, display) {
  const first = projectPoint(bounds, display);
  const last = projectPoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, display);
  return { ...first, width: Math.max(1, last.x - first.x), height: Math.max(1, last.y - first.y) };
}

function parseTargets(result, displays, exactWindow, ignoredProcessId) {
  if (!Array.isArray(result?.targets) || result.targets.length > targetLimit) return [];
  const targets = new Map();
  for (const candidate of result.targets) {
    if (!candidate || !Number.isSafeInteger(candidate.clipIndex)) continue;
    const display = displays[candidate.clipIndex];
    const windowIdentity = identity(candidate.window);
    const windowBounds = rect(candidate.window);
    const bounds = rect(candidate.bounds);
    const point = candidate.point;
    if (
      !display ||
      !windowIdentity ||
      windowIdentity.processId === ignoredProcessId ||
      (exactWindow && !sameWindow(windowIdentity, exactWindow)) ||
      !windowBounds ||
      !bounds ||
      !containsRect(windowBounds, bounds) ||
      !containsRect(display.physical, bounds) ||
      !Number.isSafeInteger(point?.x) ||
      !Number.isSafeInteger(point?.y) ||
      !containsPoint(bounds, point)
    )
      continue;
    const top = candidate.kind === 'window-top' && bounds.y === windowBounds.y;
    const field =
      candidate.kind === 'search-field' &&
      typeof candidate.controlId === 'string' &&
      controlId.test(candidate.controlId) &&
      ['search', 'address'].includes(candidate.searchKind);
    if (!top && !field) continue;
    const id = [
      windowIdentity.windowId,
      windowIdentity.processId,
      windowIdentity.startedAtTicks,
      top ? 'top' : candidate.controlId,
    ].join(':');
    if (targets.has(id)) continue;
    const window = { ...windowIdentity, ...windowBounds };
    // The rightmost native pixel at fractional DPI can round into the next display.
    const destination = projectPoint(point, display);
    const dips = projectRect(bounds, display);
    const work = display.dip;
    dips.x = Math.min(dips.x, work.x + work.width - 1);
    dips.y = Math.min(dips.y, work.y + work.height - 1);
    dips.width = Math.min(dips.width, work.x + work.width - dips.x);
    dips.height = Math.min(dips.height, work.y + work.height - dips.y);
    destination.x = Math.min(destination.x, dips.x + dips.width - 1);
    destination.y = Math.min(destination.y, dips.y + dips.height - 1);
    targets.set(id, {
      id,
      kind: candidate.kind,
      ...(field && { searchKind: candidate.searchKind }),
      bounds: dips,
      point: destination,
      displayId: display.id,
      windowId: window.windowId,
      window,
    });
  }
  return [...targets.values()];
}

/** Read a bounded set of visible native targets under the exact current observation lease. */
export function createAvatarScreenTargetDetector({
  capturePolicy,
  screen,
  avatarWindow,
  callApplicationBridge,
  permitted,
  now = Date.now,
  ignoreProcessId = process.pid,
  ownedOverlayWindowIds = () => [],
}) {
  const ignoredProcessId = String(ignoreProcessId);
  return {
    async detect({ signal, windowId } = {}) {
      signal?.throwIfAborted();
      const capture = capturePolicy.capture;
      const allowed = () =>
        !signal?.aborted &&
        permitted() &&
        capturePolicy.capture === capture &&
        capture?.mode === 'watch' &&
        capture.phase === 'capturing' &&
        capture.expiresAt > now();
      try {
        if (!allowed() || typeof capture.nativeId !== 'string') return [];
        if (windowId !== undefined && (typeof windowId !== 'string' || !hwnd.test(windowId)))
          return [];
        const watchingWindow = sourceWindow.exec(capture.nativeId)?.[1];
        if (
          (!watchingWindow && !/^screen:\d+:\d+$/.test(capture.nativeId)) ||
          (watchingWindow && windowId && windowId !== watchingWindow)
        )
          return [];
        if (!(await capturePolicy.checkActive(capture.id)) || !allowed()) return [];

        const displays = allowedDisplayClips(screen, capture, watchingWindow);
        if (!displays.length) return [];
        const selectedWindow = watchingWindow || windowId;
        let exactWindow;
        if (selectedWindow) {
          const record = await avatarWindow({ windowId: selectedWindow });
          exactWindow = identity(record);
          const windowBounds = rect(record);
          if (
            !allowed() ||
            !exactWindow ||
            exactWindow.windowId !== selectedWindow ||
            exactWindow.processId === ignoredProcessId ||
            !windowBounds ||
            !displays.some((display) => intersects(display.physical, windowBounds))
          )
            return [];
        }
        const overlayIds = ownedOverlayWindowIds();
        const overlays = Array.isArray(overlayIds)
          ? [...new Set(overlayIds.filter((id) => typeof id === 'string' && hwnd.test(id)))].slice(
              0,
              4,
            )
          : [];
        const result = await callApplicationBridge(
          {
            action: 'avatar_screen_targets',
            ...(exactWindow ?? {}),
            ignoreProcessId: ignoredProcessId,
            clips: displays.map(({ physical }) => physical),
            overlays,
          },
          { signal, stillAllowed: allowed },
        );
        signal?.throwIfAborted();
        const revalidated = allowed() && (await capturePolicy.checkActive(capture.id));
        if (
          !revalidated ||
          !allowed() ||
          JSON.stringify(displays) !==
            JSON.stringify(allowedDisplayClips(screen, capture, watchingWindow))
        )
          return [];
        return parseTargets(result, displays, exactWindow, ignoredProcessId);
      } catch {
        signal?.throwIfAborted();
        return [];
      }
    },
  };
}
