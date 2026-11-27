// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LIFELINE_ENV,
  lifelineRequested,
  watchParentLifeline,
} from '../packages/runtime/src/host/lifeline.mjs';
import { paths } from '../packages/runtime/src/host/paths.mjs';
import { markerPath } from '../packages/runtime/src/host/processes.mjs';
import { createSignalExit } from '../apps/desktop/main/signal-exit.mjs';

const url = (file) => pathToFileURL(path.resolve(file)).href;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const until = async (check, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
};

test('the lifeline is requested only by the launcher on POSIX', () => {
  assert.equal(lifelineRequested({ [LIFELINE_ENV]: 'stdin' }, 'linux'), true);
  assert.equal(lifelineRequested({ [LIFELINE_ENV]: 'stdin' }, 'darwin'), true);
  assert.equal(lifelineRequested({ [LIFELINE_ENV]: 'stdin' }, 'win32'), false);
  assert.equal(lifelineRequested({ [LIFELINE_ENV]: 'other' }, 'linux'), false);
  assert.equal(lifelineRequested({}, 'linux'), false);
});

test('watching a lifeline runs the handler on stdin end or error, and nothing without the request', () => {
  const stdin = new EventEmitter();
  stdin.resume = () => {};
  let ended = 0;
  const onEnd = () => ended++;
  assert.equal(watchParentLifeline(onEnd, { stdin, env: {}, platform: 'linux' }), false);
  assert.equal(
    watchParentLifeline(onEnd, {
      stdin,
      env: { [LIFELINE_ENV]: 'stdin' },
      platform: 'win32',
    }),
    false,
  );
  assert.equal(
    watchParentLifeline(onEnd, {
      stdin,
      env: { [LIFELINE_ENV]: 'stdin' },
      platform: 'linux',
    }),
    true,
  );
  stdin.emit('end');
  assert.equal(ended, 1);
  stdin.emit('error', new Error('closed'));
  assert.equal(ended, 2);
});

