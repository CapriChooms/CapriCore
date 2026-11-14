export const DEFAULT_AVATAR_LAYOUT = Object.freeze({ x: 0.5, y: 1, zoom: 1.15 });
export const MIN_AVATAR_ZOOM = 0.6;
export const MAX_AVATAR_ZOOM = 3;
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

export function validateAvatarLayout(value) {
  if (
    !value ||
    !['x', 'y', 'zoom'].every((key) => Number.isFinite(value[key])) ||
    value.x < 0 ||
    value.x > 1 ||
    value.y < 0 ||
    value.y > 1 ||
    value.zoom < MIN_AVATAR_ZOOM ||
    value.zoom > MAX_AVATAR_ZOOM
  )
    throw new Error('Invalid avatar layout');
  return { x: value.x, y: value.y, zoom: value.zoom };
}

function panBounds(viewport, zoom) {
  const base = viewport.baseSize ?? Math.min(298, viewport.width, viewport.height);
  const size = base * zoom;
  const axis = (origin, available, alignEnd = false) => {
    const space = available - size;
    // Near a perfect fit there would otherwise be almost no travel. Keep at
    // least the room available at minimum zoom and allow full panning beyond it.
    const travel = Math.max(
      Math.abs(space),
      Math.abs(available - base * MIN_AVATAR_ZOOM),
      available * 0.4,
    );
    const margin = travel - Math.abs(space);
    const start = origin + Math.min(0, space) - margin * (alignEnd ? 1 : 0.5);
    if (!viewport.centerFaces) return { start, travel };
    // The old bottom-aligned range cannot put a face in the middle at some
    // zoom levels. The home camera also permits centering points in the canvas.
    const first = Math.min(start, origin + available / 2 - size);
    const last = Math.max(start + travel, origin + available / 2);
    return { start: first, travel: last - first };
  };
  return { size, x: axis(viewport.x, viewport.width), y: axis(viewport.y, viewport.height, true) };
}

/** Stored positions are normalized across the available pan range. */
export function avatarRect(layout, viewport) {
  const { size, x, y } = panBounds(viewport, layout.zoom);
  return {
    x: x.start + x.travel * layout.x,
    y: y.start + y.travel * layout.y,
    width: size,
    height: size,
  };
}

/** Shared canvas scale; align authored contacts instead of trimming each pose. */
export function registeredAvatarRect(
  layout,
  viewport,
  frame,
  canvas = { width: 1254, height: 1254 },
) {
  const rect = avatarRect(layout, viewport);
  if (!frame?.anchor) return rect;
  const referenceY = frame.anchor.name === 'seat' ? 807 : 1166;
  return {
    ...rect,
    x: rect.x + ((627 - frame.anchor.x) / canvas.width) * rect.width,
    y: rect.y + ((referenceY - frame.anchor.y - 75) / canvas.height) * rect.height,
  };
}

/** Frame the whole sleeping silhouette, with room for the drifting Zs. */
export function sleepingAvatarRect(viewport, { x, y, width, height }, zoom) {
  const scale = Math.min(
    (viewport.baseSize * zoom) / 1254,
    (viewport.width * 0.94) / width,
    (viewport.height * 0.84) / height,
  );
  return {
    x: viewport.x + viewport.width / 2 - (x + width / 2) * scale,
    y: viewport.y + viewport.height * 0.53 - (y + height / 2) * scale,
    width: 1254 * scale,
    height: 1254 * scale,
  };
}

export function moveAvatar(layout, viewport, dx, dy) {
  const { x, y } = panBounds(viewport, layout.zoom);
  return {
    x: clamp(layout.x + dx / x.travel, 0, 1),
    y: clamp(layout.y + dy / y.travel, 0, 1),
    zoom: layout.zoom,
  };
}

/** Authored face landmarks share the sprite's untrimmed 1254-pixel canvas. */
export function avatarFacePoint(layout, viewport, frame, face = [646, 400]) {
  const rect = registeredAvatarRect(layout, viewport, frame);
  return {
    x: rect.x + (face[0] / 1254) * rect.width,
    y: rect.y + (face[1] / 1254) * rect.height,
  };
}

/** Recover a visible face without changing the user's zoom or stretching a pose. */
export function centerAvatarFace(layout, viewport, frame, face) {
  const point = avatarFacePoint(layout, viewport, frame, face);
  return moveAvatar(
    layout,
    viewport,
    viewport.x + viewport.width / 2 - point.x,
    viewport.y + viewport.height / 2 - point.y,
  );
}

/** Keep the image point under the cursor still while zooming, until an edge clamps. */
export function zoomAvatar(layout, viewport, zoom, anchor) {
  const rect = avatarRect(layout, viewport);
  const next = { ...layout, zoom: clamp(zoom, MIN_AVATAR_ZOOM, MAX_AVATAR_ZOOM) };
  const { size, x, y } = panBounds(viewport, next.zoom);
  const point = anchor ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const left = point.x - ((point.x - rect.x) / rect.width) * size;
  const top = point.y - ((point.y - rect.y) / rect.height) * size;
  next.x = clamp((left - x.start) / x.travel, 0, 1);
  next.y = clamp((top - y.start) / y.travel, 0, 1);
  return next;
}

/** Crop the hit rectangle, but keep its coordinates in the original PNG canvas. */
export function clippedAvatarRect(rect, bounds, viewport = { x: 0, y: 0, ...bounds }) {
  const x = Math.max(0, viewport.x, rect.x),
    y = Math.max(0, viewport.y, rect.y);
  const width = Math.min(bounds.width, viewport.x + viewport.width, rect.x + rect.width) - x;
  const height = Math.min(bounds.height, viewport.y + viewport.height, rect.y + rect.height) - y;
  if (width <= 0 || height <= 0) throw new Error('Avatar outside window');
  return {
    x,
    y,
    width,
    height,
    source: {
      x: (x - rect.x) / rect.width,
      y: (y - rect.y) / rect.height,
      width: width / rect.width,
      height: height / rect.height,
    },
  };
}
