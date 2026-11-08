// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { request } from 'node:http';
import { ActionBroker, ActionApprovals } from '../apps/desktop/action-broker.mjs';
const parent = path.resolve('.runtime/action-unit');
mkdirSync(parent, { recursive: true });
test('local broker requires its secret, exact host and non-browser origin', async () => {
  let calls = 0;
  const broker = new ActionBroker({
    root: mkdtempSync(path.join(parent, 'case-')),
    execute: async () => ({ ok: true, n: ++calls }),
  });
  await broker.start();
  try {
    const { url, token } = JSON.parse(readFileSync(broker.file));
    const send = (headers = {}) =>
      fetch(url + '/action', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool: 'time_control',
          id: 'a'.repeat(64),
          args: { action: 'list' },
        }),
      });
    assert.equal((await send()).status, 403);
    assert.equal(
      (await send({ authorization: 'Bearer ' + token, origin: 'https://example.com' })).status,
      403,
    );
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(
        url + '/action',
        { method: 'POST', headers: { authorization: 'Bearer ' + token, host: 'localhost' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(wrongHost, 403);
    const valid = await send({ authorization: 'Bearer ' + token });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).n, 1);
    assert.equal(calls, 1);
    assert.equal(broker.diagnostics().at(-1).outcome, 'completed');
    assert.equal(broker.diagnostics().length, 1, 'unauthenticated traffic is never recorded');
  } finally {
    broker.close();
  }
  assert.equal(existsSync(broker.file), false);
});

test('broker diagnostics are bounded command metadata without arguments, secrets or result text', () => {
  const broker = new ActionBroker({ root: parent, execute() {} });
  const input = {
    tool: 'settings_control',
    args: {
      action: 'request',
      setting: 'screenObservation',
      token: 'private-token',
      text: 'private-text',
    },
  };
  for (let i = 0; i < 30; i++)
    broker.record(input, Date.now(), { needsApproval: true, text: 'private-result' });
  assert.equal(broker.diagnostics().length, 24);
  assert.equal(broker.diagnostics().at(-1).outcome, 'pending');
  broker.record(input, Date.now(), null, true);
  const report = broker.diagnostics();
  assert.equal(report.at(-1).outcome, 'failed');
  assert.equal(report.at(-1).setting, 'screenObservation');
  assert.doesNotMatch(JSON.stringify(report), /private-|token/);
  report[0].outcome = 'modified';
  assert.equal(broker.diagnostics()[0].outcome, 'pending');
  broker.record(input, Date.now(), {
    ok: false,
    error: { code: 'missing_app_id', message: 'private-text' },
  });
  assert.equal(broker.diagnostics().at(-1).errorCode, 'missing_app_id');
  broker.record(input, Date.now(), {
    ok: false,
    error: { code: 'private-token', message: 'private-text' },
  });
  assert.equal(broker.diagnostics().at(-1).errorCode, undefined);
  assert.doesNotMatch(JSON.stringify(broker.diagnostics()), /private-|token/);
});
test('approval is exact, expiring, one shot and unrelated speech cancels it', async () => {
  let now = 1000,
    calls = 0;
  const approvals = new ActionApprovals({ now: () => now, emit() {} });
  const propose = (voice = true) =>
    approvals.propose({
      title: 'Enable app',
      detail: 'One app',
      kind: 'permission',
      execute: async () => ({ ok: true, n: ++calls }),
      voice,
    }).proposal;
  let p = propose();
  await approvals.text('something else');
  assert.equal(await approvals.text('yes'), null);
  assert.equal(calls, 0);
  p = propose(false);
  assert.match((await approvals.text('yes')).confirmation, /buttons/);
  await approvals.respond(p.id, true);
  assert.equal(calls, 1);
  await assert.rejects(approvals.respond(p.id, true), /expired/);
  p = propose();
  now += 90001;
  await assert.rejects(approvals.respond(p.id, true), /expired/);
  assert.equal(calls, 1);
});

test('confirm and approve consume only real unexpired voice-enabled proposals', async () => {
  let calls = 0,
    now = 1000;
  const approvals = new ActionApprovals({ now: () => now, emit() {} });
  const propose = (voice = true) =>
    approvals.propose({
      title: 'Open picker',
      detail: 'No capture',
      kind: 'permission',
      voice,
      execute: async () => ({ ok: true, count: ++calls }),
    });
  for (const text of ['confirm', 'approve', 'подтверждаю', 'подтвердить']) {
    assert.equal(await approvals.text(text), null);
    const result = propose();
    assert.match(result.instruction, /pending approval, not a failed tool call/);
    assert.equal((await approvals.text(text)).ok, true);
    assert.equal(await approvals.text(text), null);
  }
  assert.equal(calls, 4);
  propose(false);
  assert.match((await approvals.text('confirm')).confirmation, /buttons/);
  assert.ok(approvals.pending);
  approvals.cancel();
  propose();
  now += 90001;
  assert.equal(await approvals.text('approve'), null);
  assert.equal(calls, 4);
});
