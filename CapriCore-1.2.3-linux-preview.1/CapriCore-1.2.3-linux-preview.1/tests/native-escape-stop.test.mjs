// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { NativeEscapeStop } from '../apps/desktop/native-escape-stop.mjs';

function fixture(t, extra = {}) {
  const children = [],
    calls = [];
  let escaped = 0,
    failed = 0;
  const watcher = new NativeEscapeStop({
    root: path.resolve('.runtime/escape-fixture'),
    executable: path.resolve('.runtime/escape-fixture/owned-helper.exe'),
    parentPid: 42,
    armTimeoutMs: 20,
    env: { SystemRoot: 'C:\\Windows', PRIVATE_FIXTURE_VALUE: 'must-not-be-in-child-environment' },
    spawnImpl: (file, args, options) => {
      calls.push({ file, args, options });
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.request = '';
      child.killed = 0;
      child.stdin.on('data', (chunk) => {
        child.request += chunk.toString();
      });
      child.kill = () => {
        child.killed++;
        return true;
      };
      child.event = (event) => child.stdout.write(JSON.stringify({ ok: true, event }) + '\n');
      children.push(child);
      return child;
    },
    ...extra,
  });
  t.after(() => watcher.stop());
  return {
    watcher,
    children,
    calls,
    start: () =>
      watcher.start({
        onEscape: () => {
          escaped++;
        },
        onFailure: () => {
          failed++;
        },
      }),
    escaped: () => escaped,
    failed: () => failed,
  };
}

test('native fallback must confirm arming and receives only a hidden bounded read-only request', async (t) => {
  const f = fixture(t),
    pending = f.start(),
    child = f.children[0];
  assert.equal(f.watcher.armed, false);
  child.event('armed');
  assert.equal(await pending, true);
  assert.equal(f.watcher.armed, true);
  assert.equal(f.watcher.active, true);
  assert.deepEqual(JSON.parse(child.request), {
    action: 'computer_watch_escape',
    parentPid: 42,
    durationMs: 600000,
  });
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.deepEqual(f.calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(f.calls[0].options.env.PRIVATE_FIXTURE_VALUE, undefined);
  assert.equal(f.failed(), 0);
});

test('Escape stops once independently of modifier/focus state and intentional stop is quiet', async (t) => {
  const f = fixture(t),
    pending = f.start(),
    child = f.children[0];
  child.event('armed');
  await pending;
  child.event('escape');
  child.event('escape');
  child.emit('close');
  assert.equal(f.escaped(), 1);
  assert.equal(f.failed(), 0);
  assert.equal(f.watcher.active, false);
  assert.equal(child.killed, 1);
  const next = f.start(),
    second = f.children[1];
  second.event('armed');
  await next;
  f.watcher.stop();
  f.watcher.stop();
  second.emit('close');
  assert.equal(f.failed(), 0);
  assert.equal(f.escaped(), 1);
});

test('failed, silent and malformed arming fail closed without enabling input', async (t) => {
  for (const mode of ['closed', 'error', 'malformed', 'oversized', 'silent']) {
    const f = fixture(t),
      pending = f.start(),
      child = f.children[0];
    if (mode === 'closed') child.emit('close');
    if (mode === 'error') child.emit('error', new Error('Synthetic helper failure'));
    if (mode === 'malformed') child.stdout.write('not JSON\n');
    if (mode === 'oversized') child.stdout.write('x'.repeat(4097));
    assert.equal(await pending, false);
    assert.equal(f.watcher.armed, false);
    assert.equal(child.killed, 1);
  }
});

test('a lost or expired armed watcher fails closed exactly once', async (t) => {
  for (const mode of ['closed', 'expired', 'stderr']) {
    const f = fixture(t),
      pending = f.start(),
      child = f.children[0];
    child.event('armed');
    await pending;
    if (mode === 'closed') child.emit('close');
    if (mode === 'expired') child.event('expired');
    if (mode === 'stderr') child.stderr.write('Untrusted diagnostic must not be reflected');
    child.emit('error', new Error('Late process failure'));
    assert.equal(f.failed(), 1);
    assert.equal(f.escaped(), 0);
    assert.equal(f.watcher.active, false);
  }
});

test('callbacks from an old generation cannot stop a newly armed session', async (t) => {
  const f = fixture(t),
    first = f.start(),
    old = f.children[0];
  old.event('armed');
  await first;
  const next = f.start(),
    current = f.children[1];
  current.event('armed');
  await next;
  old.event('escape');
  old.emit('close');
  old.emit('error', new Error('Late old failure'));
  assert.equal(f.watcher.armed, true);
  assert.equal(f.failed(), 0);
  assert.equal(f.escaped(), 0);
});

test('stopping while arming resolves false without a later callback or leaked helper', async (t) => {
  const f = fixture(t),
    pending = f.start(),
    child = f.children[0];
  f.watcher.stop();
  child.event('armed');
  child.emit('close');
  assert.equal(await pending, false);
  assert.equal(f.watcher.active, false);
  assert.equal(f.failed(), 0);
  assert.equal(child.killed, 1);
});
