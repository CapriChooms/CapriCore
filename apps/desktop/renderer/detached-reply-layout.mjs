// SPDX-License-Identifier: GPL-3.0-only
const clamp = (n, low, high) => Math.max(low, Math.min(Math.max(low, high), n));
const union = (rects) => {
  const x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
};

/** Event-driven placement: a collapsed tab reserves no invisible bubble space. */
export function detachedReplyLayout({
  width,
  height,
  faceX,
  faceY,
  crownY,
  scale,
  badge,
  reply,
  collapsed = false,
  inverted = false,
}) {
  const margin = 8,
    gap = 24;
  if (!badge.width || !badge.height) {
    const rw = Math.min(reply.width, width - 2 * margin - 24),
      rh = reply.height;
    const bubble = {
      x: clamp(faceX - rw / 2, margin, width - margin - rw - 24),
      y: clamp(crownY - 16 - rh, margin, height - margin - rh),
      width: rw,
      height: rh,
    };
    const tab = { x: bubble.x + rw - 1, y: bubble.y + (rh - 24) / 2, width: 24, height: 24 };
    return {
      side: 'right',
      badge: { x: tab.x, y: tab.y, width: 0, height: 0 },
      reply: bubble,
      tab,
      hud: union(collapsed ? [tab] : [bubble, tab]),
    };
  }
  const bw = Math.min(badge.width, width - 2 * margin),
    bh = badge.height;
  let rw = Math.min(reply.width, width - 2 * margin),
    rh = reply.height;
  const badgeX = clamp(faceX - bw / 2, margin, width - margin - bw);
  let badgeY = clamp(crownY - 16 - bh, margin, height - margin - bh);
  let side = 'above';
  const right = width - margin - badgeX - bw - gap,
    left = badgeX - margin - gap;
  if (inverted && height - margin - (faceY + scale * 0.28 + 16 + bh + gap) >= rh) side = 'below';
  else if (badgeY - margin - gap >= rh) side = 'above';
  else if (Math.max(left, right) >= Math.min(144, rw)) {
    side = right >= left ? 'right' : 'left';
    rw = Math.min(rw, side === 'right' ? right : left);
  } else side = 'below';
  const label = { x: badgeX, y: badgeY, width: bw, height: bh };
  let bubble;
  if (side === 'left' || side === 'right') {
    bubble = {
      x: side === 'right' ? label.x + bw + gap : label.x - gap - rw,
      y: clamp(badgeY + bh / 2 - rh / 2, margin, height - margin - rh),
      width: rw,
      height: rh,
    };
  } else if (side === 'above') {
    bubble = {
      x: clamp(faceX - rw / 2, margin, width - margin - rw),
      y: label.y - gap - rh,
      width: rw,
      height: rh,
    };
  } else {
    label.y = clamp(
      Math.max(badgeY, faceY + scale * 0.28 + 16),
      margin,
      height - margin - bh - gap - rh,
    );
    bubble = {
      x: clamp(faceX - rw / 2, margin, width - margin - rw),
      y: label.y + bh + gap,
      width: rw,
      height: rh,
    };
  }
  const vertical = side === 'above' || side === 'below';
  const tab = { width: vertical ? 28 : 24, height: vertical ? 20 : Math.min(32, Math.max(20, bh)) };
  tab.x = vertical
    ? label.x + (bw - tab.width) / 2
    : side === 'right'
      ? label.x + bw - 1
      : label.x - tab.width + 1;
  tab.y = vertical
    ? side === 'below'
      ? label.y + bh - 1
      : label.y - tab.height + 1
    : label.y + (bh - tab.height) / 2;
  const hud = union(collapsed ? [label, tab] : [label, tab, bubble]);
  return { side, badge: label, reply: bubble, tab, hud };
}
