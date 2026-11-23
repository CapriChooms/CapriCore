// SPDX-License-Identifier: GPL-3.0-only
import { blinkOffset, layeredBlinkDuration, layeredBlinkPose } from './avatar-layered-blink.mjs';

// The mouth contours use quadratic segments with matching points so they can
// interpolate during speech and reactions. All coordinates fit inside the jaw.
const smile = [
  614.3, 426.1, 624.2, 427.7, 631.5, 425.8, 641.6, 421.6, 653.8, 414.9, 646.3, 422.9, 634, 432.3,
  625.1, 429.5, 614.3, 426.1,
];

function mouthOnJaw(points) {
  const result = [];
  for (let i = 0; i < points.length; i += 2) {
    const [x, y] = [points[i], points[i + 1]];
    result.push(634 + x * 0.934 + y * 0.357, 426 - x * 0.357 + y * 0.934);
  }
  return result;
}

const mouths = {
  smile,
  flat: mouthOnJaw([-11, 2, -7, 0, 1, 0, 6, 0, 11, 0, 6, 2, 0, 2.4, -7, 2.4, -11, 2]),
  frown: mouthOnJaw([-13, 4, -8, -2, 0, -3, 7, -4, 13, 2, 6, 1.3, 0, 0.3, -9, 2, -13, 4]),
  concerned: mouthOnJaw([-12, 2, -7, -2, 0, -2, 5, -2, 9, 3, 5, 2, 0, 0.9, -6, 2, -12, 2]),
  pressed: mouthOnJaw([
    -13, 0, -10, -2, -5, 0.7, 2, 1.1, 12, -1.5, 5, 3.5, -3, 1.8, -8, 0.1, -13, 0,
  ]),
  smirk: mouthOnJaw([-16, 0.6, -9, 2.5, 0, 1.8, 9, 0.6, 19, -4, 14, 3.4, 6, 5, -4, 4, -16, 0.6]),
  happy: mouthOnJaw([-19, -3, -10, -0.4, 0, -0.3, 9, -0.6, 19, -3, 10, 6, 1, 10, -10, 8, -19, -3]),
  laugh: mouthOnJaw([-17, -5, -9, -4, 0, -5, 8, -6, 17, -7, 8, 14, 0, 17, -9, 14, -17, -5]),
  grin: mouthOnJaw([-22, -3, -11, 0, 0, -1, 11, -2, 22, -6, 12, 7, 3, 12, -11, 8, -22, -3]),
  small: mouthOnJaw([-9, 0, -5, -2, 0, -2, 5, -2, 9, -1, 5, 3, 0, 4, -6, 3, -9, 0]),
  round: mouthOnJaw([-10, 4, -10, -3, 0, -4, 10, -4, 10, 4, 9, 11, 0, 11.5, -10, 11, -10, 4]),
  wide: mouthOnJaw([-18, -4, -9, -2, 0, -3, 10, -4, 18, -5, 10, 6, 0, 9, -10, 5, -18, -4]),
  surprise: mouthOnJaw([-12, 5, -6, -2, 0, -7, 6, -2, 12, 5, 7, 12, 0, 18, -6, 12, -12, 5]),
};

function face(eyelids, mouth = 'smile', gaze = [0, 0], lift = 0) {
  return { eyelids, mouth: mouths[mouth], gaze, lift };
}

export const speechMouths = { small: mouths.small, round: mouths.round, wide: mouths.wide };

export const faceFrames = {
  neutral: face([0, 0]),
  annoyed: face([0.43, 0.3], 'frown', [1, 1.2]),
  attentive: face([0, 0], 'pressed', [0, -0.7]),
  'idle-blink_closed': face([1, 1]),
  'idle-blink_half': face([0.58, 0.58]),
  concerned: face([0.07, 0.12], 'concerned', [0.6, 1]),
  embarrassed: face([0.08, 0.28], 'pressed', [-2.2, 1.5]),
  'idle-excited': face([0, 0], 'grin', [0, -0.5]),
  flirty: { ...face([0.35, 0], 'smirk', [1.2, 0]), wink: true },
  focused: face([0.19, 0.24], 'flat', [1, 0.4]),
  happy: face([0.46, 0.41], 'happy', [0, -1.25], 8.5),
  'idle-laughing': face([1, 1], 'laugh', [0, 0], 15),
  'idle-look_down': face([0, 0], 'smile', [0, 4.75]),
  'idle-look_left': face([0, 0], 'smile', [-5.5, 0.3]),
  'idle-look_right': face([0, 0], 'smile', [5.5, -0.6]),
  'idle-look_up': face([0, 0], 'smile', [1, -5.5]),
  'idle-mouth_round': face([0, 0], 'round'),
  'idle-mouth_small': face([0, 0], 'small'),
  'idle-mouth_wide': face([0, 0], 'wide'),
  sad: face([0.12, 0.21], 'frown', [-1.6, 2.3]),
  skeptical: face([0.54, 0.07], 'flat', [1.4, 0]),
  sleepy: face([0.66, 0.6], 'smile', [0, 1]),
  smirk: face([0.56, 0], 'smirk', [0, 0.8]),
  'idle-surprised_closed': face([1, 1], 'surprise'),
  surprised: face([0, 0], 'surprise'),
  thinking: face([0.03, 0.11], 'flat', [1.8, -2.8]),
  'idle-wink_closed': { ...face([1, 0], 'smirk', [1.2, 0]), wink: true },
  'idle-wink_half': { ...face([0.64, 0], 'smirk', [1.2, 0]), wink: true },
};

