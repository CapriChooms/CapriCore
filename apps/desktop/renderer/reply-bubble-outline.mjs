// SPDX-License-Identifier: GPL-3.0-only
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const nonnegative = (value, fallback = 0) =>
  Number.isFinite(value) ? Math.max(0, value) : fallback;

// Scale only when subtracting extreme coordinates would overflow.
function direction(from, to) {
  let dx = to.x - from.x,
    dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    const scale = Math.max(Math.abs(from.x), Math.abs(from.y), Math.abs(to.x), Math.abs(to.y));
    dx = to.x / scale - from.x / scale;
    dy = to.y / scale - from.y / scale;
  }
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (!scale) return { x: 0, y: 0, distance: 0 };
  const length = Math.hypot(dx / scale, dy / scale);
  return { x: dx / scale / length, y: dy / scale / length, distance };
}

/** One clockwise outline, in coordinates local to the rectangular bubble body. */
export function replyBubbleOutline({
  width,
  height,
  targetX,
  targetY,
  anchorX,
  anchorY,
  radius = 9,
  tailLength = 16,
  tailWidth = 18,
} = {}) {
  const w = nonnegative(width),
    h = nonnegative(height),
    r = Math.min(nonnegative(radius, 9), w / 2, h / 2),
    length = Math.min(nonnegative(tailLength, 16), 16),
    requestedWidth = nonnegative(tailWidth, 18);
  let side = null,
    tip = null,
    base = null,
    start,
    end;

  if (
    w > 0 &&
    h > 0 &&
    length > 0 &&
    requestedWidth > 0 &&
    Number.isFinite(targetX) &&
    Number.isFinite(targetY)
  ) {
    const outsideX = targetX < 0 || targetX > w,
      outsideY = targetY < 0 || targetY > h;
    if (outsideX || outsideY) {
      // For corner targets, use the side met by a ray from the body's center.
      const horizontal =
        outsideX && (!outsideY || Math.abs(targetX / w - 0.5) > Math.abs(targetY / h - 0.5));
      side = horizontal ? (targetX < 0 ? 'left' : 'right') : targetY < 0 ? 'top' : 'bottom';
      const edgeLength = horizontal ? h : w,
        halfWidth = Math.min(requestedWidth, Math.max(0, edgeLength - 2 * r)) / 2;
      if (halfWidth > 0) {
        const center = clamp(
          horizontal
            ? Number.isFinite(anchorY)
              ? anchorY
              : targetY
            : Number.isFinite(anchorX)
              ? anchorX
              : targetX,
          r + halfWidth,
          edgeLength - r - halfWidth,
        );
        base = horizontal
          ? { x: side === 'left' ? 0 : w, y: center }
          : { x: center, y: side === 'top' ? 0 : h };
        const toward = direction(base, { x: targetX, y: targetY }),
          reach = Math.min(length, toward.distance);
        start = center - halfWidth;
        end = center + halfWidth;
        tip = { x: base.x + toward.x * reach, y: base.y + toward.y * reach };
      } else side = null;
    }
  }

  const commands = [`M ${r} 0`],
    line = (x, y) => commands.push(`L ${x} ${y}`),
    corner = (x, y, endX, endY) => commands.push(`Q ${x} ${y} ${endX} ${endY}`),
    tail = (edge) => {
      if (side !== edge) return;
      if (edge === 'top' || edge === 'bottom') {
        const y = edge === 'top' ? 0 : h;
        line(edge === 'top' ? start : end, y);
        line(tip.x, tip.y);
        line(edge === 'top' ? end : start, y);
      } else {
        const x = edge === 'left' ? 0 : w;
        line(x, edge === 'right' ? start : end);
        line(tip.x, tip.y);
        line(x, edge === 'right' ? end : start);
      }
    };

  tail('top');
  line(w - r, 0);
  corner(w, 0, w, r);
  tail('right');
  line(w, h - r);
  corner(w, h, w - r, h);
  tail('bottom');
  line(r, h);
  corner(0, h, 0, h - r);
  tail('left');
  line(0, r);
  corner(0, 0, r, 0);
  commands.push('Z');

  const x = Math.min(0, tip?.x ?? 0),
    y = Math.min(0, tip?.y ?? 0);
  return {
    path: commands.join(' '),
    side,
    tip,
    base,
    bounds: { x, y, width: Math.max(w, tip?.x ?? w) - x, height: Math.max(h, tip?.y ?? h) - y },
  };
}
