// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemorySampler,
  memoryUsage,
  parseGpuMemory,
} from '../packages/runtime/src/hardware/memory.mjs';
import { gpuBudget } from '../packages/runtime/src/hardware/gpu-budget.mjs';
import {
  memoryDisplay,
  dedicatedCapacity,
  contextDisplay,
  ResourceWarnings,
  sparkline,
} from '../apps/desktop/renderer/memory-hud.mjs';
import { ProcessLoadSampler } from '../apps/desktop/process-load.mjs';
import {
  celsiusFromDecikelvin,
  cpuPackageTemperature,
  CpuSampler,
  libreCpuTemperature,
  resourceDiskUsage,
} from '../apps/desktop/system-resources.mjs';
import {
  resourceMonitorDisplay,
  resourceMonitorNeedsProcessLoad,
} from '../apps/desktop/renderer/resource-metrics.mjs';
import { ContextSampler, contextUsage } from '../apps/desktop/context-usage.mjs';
import {
  COMPANION_DEFAULTS,
  monitorDisplayChange,
  validateCompanionSettings,
} from '../apps/desktop/companion-settings.mjs';
import { startModelServices } from '../apps/desktop/model-startup.mjs';

test('memory readings reject unavailable values and choose pressure per GPU, never pool incompatible cards', () => {
  const gpus = parseGpuMemory(
    '0, GPU-0, RTX 4070, 12282, 6000\n1, GPU-1, RTX 3090, 24576, 1000\n2, GPU-2, Unknown, N/A, N/A',
  );
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].freeBytes, 6000 * 1024 ** 2);
  assert.equal(memoryDisplay({ gpus }).gpu.id, 'GPU-1');
  assert.equal(memoryUsage(1024, 2048), null);
  assert.equal(memoryUsage(0, 0), null);
  assert.equal(memoryDisplay({ gpus: [] }).gpu, null);
  assert.equal(memoryDisplay({ ram: memoryUsage(100, 25) }).ram.percent, 75);
});

test('AMD dedicated capacity remains visible when usage is unavailable; shared memory is never VRAM', () => {
  const amd = {
    id: 'rx6400',
    name: 'AMD Radeon RX 6400',
    vendor: 'amd',
    memoryKind: 'dedicated',
    totalBytes: 4 * 1024 ** 3,
    usedBytes: null,
    freeBytes: null,
  };
  const shared = { ...amd, id: 'apu', memoryKind: 'shared', totalBytes: 16 * 1024 ** 3 };
  const sample = { gpus: [shared, amd] };
  assert.equal(dedicatedCapacity(sample), amd);
  assert.equal(memoryDisplay(sample).gpu, null);
  assert.equal(dedicatedCapacity({ gpus: [shared] }), null);
  assert.equal(dedicatedCapacity({ gpus: [{ ...amd, totalBytes: NaN }] }), null);
});

test('missing AMD memory samples cannot count as zero usage and rearm a dismissed warning', () => {
  const warnings = new ResourceWarnings();
  const sample = (at, usedBytes) => ({
    gpuSampledAt: at,
    gpus: [{ id: 'amd', vendor: 'amd', memoryKind: 'dedicated', totalBytes: 100, usedBytes }],
  });
  warnings.update(sample(1, 97));
  assert.equal(warnings.update(sample(2, 97))[0].device, 'VRAM');
  warnings.dismiss('VRAM');
  assert.deepEqual(warnings.update(sample(3, null)), []);
  assert.deepEqual(warnings.update(sample(4, 97)), []);
  assert.deepEqual(warnings.update(sample(5, 97)), []);
  warnings.update(sample(6, 50));
  warnings.update(sample(7, 97));
  assert.equal(warnings.update(sample(8, 97))[0].device, 'VRAM');
});

test('overlapping readers share one bounded probe; failure removes stale data and backs off', async () => {
  let now = 0,
    calls = 0,
    fail = false,
    finish;
  const gpu = parseGpuMemory('0, GPU-0, RTX 4070, 12288, 4096');
  const sampler = new MemorySampler({
    now: () => now,
    ram: () => memoryUsage(480, 240),
    readGpu: async () => {
      calls++;
      if (fail) throw Error('driver unavailable');
      await new Promise((resolve) => {
        finish = resolve;
      });
      return gpu;
    },
  });
  const first = sampler.sample(),
    second = sampler.sample();
  await Promise.resolve();
  finish();
  assert.equal((await first).gpus.length, 1);
  assert.equal((await second).gpus.length, 1);
  assert.equal(calls, 1);
  await sampler.sample();
  assert.equal(calls, 1);
  fail = true;
  now = 3000;
  assert.equal((await sampler.sample()).gpus.length, 0);
  now = 4000;
  assert.equal((await sampler.sample()).gpus.length, 0);
  assert.equal(calls, 2);
});

