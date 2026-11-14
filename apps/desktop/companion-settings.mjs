// SPDX-License-Identifier: GPL-3.0-only
import { GLITCH_DEFAULTS, validateGlitchSettings } from './renderer/glitch-settings.mjs';
import { MOTION_DEFAULTS, validateMotionSettings } from './renderer/motion-settings.mjs';
import { THEME_DEFAULTS, validateInterfaceTheme } from './renderer/interface-theme.mjs';
const TELEPORT_LEVELS = ['teleportIntensity', 'teleportJaggedness', 'teleportBranches'];
export const COMPANION_DEFAULTS = Object.freeze({
  ...GLITCH_DEFAULTS,
  ...MOTION_DEFAULTS,
  expandOnReply: true,
  replyAutoHide: true,
  replyAutoHideSeconds: 8,
  detachedStyle: 'character',
  minimizedChip: true,
  restoreFromTrayOnWake: true,
  wakeSound: 'tone',
  wakePhrase: 'Listening.',
  wakeVolume: 0.7,
  followUp: true,
  followUpSeconds: 12,
  buttonFeedback: true,
  wakeOnReminder: true,
  memoryMonitor: true,
  processGraphs: true,
  memoryStyle: 'rings',
  memoryIntervalSeconds: 3,
  teleportIntensity: 75,
  teleportJaggedness: 78,
  teleportBranches: 75,
  teleportReducedFlash: false,
  teleportSound: 'spark',
  avatarTapGapSeconds: 10,
  avatarSnapRadius: 36,
  avatarRoaming: false,
  avatarRoamIntervalSeconds: 120,
  avatarDragTether: true,
  avatarDragTetherIntensity: 45,
  avatarDragTetherChaos: 55,
  avatarDragTetherDeadZone: 30,
  interfaceTheme: THEME_DEFAULTS,
});
export function validateCompanionSettings(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(COMPANION_DEFAULTS, key))
  )
    throw new Error('Invalid companion settings');
  const next = { ...COMPANION_DEFAULTS, ...value };
  next.interfaceTheme = validateInterfaceTheme(next.interfaceTheme);
  validateGlitchSettings(next);
  validateMotionSettings(next);
  if (
    !['tone', 'file', 'voice', 'off'].includes(next.wakeSound) ||
    !['Listening.', 'Yes, choom.', 'Mhm?'].includes(next.wakePhrase) ||
    !Number.isFinite(next.wakeVolume) ||
    next.wakeVolume < 0 ||
    next.wakeVolume > 1 ||
    typeof next.followUp !== 'boolean' ||
    typeof next.buttonFeedback !== 'boolean' ||
    typeof next.wakeOnReminder !== 'boolean' ||
    typeof next.expandOnReply !== 'boolean' ||
    typeof next.replyAutoHide !== 'boolean' ||
    typeof next.minimizedChip !== 'boolean' ||
    !['character', 'dialogue'].includes(next.detachedStyle) ||
    !Number.isInteger(next.replyAutoHideSeconds) ||
    next.replyAutoHideSeconds < 2 ||
    next.replyAutoHideSeconds > 60 ||
    typeof next.restoreFromTrayOnWake !== 'boolean' ||
    typeof next.memoryMonitor !== 'boolean' ||
    typeof next.processGraphs !== 'boolean' ||
    typeof next.teleportReducedFlash !== 'boolean' ||
    !['off', 'spark', 'thunder', 'pulse'].includes(next.teleportSound) ||
    !Number.isInteger(next.avatarTapGapSeconds) ||
    next.avatarTapGapSeconds < 1 ||
    next.avatarTapGapSeconds > 15 ||
    !Number.isInteger(next.avatarSnapRadius) ||
    next.avatarSnapRadius < 12 ||
    next.avatarSnapRadius > 100 ||
    typeof next.avatarDragTether !== 'boolean' ||
    typeof next.avatarRoaming !== 'boolean' ||
    !Number.isInteger(next.avatarRoamIntervalSeconds) ||
    next.avatarRoamIntervalSeconds < 30 ||
    next.avatarRoamIntervalSeconds > 1800 ||
    !Number.isInteger(next.avatarDragTetherIntensity) ||
    next.avatarDragTetherIntensity < 0 ||
    next.avatarDragTetherIntensity > 100 ||
    !Number.isInteger(next.avatarDragTetherChaos) ||
    next.avatarDragTetherChaos < 0 ||
    next.avatarDragTetherChaos > 100 ||
    !Number.isInteger(next.avatarDragTetherDeadZone) ||
    next.avatarDragTetherDeadZone < 0 ||
    next.avatarDragTetherDeadZone > 120 ||
    TELEPORT_LEVELS.some(
      (key) => !Number.isInteger(next[key]) || next[key] < 0 || next[key] > 100,
    ) ||
    !['bars', 'rings'].includes(next.memoryStyle) ||
    ![3, 5, 10].includes(next.memoryIntervalSeconds) ||
    !Number.isInteger(next.followUpSeconds) ||
    next.followUpSeconds < 5 ||
    next.followUpSeconds > 30
  )
    throw new Error('Invalid companion settings');
  return next;
}

export function setMonitorDisplay(settings, mode) {
  if (mode === 'toggle')
    return settings.processGraphs
      ? { ...settings, processGraphs: false, memoryMonitor: true }
      : { ...settings, processGraphs: true };
  if (mode === 'graphs') return { ...settings, processGraphs: true };
  if (mode === 'rings' || mode === 'bars')
    return { ...settings, processGraphs: false, memoryMonitor: true, memoryStyle: mode };
  throw new Error('Invalid monitor display');
}
