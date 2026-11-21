// SPDX-License-Identifier: GPL-3.0-only
// Authored surface interactions for the installed painted-pose rig.
// Nothing here reads the screen, enters text, clicks, or moves a window.
import { validateAvatarMotion, isStandingMotionFrame } from '../avatar-motion-protocol.mjs';
import { CHANNELS, sampleCustomGesture, createRenderer } from './idle-gesture-rig.mjs';
import { drawSurfaceGaze } from './surface-gaze.mjs';
import { createCelPainter, registeredCelClip } from './hanging-cels.mjs';

const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
const key = (at, channels = {}) => ({ at, ...channels });
const clip = (durationMs, keyframes, fps = 12) => ({ durationMs, fps, keyframes });
const contact = (name, x, y) => ({ name, x, y });
const profiles = freeze({
  'pose-sit-edge': {
    anchor: contact('seat', 599, 773),
    contacts: [
      contact('seat', 599, 773),
      contact('left-palm', 457, 781),
      contact('right-palm', 751, 781),
    ],
    bounds: { x: 183, y: 110, width: 887, height: 1067 },
  },
  'pose-ceiling': {
    anchor: contact('ceiling', 615, 111),
    contacts: [contact('left-grip', 481, 111), contact('right-grip', 764, 111)],
    bounds: { x: 208, y: 75, width: 836, height: 1102 },
  },
  'pose-dock-left': {
    anchor: contact('dock-left', 239, 555),
    contacts: [contact('upper-grip', 243, 477), contact('lower-grip', 243, 655)],
    bounds: { x: 219, y: 76, width: 815, height: 1101 },
  },
  'pose-dock-right': {
    anchor: contact('dock-right', 994, 505),
    contacts: [contact('upper-grip', 1004, 428), contact('lower-grip', 1000, 610)],
    bounds: { x: 212, y: 75, width: 831, height: 1103 },
  },
  standing: {
    anchor: contact('ground', 627, 1166),
    contacts: [contact('left-foot', 552, 1163), contact('right-foot', 758, 1163)],
    bounds: { x: 210, y: 115, width: 835, height: 1052 },
  },
});

