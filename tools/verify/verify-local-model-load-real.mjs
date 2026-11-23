// SPDX-License-Identifier: GPL-3.0-only
// Explicit real-model qualification. Uses a separate loopback Ollama instance,
// cached weights only, stock hardware settings and isolated preferences.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { availableParallelism } from 'node:os';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { LocalModelLoad } from '../../apps/desktop/local-model-load.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--(ollama|models|model|duration|suite)=(.+)$/.exec(arg);
    if (!match)
      throw Error('Use --ollama=<exe> --models=<cache> --model=<cached model> [--duration=10]');
    return [match[1], match[2]];
  }),
);
if (
  process.platform !== 'win32' ||
  !path.isAbsolute(options.ollama ?? '') ||
  !path.isAbsolute(options.models ?? '') ||
  !options.model
)
  throw Error('Windows and explicit cached Ollama/model paths are required.');
const duration = Number(options.duration ?? 10);
if (!Number.isInteger(duration) || duration < 8 || duration > 60)
  throw Error('Duration must be 8–60 seconds.');
if (options.suite && !['all', 'live'].includes(options.suite))
  throw Error('Suite must be all or live.');
const run = promisify(execFile),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parent = path.join(root, '.runtime/local-load-real');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'qualification-'));
const report = { passed: false, cases: [], checks: [], errors: [] };
const socket = createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = 'http://127.0.0.1:' + port;
const engine = spawn(options.ollama, ['serve'], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    OLLAMA_HOST: '127.0.0.1:' + port,
    OLLAMA_MODELS: options.models,
    OLLAMA_NO_CLOUD: '1',
    OLLAMA_NUM_PARALLEL: '1',
    OLLAMA_MAX_LOADED_MODELS: '1',
  },
});
const limit = new LocalModelLoad({ root, dataRoot: folder });
let active = false,
  timer,
  pending,
  abort;
async function until(check, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await sleep(100);
  }
  throw Error('Timed out waiting for local load control.');
}
const chat = (value, signal) =>
  fetch(base + '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ model: options.model, think: false, keep_alive: -1, ...value }),
    signal,
  });
