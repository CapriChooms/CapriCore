// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { computerPlanner } from '../../apps/desktop/computer-planner.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
export async function verifyBrowserAgent({ root, catalog, windowId, title }) {
  await catalog.execute(
    'agent-focus-fixture',
    { action: 'launch', query: 'Google Chrome', windowId },
    {},
  );
  const initial = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(initial.windowId, windowId, 'Only the disposable browser window may be controlled.');
  const actions = [];
  const control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    registerEscape: () => true,
    unregisterEscape: () => {},
    showBorder: async () => {},
    hideBorder: () => {},
    bridge: async (args, options) => {
      if (args.action === 'computer_release') return callApplicationBridge(root, args, options);
      const current = await callApplicationBridge(root, { action: 'computer_state' }, options);
      assert.equal(current.windowId, windowId, 'Owner windows must never receive test input.');
      if (args.action === 'computer_state') return current;
      assert(
        ['computer_type', 'computer_pointer', 'computer_click'].includes(args.action),
        'No navigation or keyboard submission in this fixture.',
      );
      actions.push(args.action);
      return callApplicationBridge(root, args, options);
    },
    capture: async () => {
      throw Error('Accessible browser chrome is sufficient for this test.');
    },
  });
  const planner = computerPlanner({
    url: process.env.CAPRI_VERIFY_OLLAMA_URL,
    model: process.env.CAPRI_VERIFY_MODEL,
    params: { num_ctx: 8192 },
  });
  const agent = new ComputerAgent({
    control,
    maxDecisions: 12,
    plan: async (context, options) => {
      const step = await planner(context, options);
      console.log(JSON.stringify({ fixturePlan: step }));
      return step;
    },
    applications: {
      availableApps: () => [{ name: 'Google Chrome' }],
      operation: (...args) => catalog.operation(...args),
      execute: async (id, args, approvals, signal) => {
        assert(['launch', 'browser_input'].includes(args.action));
        if (!/^(?:Google )?Chrome$/i.test(args.query))
          return {
            ok: false,
            error:
              'Use application name Google Chrome in query, and the window title only in windowTitle.',
          };
        actions.push(args.action);
        return catalog.execute(
          id,
          { ...args, windowId, windowTitle: undefined },
          approvals,
          signal,
        );
      },
    },
  });
  const result = await agent.run(
    `In Google Chrome window titled ${title}, type Capri desktop agent in the address bar. Do not press Enter or navigate. Leave the page field unchanged.`,
  );
  const final = await callApplicationBridge(root, { action: 'computer_state' });
  console.log(
    JSON.stringify({
      fixtureResult: result,
      actions,
      fields: final.untrustedControls.filter((c) => c.editable),
    }),
  );
  assert.equal(final.windowId, windowId);
  assert(final.untrustedTitle.includes(title), 'The local data page must remain open.');
  assert(final.untrustedControls.some((c) => c.untrustedValue === 'Capri desktop agent'));
  assert(
    final.untrustedControls.some(
      (c) => c.untrustedName === 'Fixture page field' && c.untrustedValue === 'unchanged',
    ),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return { result, actions, ownerTabsTouched: false, searchSubmitted: false };
}
