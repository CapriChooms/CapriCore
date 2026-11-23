// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CodingAgent } from '../apps/desktop/coding-agent.mjs';
import { CodingService } from '../apps/desktop/coding-service.mjs';
import { temporaryFolders } from './temporary-folders.mjs';

const folders = temporaryFolders('capri-coding-workflow-');

function fixture() {
  const folder = folders();
  const root = path.join(folder, 'app');
  const workspace = path.join(folder, 'project');
  mkdirSync(root);
  mkdirSync(workspace);
  const service = new CodingService({ root });
  service.save({ workspace, editor: null, tasks: [] });
  return { service, workspace };
}

function planner(service, actions, options = {}) {
  let call = 0;
  return new CodingAgent({
    service,
    model: 'fixture',
    url: 'http://unused',
    fetchImpl: async (_url, { body }) => {
      const request = JSON.parse(body);
      const context = JSON.parse(request.messages.at(-1).content);
      assert(call < actions.length, 'Unexpected model request');
      const next = actions[call++];
      const action = typeof next === 'function' ? next(context, request) : next;
      return action instanceof Response
        ? action
        : Response.json({
            message: { content: JSON.stringify({ summary: 'Coding fixture', ...action }) },
          });
    },
    ...options,
  });
}

test('coding uses a ranged read to edit large CRLF source, creates nested tests and fixes a failing test', async () => {
  const { service, workspace } = fixture();
  const math = path.join(workspace, 'math.cjs');
  const prefix = '// Keep unrelated code and its CRLF line endings.\r\n'.repeat(520);
  const original = 'module.exports = function twice(value) {\r\n  return value;\r\n};\r\n';
  writeFileSync(math, prefix + original);
  service.save({
    ...service.config,
    tasks: [
      {
        id: 'Unit tests',
        executable: process.execPath,
        args: ['--test', 'tests/unit/math.test.cjs'],
      },
    ],
  });
  const testFile = 'tests/unit/math.test.cjs';
  const testCode = [
    "const assert = require('node:assert/strict');",
    "const { test } = require('node:test');",
    "const twice = require('../../math.cjs');",
    "test('twice', () => assert.equal(twice(3), 6));",
  ].join('\n');
  const agent = planner(service, [
    { action: 'plan', steps: ['Inspect function', 'Add a test', 'Verify'] },
    { action: 'read', path: 'math.cjs', line: 521, endLine: 523 },
    (context) => {
      assert.equal(context.recentActions.at(-1).result.partial, true);
      assert.match(context.recentActions.at(-1).result.text, /return value;/);
      assert.equal(context.recentActions.at(-1).result.hash, undefined);
      return {
        action: 'apply',
        edits: [
          {
            kind: 'replace',
            path: '.\\math.cjs',
            oldText: '  return value;\n};',
            newText: '  return value * 3;\n};',
          },
          { kind: 'create', path: testFile, text: testCode },
        ],
      };
    },
    (context) => {
      const { files } = context.recentActions.at(-1).result;
      assert.deepEqual(
        files.map(({ path }) => path),
        ['math.cjs', testFile],
      );
      assert(files.every((file) => !('before' in file) && !('after' in file)));
      return { action: 'run_task', task: 'Unit tests' };
    },
    (context) => {
      assert.equal(context.latestVerification.exitCode, 1);
      assert.match(context.recentActions.at(-1).result.output, /twice/);
      return { action: 'read', path: 'math.cjs', line: 521, endLine: 523 };
    },
    { action: 'replace', path: 'math.cjs', oldText: 'value * 3', newText: 'value * 2' },
    { action: 'run_task', task: 'Unit tests' },
    { action: 'done', summary: 'Fixed twice and verified the new test.' },
  ]);
  const result = await agent.run('Fix twice and add a regression test.');
  assert.deepEqual(result.changes, ['math.cjs', testFile]);
  assert.deepEqual(result.verification, { state: 'passed', task: 'Unit tests' });
  assert.equal(result.verified, true);
  assert.equal(result.blocked, false);
  assert.equal(
    readFileSync(math, 'utf8'),
    prefix + original.replace('return value;', 'return value * 2;'),
  );
  assert.equal(readFileSync(path.join(workspace, testFile), 'utf8'), testCode);
});

test('coding rejects ambiguous edits and recovers with a unique anchor', async () => {
  const { service, workspace } = fixture();
  const file = path.join(workspace, 'values.js');
  writeFileSync(file, 'const first = 1;\nconst second = 1;\n');
  const agent = planner(service, [
    { action: 'read', path: 'values.js' },
    { action: 'replace', path: 'values.js', oldText: ' = 1;', newText: ' = 2;' },
    (context) => {
      assert.match(context.recentActions.at(-1).result.error, /unique excerpt/);
      return { action: 'replace', path: 'values.js', oldText: 'first = 1;', newText: 'first = 2;' };
    },
    { action: 'done' },
  ]);
  const result = await agent.run('Change the first value only.');
  assert.equal(result.blocked, false);
  assert.equal(result.verification.state, 'not_run');
  assert.equal(readFileSync(file, 'utf8'), 'const first = 2;\nconst second = 1;\n');
});

