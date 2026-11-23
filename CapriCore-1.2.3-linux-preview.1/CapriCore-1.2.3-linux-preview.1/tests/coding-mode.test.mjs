// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  linkSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {
  CodingService,
  editorArguments,
  editorProjectArguments,
} from '../apps/desktop/coding-service.mjs';
import { CodingAgent } from '../apps/desktop/coding-agent.mjs';
import { validateInput } from '../apps/desktop/chat-service.mjs';
function fixture(t, options = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'capri-coding-')),
    root = path.join(parent, 'app'),
    workspace = path.join(parent, 'project');
  mkdirSync(root);
  mkdirSync(workspace);
  const service = new CodingService({ root, ...options });
  t.after(() => {
    service.setMonitoring(false);
    rmSync(parent, { recursive: true, force: true });
  });
  service.save({ workspace, editor: null, tasks: [] });
  return { parent, root, workspace, service };
}
test('coding grant rejects traversal, secrets, linked files and Capri installation', (t) => {
  const { root, workspace, service } = fixture(t);
  writeFileSync(path.join(workspace, 'code.js'), 'const a=1;');
  writeFileSync(path.join(workspace, '.env'), 'PRIVATE_VALUE');
  for (const file of ['../outside', '.env', '.git/config', 'C:\\Windows\\test', 'code.js:stream'])
    assert.throws(() => service.read(file));
  linkSync(path.join(workspace, 'code.js'), path.join(workspace, 'linked.js'));
  assert.throws(() => service.read('linked.js'));
  assert.throws(() => service.save({ workspace: root, editor: null, tasks: [] }));
});
test('atomic edit preserves a changed file; create never overwrites', async (t) => {
  const { workspace, service } = fixture(t);
  await service.execute({ action: 'create', path: 'example.js', text: 'old' });
  const read = service.read('example.js');
  writeFileSync(path.join(workspace, 'example.js'), 'editor changed it');
  assert.throws(() => service.edit('example.js', 'stale', read.hash));
  assert.equal(readFileSync(path.join(workspace, 'example.js'), 'utf8'), 'editor changed it');
  const latest = service.read('example.js');
  assert.equal(service.edit('example.js', 'new', latest.hash).text, 'new');
  assert.throws(() => service.edit('example.js', 'overwrite', null, true));
});
test('native coding executes an explicitly approved real Node test without credential environment', async (t) => {
  const { workspace, service } = fixture(t);
  writeFileSync(path.join(workspace, 'addition.cjs'), 'module.exports=(a,b)=>a+b');
  writeFileSync(
    path.join(workspace, 'addition.test.cjs'),
    "const{test}=require('node:test');const assert=require('node:assert/strict');test('addition',()=>assert.equal(require('./addition.cjs')(2,3),5));test('private environment',()=>assert.equal(process.env.CAPRI_CODING_TEST_SECRET,undefined));",
  );
  process.env.CAPRI_CODING_TEST_SECRET = 'must not reach project';
  t.after(() => delete process.env.CAPRI_CODING_TEST_SECRET);
  service.save({
    workspace,
    editor: null,
    tasks: [{ id: 'Tests', executable: process.execPath, args: ['--test', 'addition.test.cjs'] }],
  });
  const result = await service.task('Tests');
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /pass 2/);
  await assert.rejects(service.task('model-invented-command'));
});
test('IDE adapters open exact files and line locations as arguments, never shell text', () => {
  const file = 'C:\\Project with spaces\\file.cs';
  assert.deepEqual(editorArguments('vscode', file, 12, 4), [
    '--reuse-window',
    '--goto',
    file + ':12:4',
  ]);
  for (const kind of ['jetbrains', 'visual-studio', 'sublime', 'notepad++', 'neovim', 'emacs'])
    assert.ok(
      editorArguments(kind, file, 12, 4).includes(file) ||
        editorArguments(kind, file, 12, 4).some((arg) => arg.startsWith(file + ':')),
    );
  assert.throws(() => editorArguments('shell', file));
});
test('coding agent completes a read/edit/test chain and uses no desktop actions', async (t) => {
  const { workspace, service } = fixture(t);
  writeFileSync(path.join(workspace, 'function.js'), 'wrong');
  service.save({
    workspace,
    editor: null,
    tasks: [
      {
        id: 'Check',
        executable: process.execPath,
        args: [
          '-e',
          "require('node:assert/strict').equal(require('node:fs').readFileSync('function.js','utf8'),'right')",
        ],
      },
    ],
  });
  let step = 0;
  const agent = new CodingAgent({
    service,
    url: 'http://unused',
    model: 'test',
    fetchImpl: async (_url, request) => {
      const context = JSON.parse(JSON.parse(request.body).messages.at(-1).content);
      const action = [
        { action: 'read', path: 'function.js' },
        {
          action: 'edit',
          path: 'function.js',
          text: 'right',
        },
        { action: 'run_task', task: 'Check' },
        { action: 'done' },
      ][step++];
      return Response.json({
        message: { content: JSON.stringify({ ...action, summary: 'Fixed and verified.' }) },
      });
    },
  });
  const result = await agent.run('Fix the function and test it');
  assert.equal(result.verified, true);
  assert.deepEqual(result.changes, ['function.js']);
  assert.equal(
    validateInput({ id: '11111111-1111-1111-1111-111111111111', text: 'fix', mode: 'coding' }).mode,
    'coding',
  );
});
test('aborted coding task cannot write a file', async (t) => {
  const { service } = fixture(t);
  await assert.rejects(
    service.execute({ action: 'create', path: 'never.js', text: 'no' }, AbortSignal.abort()),
  );
  assert.throws(() => service.read('never.js'));
});

