// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { CodingEditorBridge } from '../apps/desktop/coding-editor-bridge.mjs';
import { CodingService } from '../apps/desktop/coding-service.mjs';

test('editor bridge authenticates loopback requests, preserves split UTF-8 and excludes other workspaces', async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'capri-bridge-')),
    directory = path.join(folder, 'bridge'),
    workspace = path.join(folder, 'project');
  mkdirSync(directory);
  mkdirSync(workspace);
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const token = 'a'.repeat(64);
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer ' + token);
    let input = '';
    for await (const chunk of request) input += chunk;
    assert.equal(JSON.parse(input).workspace, workspace);
    response.setHeader('content-type', 'application/json');
    const bytes = Buffer.from(JSON.stringify({ text: 'Привет, мир!' }));
    for (const byte of bytes) response.write(Buffer.from([byte]));
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  writeFileSync(
    path.join(directory, `${process.pid}-012345abcdef.json`),
    JSON.stringify({
      protocol: 1,
      pid: process.pid,
      port: server.address().port,
      token,
      workspaces: [workspace],
    }),
  );
  const bridge = new CodingEditorBridge({ directory });
  assert.equal(
    (await bridge.request(workspace, { action: 'read', path: 'a.js' })).text,
    'Привет, мир!',
  );
  assert.equal(bridge.endpoint(directory), null);
  writeFileSync(
    path.join(directory, `${process.pid}-abcdef012345.json`),
    readFileSync(path.join(directory, `${process.pid}-012345abcdef.json`)),
  );
  assert.throws(() => bridge.endpoint(workspace), /multiple editor/);
});
test('coding mode uses live buffer versions, rejects dirty/missing bridges and never silently writes disk', async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'capri-live-editor-')),
    root = path.join(folder, 'app'),
    workspace = path.join(folder, 'project');
  mkdirSync(root);
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'a.js'), 'disk');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  let connected = true;
  const calls = [];
  const service = new CodingService({
    root,
    bridge: {
      request: async (_workspace, value) => {
        calls.push(value);
        if (!connected) return null;
        if (value.action === 'read')
          return { text: 'unsaved', hash: 'current-hash', version: 4, dirty: true };
        if (value.action === 'edit') {
          assert.equal(value.version, 4);
          throw Error('Save your unsaved editor changes before asking Capri to edit this file.');
        }
      },
    },
  });
  // A real executable is required for persisted editor selection, but is never launched by this test.
  service.save({
    workspace,
    editor: { kind: 'vscode', executable: process.execPath },
    tasks: [],
    bridge: true,
  });
  assert.equal((await service.execute({ action: 'read', path: 'a.js' })).dirty, true);
  await assert.rejects(
    service.execute({ action: 'edit', path: 'a.js', text: 'new', hash: 'current-hash' }),
    /unsaved/,
  );
  assert.equal(readFileSync(path.join(workspace, 'a.js'), 'utf8'), 'disk');
  connected = false;
  await assert.rejects(service.execute({ action: 'read', path: 'a.js' }), /not connected/);
  await assert.rejects(
    service.execute({ action: 'edit', path: 'a.js', text: 'new', hash: 'current-hash' }),
    /not connected/,
  );
  assert.equal(readFileSync(path.join(workspace, 'a.js'), 'utf8'), 'disk');
});
