// SPDX-License-Identifier: GPL-3.0-only

export function nearestAvatarDock(point, bounds, radius, display = false) {
  if (!point || !bounds || !Number.isFinite(radius) || radius <= 0) return null;
  const { x, y, width, height } = bounds;
  const fx = (point.x - x) / width;
  const fy = (point.y - y) / height;
  const options = [];
  if (fx >= 0.04 && fx <= 0.96) {
    options.push({
      kind: display ? 'ceiling' : 'seat',
      edge: 'top',
      fraction: fx,
      distance: Math.abs(point.y - y),
    });
    if (!display)
      options.push({
        kind: 'ceiling',
        edge: 'bottom',
        fraction: fx,
        distance: Math.abs(point.y - y - height),
      });
  }
  if (fy >= 0.04 && fy <= 0.96) {
    options.push({ kind: 'left', edge: 'left', fraction: fy, distance: Math.abs(point.x - x) });
    options.push({
      kind: 'right',
      edge: 'right',
      fraction: fy,
      distance: Math.abs(point.x - x - width),
    });
  }
  const inside = options.filter(({ distance }) => distance <= radius);
  return inside.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

export function avatarDockPoint(bounds, { edge, fraction }) {
  const { x, y, width, height } = bounds;
  return {
    x: Math.round(edge === 'left' ? x : edge === 'right' ? x + width : x + width * fraction),
    y: Math.round(edge === 'top' ? y : edge === 'bottom' ? y + height : y + height * fraction),
  };
}

export function pointInReservedDesktop(point, { bounds, workArea }) {
  const contains = ({ x, y, width, height }) =>
    point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
  return contains(bounds) && !contains(workArea);
}

export function visibleAvatarDock(dock, contact, workArea) {
  // An underside coincident with the taskbar or monitor floor has nowhere to hang.
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  return (
    contact.x >= workArea.x - 1 &&
    contact.x <= right + 1 &&
    contact.y >= workArea.y - 1 &&
    contact.y <= bottom + 1 &&
    (dock.edge !== 'bottom' || dock.kind === 'floor' || contact.y < bottom - 2)
  );
}

export function nearestDisplayAvatarDock(point, { bounds, workArea }, radius) {
  if (!point || !Number.isFinite(radius) || radius <= 0) return null;
  const reserved = pointInReservedDesktop(point, { bounds, workArea });
  const edge = !reserved && nearestAvatarDock(point, bounds, radius, true);
  const visibleEdge =
    edge && visibleAvatarDock(edge, avatarDockPoint(bounds, edge), workArea)
      ? { ...edge, bounds }
      : null;
  const bottom = workArea.y + workArea.height;
  const fraction = (point.x - workArea.x) / workArea.width;
  // A bottom taskbar can receive the drop, but the sprite sits above it.
  const distance =
    reserved && point.y >= bottom
      ? Math.min(point.y - bottom, Math.abs(point.y - bounds.y - bounds.height))
      : Math.abs(point.y - bottom);
  if (
    (!reserved || point.y >= bottom) &&
    fraction >= 0.04 &&
    fraction <= 0.96 &&
    distance <= radius &&
    (!visibleEdge || distance < visibleEdge.distance)
  )
    return { kind: 'floor', edge: 'bottom', fraction, distance, bounds: workArea };
  return visibleEdge;
}

export function avatarDockFrame(frames, dock) {
  if (!dock) return undefined;
  const { kind, edge, display } = dock;
  if (kind === 'floor') return frames.get('pose-sit-floor');
  const spriteToRight = (edge === 'right') !== Boolean(display);
  const id =
    kind === 'seat'
      ? 'pose-sit-edge'
      : kind === 'ceiling'
        ? display
          ? 'pose-ceiling-upside-down'
          : 'pose-ceiling'
        : spriteToRight
          ? 'pose-dock-left'
          : 'pose-dock-right';
  return frames.get(id);
}
