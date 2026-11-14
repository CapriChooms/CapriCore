// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CapriCore } from '../packages/core/src/index.mjs';
import { TimeService } from '../packages/runtime/src/time/service.mjs';
import {
  defineSkill,
  noInput,
  SKILL_API_VERSION,
  SkillError,
} from '../packages/skill-sdk/src/index.mjs';
import { timerClient, timerSkill } from '../packages/skills/src/timers/index.mjs';

const text = (value) => typeof value === 'string';

test('skills initialize after authorization and receive only their declared ports', async (t) => {
  const attempts = [];
  const core = new CapriCore({
    authorize({ operation }) {
      attempts.push(operation.requestId);
      if (operation.requestId === 'denied') throw new SkillError('skill_access_denied', 'Denied.');
    },
  });
  t.after(() => core.close());

  const skillId = 'test.scoped';
  let created = 0;
  let disposed = 0;
  let closeDuringDispose;
  const definition = defineSkill({
    manifest: {
      id: skillId,
      version: '1.0.0',
      apiVersion: 1,
      requires: ['readSample'],
      commands: { read: { input: noInput, output: text, sources: ['host'] } },
    },
    create({ ports }) {
      created++;
      assert.deepEqual(Object.keys(ports), ['readSample']);
      assert.equal(Object.isFrozen(ports), true);
      return {
        invoke: () => ports.readSample(),
        dispose() {
          disposed++;
          closeDuringDispose = core.close();
        },
      };
    },
  });
  assert.throws(() => core.register(definition), { code: 'missing_skill_port' });
  core.register(definition, { readSample: () => 'sample', hidden: () => 'private' });
  assert.throws(() => core.register(definition), { code: 'duplicate_skill' });
  assert.deepEqual(core.describeSkills(), [
    { id: skillId, version: '1.0.0', apiVersion: 1, commands: ['read'], active: false },
  ]);

  const request = { skillId, command: 'read', requestId: 'denied' };
  const denied = { status: 'failed', code: 'skill_access_denied' };
  assert.deepEqual(await core.dispatch(request, { source: 'tool' }), denied);
  assert.deepEqual(attempts, []);
  assert.deepEqual(await core.dispatch(request, { source: 'host' }), denied);
  assert.equal(created, 0);

  const allowed = { ...request, requestId: 'allowed' };
  assert.deepEqual(await core.dispatch(allowed, { source: 'host' }), {
    status: 'ok',
    value: 'sample',
  });
  assert.equal(core.call(allowed, { source: 'host' }), 'sample');
  assert.deepEqual(attempts, ['denied', 'allowed', 'allowed']);
  assert.equal(core.describeSkills()[0].active, true);
  assert.equal(created, 1);

  const closed = core.close();
  assert.equal(core.close(), closed);
  await closed;
  assert.equal(closeDuringDispose, closed);
  assert.equal(disposed, 1);
  assert.equal(core.describeSkills()[0].active, false);
  assert.deepEqual(await core.dispatch(allowed, { source: 'host' }), { status: 'cancelled' });
});

test('a host can compose either implementation of the same skill contract', async (t) => {
  const skillId = 'test.counter';
  const manifest = {
    id: skillId,
    version: '1.0.0',
    apiVersion: SKILL_API_VERSION,
    commands: { increment: { input: noInput, output: Number.isInteger, sources: ['host'] } },
  };
  const local = new CapriCore();
  const alternate = new CapriCore();
  t.after(() => Promise.all([local.close(), alternate.close()]));

  const createLocalCounter = () => {
    let count = 0;
    return { invoke: () => ++count };
  };
  const createPortCounter = ({ ports }) => ({ invoke: () => ports.nextValue() });
  assert.throws(
    () =>
      local.register({
        manifest: { ...manifest, apiVersion: SKILL_API_VERSION + 1 },
        create: createLocalCounter,
      }),
    { code: 'unsupported_skill_api' },
  );
  assert.equal(local.has(skillId), false);

  local.register({ manifest, create: createLocalCounter });
  let portCount = 40;
  alternate.register(
    { manifest: { ...manifest, requires: ['nextValue'] }, create: createPortCounter },
    { nextValue: () => ++portCount },
  );
  const increment = (core) => core.dispatch({ skillId, command: 'increment' }, { source: 'host' });
  assert.deepEqual(await increment(local), { status: 'ok', value: 1 });
  assert.deepEqual(await increment(alternate), { status: 'ok', value: 41 });
  assert.deepEqual(await increment(local), { status: 'ok', value: 2 });
  assert.deepEqual(await increment(alternate), { status: 'ok', value: 42 });
  assert.deepEqual(local.describeSkills(), alternate.describeSkills());
});

