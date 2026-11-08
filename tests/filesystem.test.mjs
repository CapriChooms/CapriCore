import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../packages/runtime/src/index.mjs';
import { FilePermissions } from '../integrations/filesystem/permissions.mjs';
import { FileService } from '../integrations/filesystem/service.mjs';
import plugin from '../integrations/filesystem/index.mjs';
import { ActionBroker } from '../apps/desktop/action-broker.mjs';

async function fixture(t) {
  const parent = path.join(root, '.runtime/test-data');
  await fs.mkdir(parent, { recursive: true });
  const dir = await fs.mkdtemp(path.join(parent, 'files-')),
    work = path.join(dir, 'Work'),
    privateDir = path.join(dir, 'Private');
  await fs.mkdir(work);
  await fs.mkdir(privateDir);
  const permissions = new FilePermissions(path.join(privateDir, 'permissions.json'), {
    protectedRoots: [privateDir],
  });
  const options = {
    database: path.join(privateDir, 'operations.sqlite'),
    recovery: path.join(privateDir, 'recovery'),
  };
  let service = new FileService(permissions, options);
  t.after(() => service.close());
  return {
    dir,
    work,
    privateDir,
    permissions,
    get service() {
      return service;
    },
    restart: async () => {
      await service.close();
      service = new FileService(permissions, options);
    },
  };
}
test('no implicit access; explicit folder grants start read-only and can be revoked', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.service.execute('status', { action: 'status' })).scopes, []);
  const [scope] = f.permissions.grant(f.work);
  await fs.writeFile(path.join(f.work, 'hello.txt'), 'Hello.');
  assert.equal(
    (await f.service.execute('read', { action: 'read_text', scopeId: scope.id, path: 'hello.txt' }))
      .untrustedContent,
    'Hello.',
  );
  await assert.rejects(
    f.service.execute('write', {
      action: 'write_text',
      scopeId: scope.id,
      path: 'new.txt',
      text: 'No.',
    }),
    /read-only/,
  );
  f.permissions.revoke(scope.id);
  await assert.rejects(
    f.service.execute('read-again', { action: 'read_text', scopeId: scope.id, path: 'hello.txt' }),
    /allowed folder/,
  );
  assert.throws(() => f.permissions.grant(f.privateDir));
});

