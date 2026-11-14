// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, linkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CodingService, editorArguments } from '../apps/desktop/coding-service.mjs';
import { CodingAgent } from '../apps/desktop/coding-agent.mjs';
import { validateInput } from '../apps/desktop/chat-service.mjs';
function fixture(t) {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'capri-coding-')),
    root = path.join(parent, 'app'),
    workspace = path.join(parent, 'project');
  mkdirSync(root);
  mkdirSync(workspace);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = new CodingService({ root });
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