// Repeated key values are deliberate holds, not sinusoidal oscillation.
const authored = freeze({
  'ledge-lean': clip(4800, [
    key(0),
    key(300, { bodyY: -0.25, headY: -0.1 }),
    key(750, { bodyY: 0.65, bodyX: 0.65, headTilt: 0.55, headX: 0.45, headY: 0.35, lean: 0.25 }),
    key(1050, { bodyY: 0.45, bodyX: 0.5, headTilt: 0.4, headX: 0.35, headY: 0.25, lean: 0.18 }),
    key(2300, { bodyY: 0.45, bodyX: 0.5, headTilt: 0.4, headX: 0.35, headY: 0.25, lean: 0.18 }),
    key(2750, { bodyY: 0.35, bodyX: 0.35, headTilt: -0.25, headX: -0.3, headY: -0.15 }),
    key(3050, { bodyY: 0.25, bodyX: 0.25, headTilt: -0.18, headX: -0.2, headY: -0.1 }),
    key(3550, { bodyY: 0.25, bodyX: 0.25, headTilt: -0.18, headX: -0.2, headY: -0.1 }),
    key(4000, { bodyY: -0.08, headTilt: 0.08 }),
    key(4350),
    key(4800),
  ]),
  'edge-lean': clip(5200, [
    key(0),
    key(250, { bodyX: -0.2, headTilt: 0.1 }),
    key(700, { bodyX: 0.85, headTilt: -0.5, headX: 0.35, headY: 0.2, lean: 0.15 }),
    key(1000, { bodyX: 0.65, headTilt: -0.38, headX: 0.28, headY: 0.13, lean: 0.1 }),
    key(2300, { bodyX: 0.65, headTilt: -0.38, headX: 0.28, headY: 0.13, lean: 0.1 }),
    key(2700, { bodyX: 0.65, headTilt: 0.4, headX: -0.4, headY: -0.2 }),
    key(3000, { bodyX: 0.52, headTilt: 0.3, headX: -0.32, headY: -0.15 }),
    key(3700, { bodyX: 0.52, headTilt: 0.3, headX: -0.32, headY: -0.15 }),
    key(4200, { bodyX: -0.12, headTilt: -0.12 }),
    key(4650),
    key(5200),
  ]),
  'edge-hang': clip(4400, [
    key(0),
    key(250, { bodyY: -0.25, bodyX: -0.1 }),
    key(650, { bodyY: 0.8, bodyX: 0.65, headTilt: -0.25, headY: 0.2 }),
    key(950, { bodyY: 0.45, bodyX: 0.4, headTilt: -0.17 }),
    key(1700, { bodyY: 0.45, bodyX: 0.4, headTilt: -0.17 }),
    key(2200, { bodyX: -0.55, headTilt: 0.3, headX: 0.25 }),
    key(2500, { bodyX: -0.3, headTilt: 0.2, headX: 0.2 }),
    key(3100, { bodyX: -0.3, headTilt: 0.2, headX: 0.2 }),
    key(3500, { bodyY: -0.1, bodyX: 0.1 }),
    key(3950),
    key(4400),
  ]),
  'bar-perch': clip(5200, [
    key(0),
    key(300, { headY: -0.12, bodyY: -0.2, legSwing: -0.16 }),
    key(750, { headTilt: 0.35, headY: 0.2, bodyY: 0.55, legSwing: 0.9 }),
    key(1050, { headTilt: 0.24, headY: 0.12, bodyY: 0.3, legSwing: 0.55 }),
    key(1800, { headTilt: 0.24, headY: 0.12, bodyY: 0.3, legSwing: 0.55 }),
    key(2300, { headTilt: -0.5, headX: -0.45, headY: -0.1, legSwing: -0.5 }),
    key(2600, { headTilt: -0.36, headX: -0.35, headY: -0.1, legSwing: -0.3 }),
    key(3400, { headTilt: -0.36, headX: -0.35, headY: -0.1, legSwing: -0.3 }),
    key(3900, { headTilt: 0.1, legSwing: 0.15 }),
    key(4600),
    key(5200),
  ]),
  'bar-search': clip(6200, [
    key(0),
    key(300, { headY: -0.14, headTilt: 0.1 }),
    key(750, { headX: -0.85, headY: 0.75, headTilt: -0.65, lean: -0.12, bodyY: 0.2 }),
    key(1150, { headX: -0.72, headY: 0.6, headTilt: -0.48, lean: -0.08, bodyY: 0.15 }),
    key(1900, { headX: -0.72, headY: 0.6, headTilt: -0.48, lean: -0.08, bodyY: 0.15 }),
    key(2900, { headX: 0.75, headY: 0.65, headTilt: 0.5, bodyY: 0.15 }),
    key(3300, { headX: 0.62, headY: 0.55, headTilt: 0.36, bodyY: 0.1 }),
    key(4100, { headX: 0.62, headY: 0.55, headTilt: 0.36, bodyY: 0.1 }),
    key(4550, { headTilt: -0.1, headY: -0.38, legSwing: 0.3 }),
    key(5050, { headTilt: 0.12, headY: -0.18, legSwing: 0.15 }),
    key(5650),
    key(6200),
  ]),
  'bar-search-below': clip(6000, [
    key(0),
    key(300, { bodyY: 0.4, headY: 0.1 }),
    key(800, { headX: -0.9, headY: -0.65, headTilt: -0.55, bodyX: -0.5 }),
    key(1150, { headX: -0.75, headY: -0.5, headTilt: -0.38, bodyX: -0.3 }),
    key(1900, { headX: -0.75, headY: -0.5, headTilt: -0.38, bodyX: -0.3 }),
    key(2900, { headX: 0.85, headY: -0.6, headTilt: 0.55, bodyX: 0.7 }),
    key(3250, { headX: 0.65, headY: -0.45, headTilt: 0.38, bodyX: 0.45 }),
    key(4050, { headX: 0.65, headY: -0.45, headTilt: 0.38, bodyX: 0.45 }),
    key(4550, { headX: 0.1, headY: -0.15, headTilt: 0.1, bodyY: 0.35 }),
    key(5100, { headY: 0.12, bodyY: 0.15 }),
    key(5500),
    key(6000),
  ]),
  'bar-present': clip(
    4300,
    [
      key(0),
      key(250, { headTilt: -0.14, leftArm: -0.05, leftElbow: -0.05 }),
      key(650, {
        leftArm: 0.28,
        leftElbow: 0.52,
        leftWrist: -0.15,
        leftShoulder: 0.18,
        headTilt: 0.3,
        headX: -0.2,
      }),
      key(950, {
        leftArm: 0.36,
        leftElbow: 0.64,
        leftWrist: 0.22,
        leftShoulder: 0.22,
        headTilt: 0.5,
        headX: -0.4,
      }),
      key(1250, {
        leftArm: 0.3,
        leftElbow: 0.56,
        leftWrist: 0.14,
        leftShoulder: 0.15,
        headTilt: 0.35,
        headX: -0.3,
      }),
      key(2300, {
        leftArm: 0.3,
        leftElbow: 0.56,
        leftWrist: 0.14,
        leftShoulder: 0.15,
        headTilt: 0.35,
        headX: -0.3,
      }),
      key(2600, {
        leftArm: 0.3,
        leftElbow: 0.6,
        leftWrist: -0.08,
        leftShoulder: 0.15,
        headTilt: 0.3,
        headX: -0.3,
      }),
      key(2900, { leftArm: 0.25, leftElbow: 0.5, leftWrist: 0.12, headTilt: 0.24 }),
      key(3400, { leftArm: -0.02, leftElbow: -0.03, headTilt: -0.08 }),
      key(3800),
      key(4300),
    ],
    24,
  ),
  // The head follows the eyes a beat late, then returns to the start of the next line.
  'bar-read': clip(5800, [
    key(0),
    key(270, { headY: -0.3, legSwing: -0.25 }),
    key(760, { headX: -0.84, headY: 0.62, headTilt: -0.52, bodyX: -0.42, bodyY: 0.35 }),
    key(1960, { headX: 0.72, headY: 0.52, headTilt: 0.35, bodyX: 0.22 }),
    key(2220, { headX: 0.82, headY: 0.57, headTilt: 0.45, bodyX: 0.22 }),
    key(2510, { headX: -0.73, headY: 0.95, headTilt: -0.46, bodyX: -0.22 }),
    key(3820, { headX: 0.76, headY: 0.88, headTilt: 0.45, bodyX: 0.26 }),
    key(4140, { headX: 0.64, headY: 0.76, headTilt: 0.36, bodyX: 0.19 }),
    key(4490, { headY: -0.48, legSwing: 0.72 }),
    key(4920, { headY: -0.22, legSwing: 0.31 }),
    key(5420),
    key(5800),
  ]),
  'bar-read-below': clip(5800, [
    key(0),
    key(260, { bodyY: 0.48, headY: 0.28 }),
    key(780, { headX: -0.84, headY: -0.92, headTilt: -0.4, bodyX: -0.68, bodyY: -0.72 }),
    key(1990, { headX: 0.72, headY: -0.85, headTilt: 0.31, bodyX: 0.35 }),
    key(2240, { headX: 0.8, headY: -0.85, headTilt: 0.43, bodyX: 0.44 }),
    key(2520, { headX: -0.74, headY: -0.62, headTilt: -0.4, bodyX: -0.45 }),
    key(3830, { headX: 0.77, headY: -0.55, headTilt: 0.4, bodyX: 0.42 }),
    key(4180, { headX: 0.65, headY: -0.47, headTilt: 0.28, bodyX: 0.3 }),
    key(4520, { bodyY: 0.93, headY: 0.38 }),
    key(4920, { bodyY: 0.45, headY: 0.18 }),
    key(5420),
    key(5800),
  ]),
  // A close double tap, a deliberate opposite-hand selection, then a confirmation.
  'bar-tap': clip(
    5600,
    [
      key(0),
      key(400, { headY: -0.24, legSwing: 0.38 }),
      key(900, { headX: -0.78, headY: 0.74, headTilt: -0.56, bodyX: -0.57, bodyY: 0.55 }),
      key(1720, { headX: -0.68, headY: 0.61, headTilt: -0.49, bodyX: -0.46, bodyY: 0.35 }),
      key(2100, { headY: -0.34, bodyX: 0.1, legSwing: -0.76 }),
      key(2580, { headX: 0.82, headY: 0.69, headTilt: 0.55, bodyX: 0.49, bodyY: 0.5 }),
      key(3100, { headX: 0.64, headY: 0.58, headTilt: 0.38, bodyX: 0.34, bodyY: 0.27 }),
      key(3560, { headY: -0.23, legSwing: 0.46 }),
      key(4090, { headX: -0.72, headY: 0.69, headTilt: -0.48, bodyX: -0.46, bodyY: 0.37 }),
      key(4580, { headX: -0.58, headY: 0.52, headTilt: -0.38, bodyX: -0.25 }),
      key(5090),
      key(5600),
    ],
    24,
  ),
  'bar-tap-below': clip(
    5600,
    [
      key(0),
      key(400, { bodyY: 0.75, headY: 0.25 }),
      key(900, { headX: -0.9, headY: -0.74, headTilt: -0.57, bodyX: -0.82, bodyY: -0.45 }),
      key(1720, { headX: -0.7, headY: -0.62, headTilt: -0.41, bodyX: -0.5, bodyY: -0.28 }),
      key(2120, { headY: 0.34, bodyY: 0.91, bodyX: 0.4 }),
      key(2580, { headX: 0.89, headY: -0.73, headTilt: 0.56, bodyX: 0.8, bodyY: -0.53 }),
      key(3100, { headX: 0.65, headY: -0.61, headTilt: 0.38, bodyX: 0.54, bodyY: -0.29 }),
      key(3560, { headY: 0.24, bodyX: -0.17, bodyY: 0.65 }),
      key(4090, { headX: -0.82, headY: -0.68, headTilt: -0.49, bodyX: -0.7, bodyY: -0.49 }),
      key(4580, { headX: -0.59, headY: -0.52, headTilt: -0.38, bodyX: -0.49 }),
      key(5090),
      key(5600),
    ],
    24,
  ),
  // Look over the sill, hang there for a beat, then rock back on the seat.
  'ledge-peek': clip(4650, [
    key(0),
    key(360, { headY: -0.4, headX: 0.26, legSwing: 0.5 }),
    key(800, {
      headX: -1,
      headY: 0.96,
      headTilt: -0.95,
      lean: -0.94,
      bodyX: -0.96,
      bodyY: 0.92,
      legSwing: -1,
    }),
    key(1110, {
      headX: -0.78,
      headY: 0.8,
      headTilt: -0.73,
      lean: -0.71,
      bodyX: -0.79,
      bodyY: 0.72,
      legSwing: -0.68,
    }),
    key(1860, {
      headX: -0.78,
      headY: 0.8,
      headTilt: -0.73,
      lean: -0.71,
      bodyX: -0.79,
      bodyY: 0.72,
      legSwing: -0.68,
    }),
    key(2270, {
      headX: -0.6,
      headY: 0.98,
      headTilt: -0.34,
      lean: -0.7,
      bodyX: -0.75,
      bodyY: 0.7,
      legSwing: -0.38,
    }),
    key(2930, {
      headX: -0.6,
      headY: 0.98,
      headTilt: -0.34,
      lean: -0.7,
      bodyX: -0.75,
      bodyY: 0.7,
      legSwing: -0.38,
    }),
    key(3350, { headX: 0.34, headY: -0.46, headTilt: 0.36, bodyX: 0.32, legSwing: 0.86 }),
    key(3700, { headX: 0.14, headY: -0.16, headTilt: 0.15, bodyX: 0.12, legSwing: 0.37 }),
    key(4180),
    key(4650),
  ]),
  'ledge-peek-below': clip(4650, [
    key(0),
    key(330, { bodyX: 0.52, bodyY: 0.8, headX: 0.31, headY: 0.22 }),
    key(810, { bodyX: -1, bodyY: -0.97, headX: -0.98, headY: -0.96, headTilt: -0.93, lean: -0.85 }),
    key(1110, {
      bodyX: -0.75,
      bodyY: -0.71,
      headX: -0.83,
      headY: -0.8,
      headTilt: -0.72,
      lean: -0.63,
    }),
    key(1860, {
      bodyX: -0.75,
      bodyY: -0.71,
      headX: -0.83,
      headY: -0.8,
      headTilt: -0.72,
      lean: -0.63,
    }),
    key(2270, { bodyX: -0.71, bodyY: -0.61, headX: -0.39, headY: -1, headTilt: 0.3, lean: -0.61 }),
    key(2930, { bodyX: -0.71, bodyY: -0.61, headX: -0.39, headY: -1, headTilt: 0.3, lean: -0.61 }),
    key(3350, { bodyX: 0.46, bodyY: 0.95, headX: 0.36, headY: 0.38, headTilt: 0.35, lean: 0.37 }),
    key(3700, { bodyX: 0.19, bodyY: 0.47, headX: 0.15, headY: 0.14, headTilt: 0.14, lean: 0.17 }),
    key(4180),
    key(4650),
  ]),
});

