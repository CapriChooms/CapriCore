// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root, paths } from '../packages/runtime/src/host/paths.mjs';
import { nodePath } from '../packages/runtime/src/host/executables.mjs';
import { runtime, initialize } from '../packages/runtime/src/context.mjs';
import {
  launch,
  markerPath,
  processStartedAt,
  stopProcess,
} from '../packages/runtime/src/host/processes.mjs';

test(
  'Windows process ownership can be verified and released when PowerShell is missing from PATH',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const name = 'shutdown-path-' + randomUUID();
    const savedPath = process.env.PATH;
    t.after(async () => {
      await stopProcess(name);
      for (const stream of ['stdout', 'stderr']) {
        const file = path.join(paths.logs, name + '.' + stream + '.log');
        if (existsSync(file)) unlinkSync(file);
      }
    });
    try {
      process.env.PATH = path.dirname(process.execPath);
      const marker = await launch(
        name,
        process.execPath,
        ['-e', 'setTimeout(() => {}, 5000)'],
        null,
        {
          cleanEnv: true,
          env: process.env,
        },
      );
      assert.match(marker.startedAt, /^\d+$/);
      assert.equal(processStartedAt(marker.pid), marker.startedAt);
      await stopProcess(name);
      assert.equal(existsSync(markerPath(name)), false);
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  },
);

test('a transient start-time lookup failure is retried before writing an ownership marker', async (t) => {
  const name = 'shutdown-retry-' + randomUUID();
  let probes = 0;
  const marker = await launch(name, process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], null, {
    cleanEnv: true,
    env: process.env,
    probeStartedAt(pid) {
      return ++probes === 1 ? null : processStartedAt(pid);
    },
  });
  t.after(() => stopProcess(name));
  assert.equal(probes, 2);
  assert.equal(processStartedAt(marker.pid), marker.startedAt);
});

test('startup failure distinguishes a child exit code from inability to identify a running service', async () => {
  const exited = 'shutdown-exited-' + randomUUID();
  await assert.rejects(
    launch(exited, process.execPath, ['-e', 'process.exit(23)'], null, {
      cleanEnv: true,
      env: process.env,
      probeStartedAt() {
        // The real child can exit while the synchronous Windows lookup is pending.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
        return null;
      },
    }),
    { code: 'CAPRI_SERVICE_EXITED', exitCode: 23, message: /exit code 23/ },
  );
  assert.equal(existsSync(markerPath(exited)), false);

  const unidentified = 'shutdown-unverified-' + randomUUID();
  const stopped = Promise.withResolvers();
  await assert.rejects(
    launch(unidentified, process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], null, {
      cleanEnv: true,
      env: process.env,
      onExit: stopped.resolve,
      probeStartedAt: () => null,
    }),
    { code: 'CAPRI_SERVICE_IDENTITY_UNAVAILABLE', message: /Could not verify/ },
  );
  assert.notEqual(
    await Promise.race([stopped.promise, delay(4000, 'still running', { ref: false })]),
    'still running',
  );
  assert.equal(existsSync(markerPath(unidentified)), false);
  const diagnostic = readFileSync(path.join(paths.logs, unidentified + '.stderr.log'), 'utf8');
  assert.match(diagnostic, /"code":"CAPRI_SERVICE_IDENTITY_UNAVAILABLE"/);
});

test('managed shutdown waits for the lifeline drain and removes its own marker', async (t) => {
  const base = path.join(paths.cache, 'shutdown-test');
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(path.join(base, 'run-'));
  const rt = runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    logPrefix: 'shutdown-unit',
  });
  initialize(rt);
  const script = path.join(folder, 'gateway-host.mjs');
  const name = 'shutdown-test-' + randomUUID();
  const stop = path.join(paths.data, 'run', name + '.stop');
  const drained = path.join(folder, 'drained');
  writeFileSync(
    script,
    `import { existsSync, writeFileSync } from 'node:fs';
    const timer = setInterval(() => {
      if (existsSync(process.argv[2])) {
        clearInterval(timer);
        setTimeout(() => writeFileSync(process.argv[3], 'drained'), 80);
      }
    }, 40);`,
  );
  let childExited = false;
  const child = await launch(name, nodePath, [script, stop, drained], rt, {
    onExit: () => {
      childExited = true;
    },
  });
  t.after(() => {
    try {
      process.kill(child.pid);
    } catch {}
    for (const file of [markerPath(name), stop]) if (existsSync(file)) unlinkSync(file);
  });
  const start = performance.now();
  await stopProcess(name);
  t.diagnostic(`Graceful owned-process shutdown: ${Math.round(performance.now() - start)} ms`);
  assert.equal(readFileSync(drained, 'utf8'), 'drained');
  assert.equal(existsSync(markerPath(name)), false);
  assert.equal(childExited, true, 'The persistent launcher is released after its child exits');
});

test('a stale timestamp or another checkout cannot terminate a reused PID', async (t) => {
  const child = spawn(nodePath, ['-e', 'setInterval(() => {}, 1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const name = 'shutdown-test-' + randomUUID();
  t.after(() => {
    child.kill();
    if (existsSync(markerPath(name))) unlinkSync(markerPath(name));
  });
  mkdirSync(path.dirname(markerPath(name)), { recursive: true });
  const original = {
    pid: child.pid,
    startedAt: processStartedAt(child.pid),
    executable: nodePath,
    args: [],
    projectRoot: root,
  };
  writeFileSync(markerPath(name), JSON.stringify({ ...original, startedAt: '1' }));
  await stopProcess(name);
  assert.equal(processStartedAt(child.pid), original.startedAt);
  writeFileSync(
    markerPath(name),
    JSON.stringify({ ...original, projectRoot: path.join(root, 'another-checkout') }),
  );
  await stopProcess(name);
  assert.equal(processStartedAt(child.pid), original.startedAt);
});

test('launch clears only the old stop request before a delayed child starts, then preserves a fresh stop', async (t) => {
  const base = path.join(paths.cache, 'shutdown-test');
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(path.join(base, 'delayed-'));
  const name = 'shutdown-delay-' + randomUUID();
  const stop = path.join(paths.data, 'run', name + '.stop');
  const entered = path.join(folder, 'entered.json');
  const drained = path.join(folder, 'drained.json');
  const script = path.join(folder, 'gateway-host.mjs');
  mkdirSync(path.dirname(stop), { recursive: true });
  writeFileSync(stop, 'stale request from an exited instance');
  writeFileSync(
    script,
    `import {existsSync, writeFileSync} from 'node:fs';
    writeFileSync(process.argv[3], JSON.stringify({stale:existsSync(process.argv[2])}));
    setTimeout(() => writeFileSync(process.argv[4], JSON.stringify({stoppedBeforeModel:existsSync(process.argv[2])})), 2000);`,
  );
  const rt = runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    logPrefix: name,
  });
  initialize(rt);
  const child = await launch(name, nodePath, [script, stop, entered, drained], rt);
  t.after(() => {
    try {
      process.kill(child.pid);
    } catch {}
    for (const file of [markerPath(name), stop]) if (existsSync(file)) unlinkSync(file);
  });
  await stopProcess(name);
  assert.deepEqual(JSON.parse(readFileSync(entered, 'utf8')), { stale: false });
  assert.deepEqual(JSON.parse(readFileSync(drained, 'utf8')), { stoppedBeforeModel: true });
  assert.equal(existsSync(markerPath(name)), false);
});
