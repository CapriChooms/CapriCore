// SPDX-License-Identifier: GPL-3.0-only
import { avatarFaceState } from './avatar-face-rig.mjs';
import { deformPoint } from './idle-gesture-rig.mjs';

// The face is on the same mesh as the head. Project its local axes at the
// eye line, so leaning and swaying carry the lids and jaw with the body.
export function createSurfaceFacePainter(rig) {
  if (!rig) return () => {};
  const canvas = document.createElement('canvas');
  const patchContext = canvas.getContext('2d');
  return (context, image, frameId, gaze, channels) => {
    const patch = rig(image, frameId);
    if (!patch) return;
    const [x, y, width, height] = patch.bounds;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    patch.paint(patchContext, {
      ...avatarFaceState(frameId),
      gaze: [3.4 * (gaze?.x ?? 0), 3 * (gaze?.y ?? 0)],
    });
    if (!channels) {
      context.drawImage(canvas, x, y);
      return;
    }
    const mx = x + width / 2;
    const my = y + height / 2;
    const [ox, oy] = deformPoint(mx, my, channels);
    const [xx, xy] = deformPoint(mx + 1, my, channels);
    const [yx, yy] = deformPoint(mx, my + 1, channels);
    context.save();
    context.transform(xx - ox, xy - oy, yx - ox, yy - oy, ox, oy);
    context.drawImage(canvas, x - mx, y - my);
    context.restore();
  };
}
