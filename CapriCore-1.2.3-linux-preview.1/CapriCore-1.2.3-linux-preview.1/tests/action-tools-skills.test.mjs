// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { CompanionActions } from '../apps/desktop/companion-actions.mjs';
import { CapriCore } from '../packages/core/src/index.mjs';
import { ACTION_SKILLS, registerActionToolSkills } from '../packages/skills/src/action-tools.mjs';

test('legacy aliases dispatch through their registered skills without changing the tool receipts', async (t) => {
  const effects = [];
  const service = (key) => ({
    execute(id, args, signal) {
      signal.throwIfAborted();
      effects.push([key, id, args]);
      return { ok: true, key, id };
    },
    close() {},
  });
  const actions = new CompanionActions({
    root: process.cwd(),
    emit() {},
    desktop: { close() {} },
    spotify: service('spotify'),
    applications: service('applications'),
    files: service('files'),
    workflows: {
      list: () => [{ id: 'daily', name: 'Daily task', steps: [{ private: 'private selector' }] }],
      run(id, variables, signal) {
        signal.throwIfAborted();
        effects.push(['workflows', id, variables]);
        return { ok: true, steps: 1 };
      },
    },
    userTools: {
      run(name, parameters, signal) {
        signal.throwIfAborted();
        effects.push(['user-tools', name, parameters]);
        return { output: 'fixture output' };
      },
    },
    authorizeAction: (tool) => effects.push(['authorize', tool]),
  });
  t.after(() => actions.close());
  for (const [tool, key] of [
    ['spotify_control', 'spotify'],
    ['application_control', 'applications'],
    ['filesystem_control', 'files'],
  ]) {
    assert.equal(actions.skills.has(ACTION_SKILLS[key]), true);
    assert.deepEqual(await actions.execute(tool, 'operation-1', { action: 'status' }), {
      ok: true,
      key,
      id: 'operation-1',
    });
    assert.deepEqual(effects.splice(0), [
      ['authorize', tool],
      [key, 'operation-1', { action: 'status' }],
    ]);
  }
  assert.deepEqual(await actions.execute('workflow_control', 'workflow-1', { action: 'list' }), {
    ok: true,
    workflows: [{ id: 'daily', name: 'Daily task', steps: 1 }],
  });
  assert.deepEqual(
    await actions.execute('workflow_control', 'workflow-2', { action: 'run', id: 'daily' }),
    { ok: true, steps: 1 },
  );
  assert.deepEqual(await actions.execute('capri_tool_01', 'tool-1', {}), {
    ok: true,
    data: { output: 'fixture output' },
  });
  assert.deepEqual(effects, [
    ['authorize', 'workflow_control'],
    ['authorize', 'workflow_control'],
    ['workflows', 'daily', {}],
    ['authorize', 'capri_tool_01'],
    ['user-tools', 'capri_tool_01', {}],
  ]);
  effects.length = 0;
  assert.deepEqual(
    await actions.skills.call(
      { skillId: ACTION_SKILLS.workflows, command: 'run', input: { id: 'daily', variables: {} } },
      { source: 'settings' },
    ),
    { ok: true, steps: 1 },
  );
  const request = {
    skillId: ACTION_SKILLS.userTools,
    command: 'test',
    input: { name: 'fixture', parameters: {} },
  };
  assert.deepEqual(await actions.skills.call(request, { source: 'settings' }), {
    output: 'fixture output',
  });
  assert.deepEqual(await actions.skills.dispatch(request, { source: 'tool' }), {
    status: 'failed',
    code: 'skill_access_denied',
  });
  assert.deepEqual(effects, [
    ['workflows', 'daily', {}],
    ['user-tools', 'fixture', {}],
  ]);
});

