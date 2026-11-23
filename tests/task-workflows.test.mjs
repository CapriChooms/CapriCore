import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TaskWorkflows, validateWorkflow } from '../apps/desktop/task-workflows.mjs';
const parent = path.resolve('.runtime/0.6.2/workflow-tests');
mkdirSync(parent, { recursive: true });
const selector = { label: 'Search', role: 'ControlType.Edit', automationId: 'query' };
test('workflow playback resolves every target again, handles variables/shortcuts/dragging and always stops on ambiguity', async () => {
  const data = mkdtempSync(path.join(parent, 'case-')),
    executable = path.join(data, 'Owned.exe');
  writeFileSync(executable, 'not executed');
  let allowed = true,
    ambiguous = false,
    stops = 0,
    turn;
  const calls = [];
  const control = {
    session: null,
    begin: async () => {
      control.session = { target: { executable } };
    },
    requireSession: () => {
      if (!allowed) throw new Error('revoked');
    },
    stop: async () => {
      control.session = null;
      stops++;
    },
    execute: async (args) => {
      calls.push(args);
      return {
        observationId: 'current',
        targets: [
          {
            targetId: 'one',
            role: selector.role,
            automationId: selector.automationId,
            untrustedLabel: 'Search',
          },
          ...(ambiguous
            ? [
                {
                  targetId: 'two',
                  role: selector.role,
                  automationId: selector.automationId,
                  untrustedLabel: 'Search',
                },
              ]
            : []),
        ],
      };
    },
  };
  const catalog = {
    rememberApplication: () => ({ id: 'owned' }),
    execute: async () => ({ ok: true }),
  };
  const workflows = new TaskWorkflows({
    root: data,
    data,
    control,
    catalog,
    allowed: () => allowed,
    turn: (value) => (turn = value),
  });
  const steps = [
    { action: 'click', selector, executable, delayMs: 0 },
    { action: 'text', selector, text: '{{query}}', executable, delayMs: 0 },
    { action: 'keys', keys: ['CTRL', 'A'], executable, delayMs: 0 },
    { action: 'drag', selector, to: selector, executable, delayMs: 0 },
  ];
  const [saved] = workflows.save({ name: 'Owned search', steps });
  assert.equal((await workflows.run(saved.id, { query: 'vanilla' })).steps, 4);
  assert(calls.some((call) => call.action === 'enter_text' && call.text === 'vanilla'));
  assert.equal(turn, null);
  assert.equal(stops, 1);
  ambiguous = true;
  await assert.rejects(workflows.run(saved.id, {}), /ambiguous/);
  assert.equal(stops, 2);
  assert.equal(control.session, null);
  allowed = false;
  await assert.rejects(workflows.run(saved.id), /full computer access/);
  workflows.close();
});
test('workflow validation rejects executable arguments, unsupported actions and Escape shortcuts', () => {
  const executable = path.resolve('Owned.exe');
  assert.throws(() =>
    validateWorkflow({
      name: 'bad',
      steps: [{ action: 'keys', keys: ['ESCAPE'], executable, delayMs: 0 }],
    }),
  );
  assert.throws(() =>
    validateWorkflow({ name: 'bad', steps: [{ action: 'shell', executable, delayMs: 0 }] }),
  );
  assert.throws(() =>
    validateWorkflow({
      name: 'bad',
      steps: [{ action: 'click', selector, executable: executable + ' --evil', delayMs: 0 }],
    }),
  );
});
