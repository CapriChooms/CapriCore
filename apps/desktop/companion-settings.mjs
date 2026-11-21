// SPDX-License-Identifier: GPL-3.0-only
import { GLITCH_DEFAULTS, validateGlitchSettings } from './renderer/glitch-settings.mjs';
import { MOTION_DEFAULTS, validateMotionSettings } from './renderer/motion-settings.mjs';
import { TELEPORT_EFFECT_DEFAULTS, validTeleportEffect } from './renderer/teleport-effects.mjs';
import { THEME_DEFAULTS, validateInterfaceTheme } from './renderer/interface-theme.mjs';
import {
  DEFAULT_RESOURCE_GRAPHS,
  DEFAULT_RESOURCE_METERS,
  RESOURCE_REFRESH_INTERVALS,
  validateResourceMetrics,
} from './renderer/resource-metrics.mjs';
export const COMPANION_DEFAULTS = Object.freeze({
  ...GLITCH_DEFAULTS,
  ...MOTION_DEFAULTS,
  windowLayout: 'vertical',
  horizontalMonitorPosition: 'between',
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
  conversationMode: false,
  wildCloseAiTabs: false,
  wakeOnReminder: true,
  memoryMonitor: true,
  processGraphs: true,
  graphMetrics: DEFAULT_RESOURCE_GRAPHS,
  meterMetrics: DEFAULT_RESOURCE_METERS,
  memoryStyle: 'rings',
  memoryIntervalSeconds: 3,
  ...TELEPORT_EFFECT_DEFAULTS,
  teleportSound: 'spark',
  avatarTapGapSeconds: 10,
  avatarSnapRadius: 36,
  avatarRoaming: false,
  avatarRoamMonitors: 'current',
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
    Object.keys(value).some(
      (key) => key !== 'buttonFeedback' && !Object.hasOwn(COMPANION_DEFAULTS, key),
    )
  )
    throw new Error('Invalid companion settings');
  const next = { ...COMPANION_DEFAULTS, ...value };
  if (next.teleportStyle === 'afterimage') next.teleportStyle = 'sandevistan';
  // Older profiles stored this preference. Button feedback is now always on.
  delete next.buttonFeedback;
  next.interfaceTheme = validateInterfaceTheme(next.interfaceTheme);
  next.graphMetrics = validateResourceMetrics(next.graphMetrics);
  next.meterMetrics = validateResourceMetrics(next.meterMetrics);
  validateGlitchSettings(next);
  validateMotionSettings(next);
  if (
    !['vertical', 'horizontal'].includes(next.windowLayout) ||
    !['between', 'right'].includes(next.horizontalMonitorPosition) ||
    !['tone', 'file', 'voice', 'off'].includes(next.wakeSound) ||
    !['Listening.', 'Yes, choom.', 'Mhm?'].includes(next.wakePhrase) ||
    !Number.isFinite(next.wakeVolume) ||
    next.wakeVolume < 0 ||
    next.wakeVolume > 1 ||
    typeof next.followUp !== 'boolean' ||
    typeof next.conversationMode !== 'boolean' ||
    typeof next.wildCloseAiTabs !== 'boolean' ||
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
    !validTeleportEffect(next) ||
    !['off', 'spark', 'thunder', 'pulse'].includes(next.teleportSound) ||
    !Number.isInteger(next.avatarTapGapSeconds) ||
    next.avatarTapGapSeconds < 1 ||
    next.avatarTapGapSeconds > 15 ||
    !Number.isInteger(next.avatarSnapRadius) ||
    next.avatarSnapRadius < 12 ||
    next.avatarSnapRadius > 100 ||
    typeof next.avatarDragTether !== 'boolean' ||
    typeof next.avatarRoaming !== 'boolean' ||
    !['current', 'any', 'pointer'].includes(next.avatarRoamMonitors) ||
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
    !['bars', 'rings'].includes(next.memoryStyle) ||
    !RESOURCE_REFRESH_INTERVALS.includes(next.memoryIntervalSeconds) ||
    !Number.isInteger(next.followUpSeconds) ||
    next.followUpSeconds < 5 ||
    next.followUpSeconds > 30
  )
    throw new Error('Invalid companion settings');
  return next;
}

export function monitorDisplayChange(settings, mode) {
  if (mode === 'toggle')
    return settings.processGraphs
      ? { processGraphs: false, memoryMonitor: true }
      : { processGraphs: true };
  if (mode === 'off') return { processGraphs: false, memoryMonitor: false };
  if (mode === 'graphs') return { processGraphs: true };
  if (mode === 'rings' || mode === 'bars')
    return { processGraphs: false, memoryMonitor: true, memoryStyle: mode };
  throw new Error('Invalid monitor display');
}
