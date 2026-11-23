// SPDX-License-Identifier: GPL-3.0-only
import { physicalCallInputs } from './call-microphone.mjs';

const specificId = (value) =>
  typeof value === 'string' &&
  /^[^\x00-\x1f\x7f]{1,512}$/.test(value) &&
  Boolean(value.trim()) &&
  !['default', 'communications'].includes(value.toLowerCase());
const label = (value) =>
  typeof value === 'string'
    ? value
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .trim()
        .slice(0, 180)
    : '';

/** A group is a hardware association, not proof of a digital feedback connection. */
export function isVerifiedSeparateCallCable(devices, { output, microphone } = {}) {
  if (
    !Array.isArray(devices) ||
    devices.length > 128 ||
    microphone?.readyState !== 'live' ||
    !specificId(microphone?.deviceId) ||
    !specificId(microphone?.groupId) ||
    !specificId(output?.deviceId) ||
    !specificId(output?.groupId) ||
    microphone.deviceId === output.deviceId
  )
    return false;
  const micEndpoints = devices.filter(
    (device) => device?.kind === 'audioinput' && device.deviceId === microphone.deviceId,
  );
  const sinkEndpoints = devices.filter(
    (device) => device?.kind === 'audiooutput' && device.deviceId === output.deviceId,
  );
  if (micEndpoints.length !== 1 || sinkEndpoints.length !== 1) return false;
  const mic = micEndpoints[0],
    sink = sinkEndpoints[0];
  if (
    physicalCallInputs([mic]).length !== 1 ||
    physicalCallInputs([{ ...mic, label: microphone.label }]).length !== 1 ||
    mic.groupId !== microphone.groupId ||
    sink.groupId !== output.groupId ||
    label(mic.label) !== label(microphone.label) ||
    label(sink.label) !== label(output.label)
  )
    return false;
  const family = label(sink.label).match(/\bCABLE(-[A-D])? Input\b/i)?.[1] ?? '';
  const sourceName = new RegExp('\\bCABLE' + family + ' Output\\b', 'i');
  const sinkName = new RegExp('\\bCABLE' + family + ' Input\\b', 'i');
  if (!sinkName.test(label(sink.label))) return false;
  const sources = devices.filter(
    (device) =>
      device?.kind === 'audioinput' &&
      specificId(device.deviceId) &&
      sourceName.test(label(device.label)),
  );
  const sinks = devices.filter(
    (device) =>
      device?.kind === 'audiooutput' &&
      specificId(device.deviceId) &&
      sinkName.test(label(device.label)),
  );
  return Boolean(
    sources.length === 1 &&
      sinks.length === 1 &&
      sinks[0].deviceId === sink.deviceId &&
      sources[0].deviceId !== sink.deviceId &&
      sources[0].deviceId !== mic.deviceId,
  );
}
