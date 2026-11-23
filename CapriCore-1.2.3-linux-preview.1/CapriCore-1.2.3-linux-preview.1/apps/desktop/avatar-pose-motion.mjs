// SPDX-License-Identifier: GPL-3.0-only
// Only unsupported lower limbs move. Each cut shares its hinge with the base
// raster and never includes a hand, foot contact, neck or any part of the face.
const segments = Object.freeze({
  'pose-ceiling': [
    { bounds: [471, 849, 590, 1200], pivot: [548, 849], amplitude: 1.8, phase: 0 },
    { bounds: [599, 849, 728, 1200], pivot: [647, 849], amplitude: 2.1, phase: 1.4 },
  ],
  'pose-dock-left': [
    { bounds: [348, 879, 490, 1200], pivot: [426, 879], amplitude: 2.5, phase: 0.7 },
  ],
  'pose-dock-right': [
    { bounds: [706, 899, 823, 1200], pivot: [752, 899], amplitude: 2.4, phase: 1.1 },
  ],
  'pose-sit-edge': [
    { bounds: [383, 856, 605, 1200], pivot: [511, 856], amplitude: 2.2, phase: 0.3 },
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