async function liveChanges() {
  const warmed = await chat(
    {
      stream: false,
      messages: [{ role: 'user', content: 'Say Ready.' }],
      options: { num_ctx: 4096, num_thread: 4, num_gpu: 99, num_predict: 1 },
    },
    AbortSignal.timeout(90000),
  );
  assert.equal(warmed.ok, true);
  await warmed.json();
  limit.set({ enabled: true, percent: 85 });
  active = true;
  abort = new AbortController();
  let characters = 0;
  const response = await chat(
    {
      stream: true,
      messages: [
        {
          role: 'user',
          content:
            'Write a very long technical explanation of computer architecture. Discuss every major component with examples. Continue for at least 10000 words.',
        },
      ],
      options: { num_ctx: 4096, num_thread: 4, num_gpu: 99, num_predict: 10000, seed: 17 },
    },
    AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]),
  );
  assert.equal(response.ok, true);
  pending = (async () => {
    let buffer = '';
    for await (const bytes of response.body) {
      buffer += Buffer.from(bytes).toString();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const value = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (value.error) throw Error('Local model failed during the live scenario.');
        characters += value.message?.content?.length ?? 0;
      }
    }
  })();
  pending.catch(() => {});
  await until(() => limit.sample?.members > 0);
  await sleep(3500);
  const initialWorker = limit.worker,
    oldQuota = limit.policy.cap;
  limit.set({ enabled: true, percent: 35 });
  assert(
    limit.policy.cap <= oldQuota,
    'lowering a live target must not release the calibrated CPU quota',
  );
  await sleep(1000);
  for (const percent of [30, 25, 20, 10, 60, 85]) {
    limit.set({ enabled: true, percent });
    await sleep(150);
  }
  assert.equal(
    limit.worker,
    initialWorker,
    'slider changes never restart the model or its controller',
  );
  report.checks.push(
    'Live and rapid slider changes preserve calibration and keep the same helper.',
  );
  limit.set({ enabled: false, percent: 85 });
  await limit.stopping;
  assert.equal(limit.worker, null);
  const beforeOff = characters;
  await sleep(1200);
  assert(characters > beforeOff, 'generation continues with the limiter disabled');
  limit.set({ enabled: true, percent: 85 });
  await until(() => limit.worker && limit.sample?.members > 0);
  const crashed = limit.worker,
    beforeCrash = characters;
  crashed.kill();
  await until(() => !limit.worker);
  await sleep(1000);
  assert(characters > beforeCrash, 'a crashed limiter must not stop the model stream');
  await until(() => limit.worker && limit.worker !== crashed && limit.sample?.members > 0, 15000);
  assert.equal(limit.jobs.size, 1);
  report.checks.push(
    'Disabling/re-enabling during a reply works; forced helper exit recovers while the reply continues.',
  );
  active = false;
  limit.synchronize(false);
  await limit.stopping;
  assert.equal(limit.worker, null);
  report.checks.push(
    'Leaving local activity for idle/API releases the running helper immediately.',
  );
  abort.abort();
  await pending.catch(() => {});
  pending = null;
  console.log(JSON.stringify({ liveChanges: 'passed' }));
}
async function measure(device, percent) {
  limit.set({ enabled: true, percent });
  active = true;
  let characters = 0,
    done = false,
    firstText = null;
  abort = new AbortController();
  const began = performance.now();
  const response = await chat(
    {
      stream: true,
      messages: [
        {
          role: 'user',
          content:
            'Write a long technical explanation of operating systems, memory, process scheduling and networking. Include many concrete examples and continue for at least 5000 words.',
        },
      ],
      options: {
        num_ctx: 4096,
        num_thread: Math.min(32, availableParallelism()),
        num_gpu: device === 'cpu' ? 0 : 99,
        num_predict: 6000,
        seed: 42,
      },
    },
    AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]),
  );
  assert.equal(response.ok, true);
  pending = (async () => {
    let buffer = '';
    for await (const bytes of response.body) {
      buffer += Buffer.from(bytes).toString();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const value = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (value.error) throw Error('Local model failed during generation.');
        if (value.message?.content) {
          characters += value.message.content.length;
          firstText ??= performance.now() - began;
        }
        if (value.done) done = true;
      }
    }
  })();
  // Observe errors immediately, also while awaiting native startup.
  pending.catch(() => {});
  await until(() => limit.sample?.members > 0, 20000);
  await sleep(2500);
  const start = performance.now(),
    initial = characters,
    samples = [];
  while (!done && performance.now() - start < duration * 1000) {
    const sample = limit.sample;
    if (sample)
      samples.push({
        cpu: sample.cpuPercent,
        gpu: sample.gpuPercent,
        quota: sample.appliedCpuPercent,
      });
    // Optional independent NVIDIA measurement; no clock/power changes.
    const thermal = await run(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 2000 },
    )
      .then(({ stdout }) => stdout.trim().split(/\s+/).map(Number).filter(Number.isFinite))
      .catch(() => []);
    if (thermal.some((temperature) => temperature >= 78))
      throw Error('GPU thermal guard stopped qualification.');
    await sleep(450);
  }
  const average = (key) => {
    const values = samples.map((row) => row[key]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  assert(samples.length >= 3);
  assert(samples.every((sample) => sample.quota <= percent + 0.001));
  assert(characters > initial, 'generation must continue under the selected limit');
  const result = {
    device,
    target: percent,
    cpuAverage: average('cpu'),
    gpuAverage: average('gpu'),
    charactersPerSecond: ((characters - initial) / (performance.now() - start)) * 1000,
    firstTextMs: firstText,
    samples,
  };
  report.cases.push(result);
  console.log(JSON.stringify({ ...result, samples: undefined }));
  abort.abort();
  await pending.catch(() => {});
  pending = null;
  active = false;
  await limit.stop();
  assert.equal(limit.worker, null);
}
try {
  await until(() =>
    fetch(base + '/api/version', { signal: AbortSignal.timeout(500) })
      .then((response) => response.ok)
      .catch(() => false),
  );
  const tags = await (await fetch(base + '/api/tags')).json();
  assert(
    tags.models.some((model) => model.name === options.model),
    'only an already cached model may be used',
  );
  const started = (
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Process -Id ' + engine.pid + ').StartTime.ToUniversalTime().Ticks.ToString()',
      ],
      { windowsHide: true },
    )
  ).stdout.trim();
  limit.marker = () => ({ pid: engine.pid, startedAt: started, executable: options.ollama });
  await limit.prepare();
  timer = setInterval(() => limit.synchronize(active), 350);
  for (const device of options.suite === 'live' ? [] : ['gpu', 'cpu']) {
    const warmed = await chat(
      {
        stream: false,
        messages: [{ role: 'user', content: 'Say Ready.' }],
        options: {
          num_ctx: 4096,
          num_thread: Math.min(32, availableParallelism()),
          num_gpu: device === 'cpu' ? 0 : 99,
          num_predict: 1,
        },
      },
      AbortSignal.timeout(90000),
    );
    assert.equal(warmed.ok, true);
    await warmed.json();
    for (const percent of device === 'gpu' ? [100, 85, 60, 35, 100] : [100, 25, 10, 100])
      await measure(device, percent);
  }
  await liveChanges();
  limit.set({ enabled: false, percent: 85 });
  active = true;
  for (let n = 0; n < 5; n++) {
    limit.synchronize(true);
    await sleep(100);
  }
  assert.equal(limit.worker, null);
  active = false;
  limit.synchronize(false);
  assert.equal(limit.jobs.size, 1, 'repeated local turns must reuse one supervisor job');
  if (report.cases.length)
    report.checks.push(
      'GPU/CPU generation continues at all selected limits; native CPU quotas respect each setting.',
    );
  report.checks.push(
    'Ending a reply and disabling control stop the helper; repeated turns reuse one job.',
    'Only an isolated loopback service and cached model were used; no paid API calls or owner conversations.',
  );
  report.passed = true;
} catch (error) {
  report.errors.push(error.message);
  throw error;
} finally {
  clearInterval(timer);
  abort?.abort();
  await pending?.catch(() => {});
  await limit.close();
  await fetch(base + '/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model: options.model, keep_alive: 0 }),
    signal: AbortSignal.timeout(15000),
  })
    .then((response) => response.body?.cancel())
    .catch(() => {});
  engine.kill();
  await Promise.race([once(engine, 'exit'), sleep(3000)]);
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ passed: report.passed, folder, cases: report.cases.length }));
