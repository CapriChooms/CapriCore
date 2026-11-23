// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { FilePermissions, INSTALLATION_SCOPE_ID } from '../integrations/filesystem/permissions.mjs';
import { FileService } from '../integrations/filesystem/service.mjs';
import { DesktopCatalog } from '../apps/desktop/desktop-catalog.mjs';
import { ActionApprovals } from '../apps/desktop/action-broker.mjs';

async function fixture() {
  const parent = path.resolve('.runtime/test-data');
  await fs.mkdir(parent, { recursive: true });
  const folder = await fs.mkdtemp(path.join(parent, 'installation-access-'));
  const root = path.join(folder, 'AppData', 'Local', 'Programs', 'Capri');
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'data/desktop/file-permissions.json');
  const options = { applicationRoot: root, protectedRoots: [root, path.join(folder, 'AppData')] };
  return { folder, root, file, options, permissions: new FilePermissions(file, options) };
}

test('the installation receives default write access, including code and configuration under AppData', async () => {
  const f = await fixture(),
    scopes = f.permissions.snapshot();
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].id, INSTALLATION_SCOPE_ID);
  assert.equal(scopes[0].kind, 'installation');
  assert.equal(scopes[0].write, true);
  assert.equal(scopes[0].confirmationRequired, false);
  for (const name of [
    'apps/desktop/main.mjs',
    'config/core.local.json',
    'data/workspace/PERSONALITY.md',
  ])
    assert.equal(
      f.permissions.target(INSTALLATION_SCOPE_ID, name, true).path,
      path.join(f.root, name),
    );
  assert.throws(() => f.permissions.target(INSTALLATION_SCOPE_ID, '../Other/file.txt', true));
  assert.throws(() =>
    f.permissions.target(INSTALLATION_SCOPE_ID, path.join(f.folder, 'elsewhere'), true),
  );
  const outside = path.join(f.folder, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(
    outside,
    path.join(f.root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(
    () => f.permissions.target(INSTALLATION_SCOPE_ID, 'linked/file.txt', true),
    /Linked/,
  );
  assert.throws(() => f.permissions.grant(path.join(f.folder, 'AppData')), /personal folder/);
});

test('migration preserves existing scopes and explicit read-only/revocation choices survive restart', async () => {
  const f = await fixture(),
    external = path.join(f.folder, 'documents');
  await fs.mkdir(external);
  const old = new FilePermissions(f.file, { protectedRoots: f.options.protectedRoots });
  const [scope] = old.grant(external);
  assert.equal(f.permissions.snapshot().length, 2);
  assert.equal(f.permissions.scope(scope.id).write, false);
  f.permissions.update(INSTALLATION_SCOPE_ID, false);
  const restart = () => new FilePermissions(f.file, f.options);
  assert.equal(restart().scope(INSTALLATION_SCOPE_ID).write, false);
  assert.throws(
    () => restart().target(INSTALLATION_SCOPE_ID, 'config/core.json', true),
    /read-only/,
  );
  f.permissions.revoke(INSTALLATION_SCOPE_ID);
  assert.deepEqual(
    restart()
      .snapshot()
      .map((s) => s.id),
    [scope.id],
  );
  restart().grant(f.root);
  assert.equal(restart().scope(INSTALLATION_SCOPE_ID).write, true);
  restart().save([]);
  assert.deepEqual(restart().snapshot(), []);
});

test('corrupt permissions never trigger implicit reset or renewed installation access', async () => {
  const f = await fixture();
  f.permissions.snapshot();
  await fs.writeFile(f.file, '{broken');
  assert.throws(() => f.permissions.snapshot());
  assert.equal(await fs.readFile(f.file, 'utf8'), '{broken');
});

test('own configuration can be replaced without a dialog, with conflict detection, recovery and undo', async (t) => {
  const f = await fixture();
  f.permissions.snapshot();
  await fs.mkdir(path.join(f.root, 'config'));
  await fs.mkdir(path.join(f.root, 'data/filesystem'), { recursive: true });
  const service = new FileService(f.permissions, {
    database: path.join(f.root, 'data/filesystem/operations.sqlite'),
    recovery: path.join(f.root, 'data/filesystem/recovery'),
    review: () => assert.fail('Default installation edits must not require a dialog'),
    replaceFile: async ({ source, target }) => fs.rename(source, target),
  });
  t.after(() => service.close());
  const base = { scopeId: INSTALLATION_SCOPE_ID, path: 'config/core.json' };
  await service.execute('create', { ...base, action: 'write_text', text: '{"value":1}' });
  const read = await service.execute('read', { ...base, action: 'read_text' });
  const changed = await service.execute('replace', {
    ...base,
    action: 'replace_text',
    text: '{"value":2}',
    expectedHash: read.expectedHash,
  });
  assert.equal(changed.ok, true);
  assert.equal(await fs.readFile(path.join(f.root, base.path), 'utf8'), '{"value":2}');
  await assert.rejects(
    service.execute('stale', {
      ...base,
      action: 'replace_text',
      text: '{"value":3}',
      expectedHash: read.expectedHash,
    }),
    /changed/,
  );
  assert.equal(
    (await service.execute('undo', { action: 'undo', operationId: 'replace' })).ok,
    true,
  );
  assert.equal(await fs.readFile(path.join(f.root, base.path), 'utf8'), '{"value":1}');
  f.permissions.revoke(INSTALLATION_SCOPE_ID);
  await assert.rejects(
    service.execute('after-revoke', {
      ...base,
      action: 'write_text',
      path: 'config/new.json',
      text: '{}',
    }),
    /allowed folder/,
  );
});

test('own file removal uses the existing verified recovery path without an approval dialog', async (t) => {
  const f = await fixture();
  f.permissions.snapshot();
  const state = path.join(f.root, 'data/desktop');
  const catalog = new DesktopCatalog({
    root: f.root,
    state,
    filePermissions: f.permissions,
    trash: async (file) => fs.unlink(file),
  });
  t.after(() => catalog.close());
  const file = path.join(f.root, 'test-note.txt');
  await fs.writeFile(file, 'owned fixture');
  const approvals = new ActionApprovals({
    emit() {
      assert.fail('Own file removal should not request approval');
    },
  });
  const result = await catalog.execute(
    'trash-own',
    { action: 'trash', scopeId: INSTALLATION_SCOPE_ID, path: 'test-note.txt' },
    approvals,
  );
  assert.equal(result.ok, true);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  const row = catalog.db.prepare('SELECT * FROM recovery WHERE id=?').get('trash-own');
  assert.equal(
    await fs.readFile(path.join(state, 'file-recovery', row.backup), 'utf8'),
    'owned fixture',
  );
});