test('skill dispatch correlates events, suppresses events after cancellation, and redacts errors', async (t) => {
  const listenerErrors = [];
  const events = [];
  const core = new CapriCore({ onEventError: (error) => listenerErrors.push(error) });
  t.after(() => core.close());
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const skillId = 'test.events';
  core.register({
    manifest: {
      id: skillId,
      version: '1.0.0',
      apiVersion: 1,
      commands: {
        run: { input: noInput, output: text, sources: ['host'] },
        fail: { input: noInput, output: text, sources: ['host'] },
        invalid: { input: noInput, output: text, sources: ['host'] },
      },
      events: { progress: text },
    },
    create: () => ({
      async invoke(command, input, { emit }) {
        if (command === 'fail') throw new Error('private provider diagnostics');
        if (command === 'invalid') return { secret: 'invalid private output' };
        emit('progress', 'started');
        entered.resolve();
        await release.promise;
        emit('progress', 'late');
        return 'finished';
      },
    }),
  });
  core.subscribe({ skillId: 'test.unrelated' }, () => events.push('unrelated'));
  core.subscribe({ skillId, event: 'progress' }, () => {
    throw new Error('private listener details');
  });
  const unsubscribe = core.subscribe({ skillId, event: 'progress' }, (event) => events.push(event));
  const actor = { source: 'host' };
  const controller = new AbortController();
  const run = core.dispatch(
    { skillId, command: 'run', requestId: 'test:cancel' },
    { ...actor, signal: controller.signal },
  );
  await entered.promise;
  controller.abort(new Error('private cancellation details'));
  release.resolve();
  assert.deepEqual(await run, { status: 'cancelled' });
  unsubscribe();

  assert.deepEqual(events, [
    { skillId, event: 'progress', data: 'started', apiVersion: 1, requestId: 'test:cancel' },
  ]);
  assert.deepEqual(listenerErrors, [{ skillId, event: 'progress' }]);
  assert.deepEqual(await core.dispatch({ skillId, command: 'fail' }, actor), {
    status: 'failed',
    code: 'skill_failed',
  });
  assert.deepEqual(await core.dispatch({ skillId, command: 'invalid' }, actor), {
    status: 'failed',
    code: 'invalid_skill_output',
  });
  assert.deepEqual(await core.dispatch({ skillId: 'test.missing', command: 'run' }, actor), {
    status: 'unavailable',
    code: 'skill_unavailable',
  });
  assert.deepEqual(
    await core.dispatch({ skillId, command: 'fail' }, { ...actor, deadline: Date.now() - 1 }),
    { status: 'cancelled' },
  );
});

test('timer skill opens the legacy SQLite database and keeps request receipts across restarts', async (t) => {
  const tempRoot = path.resolve(tmpdir());
  const folder = mkdtempSync(path.join(tempRoot, 'capri-core-timers-'));
  let wall = Date.parse('2026-10-31T12:00:00Z');
  let ticks = 0;
  const options = {
    file: path.join(folder, 'time.sqlite'),
    now: () => wall,
    monotonic: () => ticks,
    timeZone: 'UTC',
  };
  const legacy = new TimeService(options);
  const cores = [];
  t.after(async () => {
    legacy.close();
    await Promise.all(cores.map((core) => core.close()));
    assert.equal(path.dirname(folder), tempRoot);
    rmSync(folder, { recursive: true, force: true });
  });

  const existing = await legacy.execute('legacy-request', { action: 'timer', seconds: 30 });
  legacy.close();

  const events = [];
  const open = () => {
    const core = new CapriCore();
    cores.push(core);
    core.register(timerSkill, {
      formatElapsed: (time) => time,
      createTimeService: (changed) => new TimeService({ ...options, changed }),
    });
    core.subscribe({ skillId: timerSkill.manifest.id, event: 'changed' }, ({ data }) =>
      events.push(data),
    );
    const client = timerClient(core);
    client.start();
    return { core, client };
  };
  const first = open();
  assert.equal(first.client.snapshot()[0].id, existing.id);
  const args = { action: 'timer', seconds: 60 };
  const created = await first.client.execute('replay-request', args, { source: 'tool' });
  assert.deepEqual(
    await first.client.execute('replay-request', args, { source: 'settings' }),
    created,
  );
  assert.equal(first.client.snapshot().length, 2);
  assert.equal(events.length, 1);
  assert.ok(events[0].some((timer) => timer.id === created.id));

  wall += 2_000;
  ticks += 2_000;
  await first.core.close();
  const reopened = open();
  const stored = new Map(reopened.client.snapshot().map((timer) => [timer.id, timer.remainingMs]));
  assert.deepEqual(
    stored,
    new Map([
      [created.id, 58_000],
      [existing.id, 28_000],
    ]),
  );
  assert.deepEqual(await reopened.client.execute('replay-request', args), created);
  await assert.rejects(
    reopened.client.execute('replay-request', { ...args, seconds: 90 }),
    /cannot change/,
  );
  assert.equal(reopened.client.snapshot().length, 2);
  assert.equal(events.length, 1);
});
