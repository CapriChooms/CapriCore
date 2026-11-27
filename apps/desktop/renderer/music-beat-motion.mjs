// SPDX-License-Identifier: GPL-3.0-only
import { POSE_RIGS, resolvePose } from './idle-gesture-rig.mjs';

const restingBreathsPerMinute = 12.5;

// The CSS animation starts at 12.5 breaths per minute. Under music one full
// breath takes four beats. Updating the rate keeps the current inhale/exhale.
export function syncSleepBreathing(element, musicTempo) {
  const animation = element
    .getAnimations()
    .find(({ animationName }) => animationName === 'avatar-sleep-breathe');
  if (!animation) return;
  const rate = musicTempo > 0 ? musicTempo / (4 * restingBreathsPerMinute) : 1;
  if (animation.playbackRate !== rate) animation.updatePlaybackRate(rate);
}

export function musicRig(frameId) {
  if (!frameId) return null;
  const id = resolvePose(frameId);
  return Object.hasOwn(POSE_RIGS, id) && !POSE_RIGS[id].unverified ? id : null;
}

// One four-beat phrase. Weight changes sides on alternate beats. The head
// settles just after the body and loose limbs follow a little later still.
export function beatPoseChannels(frameId, beats, amplitude = 1) {
  const pose = musicRig(frameId);
  if (!pose || !Number.isFinite(beats) || !(amplitude > 0)) return null;
  const a = Math.min(amplitude, 1);
  const phase = beats * Math.PI;
  const side = Math.cos(phase) * a;
  const follow = Math.cos(phase - 0.55) * a;
  const drop = (0.5 + 0.5 * Math.cos(2 * phase)) ** 2 * a;
  const nod = (0.5 + 0.5 * Math.cos(2 * phase - 0.46)) ** 2 * a;
  switch (pose) {
    case 'idle':
      return {
        pose,
        lean: 3.4 * side,
        lift: 10 * drop,
        head: -2 * follow,
        headY: 7 * nod,
        leftShoulder: 6 * side,
        rightShoulder: -6 * side,
        leftArm: -4 * follow,
        rightArm: -3 * follow,
        leftElbow: 4 * nod,
        rightElbow: -4 * nod,
      };
    case 'sit_floor':
      return { pose, lean: 2.7 * side, bodyX: 8 * side, head: 2 * follow, headY: 11 * nod };
    case 'crouch':
      return { pose, lift: 21 * drop, lean: 1.6 * side, head: -1.8 * follow, headY: 6 * nod };
    case 'seat':
      return { pose, lean: 2 * side, head: -1.7 * follow, headY: 10 * nod, legSwing: 6 * follow };
    case 'ceiling_hands':
      return {
        pose,
        bodyX: 19 * side,
        lean: -2.3 * side,
        head: 2 * follow,
        bodyY: 6 * drop,
        legSwing: -2.2 * follow,
      };
    case 'ceiling_feet':
      return { pose, bodyX: 15 * side, lean: 3.5 * side, head: 2.5 * follow, headY: -7 * nod };
    case 'wall_left':
    case 'wall_right': {
      const inward = pose === 'wall_left' ? 1 : -1;
      return {
        pose,
        bodyX: inward * 10 * drop,
        bodyY: 11 * drop,
        lean: inward * (2.3 * side + drop),
        head: -inward * 2 * follow,
        headY: 5 * nod,
        legSwing: inward * 1.8 * follow,
      };
    }
    case 'music_seat':
      return { pose, lean: 2.9 * side, head: 3.4 * follow, headY: 12 * nod, legSwing: 8 * follow };
    case 'music_ground':
      return { pose, bodyX: 9 * side, lean: 3.2 * side, head: 3 * follow, headY: 17 * nod };
    case 'sleep':
      return { pose, breath: (1 - Math.cos(phase / 2)) * 0.85 * a };
  }
}