test('known folders use their actual granted location and Telegram Desktop search tolerates spacing', async (t) => {
  const f = await fixture(t);
  const downloads = path.join(f.work, 'Moved Downloads');
  await fs.mkdir(path.join(downloads, 'Telegram Desktop'), { recursive: true });
  f.service.knownLocations = () => [
    { name: 'downloads', path: downloads },
    { name: 'documents', path: f.privateDir },
  ];
  assert.deepEqual((await f.service.execute('before', { action: 'status' })).locations, [
    { name: 'downloads', available: false },
    { name: 'documents', available: false },
  ]);
  const [scope] = f.permissions.grant(f.work);
  const locations = (await f.service.execute('after', { action: 'status' })).locations;
  assert.deepEqual(locations[0], {
    name: 'downloads',
    available: true,
    scopeId: scope.id,
    path: 'Moved Downloads',
  });
  assert.equal(JSON.stringify(locations).includes(f.privateDir), false);
  const found = await f.service.execute('find', {
    action: 'find',
    scopeId: scope.id,
    path: locations[0].path,
    query: 'telegramdesktop',
  });
  assert.deepEqual(found.entries, [
    { path: path.join('Moved Downloads', 'Telegram Desktop'), type: 'directory' },
  ]);
  f.permissions.revoke(scope.id);
  assert.equal(
    (await f.service.execute('revoked', { action: 'status' })).locations[0].available,
    false,
  );
});
test('creation is verified, never overwrites and remains idempotent across a process restart', async (t) => {
  const f = await fixture(t),
    [scope] = f.permissions.grant(f.work);
  f.permissions.update(scope.id, true);
  const args = {
    action: 'write_text',
    scopeId: scope.id,
    path: 'new.txt',
    text: 'Keep every word.',
  };
  const result = await f.service.execute('same-id', args);
  assert.equal(result.ok, true);
  assert.deepEqual(await f.service.execute('same-id', args), result);
  await f.restart();
  assert.deepEqual(
    await f.service.execute('same-id', Object.fromEntries(Object.entries(args).reverse())),
    result,
  );
  assert.deepEqual(await f.service.execute('same-id', args), result);
  await assert.rejects(f.service.execute('same-id', { ...args, text: 'Changed' }), /reused/);
  await assert.rejects(f.service.execute('another-id', { ...args, text: 'Overwrite' }), /exists/);
  assert.equal(await fs.readFile(path.join(f.work, 'new.txt'), 'utf8'), 'Keep every word.');
  await f.service.execute('undo-id', { action: 'undo', operationId: 'same-id' });
  await assert.rejects(fs.stat(path.join(f.work, 'new.txt')), { code: 'ENOENT' });
  assert.equal((await fs.readdir(path.join(f.privateDir, 'recovery'))).length, 1);
});
test('copy, move and guarded undo preserve content and reject later edits', async (t) => {
  const f = await fixture(t),
    [scope] = f.permissions.grant(f.work);
  f.permissions.update(scope.id, true);
  await fs.writeFile(path.join(f.work, 'source.txt'), 'Original');
  await f.service.execute('copy', {
    action: 'copy',
    scopeId: scope.id,
    path: 'source.txt',
    destinationScopeId: scope.id,
    destination: 'copied.txt',
  });
  await f.service.execute('move', {
    action: 'move',
    scopeId: scope.id,
    path: 'copied.txt',
    destination: 'renamed.txt',
  });
  assert.equal(await fs.readFile(path.join(f.work, 'renamed.txt'), 'utf8'), 'Original');
  await f.service.execute('undo-move', { action: 'undo', operationId: 'move' });
  assert.equal(await fs.readFile(path.join(f.work, 'copied.txt'), 'utf8'), 'Original');
  await fs.writeFile(path.join(f.work, 'copied.txt'), 'User edit');
  await assert.rejects(
    f.service.execute('undo-copy', { action: 'undo', operationId: 'copy' }),
    /changed/,
  );
  assert.equal(await fs.readFile(path.join(f.work, 'copied.txt'), 'utf8'), 'User edit');
});
test('relative paths cannot escape through traversal, Windows special names, private data or junctions', async (t) => {
  const f = await fixture(t),
    [scope] = f.permissions.grant(f.work);
  for (const name of [
    '../Private/permissions.json',
    'C:\\Windows\\win.ini',
    'CON',
    'a.txt:secret',
    'a/../../escape',
    'folder.',
    'folder ',
  ])
    assert.throws(() => f.permissions.target(scope.id, name));
  const outside = path.join(f.dir, 'Outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'Outside');
  await fs.symlink(
    outside,
    path.join(f.work, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    f.service.execute('link', { action: 'read_text', scopeId: scope.id, path: 'link/secret.txt' }),
    /Linked/,
  );
});
test('cancellation and revoked runtime authority prevent mutations, and uncertain actions are not repeated', async (t) => {
  const f = await fixture(t),
    [scope] = f.permissions.grant(f.work);
  f.permissions.update(scope.id, true);
  const args = { action: 'write_text', scopeId: scope.id, path: 'cancelled.txt', text: 'No' };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.service.execute('cancel', args, controller.signal), {
    name: 'AbortError',
  });
  let checks = 0;
  await assert.rejects(
    f.service.execute('revoked', args, undefined, () => {
      if (++checks === 2) throw new Error('Revoked');
    }),
    /Revoked/,
  );
  await assert.rejects(fs.stat(path.join(f.work, 'cancelled.txt')), { code: 'ENOENT' });
  await fs.writeFile(path.join(f.work, 'original.txt'), 'Safe');
  checks = 0;
  const move = {
    action: 'move',
    scopeId: scope.id,
    path: 'original.txt',
    destinationScopeId: scope.id,
    destination: 'partial.txt',
  };
  await assert.rejects(
    f.service.execute('partial', move, undefined, () => {
      if (++checks === 3) throw new Error('Revoked during action');
    }),
    /Revoked/,
  );
  assert.equal(await fs.readFile(path.join(f.work, 'original.txt'), 'utf8'), 'Safe');
  assert.equal(await fs.readFile(path.join(f.work, 'partial.txt'), 'utf8'), 'Safe');
  await assert.rejects(f.service.execute('partial', move), /not be repeated/);
});
test('file tools are available only to trusted desktop owner turns, with live invocation authority', async (t) => {
  const f = await fixture(t);
  let factory, lifecycle;
  plugin.register({
    source: pathToFileURL(path.join(f.dir, 'integrations/filesystem/index.mjs')).href,
    registerTool: (tool) => {
      factory = tool;
    },
    registerService: (service) => {
      lifecycle = service;
    },
  });
  t.after(() => lifecycle.stop());
  const ctx = {
    agentId: 'capri',
    senderIsOwner: true,
    messageChannel: 'webchat',
    sessionKey: 'agent:capri:test',
    sessionId: 'fixture-session',
    assertInvocationCurrent: () => {},
  };
  assert.equal(factory.contextVersion, 2);
  assert.equal(factory.create({ ...ctx, messageChannel: 'telegram' }), null);
  assert.equal(factory.create({ ...ctx, senderIsOwner: false }), null);
  const tool = factory.create(ctx);
  assert.equal(tool.name, 'filesystem_control');
  const broker = new ActionBroker({
    root: f.dir,
    execute: ({ tool, id, args, signal }) => {
      assert.equal(tool, 'filesystem_control');
      return f.service.execute(id, args, signal);
    },
  });
  await broker.start();
  t.after(() => broker.close());
  assert.equal((await tool.execute('status', { action: 'status' })).details.ok, true);
});

test('undo checks object identity and a full journal does not discard retry protection', async (t) => {
  const f = await fixture(t),
    [scope] = f.permissions.grant(f.work);
  f.permissions.update(scope.id, true);
  const args = {
    action: 'write_text',
    scopeId: scope.id,
    path: 'owned.txt',
    text: 'Same contents',
  };
  const created = await f.service.execute('created', args);
  await fs.rename(path.join(f.work, 'owned.txt'), path.join(f.work, 'kept-original.txt'));
  await fs.writeFile(path.join(f.work, 'owned.txt'), 'Same contents');
  await assert.rejects(
    f.service.execute('undo-replacement', { action: 'undo', operationId: 'created' }),
    /replaced/,
  );
  assert.equal(await fs.readFile(path.join(f.work, 'owned.txt'), 'utf8'), 'Same contents');
  f.service.db.exec(
    "WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<9999) INSERT INTO operations(id,fingerprint,state) SELECT 'reserved-'||x,'reserved','started' FROM n;",
  );
  await assert.rejects(
    f.service.execute('new-action', { ...args, path: 'later.txt' }),
    /journal is full/,
  );
  assert.deepEqual(await f.service.execute('created', args), created);
  assert.equal(
    (
      await f.service.execute('read-after-full', {
        action: 'read_text',
        scopeId: scope.id,
        path: 'owned.txt',
      })
    ).untrustedContent,
    'Same contents',
  );
});
