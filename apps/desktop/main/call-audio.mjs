// SPDX-License-Identifier: GPL-3.0-only
import {
  CALL_VOICE_VOLUME_DEFAULT,
  validateCallVoiceVolume,
} from '../renderer/call-audio-settings.mjs';

const validDeviceId = (id) =>
  typeof id === 'string' &&
  /^[^\x00-\x1f\x7f]{1,512}$/.test(id) &&
  id.trim() &&
  !['default', 'communications'].includes(id);

export function callOutputDevices(devices, includeGroup = false) {
  if (!Array.isArray(devices) || devices.length > 128) return [];
  const outputs = new Map();
  for (const device of devices) {
    const { deviceId, groupId, kind, label } = device ?? {};
    if (kind !== 'audiooutput' || !validDeviceId(deviceId) || typeof label !== 'string') continue;
    const name = label
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .trim()
      .slice(0, 180);
    // Steam's Remote Play endpoint is not a qualified general-purpose call cable.
    if (/\bsteam streaming\b/i.test(name)) continue;
    if (name)
      outputs.set(deviceId, {
        deviceId,
        label: name,
        ...(includeGroup && validDeviceId(groupId) && { groupId }),
      });
  }
  return [...outputs.values()];
}

export function callAudioCommand(value) {
  if (
    !value ||
    ![
      'state',
      'system-on',
      'system-off',
      'output-on',
      'output-off',
      'allow-model',
      'share-replies',
      'voice-volume',
    ].includes(value.action) ||
    Object.keys(value).some(
      (key) =>
        !['action', 'deviceId', 'wakeFromSystem', 'mixMic', 'enabled', 'volume'].includes(key),
    ) ||
    (['allow-model', 'share-replies'].includes(value.action)
      ? typeof value.enabled !== 'boolean'
      : value.enabled !== undefined) ||
    (value.wakeFromSystem !== undefined &&
      (value.action !== 'system-on' || typeof value.wakeFromSystem !== 'boolean')) ||
    (value.mixMic !== undefined &&
      (value.action !== 'output-on' || typeof value.mixMic !== 'boolean')) ||
    (value.action === 'output-on'
      ? !validDeviceId(value.deviceId)
      : value.deviceId !== undefined) ||
    (value.action === 'voice-volume'
      ? !Number.isInteger(value.volume) || value.volume < 0 || value.volume > 100
      : value.volume !== undefined)
  )
    throw new Error('Invalid call audio action.');
  return value;
}

export function callAudioPreferences(value) {
  if (typeof value?.allowModel !== 'boolean') throw new Error('Invalid call audio preference.');
  return {
    allowModel: value.allowModel,
    callVoiceVolume: validateCallVoiceVolume(
      value.callVoiceVolume === undefined ? CALL_VOICE_VOLUME_DEFAULT : value.callVoiceVolume,
    ),
  };
}

export function callAudioState(value) {
  const callOutputReady = value?.callOutputReady === true && validDeviceId(value?.deviceId);
  return {
    systemAudioActive: value?.systemAudioActive === true,
    systemAudioPending: value?.systemAudioPending === true,
    systemAudioReview: value?.systemAudioReview === true,
    systemAudioWake: value?.systemAudioWake === true,
    micListening: value?.micListening === true,
    callOutputReady: Boolean(callOutputReady),
    mixingMic: Boolean(callOutputReady && value.mixingMic === true),
    shareReplies: Boolean(callOutputReady && value.shareReplies === true),
    deviceId: callOutputReady ? value.deviceId : '',
  };
}

export function speakerSelectionAllowed({
  active,
  owner,
  contents,
  permission,
  origin,
  details,
  url,
}) {
  return Boolean(
    active &&
      owner &&
      contents === owner &&
      permission === 'speaker-selection' &&
      owner.getURL() === url &&
      details?.isMainFrame !== false &&
      (!details?.requestingUrl || details.requestingUrl === url) &&
      ['capri://desktop', 'capri://desktop/'].includes(origin),
  );
}
