// SPDX-License-Identifier: GPL-3.0-only
const routeNames = ['speaker', 'music', 'system', 'call'];
const emptyRoutes = Object.freeze(Object.fromEntries(routeNames.map((route) => [route, ''])));
export const AUDIO_ROUTING_DEFAULTS = Object.freeze({
  routes: emptyRoutes,
  routeLabels: Object.freeze({ ...emptyRoutes }),
});

export const validAudioDeviceId = (id) =>
  typeof id === 'string' &&
  id.length <= 512 &&
  !/[\x00-\x1f\x7f]/.test(id) &&
  (!id || (id.trim() === id && !['default', 'communications'].includes(id)));

const deviceLabel = (value) =>
  typeof value === 'string'
    ? value
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .trim()
        .slice(0, 180)
    : '';

export function audioRouteRequest(value) {
  if (
    !value ||
    Object.keys(value).length !== 2 ||
    !routeNames.includes(value.route) ||
    !validAudioDeviceId(value.deviceId)
  )
    throw new Error('The selected audio device is unavailable.');
  return value;
}

export function audioRoutingPreferences(value) {
  const routes = {};
  const routeLabels = {};
  for (const route of routeNames) {
    const id = value?.routes?.[route] ?? '';
    if (!validAudioDeviceId(id)) throw new Error('The selected audio device is unavailable.');
    routes[route] = id;
    routeLabels[route] = id ? deviceLabel(value?.routeLabels?.[route]) : '';
  }
  return { routes, routeLabels };
}

export function localPlaybackDevices(devices) {
  const outputs = new Map();
  for (const device of devices) {
    if (device?.kind !== 'audiooutput' || !device.deviceId || !validAudioDeviceId(device.deviceId))
      continue;
    const label = deviceLabel(device.label);
    if (label) outputs.set(device.deviceId, { id: device.deviceId, label });
  }
  return [...outputs.values()];
}

/** The detector consumes half seconds; Windows capture supplies one tenth second at a time. */
export function nativeMusicPackets({ muted, deliver }) {
  let packet = Buffer.allocUnsafe(32000);
  let offset = 0;
  let sequence = 0;
  let gap = false;
  return (pcm) => {
    if (muted()) {
      offset = 0;
      gap = true;
      return;
    }
    if (!(pcm instanceof Uint8Array) || pcm.byteLength !== 6400) return;
    packet.set(pcm, offset);
    offset += pcm.byteLength;
    if (offset !== packet.byteLength) return;
    if (gap && sequence) sequence++;
    deliver(sequence++, packet);
    packet = Buffer.allocUnsafe(32000);
    offset = 0;
    gap = false;
  };
}