const clamp = (value) => Math.min(1, Math.max(0, value));

function blendFace(from, to, progress) {
  const t = clamp(progress);
  const ease = t * t * (3 - 2 * t);
  const blend = (a, b) => a + (b - a) * ease;
  const pair = (a, b) => a.map((value, index) => blend(value, b[index]));
  return {
    eyelids: pair(from.eyelids, to.eyelids),
    mouth: pair(from.mouth, to.mouth),
    gaze: pair(from.gaze, to.gaze),
    lift: blend(from.lift, to.lift),
    wink: from.wink || to.wink,
  };
}

// Motion timing belongs to the clip. Static frames and timed playback share the same artwork.
function timeline(keyframes) {
  return {
    duration: keyframes.at(-1)[0],
    sample(time) {
      const next = keyframes.findIndex(([at]) => at > time);
      if (next < 0) return keyframes.at(-1)[1];
      if (next === 0) return keyframes[0][1];
      const [start, from] = keyframes[next - 1];
      const [end, to] = keyframes[next];
      return blendFace(from, to, (time - start) / (end - start));
    },
  };
}

const animate = (keys) => timeline(keys.map(([ms, frame]) => [ms, faceFrames[frame]]));
const blinkKeys = (start, keys) =>
  keys.map(([offset, frame]) => [start + blinkOffset(offset), frame]);
const closedLaugh = face([1, 1], 'laugh', [0, 0], 15);
const laughBreath = face([0.91, 0.94], 'happy', [0, 0], 13);
const livelyGrin = face([0.14, 0.19], 'grin', [0, -0.65], 3.2);
const excitedSquint = face([0.57, 0.5], 'happy', [0, 0], 9);
const dozing = face([1, 1], 'smile');
const almostAsleep = face([0.91, 0.89], 'smile', [0, 1]);
const sleepy = faceFrames.sleepy;
const winkOpen = { ...face([0, 0], 'smirk', [1.2, 0]), wink: true };

export const faceAnimations = {
  blink: { duration: layeredBlinkDuration, sample: layeredBlinkPose },
  speech: animate([
    [0, 'neutral'],
    [300, 'neutral'],
    [375, 'idle-mouth_small'],
    [500, 'idle-mouth_round'],
    [625, 'idle-mouth_wide'],
    [765, 'idle-mouth_round'],
    [855, 'idle-mouth_small'],
    [970, 'neutral'],
    [1270, 'neutral'],
  ]),
  wink: timeline([
    [0, winkOpen],
    ...blinkKeys(350, [
      [0, winkOpen],
      [85, faceFrames['idle-wink_half']],
      [180, faceFrames['idle-wink_closed']],
      [325, faceFrames['idle-wink_closed']],
      [410, faceFrames['idle-wink_half']],
      [510, winkOpen],
    ]),
    [1290, winkOpen],
  ]),
  gaze: animate([
    [0, 'neutral'],
    [180, 'idle-look_left'],
    [590, 'idle-look_left'],
    [810, 'idle-look_up'],
    [1230, 'idle-look_up'],
    [1450, 'idle-look_right'],
    [1850, 'idle-look_right'],
    [2060, 'idle-look_down'],
    [2470, 'idle-look_down'],
    [2680, 'neutral'],
    [2830, 'neutral'],
  ]),
  surprise: animate([
    [0, 'neutral'],
    [210, 'surprised'],
    ...blinkKeys(890, [
      [0, 'surprised'],
      [95, 'idle-surprised_closed'],
      [170, 'idle-surprised_closed'],
      [280, 'surprised'],
    ]),
    [1780, 'surprised'],
    [2020, 'neutral'],
  ]),
  laugh: timeline([
    [0, faceFrames.smirk],
    [300, closedLaugh],
    [490, laughBreath],
    [665, closedLaugh],
    [835, laughBreath],
    [990, closedLaugh],
    [1135, laughBreath],
    [1370, faceFrames.happy],
    [1660, faceFrames.happy],
    [1820, faceFrames.smirk],
  ]),
  excited: timeline([
    [0, faceFrames.happy],
    [265, faceFrames['idle-excited']],
    [460, livelyGrin],
    [630, faceFrames['idle-excited']],
    [830, livelyGrin],
    [985, excitedSquint],
    [1160, faceFrames['idle-excited']],
    [1490, faceFrames['idle-excited']],
    [1820, faceFrames.happy],
  ]),
  sleepy: timeline([
    [0, sleepy],
    [380, sleepy],
    [800, almostAsleep],
    [1050, dozing],
    [1430, dozing],
    [1660, almostAsleep],
    [1940, sleepy],
    [2320, sleepy],
  ]),
};