test('GPU budget leaves room for Windows and future voice without double-counting resident speech', () => {
  const gpus = [{ id: 'a', name: 'small', freeBytes: 2 * 1024 ** 3, totalBytes: 6 * 1024 ** 3 }];
  const ready = gpuBudget({ gpus, voiceExpected: true, voiceReady: true });
  const cold = gpuBudget({ gpus, voiceExpected: true });
  assert.equal(ready.overheadBytes, 768 * 1024 ** 2);
  assert.equal(cold.devices[0].availableForModelBytes, 0);
  assert.equal(ready.devices[0].availableForModelBytes, 1280 * 1024 ** 2);
  assert.equal(gpuBudget({ acceleration: 'cpu' }).overheadBytes, 0);
  assert.deepEqual(gpuBudget().devices, []);
});

test('voice finishes allocating before Qwen, voice errors allow text, and cancellation stops queued models', async () => {
  for (const fail of [false, true]) {
    const events = [];
    const result = await startModelServices({
      voiceFirst: true,
      voice: async () => {
        events.push('voice');
        if (fail) throw Error('voice failed');
      },
      core: () => events.push('core'),
      recognition: () => events.push('asr'),
    });
    assert.deepEqual(events, ['voice', 'core', 'asr']);
    assert.equal(result[0].status, 'fulfilled');
    assert.equal(result[2].status, fail ? 'rejected' : 'fulfilled');
  }
  let active = true;
  const result = await startModelServices({
    voiceFirst: true,
    voice: () => {
      active = false;
    },
    shouldContinue: () => active,
    core: () => assert.fail('core must not start after cancellation'),
  });
  assert.equal(result[0].status, 'rejected');
});

test('existing preferences gain enabled memory charts; invalid values cannot create fast polling', () => {
  assert.equal(validateCompanionSettings({}).memoryMonitor, true);
  assert.equal(validateCompanionSettings({}).processGraphs, true);
  assert.equal(validateCompanionSettings({ processGraphs: false }).processGraphs, false);
  assert.throws(() => validateCompanionSettings({ processGraphs: 'false' }));
  assert.equal(validateCompanionSettings({}).memoryStyle, 'rings');
  assert.equal(validateCompanionSettings({ memoryStyle: 'bars' }).memoryStyle, 'bars');
  assert.equal(
    validateCompanionSettings({ memoryStyle: 'rings', memoryMonitor: false }).memoryMonitor,
    false,
  );
  for (let seconds = 1; seconds <= 10; seconds++)
    assert.equal(
      validateCompanionSettings({ memoryIntervalSeconds: seconds }).memoryIntervalSeconds,
      seconds,
    );
  for (const value of [0, 0.01, 1.5, 11, 100, NaN, '3'])
    assert.throws(() =>
      validateCompanionSettings({ ...COMPANION_DEFAULTS, memoryIntervalSeconds: value }),
    );
  assert.throws(() => validateCompanionSettings({ memoryStyle: 'pie' }));
});

test('display shortcut collapses graphs without replacing the previous compact style', () => {
  const legacy = validateCompanionSettings({ processGraphs: true, memoryStyle: 'bars' });
  const collapsed = { ...legacy, ...monitorDisplayChange(legacy, 'toggle') };
  assert.equal(collapsed.processGraphs, false);
  assert.equal(collapsed.memoryStyle, 'bars');
  assert.deepEqual({ ...collapsed, ...monitorDisplayChange(collapsed, 'graphs') }, legacy);
  const circles = { ...legacy, ...monitorDisplayChange(legacy, 'rings') };
  assert.equal(circles.processGraphs, false);
  assert.equal(circles.memoryStyle, 'rings');
  assert.equal(circles.memoryMonitor, true);
  assert.equal(circles.memoryIntervalSeconds, legacy.memoryIntervalSeconds);
  const hidden = { ...circles, ...monitorDisplayChange(circles, 'off') };
  assert.deepEqual(resourceMonitorDisplay(hidden), { graphs: [], meters: [] });
  assert.deepEqual({ ...hidden, ...monitorDisplayChange(hidden, 'rings') }, circles);
  assert.throws(() => monitorDisplayChange(legacy, 'invalid'), /Invalid monitor display/);
});

