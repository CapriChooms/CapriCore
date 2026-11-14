// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { CapriCore } from '../packages/core/src/index.mjs';
import { codingSkill } from '../packages/skills/src/coding.mjs';
import { computerSkill } from '../packages/skills/src/computer.mjs';

const callSkill =
  (core, { manifest: { id: skillId } }) =>
  (command, input, source, signal) =>
    core.call({ skillId, command, input }, { source, signal });

test('computer skill keeps access approval and task execution behind distinct host sources', async () => {
  const operations = [];
  const state = { enabled: false, enabling: false, drives: [] };
  const agentState = { active: false, phase: 'idle', steps: 0 };
  const core = new CapriCore();
  core.register(computerSkill, {
    access: {
      snapshot: () => state,
      configure: (enabled) => (operations.push(['settings', enabled]), { ...state, enabled }),
    },
    requests: {
      configure: (enabled) => (
        operations.push(['request', enabled]),
        { ok: false, enabled: false }
      ),
      execute: (goal, options) => {
        operations.push(['run', goal]);
        assert.equal(options.previousTask.goal, 'previous');
        assert.equal(options.ownerRequestedCall, true);
        assert.equal(options.planningEffort, 'high');
        assert.equal(options.signal.aborted, false);
        return { ok: false, status: 'cancelled', steps: 0 };
      },
    },
    agent: { snapshot: () => agentState, diagnostics: () => ({ ...agentState, actions: [] }) },
    isApplicationAccessEnabled: () => false,
  });
  const call = callSkill(core, computerSkill);
  assert.deepEqual(call('accessStatus', undefined, 'settings'), { ...state, paused: true });
  assert.equal(call('status', undefined, 'companion'), agentState);
  assert.throws(() => call('diagnostics', undefined, 'tool'), { code: 'skill_access_denied' });
  assert.throws(() => call('setAccess', true, 'tool'), { code: 'skill_access_denied' });
  assert.throws(() => call('run', { goal: 'Open a fixture' }, 'settings'), {
    code: 'skill_access_denied',
  });
  assert.deepEqual(operations, []);
  assert.equal(call('setAccess', true, 'settings').enabled, true);
  assert.equal(call('requestAccess', true, 'tool').enabled, false);
  assert.equal(
    call(
      'run',
      {
        goal: 'Open a fixture',
        previousTask: { goal: 'previous' },
        ownerRequestedCall: true,
        planningEffort: 'high',
      },
      'chat',
    ).status,
    'cancelled',
  );
  const signal = AbortSignal.abort();
  assert.throws(() => call('run', { goal: 'Open a fixture' }, 'chat', signal), {
    name: 'AbortError',
  });
  assert.deepEqual(operations, [
    ['settings', true],
    ['request', true],
    ['run', 'Open a fixture'],
  ]);
  await core.close();
});

test('coding skill owns project-dependent mode and limits bridge installation to one operation', async () => {
  const core = new CapriCore();
  const installed = Promise.withResolvers();
  const events = [];
  let config = { workspace: '', editor: null, available: false };
  let busy = false;
  let installs = 0;
  core.register(codingSkill, {
    service: {
      snapshot: () => config,
      save(value) {
        config = { ...value, available: Boolean(value.workspace) };
        return config;
      },
    },
    agent: {
      run: (summary, { signal }) => {
        assert.equal(signal.aborted, false);
        return { summary, changes: [], steps: 0, verified: true };
      },
    },
    assertModelIdle: () => {
      if (busy) throw Error('The model is busy');
    },
    installBridge: (editor, { signal }) => {
      assert.equal(editor.kind, 'vscode');
      assert.equal(signal.aborted, false);
      installs++;
      return installed.promise;
    },
  });
  core.subscribe({ skillId: 'capri.coding', event: 'settings' }, (event) =>
    events.push(event.data),
  );
  const call = callSkill(core, codingSkill);
  assert.deepEqual(call('mode', true, 'companion'), { enabled: false, projectRequired: true });
  assert.deepEqual(events, []);
  assert.throws(() => call('mode', true, 'chat'), { code: 'skill_access_denied' });
  busy = true;
  assert.throws(() => call('save', { workspace: 'project' }, 'settings'), /model is busy/);
  busy = false;
  call('save', { workspace: 'project', editor: { kind: 'vscode' } }, 'settings');
  assert.deepEqual(call('mode', true, 'companion'), { enabled: true });
  assert.equal(call('status', undefined, 'settings').enabled, true);
  assert.equal(call('run', 'Review changes', 'chat').summary, 'Review changes');
  const firstInstall = call('installBridge', undefined, 'settings');
  await assert.rejects(call('installBridge', undefined, 'settings'), /already running/);
  installed.resolve();
  assert.equal(await firstInstall, true);
  assert.equal(installs, 1);
  call('save', { workspace: '', editor: null }, 'settings');
  assert.equal(call('status', undefined, 'host').enabled, false);
  assert.deepEqual(events, [{ enabled: false }, { enabled: true }, { enabled: false }]);
  await core.close();
});
