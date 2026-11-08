// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { FullComputerAccess } from '../apps/desktop/full-computer-access.mjs';
import { Confirmations } from '../apps/desktop/main/confirmations.mjs';
import { FilePermissions } from '../integrations/filesystem/permissions.mjs';
const parent = path.resolve('.runtime/full-access-tests');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'case-'));

test('full access requires the host-enforced three-second confirmation, persists and can be revoked', async () => {
  const file = path.join(folder(), 'access.json');
  let now = 0,
    event;
  const confirmations = new Confirmations({
    emit: (value) => {
      if (value.type === 'confirmation.request') event = value;
    },
    show() {},
    now: () => now,
  });
  const full = new FullComputerAccess({
    file,
    discover: async () => ['C:\\', 'D:\\'],
    confirm: (value) => confirmations.request(value),
  });
  assert.equal(full.enabled, false);
  const pending = full.configure(true);
  assert.equal(event.delayMs, 3000);
  assert.equal(confirmations.respond({ id: event.id, choice: 'confirm' }), false);
  assert.equal(full.enabled, false);
  now = 3000;
  assert.equal(confirmations.respond({ id: event.id, choice: 'confirm' }), true);
  await pending;
  assert.equal(full.enabled, true);
  assert.equal(full.scopes().length, 2);
  assert.match(full.scopes()[0].id, /^[a-f0-9-]{36}$/);
  const restarted = new FullComputerAccess({
    file,
    discover: async () => assert.fail(),
    confirm: () => assert.fail(),
  });
  assert.equal(restarted.enabled, true);
  await restarted.configure(false);
  assert.deepEqual(restarted.scopes(), []);
});

test('cancelled or superseded full grants cannot resurrect during drive discovery', async () => {
  const full = new FullComputerAccess({
    file: path.join(folder(), 'access.json'),
    discover: async () => assert.fail(),
    confirm: async () => false,
  });
  await full.configure(true);
  assert.equal(full.enabled, false);
  let release;
  full.confirm = async () => true;
  full.discover = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = full.configure(true);
  await new Promise((resolve) => setImmediate(resolve));
  await full.configure(false);
  release(['C:\\']);
  await pending;
  assert.equal(full.enabled, false);
  assert.equal(full.enabling, false);
});

test('virtual computer scopes expand access without rewriting individual grants and disappear immediately on revocation', () => {
  const root = folder(),
    personal = path.join(root, 'personal'),
    privateData = path.join(root, 'private');
  mkdirSync(personal);
  mkdirSync(privateData);
  writeFileSync(path.join(privateData, 'fixture.txt'), 'temporary test data');
  let active = false;
  const scope = {
    id: 'fa11acc0-0000-4000-8000-000000000001',
    root,
    write: true,
    kind: 'computer',
    confirmationRequired: false,
  };
  const permissions = new FilePermissions(path.join(root, 'permissions.json'), {
    protectedRoots: [privateData],
    computerScopes: () => (active ? [scope] : []),
  });
  const [individual] = permissions.grant(personal);
  assert.throws(() => permissions.scope(scope.id));
  active = true;
  const target = permissions.target(scope.id, 'private/fixture.txt', true);
  assert.equal(target.path, path.join(privateData, 'fixture.txt'));
  assert.equal(permissions.canActWithoutConfirmation(target.scope), true);
  assert.throws(() => permissions.target(scope.id, '../outside', true));
  active = false;
  assert.throws(() => permissions.target(scope.id, 'private/fixture.txt', true));
  assert.equal(permissions.scope(individual.id).write, false);
});