test('project finder and text search honor nested .gitignore, avoid links and find deep files', async (t) => {
  const { workspace, service } = fixture(t);
  const deep = 'src/one/two/three/four/five/six/seven/eight';
  for (const folder of [deep, 'dist', 'generated'])
    mkdirSync(path.join(workspace, folder), { recursive: true });
  writeFileSync(path.join(workspace, '.gitignore'), 'generated/\n*.tmp\n');
  writeFileSync(path.join(workspace, 'src/.gitignore'), '!keep.tmp\n');
  writeFileSync(path.join(workspace, 'src/keep.tmp'), 'needle');
  writeFileSync(path.join(workspace, 'src/hidden.tmp'), 'needle');
  writeFileSync(path.join(workspace, 'dist/needle.js'), 'needle');
  writeFileSync(path.join(workspace, 'generated/needle.js'), 'needle');
  writeFileSync(path.join(workspace, '.npmrc'), 'needle');
  writeFileSync(path.join(workspace, `${deep}/needle.js`), 'header\r\n  NEEDLE match\r\n');
  linkSync(path.join(workspace, '.npmrc'), path.join(workspace, 'linked-secret.txt'));
  const found = await service.execute({ action: 'find', query: 'eight needle' });
  assert.deepEqual(found.matches, [{ path: `${deep}/needle.js` }]);
  const linked = await service.execute({ action: 'find', query: 'linked-secret' });
  assert.deepEqual(linked.matches, []);
  const results = await service.execute({
    action: 'search',
    query: 'needle',
    caseSensitive: false,
  });
  assert.deepEqual(results.matches.map(({ path }) => path).sort(), [
    'src/keep.tmp',
    `${deep}/needle.js`,
  ]);
  const scoped = await service.execute({
    action: 'search',
    path: `${deep}/needle.js`,
    query: 'NEEDLE',
  });
  assert.deepEqual(scoped.matches, [
    { path: `${deep}/needle.js`, line: 2, column: 3, text: '  NEEDLE match' },
  ]);
  await assert.rejects(service.execute({ action: 'read', path: '.npmrc' }));
  if (process.platform === 'win32')
    await assert.rejects(service.execute({ action: 'read', path: '.npmrc.' }));
});

test('ranged reads use inclusive line numbers, exact CRLF text and the full file revision', async (t) => {
  const { workspace, service } = fixture(t);
  const file = 'source.txt';
  writeFileSync(path.join(workspace, file), 'first\r\nsecond\r\nthird\r\nfourth\r\n');
  const full = service.read(file);
  const slice = await service.execute({ action: 'read', path: file, line: 2, endLine: 3 });
  assert.equal(slice.text, 'second\r\nthird');
  assert.equal(slice.hash, full.hash);
  assert.deepEqual(
    [slice.fromLine, slice.toLine, slice.totalLines, slice.partial],
    [2, 3, 5, true],
  );
  await assert.rejects(service.execute({ action: 'read', path: file, line: 8 }), /outside/);
  writeFileSync(path.join(workspace, 'big.txt'), 'line\n'.repeat(800));
  const capped = await service.execute({ action: 'read', path: 'big.txt', line: 20, endLine: 800 });
  assert.deepEqual([capped.toLine, capped.totalLines, capped.partial], [419, 801, true]);
});

