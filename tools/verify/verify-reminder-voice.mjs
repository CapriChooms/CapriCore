// SPDX-License-Identifier: GPL-3.0-only
/** Real selected voice PCM, isolated reminder queue. Does not start/stop another installation. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, request } from '../../packages/runtime/src/index.mjs';
import { VoiceService } from '../../apps/desktop/voice-service.mjs';
import { ReminderDelivery } from '../../apps/desktop/reminder-delivery.mjs';
import { SleepService, visuallySleeping } from '../../apps/desktop/sleep-service.mjs';

const argument = process.argv.indexOf('--service-root');
const serviceRoot = argument < 0 ? root : path.resolve(process.argv[argument + 1]);
const config = JSON.parse(
  readFileSync(path.join(serviceRoot, 'config/companion-voice.json'), 'utf8'),
);
assert(Number.isInteger(config.port) && config.port > 1024 && config.port < 65536);
const url = 'http://127.0.0.1:' + config.port;
const headers = () => ({
  authorization:
    'Bearer ' +
    readFileSync(path.join(serviceRoot, 'data/speech/companion-voice-token'), 'utf8').trim(),
});
const health = await request(url + '/health', { headers: headers(), timeout: 3000 });
assert.equal(health.ready, true, 'Start the selected voice service before this verification');
const parent = path.join(root, '.runtime/reminder-voice-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const report = {
  passed: false,
  folder,
  realSpeech: true,
  physicalPlayback: false,
  coreReloads: 0,
  frames: 0,
  samples: 0,
};
let finish;
const voice = new VoiceService({
  url,
  headers,
  emit: (event) => {
    if (event.type === 'voice.audio') {
      report.frames++;
      report.samples += Buffer.from(event.pcm, 'base64').length / 4;
      report.sampleRate = event.sampleRate;
    }
    if (event.type === 'voice.generated') finish?.();
    if (event.type === 'voice.error') finish?.(new Error(event.message));
  },
});
const sleep = new SleepService({
  unload: async () => voice.setReady(false),
  reload: async () => report.coreReloads++,
});
const delivery = new ReminderDelivery({
  file: path.join(folder, 'delivery.json'),
  visual: async () => {
    report.visual = true;
  },
  ready: () => 'ready',
  prepare: () => sleep.wakeForReminder(() => voice.prepareLanguage()),
  speak: () =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Real reminder voice timed out')), 60000);
      finish = (error) => {
        clearTimeout(timeout);
        error ? reject(error) : resolve();
      };
      voice.preview('reminder-fixture', 'Choom, your reminder: stretch your legs.');
    }),
});
try {
  await sleep.sleep();
  await delivery.enqueue({
    id: 'fixture',
    title: 'Stretch your legs',
    kind: 'reminder',
    dueAt: Date.now(),
  });
  for (let i = 0; i < 700 && !['spoken', 'failed'].includes(delivery.snapshot()[0]?.state); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(delivery.snapshot()[0]?.state, 'spoken', JSON.stringify(delivery.snapshot()));
  assert(report.frames > 0 && report.samples > 1000);
  assert.equal(sleep.phase, 'voice-awake');
  assert.equal(visuallySleeping(sleep.phase, 'offline'), false);
  assert.equal(report.coreReloads, 0);
  report.passed = true;
  report.speechSeconds = report.samples / report.sampleRate;
} finally {
  delivery.close();
  voice.close();
  sleep.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
