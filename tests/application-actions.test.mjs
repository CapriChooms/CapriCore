import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../packages/runtime/src/index.mjs';
import {
  ApplicationService,
  applicationPermissions,
  validateApplicationCommand,
} from '../integrations/desktop-actions/service.mjs';
import { validateApplications } from '../integrations/desktop-actions/settings.mjs';
import { writeJsonAtomic } from '../apps/desktop/storage.mjs';

async function fixture(t, bridge) {
  const parent = path.join(root, '.runtime/test-data');
  await fs.mkdir(parent, { recursive: true });
  const folder = await fs.mkdtemp(path.join(parent, 'apps-')),
    file = path.join(folder, 'permissions.json'),
    database = path.join(folder, 'operations.sqlite');
  let service = new ApplicationService({ root, permissionsFile: file, database, bridge });
  t.after(() => service.close());
  return {
    file,
    get service() {
      return service;
    },
    grant: () =>
      writeJsonAtomic(file, { schemaVersion: 1, settings: { notepad: false, calculator: true } }),
    restart: async () => {
      await service.close();
      service = new ApplicationService({ root, permissionsFile: file, database, bridge });
    },
  };
}
test('application permissions fail closed; only fixed apps and bounded calculations are accepted', async (t) => {
  const f = await fixture(t, async () => ({ ok: true }));
  assert.deepEqual(applicationPermissions(f.file), { notepad: false, calculator: false });
  await assert.rejects(
    f.service.execute('disabled', { action: 'launch', app: 'calculator' }),
    /enable/,
  );
  for (const command of [
    { action: 'launch', app: 'cmd' },
    { action: 'launch', app: ['notepad'] },
    { action: 'launch', app: 'notepad', arguments: 'secret' },
    { action: 'calculate', app: 'notepad', expression: '1+2' },
    { action: 'calculate', app: 'calculator', expression: '1+2;shutdown' },
  ])
    assert.throws(() => validateApplicationCommand(command));
  assert.throws(() => validateApplications({ notepad: true, calculator: true, other: true }));
  assert.equal(
    validateApplicationCommand({
      action: 'calculate',
      app: 'calculator',
      expression: 'sqrt(1036) + 2^3',
    }).expression,
    'sqrt(1036) + 2^3',
  );
  assert.equal(
    validateApplicationCommand({ action: 'calculate', app: 'calculator', expression: '-17.5 * 4' })
      .expression,
    '-17.5 * 4',
  );
});
test('application mutations are serial, durable and reject changed or uncertain retries', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => ({ ok: true, sequence: ++calls }));
  f.grant();
  const command = { action: 'launch', app: 'calculator' },
    first = await f.service.execute('launch', command);
  assert.equal(calls, 1);
  await f.restart();
  assert.deepEqual(await f.service.execute('launch', command), first);
  assert.equal(calls, 1);
  await assert.rejects(
    f.service.execute('launch', { action: 'focus', app: 'calculator' }),
    /cannot change/,
  );
  f.service.bridge = async () => {
    calls++;
    throw new Error('Window disappeared');
  };
  await assert.rejects(
    f.service.execute('partial', { action: 'focus', app: 'calculator' }),
    /disappeared/,
  );
  await assert.rejects(
    f.service.execute('partial', { action: 'focus', app: 'calculator' }),
    /partially completed/,
  );
  assert.equal(calls, 2);
});
test('cancellation, revoked invocation authority and application grants stop subsequent actions', async (t) => {
  let calls = 0;
  const f = await fixture(t, async (_root, _command, { stillAllowed }) => {
    calls++;
    writeJsonAtomic(f.file, { schemaVersion: 1, settings: { notepad: false, calculator: false } });
    assert.equal(stillAllowed(), false);
    throw new Error('Revoked');
  });
  f.grant();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.service.execute('cancel', { action: 'launch', app: 'calculator' }, controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    f.service.execute('authority', { action: 'launch', app: 'calculator' }, undefined, () => {
      throw new Error('Stale');
    }),
    /Stale/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    f.service.execute('revoked', { action: 'launch', app: 'calculator' }),
    /Revoked/,
  );
  assert.equal(calls, 1);
  await assert.rejects(f.service.execute('next', { action: 'focus', app: 'calculator' }), /enable/);
  assert.equal(calls, 1);
});

test('calculate infers its unique target while retaining grants and durable operation identity', async (t) => {
  let bridgeCalls = 0;
  const f = await fixture(t, async () => {
    bridgeCalls++;
    throw new Error('Background calculations must not open a window.');
  });
  const input = {
    action: 'calculate',
    expression: '3^4 + 6! - sqrt(949)',
    showWindow: false,
  };
  const original = structuredClone(input);
  assert.deepEqual(validateApplicationCommand(input), {
    ...input,
    app: 'calculator',
    mode: 'scientific',
  });
  assert.deepEqual(input, original, 'Normalization must not mutate the incoming call.');
  await assert.rejects(f.service.execute('missing-grant', input), /enable/);
  assert.equal(f.service.db.prepare('SELECT count(*) AS count FROM operations').get().count, 0);
  f.grant();
  const result = await f.service.execute('scientific', input);
  assert.equal(result.ok, true);
  assert.equal(result.displayResult, '770.1941563985013');
  assert.equal(result.result, '770.19415639850127395963027903809915957741222136939');
  assert.deepEqual(await f.service.execute('scientific', { ...input, app: 'calculator' }), result);
  assert.equal(f.service.db.prepare('SELECT count(*) AS count FROM operations').get().count, 1);
  assert.equal(bridgeCalls, 0);
});

test('implicit Calculator does not infer ambiguous app actions or accept explicit invalid targets', () => {
  for (const action of ['launch', 'focus', 'controls'])
    assert.throws(() => validateApplicationCommand({ action }), /Choose a supported application/);
  for (const app of ['notepad', 'cmd', null, false, ['calculator']])
    assert.throws(() =>
      validateApplicationCommand({ action: 'calculate', app, expression: '1+1' }),
    );
  assert.deepEqual(validateApplicationCommand({ action: 'status' }), { action: 'status' });
  assert.equal(
    validateApplicationCommand({
      action: 'calculate',
      mode: 'convert',
      value: '100',
      fromUnit: 'degC',
      toUnit: 'degF',
    }).app,
    'calculator',
  );
});

test('the model power spelling computes safely before an explicitly requested Calculator launch', async (t) => {
  const calls = [];
  const f = await fixture(t, async (_root, command) => {
    calls.push(command);
    return { ok: true, launched: true };
  });
  const input = {
    action: 'calculate',
    expression: '3**4 + factorial(6) - sqrt(949)',
    showWindow: true,
  };
  await assert.rejects(f.service.execute('no-grant-power', input), /enable/);
  assert.deepEqual(calls, []);
  f.grant();
  const result = await f.service.execute('window-power', input);
  assert.equal(result.ok, true);
  assert.equal(result.displayResult, '770.1941563985013');
  assert.deepEqual(calls, [{ action: 'launch', app: 'calculator' }]);
  assert.equal(result.display.launched, true);
});