test('workflow and user-tool management preserve Settings results and owner-only commands', async (t) => {
  const core = new CapriCore();
  t.after(() => core.close());
  const effects = [];
  const schedule = { recording: false, playing: false, count: 1 };
  const draft = [{ action: 'keys', keys: ['ENTER'] }];
  const workflows = [{ id: 'daily', name: 'Daily task', steps: draft }];
  const tools = [{ id: 'fixture', enabled: true }];
  const invalidSettings = new Error('Use a small JSON object of private string settings.');
  registerActionToolSkills(core, {
    workflows: {
      list: () => workflows,
      run() {},
      snapshot: () => schedule,
      draft,
      start: async () => ({ ...schedule, recording: true }),
      cancel: () => effects.push('cancel workflow'),
      stopRecording: async () => (effects.push('finish recording'), draft),
      save: (value) => (effects.push(['save', value.id]), workflows),
      remove: (id) => (effects.push(['remove', id]), []),
    },
    userTools: {
      run() {},
      list: () => tools,
      refresh: async () => tools,
      enable: async (id, enabled) => [{ id, enabled }],
      saveSettings: async (id, value) => {
        assert.equal(id, 'fixture');
        if (value === null) throw invalidSettings;
        assert.deepEqual(value, { key: 'sample secret' });
        return { saved: true };
      },
      cancel: () => effects.push('cancel user tool'),
      example: async () => tools,
    },
  });
  const call = (skill, command, input, source = 'settings') =>
    core.call({ skillId: ACTION_SKILLS[skill], command, input }, { source });
  const status = call('workflows', 'status');
  assert.deepEqual(status, { status: schedule, workflows, draft });
  assert.notEqual(status.draft, draft);
  assert.deepEqual(await call('workflows', 'record'), { ...schedule, recording: true });
  assert.deepEqual(await call('workflows', 'stop'), { steps: draft });
  assert.equal(call('workflows', 'save', workflows[0]), workflows);
  assert.deepEqual(call('workflows', 'remove', 'daily'), []);
  assert.equal(call('userTools', 'status'), tools);
  assert.equal(await call('userTools', 'refresh'), tools);
  assert.deepEqual(await call('userTools', 'enable', { id: 'fixture', enabled: false }), [
    { id: 'fixture', enabled: false },
  ]);
  assert.deepEqual(
    await call('userTools', 'settings', { id: 'fixture', settings: { key: 'sample secret' } }),
    { saved: true },
  );
  await assert.rejects(
    call('userTools', 'settings', { id: 'fixture', settings: null }),
    invalidSettings,
  );
  assert.equal(call('userTools', 'stop'), true);
  assert.equal(await call('userTools', 'example'), tools);
  assert.deepEqual(effects, [
    'cancel workflow',
    'finish recording',
    ['save', 'daily'],
    ['remove', 'daily'],
    'cancel user tool',
  ]);
  for (const [skill, commands] of [
    ['workflows', ['status', 'record', 'stop', 'save', 'remove']],
    ['userTools', ['status', 'refresh', 'enable', 'settings', 'stop', 'example']],
  ]) {
    for (const command of commands)
      assert.throws(() => call(skill, command, undefined, 'tool'), {
        code: 'skill_access_denied',
      });
  }
});

test('file trash keeps the busy, approval and full-access behavior of the desktop bridge', async (t) => {
  let fullAccess = false;
  const computerAgent = { running: true };
  const effects = [];
  const actions = new CompanionActions({
    root: process.cwd(),
    emit() {},
    computerAgent,
    fullAccess: () => fullAccess,
    desktop: {
      execute(id, args, approvals, signal) {
        signal.throwIfAborted();
        effects.push(['propose', id, args]);
        return approvals.propose({
          title: 'Review trash',
          detail: 'Fixture file',
          kind: 'trash',
          execute: () => {
            effects.push(['trash', id]);
            return { ok: true, confirmation: 'Moved to Recycle Bin.' };
          },
        });
      },
      close() {},
    },
    authorizeAction: (tool) => effects.push(['authorize', tool]),
  });
  t.after(() => actions.close());
  const args = { action: 'trash' };
  await assert.rejects(
    actions.execute('filesystem_control', 'trash-1', args),
    /current computer task/u,
  );
  assert.deepEqual(effects.splice(0), [['authorize', 'filesystem_control']]);
  computerAgent.running = false;
  const pending = await actions.execute('filesystem_control', 'trash-1', args);
  assert.equal(pending.needsApproval, true);
  assert.deepEqual(effects.splice(0), [
    ['authorize', 'filesystem_control'],
    ['propose', 'trash-1', args],
  ]);
  assert.equal((await actions.approvals.respond(pending.proposal.id, true)).ok, true);
  assert.deepEqual(effects.splice(0), [['trash', 'trash-1']]);

  fullAccess = true;
  assert.equal((await actions.execute('filesystem_control', 'trash-2', args)).ok, true);
  assert.deepEqual(effects.splice(0), [
    ['authorize', 'filesystem_control'],
    ['propose', 'trash-2', args],
    ['trash', 'trash-2'],
  ]);
  assert.deepEqual(
    await actions.skills.dispatch(
      { skillId: ACTION_SKILLS.files, command: 'trash', input: args },
      { source: 'settings' },
    ),
    { status: 'failed', code: 'skill_access_denied' },
  );
  assert.deepEqual(effects, []);
});
