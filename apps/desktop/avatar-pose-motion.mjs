// SPDX-License-Identifier: GPL-3.0-only
// Only unsupported lower limbs move. Each cut shares its hinge with the base
// raster and never includes a hand, foot contact, neck or any part of the face.
const segments = Object.freeze({
  'pose-ceiling': [
    { bounds: [462, 856, 578, 1210], pivot: [527, 856], amplitude: 1.8, phase: 0 },
    { bounds: [585, 855, 731, 1210], pivot: [650, 855], amplitude: 2.1, phase: 1.4 },
  ],
  'pose-dock-left': [
    { bounds: [314, 889, 428, 1210], pivot: [368, 889], amplitude: 2.5, phase: 0.7 },
  ],
  'pose-dock-right': [
    { bounds: [747, 889, 865, 1210], pivot: [793, 889], amplitude: 2.4, phase: 1.1 },
  ],
  'pose-sit-edge': [
    { bounds: [337, 853, 591, 1210], pivot: [509, 853], amplitude: 2.2, phase: 0.3 },
  ],
});

const empty = Object.freeze([]);

export function avatarPoseSegments(frameId) {
  return Object.hasOwn(segments, frameId) ? segments[frameId] : empty;
}

export function avatarPoseSwing(time, { amplitude, phase }) {
  // Presentation movement is display-paced; the drawing's articulation is
  // exposed on twos. Main-process alpha picking samples the same pose clock.
  const frame = Math.floor(time / (1000 / 12)) % 48;
  return Math.sin((frame * 2 * Math.PI) / 48 + phase) * amplitude;
}
