// SPDX-License-Identifier: GPL-3.0-only
// Shared structural and pose validation for choreography supplied as data.
// This module never evaluates source code, creates assets, or moves a window.
const avatarMotionLimits = Object.freeze({
  minimumDurationMs: 400,
  maximumDurationMs: 8000,
  minimumKeyGapMs: 80,
  minimumKeys: 3,
  maximumKeys: 12,
  maximumSmears: 2,
  frameRates: Object.freeze([12, 24]),
});

const gazeChannels = ['headTilt', 'headX', 'headY', 'lean', 'lift'];
const standingChannels = Object.freeze([
  ...gazeChannels,
  'leftArm',
  'rightArm',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftShoulder',
  'rightShoulder',
  'smear',
]);
const groundedChannels = Object.freeze([...gazeChannels, 'bodyX', 'bodyY']);
const perchChannels = Object.freeze([...groundedChannels, 'legSwing']);
const sleepChannels = Object.freeze(['breath']);
const noChannels = Object.freeze([]);
const standingFrames = new Set([
  'neutral',
  'annoyed',
  'attentive',
  'concerned',
  'embarrassed',
  'flirty',
  'focused',
  'happy',
  'sad',
  'skeptical',
  'sleepy',
  'smirk',
  'surprised',
  'thinking',
  'idle-laughing',
  'idle-excited',
]);
const groundedFrames = new Set([
  'pose-sit-floor',
  'pose-crouch',
  'pose-dock-left',
  'pose-dock-right',
  'pose-ceiling',
  'pose-ceiling-upside-down',
  'music-floor',
]);
const perchFrames = new Set(['pose-sit-edge', 'music-window']);

export function isStandingMotionFrame(frame) {
  return typeof frame === 'string'
    ? standingFrames.has(frame)
    : frame?.pose === 'idle' && ['expression', 'reaction_expression'].includes(frame.kind);
}

/** Returns the exact channel names accepted for the current source drawing. */
function avatarMotionVocabulary(frame) {
  const id = typeof frame === 'string' ? frame : frame?.id;
  if (id === 'pose-sleep') return sleepChannels;
  if (perchFrames.has(id)) return perchChannels;
  if (groundedFrames.has(id)) return groundedChannels;
  if (isStandingMotionFrame(frame)) return standingChannels;
  return noChannels;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate and return a frozen copy containing only numeric animation data.
 * Omitted channels are zero at that key. Exact rest endpoints preserve the
 * selected source bitmap. The supplied frame locks the rig to its anatomy.
 */
export function validateAvatarMotion(value, frame) {
  try {
    return normalizeAvatarMotion(value, frame);
  } catch {
    return null;
  }
}

function normalizeAvatarMotion(value, frame) {
  if (
    !record(value) ||
    Object.keys(value).length !== 3 ||
    !['durationMs', 'fps', 'keyframes'].every((key) => Object.hasOwn(value, key))
  )
    return null;
  const { durationMs, fps, keyframes } = value;
  const {
    minimumDurationMs,
    maximumDurationMs,
    minimumKeyGapMs,
    minimumKeys,
    maximumKeys,
    maximumSmears,
    frameRates,
  } = avatarMotionLimits;
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < minimumDurationMs ||
    durationMs > maximumDurationMs ||
    !frameRates.includes(fps) ||
    !Array.isArray(keyframes) ||
    keyframes.length < minimumKeys ||
    keyframes.length > maximumKeys
  )
    return null;
  const allowed = avatarMotionVocabulary(frame);
  if (!allowed.length) return null;
  const normalized = [];
  let previousAt = -minimumKeyGapMs;
  let smears = 0;
  let hasMotion = false;
  for (const [index, key] of keyframes.entries()) {
    if (!record(key) || !Object.hasOwn(key, 'at')) return null;
    const { at } = key;
    const isFirst = index === 0;
    const isLast = index === keyframes.length - 1;
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > durationMs ||
      at - previousAt < minimumKeyGapMs ||
      (isFirst && at !== 0) ||
      (isLast && at !== durationMs)
    )
      return null;
    previousAt = at;
    const result = { at };
    for (const [channel, amount] of Object.entries(key)) {
      if (channel === 'at') continue;
      if (
        !allowed.includes(channel) ||
        !Number.isFinite(amount) ||
        amount > 1 ||
        amount < (channel === 'breath' || channel === 'smear' ? 0 : -1)
      )
        return null;
      if (amount === 0) continue;
      if (isFirst || isLast) return null;
      if (channel === 'smear') {
        if (amount !== 1 || ++smears > maximumSmears) return null;
      } else {
        hasMotion = true;
      }
      result[channel] = amount;
    }
    normalized.push(Object.freeze(result));
  }
  if (!hasMotion) return null;
  return Object.freeze({ durationMs, fps, keyframes: Object.freeze(normalized) });
}