test('graph and compact meter selections migrate independently and enforce the four-item limit', () => {
  const defaults = validateCompanionSettings({});
  assert.deepEqual(defaults.graphMetrics, ['cpu', 'gpu', 'ram', 'vram']);
  assert.deepEqual(defaults.meterMetrics, ['cpu', 'gpu', 'ram', 'vram']);
  const custom = validateCompanionSettings({
    graphMetrics: ['disk', 'gpuTemperature'],
    meterMetrics: ['capriRam'],
  });
  const expanded = resourceMonitorDisplay(custom);
  assert.deepEqual(expanded, { graphs: ['disk', 'gpuTemperature'], meters: [] });
  assert.equal(resourceMonitorNeedsProcessLoad(expanded), false);
  const compact = resourceMonitorDisplay({ ...custom, ...monitorDisplayChange(custom, 'toggle') });
  assert.deepEqual(compact, { graphs: [], meters: ['capriRam'] });
  assert.equal(resourceMonitorNeedsProcessLoad(compact), true);
  assert.deepEqual(resourceMonitorDisplay({ ...custom, graphMetrics: [] }), compact);
  assert.deepEqual(resourceMonitorDisplay({ ...custom, graphMetrics: [], meterMetrics: [] }), {
    graphs: [],
    meters: [],
  });
  for (const invalid of [
    null,
    'cpu',
    ['other'],
    ['ram', 'ram'],
    ['cpu', 'gpu', 'ram', 'vram', 'disk'],
  ]) {
    assert.throws(
      () => validateCompanionSettings({ graphMetrics: invalid }),
      /Invalid resource metrics/,
    );
    assert.throws(
      () => validateCompanionSettings({ meterMetrics: invalid }),
      /Invalid resource metrics/,
    );
  }
});

test('disk occupancy uses the installation volume and preserves unavailable readings', async () => {
  const disk = await resourceDiskUsage('fixture-volume', async (location) => {
    assert.equal(location, 'fixture-volume');
    return { bsize: 4096, blocks: 1000, bfree: 250, bavail: 200 };
  });
  assert.deepEqual(disk, {
    totalBytes: 4096000,
    freeBytes: 1024000,
    usedBytes: 3072000,
    percent: 75,
  });
  assert.equal(
    await resourceDiskUsage('invalid', async () => ({ bsize: 4096, blocks: 0, bfree: 0 })),
    null,
  );
  assert.equal(
    await resourceDiskUsage('missing', async () => {
      throw Error('Volume unavailable');
    }),
    null,
  );
});

test('process samples share one probe, ignore reused PIDs and expose unavailable counters', async () => {
  let now = 0;
  let calls = 0;
  let reading = {
    processes: [{ pid: 1, started: '100', cpuMs: 100 }],
    ramBytes: 1024,
    vramBytes: null,
  };
  const sampler = new ProcessLoadSampler({
    now: () => now,
    cores: 4,
    read: () => {
      calls++;
      if (!reading) throw Error('Probe exited');
      return reading;
    },
  });
  const first = sampler.sample();
  assert.equal(first, sampler.sample());
  assert.deepEqual(await first, { cpuPercent: null, ramBytes: 1024, vramBytes: null });
  assert.equal(calls, 1);
  now += 3000;
  reading.processes[0].cpuMs += 1200;
  assert.equal((await sampler.sample()).cpuPercent, 10);
  now += 3000;
  reading.processes[0].started = '101';
  assert.equal((await sampler.sample()).cpuPercent, null);
  reading = null;
  assert.deepEqual(await sampler.sample(), { cpuPercent: null, ramBytes: null, vramBytes: null });
  await sampler.sample();
  assert.equal(calls, 4);
});

test('graph gaps keep unknown measurements distinct from zero', () => {
  const plot = (values) =>
    sparkline(
      values.map((value, index) => ({ at: index * 1000, value })),
      100,
      3000,
      70,
    );
  assert.equal(plot([null, undefined]), '');
  assert.equal(plot([10, null, 0]).match(/M/g).length, 2);
  assert.equal(plot([10, 0]).match(/L/g).length, 1);
});

