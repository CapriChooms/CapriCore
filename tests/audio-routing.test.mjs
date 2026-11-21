// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_ROUTING_DEFAULTS,
  audioRouteRequest,
  audioRoutingPreferences,
  nativeMusicPackets,
} from '../apps/desktop/audio-routing.mjs';

test('a first audio preference stores an endpoint ID independently of its display label', () => {
  const value = structuredClone(AUDIO_ROUTING_DEFAULTS);
  value.routes.music = '{capture-device-id}';
  value.routeLabels.music = 'Virtual Cable';
  const saved = audioRoutingPreferences(value);
  assert.equal(saved.routes.music, '{capture-device-id}');
  assert.equal(saved.routeLabels.music, 'Virtual Cable');
  assert.equal(saved.routes.system, '');
  assert.throws(() => audioRouteRequest({ route: 'music', deviceId: 'bad\u0000id' }));
});

test('a native music window has exactly five packets and discards partial audio at a playback interruption', () => {
  let muted = false;
  const received = [];
  const receive = nativeMusicPackets({
    muted: () => muted,
    deliver: (sequence, pcm) => received.push({ sequence, pcm }),
  });
  const send = (value) => receive(Buffer.alloc(6400, value));
  for (let i = 0; i < 5; i++) send(1);
  send(2);
  muted = true;
  send(3);
  muted = false;
  for (let i = 0; i < 4; i++) send(4);
  assert.equal(received.length, 1);
  send(4);
  assert.deepEqual(
    received.map(({ sequence }) => sequence),
    [0, 2],
  );
  assert.deepEqual(received[0].pcm, Buffer.alloc(32000, 1));
  assert.deepEqual(received[1].pcm, Buffer.alloc(32000, 4));
});
