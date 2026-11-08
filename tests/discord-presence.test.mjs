// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import defaults from '../config/discord-presence.json' with { type: 'json' };
import {
  DiscordPresence,
  discordFrame,
  discordSettings,
} from '../apps/desktop/discord-presence.mjs';

function fixture(initial = {}) {
  let value = { enabled: true, applicationId: '123456789012345678', assetKey: 'capri', ...initial };
  const sockets = [],
    paths = [];
  const preferences = {
    snapshot: () => ({ ...value }),
    set: (next) => {
      value = discordSettings(next);
    },
  };
  const presence = new DiscordPresence({
    preferences,
    platform: 'win32',
    connect: ({ path }) => {
      paths.push(path);
      const socket = new EventEmitter();
      socket.writes = [];
      socket.write = (frame) => socket.writes.push(Buffer.from(frame));
      socket.setTimeout = () => {};
      socket.destroy = () => {
        socket.destroyed = true;
      };
      socket.end = () => {
        socket.destroyed = true;
        socket.emit('close');
      };
      sockets.push(socket);
      return socket;
    },
  });
  return { presence, sockets, paths };
}
const body = (frame) => JSON.parse(frame.subarray(8).toString('utf8'));

test('Discord activity is opt-in and an application ID is required before any IPC connection', () => {
  const f = fixture({ enabled: false });
  f.presence.start();
  assert.equal(f.presence.phase, 'off');
  assert.equal(f.paths.length, 0);
  f.presence.configure({ enabled: true, applicationId: '', assetKey: '' });
  assert.equal(f.presence.phase, 'setup-required');
  assert.equal(f.paths.length, 0);
  for (const value of ['token', '123', 'https://discord.com', '../private'])
    assert.throws(() => discordSettings({ enabled: true, applicationId: value, assetKey: '' }));
  f.presence.close();
});

test('the default setup publishes activity with only a public application ID', () => {
  const { presence, sockets } = fixture(defaults);
  presence.configure({ ...defaults, enabled: true, applicationId: '123456789012345678' });
  const socket = sockets[0];
  socket.emit('connect');
  socket.emit('data', discordFrame(1, { cmd: 'DISPATCH', evt: 'READY' }));
  const activity = body(socket.writes[1]).args.activity;
  assert.equal(activity.details, 'Hanging out with Capri');
  assert.equal(Object.hasOwn(activity, 'assets'), false);
  presence.close();
});

test('local RPC buffers fragmented frames, answers ping, publishes generic activity and clears on exit', () => {
  const f = fixture();
  f.presence.start();
  const socket = f.sockets[0];
  assert.equal(f.paths[0], '\\\\?\\pipe\\discord-ipc-0');
  socket.emit('connect');
  assert.deepEqual(body(socket.writes[0]), { v: 1, client_id: '123456789012345678' });
  const ready = discordFrame(1, { cmd: 'DISPATCH', evt: 'READY' });
  socket.emit('data', ready.subarray(0, 3));
  assert.equal(f.presence.phase, 'connecting');
  socket.emit('data', ready.subarray(3));
  assert.equal(f.presence.phase, 'connected');
  const activity = body(socket.writes[1]);
  assert.equal(activity.cmd, 'SET_ACTIVITY');
  assert.equal(activity.args.activity.details, 'Hanging out with Capri');
  assert.equal(activity.args.activity.buttons.length, 2);
  assert.deepEqual(Object.keys(activity.args.activity).sort(), [
    'assets',
    'buttons',
    'details',
    'instance',
    'timestamps',
  ]);
  socket.emit('data', discordFrame(3, { heartbeat: 42 }));
  assert.equal(socket.writes.at(-1).readUInt32LE(0), 4);
  assert.deepEqual(body(socket.writes.at(-1)), { heartbeat: 42 });
  f.presence.close();
  assert.equal(body(socket.writes.at(-1)).args.activity, null);
  assert.equal(f.presence.retry, null);
});

test('unavailable Discord tries bounded local pipe names and shutdown cancels reconnect', () => {
  const f = fixture();
  f.presence.start();
  for (let index = 0; index < 10; index++) f.sockets[index].emit('error', new Error('absent'));
  assert.equal(f.paths.length, 10);
  assert.equal(f.presence.phase, 'waiting');
  assert.ok(f.presence.retry);
  f.presence.close();
  assert.equal(f.presence.retry, null);
});

test('oversized or malformed RPC input cannot enter activity, logs or configuration', () => {
  const f = fixture();
  f.presence.start();
  f.sockets[0].emit('data', Buffer.alloc(65545));
  assert.equal(f.sockets[0].destroyed, true);
  assert.equal(f.paths.length, 2);
  const malformed = Buffer.alloc(8);
  malformed.writeUInt32LE(100000, 4);
  f.sockets[1].emit('data', malformed);
  assert.equal(f.sockets[1].destroyed, true);
  assert.equal(f.presence.snapshot().applicationId, '123456789012345678');
  f.presence.close();
});