test('wider graphs show older seconds on the same time and percentage scales', () => {
  const values = [
    { at: 40_000, value: 0 },
    { at: 130_000, value: 0 },
    { at: 200_000, value: 100 },
  ];
  assert.equal(sparkline(values, 100, 200_000, 70), 'M1.0 15.0h.1L69.0 1.0');
  assert.equal(sparkline(values, 100, 200_000, 280), 'M30.1 15.0h.1L52.0 15.0L69.0 1.0');
});

test('CPU temperature selects the package reading from the CPU hardware and rejects other thermals', () => {
  assert.equal(
    cpuPackageTemperature([
      { id: '/nvidiagpu/0/temperature/0', name: 'Core (Tctl/Tdie)', value: 99 },
      { id: '/amdcpu/0/temperature/1', name: 'Core (Tctl)', value: 54 },
      { id: '/amdcpu/0/temperature/2', name: 'CPU CCD1 (Tdie)', value: 55 },
      { id: '/amdcpu/0/temperature/5', name: 'Core (Tctl/Tdie)', value: '49,67' },
    ]),
    49.7,
  );
  assert.equal(
    cpuPackageTemperature([
      { id: '/intelcpu/0/temperature/0', name: 'Core #1 Distance to TjMax', value: 43 },
      { id: '/lpc/it8688e/temperature/0', name: 'CPU Package', value: 44 },
      { id: '/intelcpu/0/temperature/8', name: 'CPU Package', value: '—' },
    ]),
    null,
  );
  assert.equal(
    libreCpuTemperature({
      Children: [
        {
          Children: [
            {
              SensorId: '/intelcpu/0/temperature/8',
              Text: 'CPU Package',
              Type: 'Temperature',
              RawValue: '46.25',
              Value: '115.3 °F',
            },
          ],
        },
      ],
    }),
    46.3,
  );
});

test('system readings distinguish missing temperature and idle GPU usage', async () => {
  const [gpu] = parseGpuMemory('0, GPU-0, NVIDIA GPU, 12000, 1000, [N/A], 0', { telemetry: true });
  assert.equal(gpu.temperatureCelsius, null);
  assert.equal(gpu.utilization, 0);
  assert.equal(gpu.usedBytes, 11000 * 1024 ** 2);
  assert.equal(celsiusFromDecikelvin(''), null);
  assert.equal(celsiusFromDecikelvin('3692'), 96.1);
  assert.equal(celsiusFromDecikelvin('0'), null);

  let now = 0;
  let temperature = 96.1;
  let times = { cores: 4, idle: 200, total: 400 };
  const sampler = new CpuSampler({
    now: () => now,
    readTimes: () => times,
    readTemperature: () => temperature,
  });
  assert.deepEqual(await sampler.sample(), {
    utilization: null,
    temperatureCelsius: 96.1,
    temperatureSampledAt: 0,
  });
  now += 3000;
  times = { cores: 4, idle: 440, total: 800 };
  assert.equal((await sampler.sample()).utilization, 40);
  assert.equal((await sampler.sample()).temperatureSampledAt, 0);
  sampler.stop();
  now += 10000;
  temperature = null;
  assert.deepEqual(await sampler.sample(), {
    utilization: null,
    temperatureCelsius: null,
    temperatureSampledAt: null,
  });
});

test('desktop polling can update CPU load while the temperature probe is pending', async () => {
  let finish;
  let times = { cores: 4, idle: 200, total: 400 };
  const sampler = new CpuSampler({
    readTimes: () => times,
    readTemperature: () => new Promise((resolve) => (finish = resolve)),
  });
  assert.equal((await sampler.sample({ awaitTemperature: false })).temperatureCelsius, null);
  times = { cores: 4, idle: 440, total: 800 };
  assert.equal((await sampler.sample({ awaitTemperature: false })).utilization, 40);
  const completed = sampler.sample();
  finish(43.5);
  assert.equal((await completed).temperatureCelsius, 43.5);
});

