// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  WINDOWS_AUDIO_PACKET_BYTES,
  WindowsAudioEndpoints,
} from '../apps/desktop/windows-audio-endpoints.mjs';

class FakeEndpointProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  exitCode = null;
  signalCode = null;

  constructor() {
    super();
    this.stdin.once('finish', () => this.close(0));
  }

  close(code) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('close', code);
  }

  kill() {
    this.close(1);
  }
}

const prepare = async () => 'Capri.audio-endpoints.exe';

test('Windows endpoint enumeration normalizes active inputs and outputs without an audio stream', async () => {
  let runs = 0;
  const endpoints = new WindowsAudioEndpoints({
    platform: 'win32',
    prepare,
    run: async (_helper, args) => {
      assert.deepEqual(args, ['list']);
      runs++;
      return {
        stdout: JSON.stringify([
          { id: 'virtual.1', label: ' Cable Input \r\n', kind: 'output' },
          { id: 'virtual.2', label: 'Saída do cabo', kind: 'input' },
          { id: '\0bad', label: 'Ignored', kind: 'input' },
          { id: 'unknown', label: 'Ignored', kind: 'unknown' },
          null,
        ]),
      };
    },
    spawnProcess: () => assert.fail('listing must never spawn capture'),
  });
  const requests = [endpoints.list(), endpoints.list()];
  assert.strictEqual(requests[0], requests[1]);
  assert.deepEqual(await requests[0], [
    { id: 'virtual.1', label: 'Cable Input', kind: 'output' },
    { id: 'virtual.2', label: 'Saída do cabo', kind: 'input' },
  ]);
  assert.equal(runs, 1);
});

test('capture opens only the requested endpoint and emits bounded whole PCM packets', async () => {
  const child = new FakeEndpointProcess();
  const endpoints = new WindowsAudioEndpoints({
    platform: 'win32',
    prepare,
    spawnProcess: (_helper, args) => {
      assert.deepEqual(args, ['capture', 'named-endpoint']);
      return child;
    },
  });
  const received = [];
  const errors = [];
  const abort = new AbortController();
  const ready = endpoints.capture('named-endpoint', {
    signal: abort.signal,
    onPacket: (packet) => received.push(packet),
    onError: (error) => errors.push(error),
  });
  await nextTurn();
  child.stdout.write('CAPRI-');
  child.stdout.write('AUDIO-1\n');
  const handle = await ready;
  const packet = Buffer.alloc(WINDOWS_AUDIO_PACKET_BYTES, 0x52);
  child.stdout.write(packet.subarray(0, 180));
  assert.equal(received.length, 0);
  child.stdout.write(Buffer.concat([packet.subarray(180), packet, packet.subarray(0, 7)]));
  assert.deepEqual(received, [packet, packet]);
  abort.abort();
  handle.stop();
  child.stdout.write(packet.subarray(7));
  await nextTurn();
  assert.equal(received.length, 2);
  assert.equal(child.exitCode, 0);
  assert.deepEqual(errors, []);
});

test('the capture protocol rejects invalid startup and reports a disconnected endpoint once', async () => {
  let child;
  const endpoints = new WindowsAudioEndpoints({
    platform: 'win32',
    prepare,
    spawnProcess: () => (child = new FakeEndpointProcess()),
  });
  const options = { onPacket: () => assert.fail('no audio expected') };
  const broken = assert.rejects(endpoints.capture('virtual', options), /could not start/);
  await nextTurn();
  child.stdout.write('invalid start\n');
  await broken;

  const errors = [];
  const ready = endpoints.capture('virtual', {
    ...options,
    onError: (error) => errors.push(error.message),
  });
  await nextTurn();
  child.stdout.write('CAPRI-AUDIO-1\n');
  const capture = await ready;
  child.close(1);
  capture.stop();
  assert.deepEqual(errors, ['The selected audio source disconnected.']);
});
