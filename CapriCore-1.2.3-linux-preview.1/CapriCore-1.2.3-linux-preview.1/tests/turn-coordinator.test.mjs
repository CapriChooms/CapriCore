// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateTurn, TURN_HANDLED } from '../packages/core/src/turn-coordinator.mjs';

const phaseHandlers = [
  ['direct', ['coding', 'memory', 'callClarification', 'spotify', 'calculator', 'new-skill']],
  ['approval', ['explicitComputerApproval']],
  ['model', ['modelPreparation']],
  ['classification', ['classification']],
  ['intent', ['computerIntent']],
  ['executor', ['computer']],
  ['context', ['webContext', 'interfaceContext', 'reasoning']],
];
const order = phaseHandlers.flatMap(([, ids]) => ids);

test('turn stages are ordered by the core and stop at the first completing route', async () => {
  for (const completeAt of [
    'coding',
    'spotify',
    'new-skill',
    'explicitComputerApproval',
    'computer',
    null,
  ]) {
    const seen = [];
    const handlers = Object.fromEntries(
      phaseHandlers.toReversed().map(([phase, ids]) => [
        phase,
        ids.map((id) => [
          id,
          async () => {
            seen.push(id);
            return id === completeAt ? TURN_HANDLED : undefined;
          },
        ]),
      ]),
    );
    assert.equal(await coordinateTurn(handlers, new AbortController().signal), completeAt);
    assert.deepEqual(seen, completeAt ? order.slice(0, order.indexOf(completeAt) + 1) : order);
  }
});

test('cancellation between turn stages prevents subsequent model or device work', async () => {
  const controller = new AbortController();
  await assert.rejects(
    coordinateTurn(
      {
        classification: [['classify', async () => controller.abort()]],
        executor: [['computer', () => assert.fail('Device work after cancellation')]],
        context: [['search', () => assert.fail('Search after cancellation')]],
      },
      controller.signal,
    ),
    { name: 'AbortError' },
  );
  assert.throws(
    () =>
      coordinateTurn({ context: [['search', () => TURN_HANDLED]] }, new AbortController().signal),
    /preparation stage cannot complete/,
  );
});

test('skipped and synchronous routes cannot postpone a native confirmation', () => {
  let requested = false;
  const result = coordinateTurn(
    {
      direct: [
        ['disabled', false],
        ['unmatched', () => {}],
      ],
      approval: [
        [
          'confirm',
          () => {
            requested = true;
            return TURN_HANDLED;
          },
        ],
      ],
    },
    new AbortController().signal,
  );
  assert.equal(requested, true);
  assert.equal(result, 'confirm');
});