test('hardware warnings need distinct high samples and persist until recovery', () => {
  const warnings = new ResourceWarnings();
  const sample = (at, temperature, free) => ({
    sampledAt: at,
    gpuSampledAt: at,
    cpu: { temperatureCelsius: temperature, temperatureSampledAt: at },
    ram: memoryUsage(100, free),
    gpus: [{ id: 'gpu0', temperatureCelsius: temperature, ...memoryUsage(100, free) }],
  });
  assert.deepEqual(warnings.update(sample(0, 96, 4)), []);
  assert.deepEqual(warnings.update(sample(0, 96, 4)), []);
  const active = warnings.update(sample(1, 96, 4));
  assert.deepEqual(
    active.map(({ device }) => device),
    ['CPU', 'RAM', 'GPU', 'VRAM'],
  );
  assert.deepEqual(warnings.update(sample(2, 92, 7)), active);
  assert.deepEqual(warnings.update(sample(3, 81, 20)), []);
  assert.deepEqual(warnings.update(sample(4, 96, 4)), []);
  assert.deepEqual(warnings.update(sample(5, 96, 4)), active);
  assert.deepEqual(warnings.update(null), []);
});

test('dismissed VRAM warnings stay suppressed through missing samples until real recovery', () => {
  const warnings = new ResourceWarnings();
  const sample = (at, free) => ({
    sampledAt: at,
    gpuSampledAt: at,
    ram: memoryUsage(100, 3),
    gpus: [{ id: 'fixture', ...memoryUsage(100, free) }],
  });
  const devices = (sample) => warnings.update(sample).map(({ device }) => device);
  assert.deepEqual(devices(sample(1, 4)), []);
  assert.deepEqual(devices(sample(2, 4)), ['RAM', 'VRAM']);
  warnings.dismiss('VRAM');
  assert.deepEqual(devices(sample(2, 4)), ['RAM']);
  assert.deepEqual(devices(sample(3, 2)), ['RAM']);
  assert.deepEqual(devices(null), []);
  assert.deepEqual(devices(sample(4, 2)), []);
  assert.deepEqual(devices(sample(5, 2)), ['RAM']);
  assert.deepEqual(devices(sample(6, 12)), ['RAM']);
  assert.deepEqual(devices(sample(7, 4)), ['RAM']);
  assert.deepEqual(devices(sample(8, 4)), ['RAM', 'VRAM']);
});

test('context shows measured last-request usage, not a stale pre-compaction estimate', () => {
  const config = { model: 'qwen', contextTokens: 32768 };
  const session = {
    model: 'qwen',
    totalTokens: 8192,
    totalTokensFresh: true,
    contextTokens: 32768,
    contextBudgetStatus: { estimatedPromptTokens: 30000 },
  };
  assert.deepEqual(contextDisplay(contextUsage(session, config)), {
    used: 8192,
    total: 32768,
    percent: 25,
  });
  for (const override of [
    { totalTokensFresh: false },
    { model: 'other' },
    { contextTokens: 65536 },
    { totalTokens: -1 },
    { totalTokens: '8192' },
    { totalTokens: NaN },
  ]) {
    assert.equal(contextDisplay(contextUsage({ ...session, ...override }, config)).percent, null);
  }
  assert.equal(contextDisplay(contextUsage(null, config)).total, 32768);
  assert.equal(contextDisplay(contextUsage({ ...session, totalTokens: 0 }, config)).percent, 0);
  assert.equal(
    contextDisplay(contextUsage({ ...session, totalTokens: 33000 }, config)).percent,
    100,
  );
});

test('context metadata is shared, cached, bounded and cannot return after reset or sleep', async () => {
  let now = 0,
    calls = 0,
    finish;
  const sampler = new ContextSampler({
    model: 'qwen',
    contextTokens: 32768,
    sessionKey: 'chat',
    now: () => now,
    rpc: {
      call(method, params) {
        assert.equal(method, 'sessions.describe');
        assert.deepEqual(params, { key: 'chat' });
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  });
  const response = { session: { model: 'qwen', totalTokens: 8192, totalTokensFresh: true } };
  const first = sampler.sample(),
    second = sampler.sample();
  finish(response);
  assert.equal((await first).usedTokens, 8192);
  assert.equal((await second).usedTokens, 8192);
  await sampler.sample();
  assert.equal(calls, 1);
  now = 3000;
  const late = sampler.sample();
  sampler.invalidate();
  finish(response);
  assert.equal((await late).usedTokens, null);
  assert.equal((await sampler.sample({ available: false })).usedTokens, null);
  assert.equal(calls, 2);

  // A hung gateway must not block the RAM/VRAM HUD indefinitely.
  sampler.timeoutMs = 20;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    assert.equal((await sampler.sample()).source, 'unavailable');
    now += 500;
    await sampler.sample();
    assert.equal(calls, 3, 'failed reads back off');
  } finally {
    clearTimeout(keepAlive);
  }
});