export const screenInteractionClips = freeze({
  'ledge-lean': {
    label: 'Brace and lean on a ledge',
    frames: ['pose-sit-edge'],
    defaultFrame: 'pose-sit-edge',
  },
  'edge-lean': {
    label: 'Lean from an edge',
    frames: ['pose-dock-left', 'pose-dock-right'],
    defaultFrame: 'pose-dock-left',
  },
  'edge-hang': {
    label: 'Catch a lower rim',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'bar-perch': {
    label: 'Perch and settle',
    frames: ['pose-sit-edge'],
    defaultFrame: 'pose-sit-edge',
  },
  'bar-search': {
    label: 'Read and tap along a field',
    frames: ['pose-sit-edge'],
    defaultFrame: 'pose-sit-edge',
  },
  'bar-search-below': {
    label: 'Search from below a field',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'bar-present': { label: 'Present the field', frames: ['standing'], defaultFrame: 'focused' },
  'bar-read': { label: 'Read two lines', frames: ['pose-sit-edge'], defaultFrame: 'pose-sit-edge' },
  'bar-read-below': {
    label: 'Read from below',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'bar-tap': {
    label: 'Double tap and confirm',
    frames: ['pose-sit-edge'],
    defaultFrame: 'pose-sit-edge',
  },
  'bar-tap-below': {
    label: 'Tap from a hanging grip',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'ledge-peek': {
    label: 'Peek over the window',
    frames: ['pose-sit-edge'],
    defaultFrame: 'pose-sit-edge',
  },
  'ledge-peek-below': {
    label: 'Peek up from the rim',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'hang-pullup': {
    label: 'Pull up to the rim',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'hang-catch': {
    label: 'Catch from a hanging grip',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'hang-wrist-scan': {
    label: 'Check the wrist scanner',
    frames: ['pose-ceiling'],
    defaultFrame: 'pose-ceiling',
  },
  'ledge-keytar': {
    label: 'Play the keytar',
    frames: ['pose-sit-edge'],
    defaultFrame: 'pose-sit-edge',
  },
});
const performances = new Set([
  'bar-search',
  'bar-search-below',
  'bar-read',
  'bar-read-below',
  'bar-tap',
  'bar-tap-below',
  'ledge-peek',
  'edge-hang',
]);
export const usesSurfacePerformance = (id) =>
  performances.has(id) || Boolean(registeredCelClip(id));
export function getScreenInteraction(id, { frameId, side = 'left' } = {}) {
  const entry = Object.hasOwn(screenInteractionClips, id) ? screenInteractionClips[id] : null;
  if (!entry) return null;
  frameId ??= id === 'edge-lean' && side === 'right' ? 'pose-dock-right' : entry.defaultFrame;
  if (
    !entry.frames.includes(frameId) &&
    !(entry.frames.includes('standing') && isStandingMotionFrame(frameId))
  )
    return null;
  const source = profiles[frameId] || profiles.standing;
  const flip =
    frameId === 'pose-dock-right' ||
    (side === 'right' && id !== 'edge-lean' && !id.startsWith('bar-read'));
  const cel = registeredCelClip(id);
  const keys = cel
    ? null
    : authored[id].keyframes.map((input) => {
        const output = { ...input };
        if (flip) {
          for (const name of ['headTilt', 'headX', 'lean', 'bodyX', 'legSwing'])
            if (name in output) output[name] *= -1;
          if (id === 'bar-present')
            for (const name of ['Arm', 'Elbow', 'Wrist', 'Shoulder']) {
              if ('left' + name in output) {
                output['right' + name] = output['left' + name];
                delete output['left' + name];
              }
            }
        }
        return output;
      });
  const validated = cel ?? validateAvatarMotion({ ...authored[id], keyframes: keys }, frameId);
  if (!validated) return null;
  const { anchor, bounds } = source;
  // Only advertise the contacts that stay fixed through the entire performance.
  // The scanner/catch release a hand; the keytar keeps the seat planted.
  const fixedContact = frameId === 'pose-sit-edge' ? 'seat' : 'left-grip';
  const contacts = cel
    ? source.contacts.filter((point) => point.name === fixedContact)
    : source.contacts;
  return {
    ...entry,
    id,
    frameId,
    side,
    anchor,
    contacts,
    bounds,
    footprint: {
      left: anchor.x - bounds.x,
      right: bounds.x + bounds.width - anchor.x,
      above: anchor.y - bounds.y,
      below: bounds.y + bounds.height - anchor.y,
    },
    clip: validated,
  };
}
export function createScreenInteractionClip(id, options = {}) {
  return getScreenInteraction(id, options)?.clip ?? null;
}
export function sampleScreenInteraction(id, timeMs, options = {}) {
  const entry = getScreenInteraction(id, options);
  if (entry?.frameId === 'pose-ceiling') return hangingRest;
  return entry ? sampleCustomGesture(entry.clip, timeMs, { frameId: entry.frameId }) : null;
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
// Times below are contact exposures. Each wrist lifts, holds, then lands.
const typingBeats = [
  [1165, 'left'],
  [1375, 'right'],
  [1585, 'left'],
  [1795, 'right'],
  [3185, 'left'],
  [3395, 'right'],
  [3605, 'left'],
  [3815, 'right'],
];
const deliberateBeats = [
  [1180, 'left'],
  [1570, 'left'],
  [2770, 'right'],
  [4170, 'left'],
  [4560, 'left'],
];
const hangingSearchBeats = [
  [1350, 'left'],
  [3290, 'right'],
  [3780, 'right'],
];
const restCue = () => ({ leftTap: 0, rightTap: 0, scan: null, tap: null, gaze: { x: 0, y: 0 } });
const hangingRest = Object.freeze({ ...CHANNELS, pose: 'ceiling_hands' });
const handSide = (hand, mirror) => (mirror ? (hand === 'left' ? 'right' : 'left') : hand);
function tappingCue(time, beats, mirror, below) {
  let leftTap = 0,
    rightTap = 0,
    tap = null;
  for (const [at, hand] of beats) {
    const offset = time - at;
    if (offset < -245 || offset >= 115) continue;
    const side = handSide(hand, mirror);
    const height = offset < -85 ? clamp((offset + 245) / 95) : offset < 0 ? -offset / 85 : 0;
    if (side === 'left') leftTap = height;
    else rightTap = height;
    if (!tap || offset >= 0) {
      const sourcePoint = below
        ? side === 'left'
          ? [481, 111]
          : [764, 111]
        : side === 'left'
          ? [437, 783]
          : [779, 783];
      tap = { side, down: offset >= 0, sourcePoint };
    }
  }
  return { leftTap, rightTap, tap };
}
// Stepped fixations: one exposure to cross each gap, then time to read at rest.
// A long right-to-left saccade starts the next line before the head catches up.
const readingFixations = [
  [0, 0, 0],
  [360, -0.96, 0.48],
  [790, -0.57, 0.48],
  [1100, -0.17, 0.48],
  [1430, 0.24, 0.48],
  [1700, 0.53, 0.48],
  [1940, 0.97, 0.49],
  [2270, -0.97, 0.91],
  [2680, -0.62, 0.91],
  [2960, -0.23, 0.91],
  [3260, 0.19, 0.91],
  [3530, 0.6, 0.91],
  [3790, 0.93, 0.91],
  [4210, 0.48, 0.84],
  [4500, 0, 0.28],
  [4900, 0, 0],
];
// Seen from below, the top line is farther above the eyes than the second line.
const readingFromBelow = readingFixations.map(([at, x, y]) => [
  at,
  x,
  y === 0 ? 0 : y < 0.4 ? -0.32 : y < 0.6 ? -0.95 : -0.57,
]);
const searchingFixations = [
  [0, 0, 0],
  [380, -0.96, 0.6],
  [780, -0.5, 0.68],
  [1980, -0.78, 0.58],
  [2320, -0.15, 0.58],
  [2580, 0.5, 0.58],
  [2870, 0.94, 0.62],
  [3950, 0.75, 0.6],
  [4280, 0.35, 0.35],
  [4650, 0, 0],
];
const tappingFixations = [
  [0, 0, 0],
  [370, -0.45, 0.48],
  [760, -0.93, 0.91],
  [1770, -0.72, 0.78],
  [1980, -0.16, 0.55],
  [2200, 0.93, 0.91],
  [3050, 0.7, 0.74],
  [3340, 0.13, 0.44],
  [3690, -0.95, 0.9],
  [4750, -0.38, 0.47],
  [4950, 0, 0],
];
const peekingFixations = [
  [0, 0, 0],
  [260, -0.42, 0.3],
  [530, -0.97, 0.82],
  [1140, -0.97, 0.82],
  [1640, -0.53, 0.9],
  [2010, 0.36, 1],
  [2440, 0.76, 0.93],
  [2930, -0.28, 0.65],
  [3230, 0.68, -0.16],
  [3550, 0.18, 0.12],
  [3870, 0, 0],
];
function fixation(time, track, mirror, below) {
  let x = 0,
    y = 0;
  for (const [at, nextX, nextY] of track) {
    if (time < at) break;
    const amount = clamp((time - at) / 70);
    x += (nextX - x) * amount;
    y += (nextY - y) * amount;
  }
  return { x: mirror ? -x : x, y: below ? -y : y };
}
export function screenInteractionCue(id, timeMs, { side = 'left' } = {}) {
  const duration = authored[id]?.durationMs;
  const cue = restCue();
  if (
    !usesSurfacePerformance(id) ||
    !Number.isFinite(timeMs) ||
    timeMs <= 0 ||
    timeMs >= duration - 400
  )
    return cue;
  const t = Math.floor((timeMs + 0.01) / (1000 / 24)) * (1000 / 24);
  const below = id.endsWith('-below'),
    mirror = side === 'right';
  if (registeredCelClip(id)) return cue;
  if (id === 'edge-hang') {
    // A small regrip, then settle. Only the curled fingertips lift.
    Object.assign(
      cue,
      tappingCue(
        t,
        [
          [850, 'left'],
          [2190, 'right'],
        ],
        mirror,
        true,
      ),
    );
    cue.leftTap *= 0.42;
    cue.rightTap *= 0.42;
  } else if (id.startsWith('bar-read')) {
    cue.gaze = fixation(t, below ? readingFromBelow : readingFixations, false, false);
  } else if (id.startsWith('ledge-peek')) {
    cue.gaze = fixation(t, peekingFixations, mirror, below);
  } else {
    const search = id.startsWith('bar-search');
    const beats = search ? (below ? hangingSearchBeats : typingBeats) : deliberateBeats;
    const track = search ? searchingFixations : tappingFixations;
    cue.gaze = fixation(t, track, mirror, below);
    Object.assign(cue, tappingCue(t, beats, mirror, below));
    if (search && t >= 550 && t < 4750) {
      const progress = clamp((t - 800) / 3300);
      cue.scan = { progress: mirror ? 1 - progress : progress, focus: t > 4100 };
    }
    // Look at the contact first. Even the rapid alternating search has one
    // held eye exposure on the finger landing before looking across again.
    let lastBeat;
    for (const beat of beats) if (t >= beat[0] - 170 && t < beat[0] + 130) lastBeat = beat;
    if (lastBeat) {
      const [at, hand] = lastBeat,
        target = handSide(hand, mirror) === 'left' ? -0.98 : 0.98;
      const weight = Math.min(clamp((t - at + 170) / 55), clamp((at + 130 - t) / 45));
      cue.gaze.x += (target - cue.gaze.x) * weight;
      cue.gaze.y += ((below ? -0.93 : 0.93) - cue.gaze.y) * weight;
    }
  }
  return cue;
}

// Search uses the real seated hand pixels only. The small polygons are
// isolated from hair, legs and torso in the reviewed source pose. The arm
// remains fixed; a wrist-centred rotation gives alternating raised fingers.
const hands = freeze({
  left: {
    rect: [389, 747, 96, 56],
    pivot: [476, 775],
    angle: 10,
    polygon: [
      [389, 747],
      [442, 747],
      [467, 764],
      [484, 774],
      [484, 803],
      [389, 803],
    ],
  },
  right: {
    rect: [726, 748, 94, 55],
    pivot: [742, 775],
    angle: -10,
    polygon: [
      [742, 775],
      [753, 764],
      [778, 748],
      [820, 748],
      [820, 803],
      [742, 803],
    ],
  },
});
const handPath = (context, polygon, x = 0, y = 0) => {
  context.beginPath();
  polygon.forEach(([px, py], i) => context[i ? 'lineTo' : 'moveTo'](px - x, py - y));
  context.closePath();
};
// Only curled digits are above this hinge. The painted palm, sleeve, rim
// contact and the entire other grip stay registered to the original pose.
const knuckles = freeze({ left: [428, 67, 111, 44], right: [710, 67, 113, 44] });
function flexHangingFingers(context, image, side, strength) {
  const [x, y, width, height] = knuckles[side];
  const hinge = y + height;
  context.clearRect(x, y, width, height);
  context.save();
  context.translate(0, hinge);
  context.transform(1, 0, (side === 'left' ? 1 : -1) * strength * 0.09, 1 - strength * 0.37, 0, 0);
  context.drawImage(image, x, y, width, height, x, -height, width, height);
  context.restore();
}
export function createScreenInteractionRenderer(canvas, { getAtlas } = {}) {
  canvas.width = canvas.height = 1254;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Screen interaction requires a 2D output canvas');
  const mesh = document.createElement('canvas');
  mesh.width = mesh.height = 1254;
  let renderer;
  let rigUnavailable = false;
  const cels = createCelPainter(canvas, getAtlas);
  let elapsed = 0,
    useCels = false,
    drawnChannels = null;
  let cue = restCue(),
    action = '',
    sourceFrame = '',
    stamp = '',
    revision = 0;
  const cutouts = new WeakMap();
  const sourceHands = (image) => {
    const identity = image.currentSrc || image.src;
    let value = cutouts.get(image);
    if (value && value.identity === identity) return value;
    value = { identity };
    for (const [side, { rect, polygon }] of Object.entries(hands)) {
      const cut = document.createElement('canvas');
      cut.width = rect[2];
      cut.height = rect[3];
      const ctx = cut.getContext('2d');
      handPath(ctx, polygon, rect[0], rect[1]);
      ctx.clip();
      ctx.drawImage(image, ...rect, 0, 0, rect[2], rect[3]);
      value[side] = cut;
    }
    cutouts.set(image, value);
    return value;
  };
  return {
    get extent() {
      return canvas.avatarMotionExtent;
    },
    get channels() {
      return drawnChannels;
    },
    get cue() {
      return cue;
    },
    setAction(id, timeMs, { frameId, side } = {}) {
      action = id;
      sourceFrame = frameId;
      elapsed = timeMs;
      cue = screenInteractionCue(id, timeMs, { side });
    },
    draw(image, channels, { bounds } = {}) {
      const cel = registeredCelClip(action);
      if (cel && cel.frameId === sourceFrame) {
        useCels = true;
        if (!cels.draw(image, action, elapsed)) return false;
        drawnChannels = null;
        canvas.avatarMotionExtent = null;
        canvas.avatarTextureRevision = ++revision;
        return true;
      }
      if (useCels) {
        useCels = false;
        cels.reset();
        stamp = '';
      }
      const hanging = sourceFrame === 'pose-ceiling';
      if (!hanging && !rigUnavailable) {
        try {
          renderer ??= createRenderer(mesh, {}, { grid: 112 });
          renderer.draw(image, channels, { bounds });
        } catch {
          renderer?.dispose();
          renderer = undefined;
          rigUnavailable = true;
        }
      }
      const fallback = !hanging && !renderer;
      drawnChannels = hanging ? hangingRest : (renderer?.channels ?? CHANNELS);
      const next = [
        image.currentSrc || image.src,
        JSON.stringify(fallback ? channels : drawnChannels),
        JSON.stringify(cue),
        action,
        sourceFrame,
        JSON.stringify(bounds),
      ].join(':');
      if (next === stamp) return false;
      stamp = next;
      context.clearRect(0, 0, 1254, 1254);
      // Field-side cursor is behind the character, so legs and fingers occlude
      // it naturally. The hanging marker is ABOVE the lower-rim contact.
      if (cue.scan && (action === 'bar-search' || action === 'bar-search-below')) {
        const hanging = action === 'bar-search-below',
          x = 454 + cue.scan.progress * 320,
          y = hanging ? 81 : 808;
        context.save();
        context.strokeStyle = cue.scan.focus ? '#eaffef' : '#6cffb0';
        context.lineWidth = 3;
        context.lineCap = 'round';
        context.shadowColor = '#00f742';
        context.shadowBlur = 4;
        context.beginPath();
        context.moveTo(x, y - 9);
        context.lineTo(x, y + 7);
        context.moveTo(x - 4, y - 9);
        context.lineTo(x + 4, y - 9);
        context.moveTo(x - 4, y + 7);
        context.lineTo(x + 4, y + 7);
        context.stroke();
        context.restore();
      }
      if (fallback) {
        // Keep the support point fixed in the software-rendered pose as well.
        const { x, y } = (profiles[sourceFrame] ?? profiles.standing).anchor;
        const angle = ((channels.lean + channels.head * 0.4) * Math.PI) / 180;
        context.save();
        context.translate(x, y);
        context.rotate(angle);
        context.translate(-x, -y);
      }
      context.drawImage(hanging || fallback ? image : mesh, 0, 0);
      drawSurfaceGaze(context, image, sourceFrame, cue.gaze, drawnChannels);
      if (sourceFrame === 'pose-ceiling' && (cue.leftTap || cue.rightTap)) {
        for (const side of ['left', 'right']) {
          const strength = cue[side + 'Tap'];
          if (strength > 0) flexHangingFingers(context, image, side, strength);
        }
      } else if (sourceFrame === 'pose-sit-edge' && (cue.leftTap || cue.rightTap)) {
        const cuts = sourceHands(image);
        for (const [side, { rect, pivot, angle, polygon }] of Object.entries(hands)) {
          const height = cue[side + 'Tap'];
          if (!height) continue;
          context.save();
          handPath(context, polygon);
          context.clip();
          context.clearRect(...rect);
          context.restore();
          // Small painted wrist underlap covers the hidden joint when the
          // fingers lift; it never reaches either coloured sleeve panel.
          context.fillStyle = '#070508';
          context.beginPath();
          context.arc(...pivot, 8, 0, Math.PI * 2);
          context.fill();
          context.save();
          context.translate(...pivot);
          context.rotate((height * angle * Math.PI) / 180);
          context.drawImage(cuts[side], rect[0] - pivot[0], rect[1] - pivot[1]);
          context.restore();
        }
      }
      if (fallback) context.restore();
      canvas.avatarTextureRevision = ++revision;
      canvas.avatarMotionExtent = hanging ? null : renderer?.extent;
      return true;
    },
    clear() {
      stamp = '';
      cels.reset();
      renderer?.clear();
      context.clearRect(0, 0, 1254, 1254);
    },
    dispose() {
      cels.reset();
      renderer?.dispose();
      context.clearRect(0, 0, 1254, 1254);
    },
  };
}
