/** Real CPU ASR + attention gate; generated fixtures, no microphone or actions. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import { ASRWorker } from '../../apps/desktop/asr-worker.mjs';
import { MicrophoneService } from '../../apps/desktop/microphone-service.mjs';
import { isClipCommand } from '../../apps/desktop/clip-command.mjs';

const folder = path.join(root, '.runtime/asr-command-evaluation');
const fixtures = JSON.parse(
  readFileSync(path.join(folder, 'fixtures.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const config = JSON.parse(readFileSync(path.join(root, 'config/companion-asr.json'), 'utf8'));
const worker = new ASRWorker({ root }),
  submitted = [],
  events = [];
const microphone = new MicrophoneService({
  worker,
  config,
  emit: (event) => events.push(event),
  interrupt: () => {},
  submit: async (value) => submitted.push(value),
});
const wanted = [
  '0-0.wav',
  '0-2.wav',
  '1-0.wav',
  '2-0.wav',
  '3-0.wav',
  '4-0.wav',
  '7-0.wav',
  '8-0.wav',
  '11-0.wav',
  '12-0.wav',
  '13-0.wav',
];
const report = { passed: false, physicalMicrophone: false, actionsExecuted: false, rows: [] };
function samples(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  let data, rate, channels, bits;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const size = bytes.readUInt32LE(offset + 4),
      tag = bytes.toString('ascii', offset, offset + 4);
    if (tag === 'fmt ') {
      channels = bytes.readUInt16LE(offset + 10);
      rate = bytes.readUInt32LE(offset + 12);
      bits = bytes.readUInt16LE(offset + 22);
    }
    if (tag === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.equal(rate, 16000);
  assert.equal(channels, 1);
  assert.equal(bits, 16);
  assert.ok(data);
  const pcm = new Float32Array(data.length / 2 + 48000);
  for (let i = 0; i < data.length / 2; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
  return pcm;
}
try {
  for (const name of wanted) {
    const fixture = fixtures.find((f) => f.file === name);
    assert.ok(fixture);
    submitted.length = 0;
    events.length = 0;
    const capture = await microphone.start();
    microphone.confirm(capture.sessionId);
    const pcm = samples(path.join(folder, name)),
      started = performance.now();
    let sequence = 0;
    for (let offset = 0; offset < pcm.length; offset += 1600) {
      const chunk = pcm.slice(offset, offset + 1600);
      await microphone.audio({
        sessionId: capture.sessionId,
        sequence: sequence++,
        pcm: new Uint8Array(chunk.buffer),
      });
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, started + (offset + 1600) / 16 - performance.now())),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    const row = {
      expected: fixture.text,
      prompts: submitted.map((m) => m.text),
      wakeCount: events.filter((e) => e.type === 'microphone.wake').length,
    };
    report.rows.push(row);
    console.log(JSON.stringify(row));
    const nameOnly = ['11-0.wav', '12-0.wav'].includes(name);
    if (nameOnly) {
      assert.equal(row.wakeCount, 1);
      assert.equal(microphone.snapshot().wakeState, 'command');
    }
    const addressed =
      !nameOnly && (fixture.text.startsWith('Capri') || fixture.text.startsWith('Hey Capri'));
    assert.equal(submitted.length, addressed ? 1 : 0);
    if (addressed) {
      assert.equal(row.wakeCount, 1);
      assert.doesNotMatch(submitted[0].text, /^(?:hey[, ]*)?(?:capri|copri|copry)[, .]/i);
    }
    if (name === '0-0.wav' || name === '0-2.wav' || name === '1-0.wav')
      assert.equal(isClipCommand(submitted[0].text), true);
    if (name === '2-0.wav') {
      assert.match(submitted[0].text, /^copy that file[.!]?$/i);
      assert.equal(isClipCommand(submitted[0].text), false);
    }
    if (name === '3-0.wav') {
      assert.match(submitted[0].text, /leave that window open/i);
      assert.equal(isClipCommand(submitted[0].text), false);
    }
    if (name === '4-0.wav') assert.equal(isClipCommand(submitted[0].text), false);
    if (name === '13-0.wav') {
      assert.match(submitted[0].text, /^leave that[.!]?$/i);
      assert.equal(isClipCommand(submitted[0].text), false);
    }
    microphone.stop(capture.sessionId);
  }
  report.passed = true;
} finally {
  microphone.close();
  writeFileSync(
    path.join(root, 'logs/asr-commands-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
