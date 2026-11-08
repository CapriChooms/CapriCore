// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { luaData, validateAssembly, ResolveAdapter } from '../integrations/resolve/service.mjs';
import { computerActionSchema } from '../apps/desktop/computer-planner.mjs';

const observed = {
  available: true,
  kind: 'resolve',
  projectId: 'test-project',
  clips: [{ id: 'source', name: 'clip.mp4', frames: 144 }],
};
const args = {
  timelineName: 'New montage',
  clips: [
    { clipId: 'source', startFrame: 0, endFrame: 47 },
    { clipId: 'source', startFrame: 72, endFrame: 119 },
  ],
};
test('Resolve assembly accepts only observed sources and valid inclusive ranges', () => {
  assert.deepEqual(validateAssembly(args, observed), {
    operation: 'assemble',
    projectId: 'test-project',
    ...args,
  });
  for (const change of [
    { clips: [] },
    { clips: [{ clipId: 'foreign', startFrame: 0, endFrame: 1 }] },
    { clips: [{ clipId: 'source', startFrame: 0, endFrame: 144 }] },
    { clips: [{ clipId: 'source', startFrame: 2, endFrame: 1 }] },
    { clips: [{ clipId: 'source', startFrame: 0.5, endFrame: 2 }] },
    { timelineName: '\x00bad' },
  ])
    assert.throws(() => validateAssembly({ ...args, ...change }, observed));
});
test('Lua request strings cannot escape data into executable expressions', () => {
  assert.equal(luaData('a"\\\n\x00b'), '"a\\"\\\\\\010\\000b"');
  assert.equal(
    luaData({ value: '"); os.execute("untrusted") --' }),
    '{["value"]="\\"); os.execute(\\"untrusted\\") --"}',
  );
  assert.throws(() => luaData({ run: () => {} }));
});
test('Resolve actions are offered only for a current available project and never over a modal dialog', () => {
  const has = (view) =>
    computerActionSchema({ targets: [], ...view }, { type: 'string' }).anyOf.some(
      (b) => b.properties.action.const === 'resolve_assemble',
    );
  assert(!has({}));
  assert(has({ application: observed }));
  assert(!has({ application: observed, window: { modal: true } }));
});
test('verified duration alone cannot hide an incorrect clip, trim or gap', async () => {
  const adapter = new ResolveAdapter({ allowed: () => true });
  const native = { windowId: 'window', processId: 'process', startedAtTicks: 'start' };
  adapter.bridge = async () => native;
  const good = {
    available: true,
    projectId: 'test-project',
    timeline: {
      name: 'New montage',
      start: 0,
      duration: 96,
      segments: [
        { clipId: 'source', sourceStart: 0, start: 0, finish: 48, duration: 48 },
        { clipId: 'source', sourceStart: 72, start: 48, finish: 96, duration: 48 },
      ],
    },
  };
  adapter.request = async () => good;
  assert((await adapter.execute(native, args, observed, new AbortController().signal)).ok);
  for (const bad of [{ clipId: 'wrong' }, { sourceStart: 71 }, { start: 49, finish: 97 }]) {
    adapter.request = async () => ({
      ...good,
      timeline: {
        ...good.timeline,
        segments: [good.timeline.segments[0], { ...good.timeline.segments[1], ...bad }],
      },
    });
    await assert.rejects(
      adapter.execute(native, args, observed, new AbortController().signal),
      /order, trim or adjacency/,
    );
  }
});
test('revoked access and a non-Resolve application cannot spawn an interpreter', async () => {
  const adapter = new ResolveAdapter({
    allowed: () => false,
    spawnImpl: () => assert.fail('must not spawn'),
  });
  await assert.rejects(adapter.request({}, {}, new AbortController().signal), /revoked/);
  adapter.allowed = () => true;
  assert.deepEqual(await adapter.request({}, {}, new AbortController().signal), {
    available: false,
  });
});

test('cancellation terminates only the owned interpreter and cannot start a later edit', async () => {
  const parent = path.resolve('.runtime/resolve-adapter-unit');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'case-'));
  writeFileSync(path.join(root, 'fuscript.exe'), 'fixture');
  const native = {
    windowId: 'window',
    processId: 'process',
    startedAtTicks: 'start',
    resolveExecutable: path.join(root, 'Resolve.exe'),
  };
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let killed = 0,
    input,
    started;
  child.kill = () => {
    killed++;
    queueMicrotask(() => child.emit('close', 1));
  };
  const spawned = new Promise((r) => (started = r));
  const adapter = new ResolveAdapter({
    root,
    bridge: async () => native,
    allowed: () => true,
    spawnImpl: (_exe, args) => {
      input = args.at(-1);
      started();
      return child;
    },
  });
  const controller = new AbortController(),
    pending = adapter.request(native, { operation: 'inspect' }, controller.signal);
  await spawned;
  assert(existsSync(input));
  controller.abort(Error('Explicit emergency stop'));
  await assert.rejects(pending, /emergency stop/);
  assert.equal(killed, 1);
  assert(!existsSync(input));
  await assert.rejects(
    adapter.request(native, { operation: 'inspect' }, controller.signal),
    /emergency stop/,
  );
  assert.equal(killed, 1);
});