test('coding preserves newer editor work and can report the conflict without modifying files', async () => {
  const { service, workspace } = fixture();
  const file = path.join(workspace, 'saved.js');
  writeFileSync(file, 'export const value = 1;\n');
  const newer = 'export const value = 1; // editor saved this\n';
  const agent = planner(service, [
    { action: 'read', path: 'saved.js' },
    () => {
      writeFileSync(file, newer);
      return { action: 'replace', path: 'saved.js', oldText: 'value = 1', newText: 'value = 2' };
    },
    (context) => {
      assert.match(context.recentActions.at(-1).result.error, /changed/);
      return { action: 'done', outcome: 'blocked', summary: 'The editor saved a newer revision.' };
    },
  ]);
  const result = await agent.run('Change value.');
  assert.equal(result.blocked, true);
  assert.deepEqual(result.changes, []);
  assert.equal(readFileSync(file, 'utf8'), newer);
});

test('declining a coding review stops the turn before a second write request', async () => {
  const { service, workspace } = fixture();
  const agent = planner(service, [{ action: 'create', path: 'declined.js', text: 'draft' }], {
    applyEdits: async () => {
      throw Object.assign(Error('The coding changes were not approved.'), {
        code: 'CAPRI_CODING_REVIEW_DECLINED',
      });
    },
  });
  const result = await agent.run('Create a draft file.');
  assert.equal(result.blocked, true);
  assert.deepEqual(result.changes, []);
  assert.match(result.summary, /not approved/);
  assert.equal(existsSync(path.join(workspace, 'declined.js')), false);
});

test('coding uses project navigation or a reported capability absence on a read-only task', async () => {
  const { service, workspace } = fixture();
  mkdirSync(path.join(workspace, 'lib'));
  writeFileSync(
    path.join(workspace, 'lib', 'math.mjs'),
    'export const double = value => value * 2;',
  );
  const agent = planner(service, [
    { action: 'context' },
    { action: 'changes' },
    { action: 'find', query: 'math' },
    (context) => {
      assert(
        context.recentActions
          .at(-1)
          .result.matches.some(({ path }) => /lib[\\/]math\.mjs$/.test(path)),
      );
      return { action: 'search', path: 'lib', query: 'DOUBLE', caseSensitive: false };
    },
    (context) => {
      assert.equal(context.recentActions.at(-1).result.matches[0].line, 1);
      return { action: 'done', summary: 'double is defined at lib/math.mjs:1.' };
    },
  ]);
  const result = await agent.run('Find the definition without changing code.');
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.verification, { state: 'not_needed' });
  assert.equal(result.blocked, false);
});

test('initial model request has the active editor location when the bridge is enabled', async () => {
  const { service, workspace } = fixture();
  writeFileSync(path.join(workspace, 'active.js'), 'export const answer = 42;');
  service.save({
    ...service.config,
    editor: { executable: process.execPath, kind: 'vscode' },
    bridge: true,
  });
  const active = { path: 'active.js', line: 1, column: 14, dirty: true };
  service.bridge.request = async (root, action) => {
    assert.equal(root, workspace);
    assert.deepEqual(action, { action: 'context' });
    return { active };
  };
  const agent = planner(service, [
    (context) => {
      assert.deepEqual(context.activeEditor, active);
      return { action: 'done', summary: 'The active file is active.js.' };
    },
  ]);
  assert.equal((await agent.run('Which editor file is open?')).blocked, false);
});

test('the local structured-decoder conflict retries in JSON mode and still validates the action', async () => {
  const { service, workspace } = fixture();
  const agent = planner(service, [
    (_context, request) => {
      assert(Array.isArray(request.format.anyOf));
      return Response.json(
        {
          error:
            'llama-server chat error: The model produced output that does not match the expected peg-native format',
        },
        { status: 500 },
      );
    },
    (_context, request) => {
      assert.equal(request.format, 'json');
      return { action: 'create', path: 'outside.js', text: 'data', unsupported: true };
    },
    (context) => {
      assert.match(context.recentActions.at(-1).result.error, /supported coding action/);
      return { action: 'done', outcome: 'blocked' };
    },
  ]);
  assert.equal((await agent.run('Inspect the project.')).blocked, true);
  assert.equal(existsSync(path.join(workspace, 'outside.js')), false);
});
