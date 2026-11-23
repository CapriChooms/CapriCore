import test from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedSeparateCallCable } from '../apps/desktop/renderer/call-audio-route.mjs';

function fixture(family = '') {
  const devices = [
    {
      kind: 'audioinput',
      deviceId: 'physical-mic',
      groupId: 'shared-device-group',
      label: 'Microphone (Physical audio)',
    },
    {
      kind: 'audioinput',
      deviceId: 'cable-recording',
      groupId: 'shared-device-group',
      label: `CABLE${family} Output (VB-Audio Virtual Cable)`,
    },
    {
      kind: 'audiooutput',
      deviceId: 'cable-playback',
      groupId: 'shared-device-group',
      label: `CABLE${family} Input (VB-Audio Virtual Cable)`,
    },
  ];
  return {
    devices,
    route: { output: { ...devices[2] }, microphone: { ...devices[0], readyState: 'live' } },
  };
}

test('a distinct current physical microphone and uniquely paired cable may share a device group', () => {
  for (const family of ['', '-A', '-B', '-C', '-D']) {
    const { devices, route } = fixture(family);
    assert.equal(isVerifiedSeparateCallCable(devices, route), true);
  }
});

test('unverifiable or changed endpoint identity never bypasses a shared-group refusal', () => {
  for (const mutate of [
    ({ route }) => delete route.microphone.deviceId,
    ({ route }) => (route.microphone.deviceId = 'default'),
    ({ route }) => (route.microphone.groupId = 'old-group'),
    ({ route }) => (route.microphone.label = 'A different physical microphone'),
    ({ route }) => (route.microphone.readyState = 'ended'),
    ({ route }) => (route.output.deviceId = 'communications'),
    ({ route }) => (route.output.groupId = 'old-group'),
    ({ route }) => (route.output.label = 'Previous cable name'),
    ({ devices }) => (devices[0].label = ''),
    ({ devices }) => (devices[0].deviceId = 'removed'),
    ({ devices }) => (devices[2].deviceId = 'removed'),
    ({ devices }) => (devices[2].label = 'Ordinary speakers'),
    ({ devices }) => devices.push({ ...devices[0] }),
    ({ devices }) => devices.push({ ...devices[1], deviceId: 'second-recording' }),
    ({ devices }) => devices.push({ ...devices[2], deviceId: 'second-playback' }),
    ({ devices }) => (devices[1].label = 'CABLE-A Output'),
    ({ devices, route }) => {
      devices[0].deviceId = devices[1].deviceId;
      route.microphone.deviceId = devices[1].deviceId;
    },
  ]) {
    const data = fixture();
    mutate(data);
    assert.equal(isVerifiedSeparateCallCable(data.devices, data.route), false);
  }
  const { devices, route } = fixture();
  for (const input of [null, {}, [], Array(129).fill(devices[0])])
    assert.equal(isVerifiedSeparateCallCable(input, route), false);
});

test('a virtual or loopback capture cannot become the physical side of a call route', () => {
  for (const label of [
    'CABLE Output (VB-Audio Virtual Cable)',
    'CABLE-A Output',
    'Stereo Mix (Audio)',
    'Microphone (Steam Streaming Microphone)',
    'Virtual microphone',
  ]) {
    const { devices, route } = fixture();
    devices[0].label = route.microphone.label = label;
    assert.equal(isVerifiedSeparateCallCable(devices, route), false);
  }
});
