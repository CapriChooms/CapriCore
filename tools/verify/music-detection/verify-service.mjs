// SPDX-License-Identifier: GPL-3.0-only
// Real CPU worker, public cached benchmark PCM, no system/microphone capture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MusicListeningService } from '../../../apps/desktop/music-listening-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = path.join(root, '.runtime/music-detection-research');
const data = path.join(fixture, 'benchmark');
const python = path.join(root, '.runtime/router-venv/Scripts/python.exe');
assert(existsSync(python), 'Install the existing CPU router runtime first.');

function readPcm16(name, seconds = 10) {
  const body = readFileSync(path.join(data, name));
  assert.equal(body.toString('ascii', 0, 4), 'RIFF');
  let position = 12,
    format,
    pcm;
  while (position + 8 <= body.length) {
    const kind = body.toString('ascii', position, position + 4),
      size = body.readUInt32LE(position + 4);
    const start = position + 8;
    if (kind === 'fmt ')
      format = {
        encoding: body.readUInt16LE(start),
        channels: body.readUInt16LE(start + 2),
        rate: body.readUInt32LE(start + 4),
        bits: body.readUInt16LE(start + 14),
      };
    if (kind === 'data') {
      pcm = body.subarray(start, Math.min(body.length, start + size));
      break;
    }
    position = start + size + (size % 2);
  }
  assert.deepEqual(format, { encoding: 1, channels: 1, rate: 16000, bits: 16 });
  assert(pcm?.length >= (seconds + 5) * 16000 * 2);
  const result = new Float32Array(seconds * 16000);
  for (let i = 0; i < result.length; i++) result[i] = pcm.readInt16LE((5 * 16000 + i) * 2) / 32768;
  return result;
}

async function until(test, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!test()) {
    assert(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const events = [],
  children = [],
  network = globalThis.fetch;
let networkCalls = 0,
  sequence = 0,
  lastSequence = -1;
globalThis.fetch = () => {
  networkCalls++;
  throw Error('Network forbidden in music worker verification.');
};
const service = new MusicListeningService({
  root,
  settings: () => ({ enabled: true, notes: true, motion: true }),
  prepare: async () => ({ python, folder: path.join(fixture, 'yamnet-onnx-float') }),
  spawnImpl: (command, args, options) => {
    assert.equal(command, python);
    assert(args.includes('integrations.music_runtime.worker'));
    assert.equal(options.windowsHide, true);
    assert(
      Object.keys(options.env).every((key) =>
        [
          'SystemRoot',
          'WINDIR',
          'PATH',
          'TEMP',
          'TMP',
          'PYTHONUTF8',
          'PYTHONIOENCODING',
          'PYTHONDONTWRITEBYTECODE',
          'OMP_NUM_THREADS',
          'OPENBLAS_NUM_THREADS',
          'MKL_NUM_THREADS',
        ].includes(key),
      ),
    );
    const child = spawn(command, args, options);
    children.push(child);
    let pending = '';
    child.stdout.on('data', (chunk) => {
      pending += chunk.toString();
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        const value = JSON.parse(line);
        if (value.type === 'classification') lastSequence = value.sequence;
      }
    });
    return child;
  },
  emit: (value) => events.push(value),
});

try {
  const session = service.start();
  await until(
    () => service.session?.ready || service.phase === 'error',
    'CPU worker did not initialize.',
  );
  assert.notEqual(service.phase, 'error');
  assert(service.ready(session.sessionId));
  const send = async (samples) => {
    for (let offset = 0; offset < samples.length; offset += 8000) {
      const current = sequence++;
      assert(
        service.packet({
          sessionId: session.sessionId,
          sequence: current,
          pcm: samples.subarray(offset, offset + 8000),
        }).accepted,
      );
      if (current % 2 === 1)
        await until(() => lastSequence >= current, 'CPU classification missing.');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  await send(readPcm16('musan-music-0.wav'));
  assert(service.snapshot().hearingMusic, 'Real public music must activate the animation state.');
  const musicScore = service.snapshot().musicScore;
  sequence += 4; // Seeking to a different recording must invalidate the previous beat.
  await send(readPcm16('musan-music-110.wav', 20));
  const rhythm = service.snapshot();
  assert(rhythm.hearingMusic);
  assert(rhythm.tempo >= 40 && rhythm.tempo <= 240);
  assert(rhythm.tempoConfidence >= 0.45 && rhythm.tempoConfidence <= 1);
  assert(rhythm.beatAt > 0 && rhythm.beatAt <= Date.now());
  await send(readPcm16('musan-speech-0.wav'));
  assert(!service.snapshot().hearingMusic, 'Real speech must leave the music animation state.');
  assert(service.snapshot().speechScore > 0.8);
  assert.equal(service.snapshot().tempo, 0, 'Ordinary speech must clear BPM and beat timing');
  assert.equal(service.snapshot().beatAt, 0);
  assert.equal(networkCalls, 0);
  assert.equal(children.length, 1);
  service.stop();
  await until(
    () => children[0].exitCode !== null || children[0].signalCode !== null,
    'Worker did not terminate.',
  );
  assert.equal(service.snapshot().phase, 'off');
  assert.equal(service.snapshot().musicScore, 0);
  assert(!JSON.stringify(events).includes('pcm'));
  const report = {
    passed: true,
    publicRecordings: 3,
    musicDetected: true,
    pureSpeechRejected: true,
    classifierChildProcesses: children.length,
    packetCount: sequence,
    networkCalls,
    noDeviceCapture: true,
    musicScore,
    tempoEstimated: rhythm.tempo,
    tempoConfidence: rhythm.tempoConfidence,
    tempoAccuracyGroundTruthAvailable: false,
    speechExited: true,
    stoppedAndReset: true,
  };
  writeFileSync(
    path.join(data, 'service-verification.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} finally {
  service.stop();
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill();
  globalThis.fetch = network;
}
