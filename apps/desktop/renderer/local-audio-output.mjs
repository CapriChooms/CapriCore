// SPDX-License-Identifier: GPL-3.0-only
export function selectedAudioOutputError(cause) {
  return Object.assign(new Error('Selected audio output is unavailable.', { cause }), {
    code: 'CAPRI_SPEAKER_OUTPUT',
  });
}

export function audioOutputDevice(value = '') {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    (value !== '' && !value.trim())
  )
    throw selectedAudioOutputError();
  return value === 'default' ? '' : value;
}

export function matchesAudioOutput(node, deviceId) {
  const sink = node.sinkId;
  return sink === deviceId || (!deviceId && (sink === undefined || sink === 'default'));
}

export async function bindAudioOutput(node, deviceId) {
  if (matchesAudioOutput(node, deviceId)) return;
  try {
    await node.setSinkId(deviceId);
    if (matchesAudioOutput(node, deviceId)) return;
  } catch (error) {
    throw selectedAudioOutputError(error);
  }
  throw selectedAudioOutputError();
}

export function createAudioOutputContext(deviceId = '', options = {}) {
  try {
    return new AudioContext(deviceId ? { ...options, sinkId: deviceId } : options);
  } catch (error) {
    if (deviceId) throw selectedAudioOutputError(error);
    throw error;
  }
}