test('monitor reports saved paths, skips ignores and stops on revoking the project', async (t) => {
  const updates = [];
  const { workspace, service } = fixture(t, { onProjectChange: (state) => updates.push(state) });
  mkdirSync(path.join(workspace, 'dist'));
  writeFileSync(path.join(workspace, '.gitignore'), '*.tmp\n');
  assert.equal(service.setMonitoring(true).watching, true);
  const waitFor = async (kind) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await service.execute({ action: 'changes' });
      if (state.changes.some((entry) => entry.path === 'source.js' && entry.kind === kind))
        return state;
      await delay(35);
    }
    assert.fail(`No ${kind} monitor event for source.js`);
  };
  writeFileSync(path.join(workspace, '.env'), 'private source');
  writeFileSync(path.join(workspace, 'dist/bundle.js'), 'large bundle');
  writeFileSync(path.join(workspace, 'scratch.tmp'), 'ignored');
  writeFileSync(path.join(workspace, 'source.js'), 'local edit');
  const changed = await waitFor('changed');
  assert.deepEqual(
    changed.changes.map(({ path }) => path),
    ['source.js'],
  );
  assert.equal(Object.hasOwn(changed.changes[0], 'text'), false);
  unlinkSync(path.join(workspace, 'source.js'));
  const removed = await waitFor('removed');
  assert.ok(removed.revision > changed.revision);
  service.save({ workspace: '', editor: null, tasks: [] });
  const calls = updates.length;
  writeFileSync(path.join(workspace, 'after-revoke.js'), 'ignored once revoked');
  await delay(180);
  assert.equal(updates.length, calls);
  assert.equal(service.snapshot().monitor.watching, false);
  assert.deepEqual(service.snapshot().monitor.changes, []);
});

test('opens the approved project as a Notepad++ workspace with a spaced path', async (t) => {
  let called;
  const { parent, workspace, service } = fixture(t, {
    spawnImpl(executable, args, options) {
      called = { executable, args, options };
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  const executable = path.join(parent, 'Notepad++ editor.exe');
  const project = path.join(workspace, 'project with spaces');
  mkdirSync(project);
  writeFileSync(executable, 'fixture');
  service.save({ workspace: project, editor: { kind: 'notepad++', executable }, tasks: [] });
  assert.deepEqual(await service.openProject(), { opened: true, editor: 'notepad++' });
  assert.equal(called.executable, executable);
  const canonical = realpathSync.native(project);
  assert.equal(called.options.cwd, canonical);
  assert.deepEqual(called.args, ['-multiInst', '-nosession', '-openFoldersAsWorkspace', canonical]);
  assert.deepEqual(editorProjectArguments('vscode', project), ['--reuse-window', project]);
});

test('live editor context is optional and never exposes a file outside the approved project', async (t) => {
  let active = { path: 'src\\code.js', line: 2, column: 4, dirty: true };
  const { parent, root, workspace, service } = fixture(t, {
    bridge: {
      async request(project, action) {
        assert.equal(project, realpathSync.native(workspace));
        assert.deepEqual(action, { action: 'context' });
        if (!active) throw Error('unsupported_action');
        return { active };
      },
    },
  });
  const executable = path.join(parent, 'code.exe');
  writeFileSync(executable, 'fixture');
  mkdirSync(path.join(workspace, 'src'));
  writeFileSync(path.join(workspace, 'src/code.js'), 'code');
  service.save({
    workspace,
    editor: { kind: 'vscode', executable },
    tasks: [],
    bridge: true,
    reviewWrites: true,
  });
  assert.equal(new CodingService({ root }).snapshot().reviewWrites, true);
  assert.deepEqual(await service.execute({ action: 'context' }), {
    active: { path: 'src/code.js', line: 2, column: 4, dirty: true },
  });
  active = { ...active, path: '../outside.js' };
  assert.deepEqual(await service.activeContext(), { active: null });
  active = null;
  assert.deepEqual(await service.activeContext(), { active: null });
});
