// SPDX-License-Identifier: GPL-3.0-only
import { hangingCelActions, seatedCelActions } from '../renderer/hanging-cels.mjs';
import celBounds from '../../../assets/default/hanging-cels/geometry.json' with { type: 'json' };
// Coordinates here and in the detector are global desktop DIP. Sprite landmarks
// are on the original art canvas, with the contact point fixed during the clip.
const actions = {
  search: ['search-field', 'bar-search', 'bar-search-below'],
  read: ['search-field', 'bar-read', 'bar-read-below'],
  tap: ['search-field', 'bar-tap', 'bar-tap-below'],
  'field-lean': ['search-field', 'ledge-lean', 'edge-hang'],
  'field-perch': ['search-field', 'bar-perch', 'edge-hang'],
  peek: ['window-top', 'ledge-peek', 'ledge-peek-below'],
  lean: ['window-top', 'ledge-lean', 'edge-hang'],
  'window-perch': ['window-top', 'bar-perch', 'edge-hang'],
};

const roamingActions = [
  'search',
  'read',
  'peek',
  'tap',
  'lean',
  'field-perch',
  'window-perch',
  'present',
  ...hangingCelActions,
  ...seatedCelActions,
];
const hangingBounds = hangingCelActions.map((action) => celBounds[action]);
const hangingLeft = Math.min(...hangingBounds.map((box) => box.x));
const hangingRight = Math.max(...hangingBounds.map((box) => box.x + box.width));
const hangingTop = Math.min(...hangingBounds.map((box) => box.y));
export function nextSurfaceActions(lastAction, random = Math.random) {
  const actions = roamingActions.filter((id) => id !== lastAction);
  const first = Math.floor(random() * actions.length);
  return [...actions.slice(first), ...actions.slice(0, first)];
}

const ambientByPose = {
  'pose-ceiling': [...hangingCelActions, 'ledge-peek-below', 'edge-hang'],
  'pose-sit-edge': ['ledge-keytar', 'ledge-lean', 'ledge-peek', 'bar-perch'],
  'pose-dock-left': ['edge-lean'],
  'pose-dock-right': ['edge-lean'],
};

export function ambientSurfaceClip(frameId, previous, random = Math.random) {
  if (!Object.hasOwn(ambientByPose, frameId)) return null;
  const clips = ambientByPose[frameId];
  const choices = clips.length === 1 ? clips : clips.filter((id) => id !== previous);
  return choices[Math.floor(random() * choices.length)];
}

export function surfaceLanding(target, action, { area, scale, canvas, frames }) {
  const { kind } = target;
  if (action === 'present') {
    const frame = frames.get('focused');
    if (kind !== 'search-field' || !frame?.anchor || !frame.visibleBounds) return null;
    const { bounds, point } = target;
    const x = Math.round(point.x);
    const y = Math.round(
      bounds.y +
        bounds.height +
        12 +
        ((frame.anchor.y - frame.visibleBounds.y) * scale) / canvas.height,
    );
    const left = x + ((frame.visibleBounds.x - frame.anchor.x) * scale) / canvas.width;
    const right = left + (frame.visibleBounds.width * scale) / canvas.width;
    if (left < area.x || right > area.x + area.width || y > area.y + area.height) return null;
    const side = x > bounds.x + bounds.width / 2 ? 'left' : 'right';
    return {
      action,
      frame,
      clipId: 'bar-present',
      side,
      targetId: target.id,
      windowId: target.windowId,
      point: { x, y },
    };
  }
  let seatedClip, hangingClip;
  if (hangingCelActions.includes(action)) {
    if (!['window-top', 'search-field', 'desktop-edge'].includes(kind)) return null;
    hangingClip = action;
  } else if (seatedCelActions.includes(action)) {
    if (!['window-top', 'search-field', 'desktop-edge'].includes(kind)) return null;
    seatedClip = action;
  } else {
    if (!Object.hasOwn(actions, action) || actions[action][0] !== kind) return null;
    [, seatedClip, hangingClip] = actions[action];
  }
  const bounds = target.bounds;
  const x = target.point.x;
  const options = [
    { frameId: 'pose-sit-edge', clipId: seatedClip, x, y: bounds.y },
    {
      frameId: 'pose-ceiling',
      clipId: hangingClip,
      x,
      y: kind === 'search-field' ? bounds.y + bounds.height : bounds.y,
    },
  ];
  for (const candidate of options) {
    if (!candidate.clipId) continue;
    const frame = frames.get(candidate.frameId);
    if (!frame?.visibleBounds || !frame.anchor) continue;
    // Include the widest held drawing, including the chip, boots or instrument.
    const cel =
      celBounds[candidate.clipId === 'ledge-peek-below' ? 'hang-pullup' : candidate.clipId];
    const art = cel ?? frame.visibleBounds;
    const above = ((frame.anchor.y - art.y) * scale) / canvas.height;
    const below = ((art.y + art.height - frame.anchor.y) * scale) / canvas.height;
    let y = candidate.y;
    if (kind === 'desktop-edge') {
      // Leave room for the raised hands at the top and the boots at the bottom.
      y =
        candidate.frameId === 'pose-ceiling'
          ? area.y + Math.ceil(((frame.anchor.y - hangingTop) * scale) / canvas.height)
          : area.y + area.height - Math.ceil(below);
    }
    // At a maximized window's very top the first few pixels of the raised
    // knuckles may extend outside the work area. Keep the hand on its ledge.
    const tolerance = candidate.frameId === 'pose-ceiling' ? (cel ? 9 : 8) : 1;
    if (y - above < area.y - tolerance || y + below > area.y + area.height + 1) continue;
    const minX = area.x + ((frame.anchor.x - art.x) * scale) / canvas.width;
    const maxX =
      area.x + area.width - ((art.x + art.width - frame.anchor.x) * scale) / canvas.width;
    if (minX > maxX) continue;
    let contactX = Math.max(minX, Math.min(maxX, candidate.x));
    if (candidate.frameId === 'pose-ceiling') {
      // Reserve space for the next trick at this grip, if the ledge permits it.
      const commonMin = Math.max(
        bounds.x,
        area.x + ((frame.anchor.x - hangingLeft) * scale) / canvas.width,
      );
      const commonMax = Math.min(
        bounds.x + bounds.width,
        area.x + area.width - ((hangingRight - frame.anchor.x) * scale) / canvas.width,
      );
      if (commonMin <= commonMax) contactX = Math.max(commonMin, Math.min(commonMax, candidate.x));
    }
    if (contactX < bounds.x || contactX > bounds.x + bounds.width) continue;
    const middle = bounds.x + bounds.width / 2;
    const lookToward =
      kind === 'search-field' && Math.abs(middle - contactX) > 8 ? middle : area.x + area.width / 2;
    return {
      action,
      frame,
      clipId: candidate.clipId,
      side: lookToward > contactX ? 'right' : 'left',
      targetId: target.id,
      windowId: target.windowId,
      point: { x: Math.round(contactX), y: Math.round(y) },
    };
  }
  return null;
}