test('signal exit covers the expected, failing, hung and repeated-signal paths', async () => {
  const exits = [];
  const exit = (signal, outcome) => exits.push([signal, outcome]);
  const cleared = [];
  const clearTimer = (timer) => cleared.push(timer);

  let shutdowns = 0;
  const ok = createSignalExit({
    shutdown: async () => {
      shutdowns++;
    },
    exit,
    setTimer: () => ({ id: 'ok' }),
    clearTimer,
  });
  assert.equal(await ok('SIGTERM'), 'done');
  assert.deepEqual(exits.at(-1), ['SIGTERM', 'done']);
  assert.equal(cleared.at(-1).id, 'ok');

  const errors = [];
  const failing = createSignalExit({
    shutdown: async () => {
      throw new Error('stop failed');
    },
    exit,
    onError: (error) => errors.push(error.message),
    setTimer: () => ({}),
    clearTimer,
  });
  assert.equal(await failing('SIGINT'), 'failed');
  assert.deepEqual(errors, ['stop failed']);
  assert.deepEqual(exits.at(-1), ['SIGINT', 'failed']);

  const hung = createSignalExit({
    shutdown: () => new Promise(() => {}),
    exit,
    setTimer: (callback) => {
      callback();
      return {};
    },
    clearTimer,
  });
  assert.equal(await hung('SIGTERM'), 'timeout');
  assert.deepEqual(exits.at(-1), ['SIGTERM', 'timeout']);

  // Defaults: a failure is silent, and the real timer is cleared so the test exits.
  const defaults = createSignalExit({
    shutdown: async () => {
      throw new Error('ignored');
    },
    exit,
  });
  assert.equal(await defaults('SIGTERM'), 'failed');
  assert.deepEqual(exits.at(-1), ['SIGTERM', 'failed']);

  let release;
  const repeated = createSignalExit({
    shutdown: () => new Promise((resolve) => (release = resolve)),
    exit,
    setTimer: () => ({}),
    clearTimer,
  });
  const first = repeated('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(repeated('SIGINT'), first);
  assert.deepEqual(exits.at(-1), ['SIGINT', 'forced']);
  release();
  assert.equal(await first, 'done');
  assert.equal(shutdowns, 1);
});

const parentSource = (launchName) => `
import { launch } from ${JSON.stringify(url('packages/runtime/src/host/processes.mjs'))};
import { createSignalExit } from ${JSON.stringify(url('apps/desktop/main/signal-exit.mjs'))};
const mode = process.argv[2];
const child = await launch(${JSON.stringify(launchName)}, process.execPath, [process.argv[3]], undefined, {
  cleanEnv: true,
  lifeline: true,
  probeStartedAt: () => '1',
});
console.log('CHILD ' + child.pid);
if (mode !== 'kill') {
  const onSignal = createSignalExit({
    shutdown: mode === 'hang' ? () => new Promise(() => {}) : async () => {},
    exit: () => process.exit(0),
    timeoutMs: 300,
  });
  process.on('SIGTERM', onSignal);
}
setInterval(() => {}, 1000);
`;

const childSource = `
import { watchParentLifeline } from ${JSON.stringify(url('packages/runtime/src/host/lifeline.mjs'))};
watchParentLifeline(() => process.exit(0));
setInterval(() => {}, 1000);
`;

async function startParent(mode, launchName) {
  const dir = mkdtempSync(path.join(tmpdir(), 'capri-lifeline-'));
  const childFile = path.join(dir, 'child.mjs');
  const parentFile = path.join(dir, 'parent.mjs');
  writeFileSync(childFile, childSource);
  writeFileSync(parentFile, parentSource(launchName));
  const parent = spawn(process.execPath, [parentFile, mode, childFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  parent.stdout.on('data', (chunk) => (output += chunk));
  const found = await until(() => /CHILD \d+/.test(output), 15000);
  const childPid = found ? Number(/CHILD (\d+)/.exec(output)[1]) : null;
  const exited = () => parent.exitCode !== null || parent.signalCode !== null;
  const cleanup = () => {
    if (!exited()) parent.kill('SIGKILL');
    if (childPid && alive(childPid)) process.kill(childPid, 'SIGKILL');
    for (const file of [
      markerPath(launchName),
      path.join(paths.logs, launchName + '.stdout.log'),
      path.join(paths.logs, launchName + '.stderr.log'),
    ])
      if (existsSync(file)) unlinkSync(file);
    rmSync(dir, { recursive: true, force: true });
  };
  return { parent, childPid, exited, cleanup };
}

const posix = { skip: process.platform === 'win32' && 'POSIX lifeline' };

test(
  'a child launched with a lifeline exits within a bounded time after its parent is killed',
  posix,
  async () => {
    const run = await startParent('kill', 'lifeline-kill-' + process.pid);
    try {
      assert.ok(run.childPid, 'the child reported its pid');
      assert.equal(alive(run.childPid), true);
      run.parent.kill('SIGKILL');
      assert.equal(await until(() => !alive(run.childPid), 10000), true, 'child exited');
    } finally {
      run.cleanup();
    }
  },
);

test('SIGTERM on the parent runs its shutdown, then the child exits with it', posix, async () => {
  const run = await startParent('term', 'lifeline-term-' + process.pid);
  try {
    assert.ok(run.childPid, 'the child reported its pid');
    run.parent.kill('SIGTERM');
    assert.equal(await until(run.exited, 10000), true, 'parent exited');
    assert.equal(await until(() => !alive(run.childPid), 10000), true, 'child exited');
  } finally {
    run.cleanup();
  }
});

test(
  'a hung shutdown cannot keep the parent, or its child, alive past the timeout',
  posix,
  async () => {
    const run = await startParent('hang', 'lifeline-hang-' + process.pid);
    try {
      assert.ok(run.childPid, 'the child reported its pid');
      run.parent.kill('SIGTERM');
      assert.equal(await until(run.exited, 10000), true, 'parent exited');
      assert.equal(await until(() => !alive(run.childPid), 10000), true, 'child exited');
    } finally {
      run.cleanup();
    }
  },
);
