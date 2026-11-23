// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { HuggingFaceService } from '../apps/desktop/huggingface-service.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides = {}) {
  const calls = [];
  const plan = { id: 'fixture', files: [{ path: 'model.gguf' }], downloadBytes: 100 };
  const hub = {
    list: () => [{ id: 'fixture', profile: { alias: 'capri-fixture' } }],
    inspect: async () => ({ repository: 'fixture/model' }),
    plan: async () => plan,
    install: async (value) => {
      calls.push(['install', value]);
      return { id: 'fixture' };
    },
    importLanguageModel: async (id) => {
      calls.push(['import', id]);
    },
    remove: async (id) => {
      calls.push(['remove', id]);
    },
    ...overrides,
  };
  const service = new HuggingFaceService({
    hub,
    credentials: { status: () => ({ hasToken: false }) },
    ensure: async () => {
      calls.push(['ensure']);
    },
    changed: async () => {
      calls.push(['changed']);
    },
  });
  return { service, hub, calls, plan };
}

test('Hub service installs only its checked plan and imports before refreshing normal model selection', async () => {
  const { service, calls, plan } = fixture();
  assert.throws(() => service.install(), /Check the selected/);
  await service.plan({ repository: 'fixture/model', filename: 'model.gguf' });
  const result = await service.install({ files: [{ path: 'malicious replacement' }] });
  assert.equal(result.phase, 'ready');
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['install', 'ensure', 'import', 'changed'],
  );
  assert.equal(calls[0][1], plan);
});

test('repair uses its pinned stored receipt and refuses changing the active model', async () => {
  const { service, calls, plan, hub } = fixture();
  const receipt = { ...plan, profile: { alias: 'capri-fixture' } };
  hub.list = () => [receipt];
  assert.equal((await service.repair('fixture')).phase, 'ready');
  assert.equal(calls[0][1], receipt);
  calls.length = 0;
  service.active = () => 'capri-fixture';
  assert.equal((await service.repair('fixture')).phase, 'error');
  assert.equal(calls.length, 0);
  assert.match(service.snapshot().error, /active model/);
});

test('cancelled late planning result cannot become installable', async () => {
  const pending = deferred();
  const { service, plan } = fixture({ plan: () => pending.promise });
  const operation = service.plan({ repository: 'fixture/model' });
  service.cancel();
  pending.resolve(plan);
  assert.equal((await operation).phase, 'idle');
  assert.throws(() => service.install(), /Check the selected/);
  assert.equal(service.snapshot().plan, null);
});

test('a failed replacement plan clears the previous public and private plan', async () => {
  const { service, hub } = fixture();
  await service.plan({ repository: 'fixture/one' });
  hub.plan = async () => {
    throw new Error('Missing selected shard');
  };
  assert.equal((await service.plan({ repository: 'fixture/two' })).phase, 'error');
  assert.equal(service.snapshot().plan, null);
  assert.throws(() => service.install(), /Check the selected/);
});

test('cancelled download does not prepare or import a late package', async () => {
  const pending = deferred();
  const { service, calls } = fixture({ install: () => pending.promise });
  await service.plan({ repository: 'fixture/model' });
  const operation = service.install();
  service.cancel();
  pending.resolve({ id: 'fixture' });
  const result = await operation;
  assert.equal(result.phase, 'idle');
  assert.deepEqual(calls, []);
});

test('concurrent operations cannot mutate the checked plan or double-install', async () => {
  const pending = deferred();
  const { service } = fixture({ install: () => pending.promise });
  await service.plan({ repository: 'fixture/model' });
  const operation = service.install();
  await assert.rejects(service.install(), /Wait for/);
  await assert.rejects(service.inspect('fixture/other'), /Wait for/);
  service.cancel();
  pending.resolve({ id: 'fixture' });
  await operation;
});

test('active model removal and upstream secret echoes are contained in the service', async () => {
  const { service, calls, hub } = fixture();
  service.active = () => 'capri-fixture';
  assert.equal((await service.remove('fixture')).phase, 'error');
  assert.deepEqual(calls, []);
  const secret = 'hf_' + 'x'.repeat(36);
  hub.inspect = async () => {
    throw new Error(secret + ' https://storage.example/file?signed=private');
  };
  const result = await service.inspect('fixture/model');
  assert.equal(result.phase, 'error');
  assert.equal(result.error.includes(secret), false);
  assert.equal(result.error.includes('signed=private'), false);
});
