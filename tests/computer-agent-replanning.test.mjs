// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';
import { computerActionSchema } from '../apps/desktop/computer-planner.mjs';

const checkpoint = (id, label, successCriterion) => ({ id, label, successCriterion });
const site = checkpoint('site', 'Open the requested site', 'The requested page is visible');
const button = (key, untrustedLabel, extra = {}) => ({
  key,
  untrustedLabel,
  role: 'ControlType.Button',
  ...extra,
});
const address = (value) => ({
  key: 'address',
  untrustedLabel: 'Address and search bar',
  untrustedValue: value,
  editable: true,
  browserAddress: true,
  focused: false,
});

// No native application or input is involved. Every target ID belongs to the
// latest stub observation, just as the real control boundary requires.
function fixture({ view, plan, input = async () => ({ ok: true }), application }) {
  const calls = [],
    applicationCalls = [],
    contexts = [];
  let revision = 0,
    latest;
  const control = {
    session: null,
    async begin() {
      this.session = { controller: new AbortController() };
    },
    requireSession() {
      assert(this.session, 'An active session is required');
      this.session.controller.signal.throwIfAborted();
      return this.session;
    },
    async stop() {
      this.session?.controller.abort();
      this.session = null;
    },
    async execute(args, signal) {
      signal?.throwIfAborted();
      calls.push(args);
      if (args.action === 'observe') {
        const state = view();
        const observationId = String(++revision);
        latest = {
          ...state,
          observationId,
          targets: (state.targets ?? []).map(({ key, ...target }) => ({
            ...target,
            targetId: `${observationId}:${key}`,
          })),
        };
        return latest;
      }
      if (args.targetId) assert(latest.targets.some((target) => target.targetId === args.targetId));
      return input(args, latest, control);
    },
  };
  const agent = new ComputerAgent({
    control,
    maxDecisions: 8,
    plan: async (context, options) => {
      contexts.push({ context, review: options.review === true });
      return plan(context, options, control);
    },
    applications: {
      operation: (_id, _args, run) => run(),
      execute: async (_id, args, _approval, signal) => {
        signal.throwIfAborted();
        applicationCalls.push(args);
        assert(application, 'No application operation was expected');
        return application(args);
      },
    },
  });
  return { agent, control, calls, applicationCalls, contexts };
}

test('a launch with multiple verified windows activates one before continuing remaining work', async () => {
  let stage = 0;
  const opening = checkpoint('paint', 'Open Paint', 'Paint is in the foreground');
  const menu = checkpoint('file', 'Open the requested File menu', 'Recent files are visible');
  const f = fixture({
    view: () => ({
      window: {
        windowId: stage ? '101' : '1',
        untrustedTitle: stage ? 'Untitled - Paint' : 'Desktop',
      },
      targets:
        stage === 1
          ? [button('file', 'File')]
          : stage === 2
            ? [button('recent', 'Recent files')]
            : [],
    }),
    application: async (args) => {
      assert.equal(args.action, 'launch');
      assert.equal(args.query, 'Paint');
      if (!args.windowId)
        return {
          ok: true,
          needsWindow: true,
          inputPerformed: false,
          windows: [{ windowId: '101' }, { windowId: '102' }],
        };
      assert.equal(args.windowId, '101');
      stage = 1;
      return { ok: true, windowId: '101', focused: true };
    },
    input: async (args, view) => {
      assert.equal(args.action, 'click');
      assert.equal(
        view.targets.find((target) => target.targetId === args.targetId).untrustedLabel,
        'File',
      );
      stage = 2;
      return { ok: true };
    },
    plan: async ({ currentObservation, taskPlan }) => {
      if (!stage) return { action: 'launch', query: 'Paint', plan: [opening, menu] };
      if (stage === 1) {
        assert.deepEqual(
          taskPlan.completedCheckpoints,
          [],
          'An activation receipt is not a milestone proof',
        );
        return {
          action: 'click',
          targetId: currentObservation.targets[0].targetId,
          verifiedCheckpoints: [{ id: 'paint', evidence: 'Paint' }],
        };
      }
      return {
        action: 'finish',
        evidence: 'Recent files',
        summary: 'Opened the File menu.',
        verifiedCheckpoints: [{ id: 'file', evidence: 'Recent files' }],
      };
    },
  });
  const result = await f.agent.run('Open Paint and click File.');
  assert.equal(result.ok, true);
  assert.equal(
    f.applicationCalls.length,
    2,
    'Only a verified side-effect-free window selection is retried',
  );
  assert.equal(f.calls.filter((call) => call.action === 'click').length, 1);
  assert.equal(f.control.session, null);
});

test('ambiguous draft typing requests owner selection before any input reaches a window', async () => {
  const f = fixture({
    view: () => ({
      window: { windowId: '1', untrustedTitle: 'Desktop' },
      targets: [
        button('chrome-one', 'Chrome - First window', { surface: 'taskbar' }),
        button('chrome-two', 'Chrome - Second window', { surface: 'taskbar' }),
      ],
    }),
    application: async (args) => {
      assert.equal(args.action, 'browser_input');
      assert.equal(args.windowId, undefined);
      return {
        ok: true,
        needsWindow: true,
        inputPerformed: false,
        windows: [{ windowId: '101' }, { windowId: '102' }],
      };
    },
    input: async () =>
      assert.fail('Ambiguous draft input must not select a window or submit Enter'),
    plan: async () => ({ action: 'browser_input', query: 'Google Chrome', text: 'Capri' }),
  });
  assert.equal(
    (await f.agent.run('Type Capri in Chrome address bar without submitting.')).status,
    'needs_user',
  );
  assert.equal(f.applicationCalls.length, 1);
  assert.equal(f.contexts.length, 1);
  assert(f.calls.every((call) => call.action === 'observe'));
  assert.equal(f.control.session, null);
});

test(
  'a cookie modal interrupts navigation waiting and revises the remaining plan without replaying navigation',
  { timeout: 5000 },
  async () => {
    let stage = 0,
      blockedReads = 0;
    const overlay = checkpoint(
      'overlay',
      'Dismiss the blocking cookie dialog',
      'The main page is accessible',
    );
    const f = fixture({
      view: () => {
        if (stage === 1) {
          assert(
            ++blockedReads <= 2,
            'A visible blocker must return to planning before the loading deadline',
          );
          return {
            window: {
              windowId: '10',
              untrustedTitle: 'Before you continue to Google',
              modal: true,
            },
            targets: [
              address('https://consent.google.com/'),
              button('cookies', 'Cookies and privacy'),
              button('close', 'Close'),
            ],
          };
        }
        return {
          window: { windowId: '10', untrustedTitle: stage ? 'Google' : 'New Tab' },
          targets: [
            address(stage ? 'https://www.google.com/' : 'about:blank'),
            button('search', 'Search'),
          ],
        };
      },
      application: async (args) => {
        assert.equal(args.action, 'open_url');
        assert.equal(args.url, 'https://www.google.com/');
        stage = 1;
        return { ok: true, navigationRequested: true, windowId: '10' };
      },
      input: async (args, view) => {
        assert.equal(args.action, 'click');
        assert.equal(
          view.targets.find((target) => target.targetId === args.targetId).untrustedLabel,
          'Close',
        );
        stage = 2;
        return { ok: true };
      },
      plan: async ({ currentObservation, correction, taskPlan }) => {
        if (!stage)
          return {
            action: 'open_url',
            query: 'Google Chrome',
            url: 'https://www.google.com/',
            plan: [site],
          };
        if (stage === 1) {
          assert.match(correction, /already been requested|not verified/u);
          assert.equal(taskPlan.needsRevision, true);
          assert.deepEqual(taskPlan.completedCheckpoints, []);
          return {
            action: 'click',
            targetId: currentObservation.targets.find((target) => target.untrustedLabel === 'Close')
              .targetId,
            plan: [overlay, site],
          };
        }
        return {
          action: 'finish',
          evidence: 'Google',
          summary: 'Google is open.',
          verifiedCheckpoints: [
            { id: 'overlay', evidence: 'Google' },
            { id: 'site', evidence: 'Google' },
          ],
        };
      },
    });
    const result = await f.agent.run('Open https://www.google.com/.');
    assert.equal(result.ok, true);
    assert.equal(f.applicationCalls.length, 1);
    assert.equal(f.calls.filter((call) => call.action === 'click').length, 1);
    assert.equal(f.agent.diagnostics().plan.revision, 2);
    assert.equal(f.agent.diagnostics().plan.completed, 2);
    assert.equal(f.agent.taskPlan, null, 'Only counts survive after a task, not private notes');
  },
);

test('a foreground change during navigation restores the observed browser and verifies the already requested page', async () => {
  let stage = 0;
  const f = fixture({
    view: () =>
      stage === 1
        ? {
            window: { windowId: '20', untrustedTitle: 'Notes' },
            targets: [button('chrome', 'Google Chrome', { surface: 'taskbar' })],
          }
        : {
            window: { windowId: '10', untrustedTitle: stage ? 'Example Domain' : 'New Tab' },
            targets: [address(stage ? 'https://example.com/' : 'about:blank')],
          },
    application: async (args) => {
      assert.equal(args.action, 'open_url');
      stage = 1;
      return { ok: true, navigationRequested: true, windowId: '10' };
    },
    input: async (args, view) => {
      assert.equal(args.action, 'click');
      assert.equal(view.targets[0].surface, 'taskbar');
      stage = 2;
      return { ok: true };
    },
    plan: async ({ currentObservation, correction, taskPlan }) => {
      if (!stage)
        return {
          action: 'open_url',
          query: 'Google Chrome',
          url: 'https://example.com/',
          plan: [site],
        };
      if (stage === 1) {
        assert.match(correction, /window_changed/u);
        assert.equal(taskPlan.needsRevision, true);
        return { action: 'click', targetId: currentObservation.targets[0].targetId };
      }
      return {
        action: 'finish',
        evidence: 'Example Domain',
        summary: 'The requested page is open.',
        verifiedCheckpoints: [{ id: 'site', evidence: 'Example Domain' }],
      };
    },
  });
  assert.equal((await f.agent.run('Open https://example.com/.')).ok, true);
  assert.equal(
    f.applicationCalls.length,
    1,
    'Restoring focus must not resubmit delivered navigation',
  );
  assert.equal(f.calls.filter((call) => call.action === 'click').length, 1);
});

for (const { search, crossAction } of [
  { search: false, crossAction: false },
  { search: true, crossAction: false },
  { search: false, crossAction: true },
  { search: true, crossAction: true },
])
  test(
    crossAction
      ? `a pending ${search ? 'browser_search' : 'open_url'} cannot replay through ${search ? 'open_url' : 'browser_search'} with an equivalent Google query`
      : `a pending ${search ? 'search query' : 'URL with equivalent www, query order and hash'} is not dispatched again during recovery`,
    async () => {
      let stage = 0;
      const query = crossAction ? 'ＣＡＰＲＩ   results' : 'Capri';
      const requested = crossAction
        ? 'https://www.google.com/search?q=' + encodeURIComponent(query)
        : 'https://www.example.com/?b=2&a=1';
      const f = fixture({
        view: () => ({
          window: {
            windowId: '10',
            untrustedTitle:
              stage === 1 ? 'Cookie dialog' : stage ? 'Capri results - Example Domain' : 'New Tab',
            modal: stage === 1,
          },
          targets: [
            address(
              stage === 1
                ? 'https://consent.google.com/'
                : stage
                  ? search || crossAction
                    ? 'https://www.google.com/search?q=' + encodeURIComponent(query)
                    : 'https://www.example.com/?a=1&b=2'
                  : 'about:blank',
            ),
            button('close', 'Close'),
          ],
        }),
        application: async (args) => {
          assert.equal(args.action, 'open_url');
          stage = 1;
          return { ok: true, navigationRequested: true, windowId: '10' };
        },
        input: async (args, view) => {
          assert.equal(args.action, 'click');
          assert.equal(
            view.targets.find((target) => target.targetId === args.targetId).untrustedLabel,
            'Close',
          );
          stage = 2;
          return { ok: true };
        },
        plan: async ({ currentObservation, correction }) => {
          if (!stage)
            return search
              ? { action: 'browser_search', query: 'Google Chrome', text: query, plan: [site] }
              : { action: 'open_url', query: 'Google Chrome', url: requested, plan: [site] };
          if (stage === 1) {
            if (!correction.includes('It was not sent again'))
              return (crossAction ? !search : search)
                ? {
                    action: 'browser_search',
                    query: 'Google Chrome',
                    text: crossAction ? ' capri  results ' : '  capri  ',
                  }
                : {
                    action: 'open_url',
                    query: 'Google Chrome',
                    url: crossAction
                      ? 'https://google.com/search?q=' +
                        encodeURIComponent(' capri  results ') +
                        '#home'
                      : 'https://example.com/?a=1&b=2#home',
                  };
            return {
              action: 'click',
              targetId: currentObservation.targets.find(
                (target) => target.untrustedLabel === 'Close',
              ).targetId,
            };
          }
          return {
            action: 'finish',
            evidence: 'Capri results',
            summary: 'The requested page is open.',
            verifiedCheckpoints: [{ id: 'site', evidence: 'Capri results' }],
          };
        },
      });
      const result = await f.agent.run(search ? `Google ${query}.` : `Open ${requested}`);
      assert.equal(result.ok, true);
      assert.equal(
        f.applicationCalls.length,
        1,
        'A pending delivered navigation must not be replayed',
      );
      assert.equal(f.calls.filter((call) => call.action === 'click').length, 1);
      assert.equal(
        f.agent.trace.filter((entry) => entry.outcome === 'pending_navigation_not_replayed').length,
        1,
      );
    },
  );

for (const search of [false, true])
  test(`an observed network failure permits retrying the same ${search ? 'search' : 'URL'} once`, async () => {
    let stage = 0;
    const requested = search ? 'https://www.google.com/search?q=Capri' : 'https://example.com/';
    const navigation = search
      ? { action: 'browser_search', query: 'Google Chrome', text: 'Capri' }
      : { action: 'open_url', query: 'Google Chrome', url: requested };
    const f = fixture({
      view: () => ({
        window: {
          windowId: '10',
          untrustedTitle:
            stage === 1
              ? 'This site cannot be reached'
              : stage
                ? 'Capri results - Example Domain'
                : 'New Tab',
        },
        targets: [
          address(stage ? requested : 'about:blank'),
          ...(stage === 1 ? [button('network', 'ERR_CONNECTION_RESET')] : []),
        ],
      }),
      application: async (args) => {
        assert.equal(args.action, 'open_url');
        assert.equal(args.url, requested);
        stage++;
        return { ok: true, navigationRequested: true, windowId: '10' };
      },
      input: async () => assert.fail('A confirmed page-load retry does not need arbitrary input'),
      plan: async ({ currentObservation, correction }) => {
        if (!stage) return { ...navigation, plan: [site] };
        if (stage === 1) {
          assert(
            currentObservation.targets.some(
              (target) => target.untrustedLabel === 'ERR_CONNECTION_RESET',
            ),
          );
          assert.match(correction, /network/u);
          return navigation;
        }
        return {
          action: 'finish',
          evidence: 'Capri results',
          summary: 'The requested page loaded after a confirmed network failure.',
          verifiedCheckpoints: [{ id: 'site', evidence: 'Capri results' }],
        };
      },
    });
    const result = await f.agent.run(search ? 'Google Capri.' : `Open ${requested}`);
    assert.equal(result.ok, true);
    assert.equal(
      f.applicationCalls.length,
      2,
      'Retry is allowed only after the observed network error',
    );
    assert(f.calls.every((call) => call.action === 'observe'));
    assert(!f.agent.trace.some((entry) => entry.outcome === 'pending_navigation_not_replayed'));
  });

test('recovery never replays input after dispatch whose receipt is uncertain', async () => {
  let stage = 0,
    attempts = 0,
    delivered = 0;
  const f = fixture({
    view: () => ({
      window: { windowId: '30', untrustedTitle: stage ? 'Ready draft' : 'Draft' },
      targets: [button('draft', 'Draft', { editable: true, untrustedValue: '' })],
    }),
    input: async (args) => {
      assert.equal(args.action, 'enter_text');
      if (++attempts === 1) {
        stage = 1;
        throw Object.assign(new Error('No text was sent.'), {
          code: 'COMPUTER_FIELD_STALE',
          inputPerformed: false,
        });
      }
      delivered++;
      throw Object.assign(new Error('The native receipt was lost after input.'), {
        inputPerformed: true,
      });
    },
    plan: async ({ currentObservation, taskPlan }) => {
      if (stage) assert.equal(taskPlan.needsRevision, true);
      return {
        action: 'enter_text',
        targetId: currentObservation.targets[0].targetId,
        text: 'Capri',
      };
    },
  });
  const result = await f.agent.run('Type Capri in the draft.');
  assert.equal(result.status, 'incomplete');
  assert.equal(attempts, 2, 'Only the explicit no-input preflight rejection may be retried');
  assert.equal(delivered, 1);
  assert.equal(f.contexts.length, 2, 'An uncertain dispatch must stop before another plan');
  assert.equal(f.control.session, null);
});

test('Escape during recovery planning cancels the returned action and releases the session', async () => {
  let stage = 0;
  const f = fixture({
    view: () => ({
      window: {
        windowId: '30',
        untrustedTitle: stage ? 'Blocking dialog' : 'Editor',
        modal: stage === 1,
      },
      targets: [button(stage ? 'close' : 'save', stage ? 'Close' : 'Save')],
    }),
    input: async (args) => {
      assert.equal(args.action, 'click');
      stage = 1;
      throw Object.assign(new Error('Another control covers the target; no click was sent.'), {
        code: 'COMPUTER_TARGET_COVERED',
        inputPerformed: false,
      });
    },
    plan: async ({ currentObservation, taskPlan }, _options, control) => {
      if (stage) {
        assert.equal(taskPlan.needsRevision, true);
        control.session.controller.abort(); // Same session cancellation used by Escape.
      }
      return { action: 'click', targetId: currentObservation.targets[0].targetId };
    },
  });
  await assert.rejects(f.agent.run('Click Save.'), { name: 'AbortError' });
  assert.equal(f.calls.filter((call) => call.action === 'click').length, 1);
  assert.equal(f.contexts.length, 2);
  assert.equal(f.control.session, null);
  assert.equal(f.agent.running, false);
});

test('the first decision requires a bounded checkpoint chain while subsequent decisions can omit unchanged metadata', () => {
  const view = { targets: [{ targetId: 'current', untrustedLabel: 'Observed control' }] };
  const evidence = { type: 'string', enum: ['Observed control'] };
  const first = computerActionSchema({ ...view, taskPlan: { revision: 0 } }, evidence);
  for (const branch of first.anyOf) {
    assert(
      branch.required.includes('plan'),
      `${branch.properties.action.const} needs an initial plan`,
    );
    assert.equal(branch.properties.plan.maxItems, 8);
    assert.equal(branch.properties.plan.minItems, 1);
    assert.equal(branch.properties.plan.items.additionalProperties, false);
    assert.deepEqual(branch.properties.plan.items.required.toSorted(), [
      'id',
      'label',
      'successCriterion',
    ]);
  }
  const following = computerActionSchema({ ...view, taskPlan: { revision: 1 } }, evidence);
  for (const branch of following.anyOf) {
    assert(
      !branch.required.includes('plan'),
      'An unchanged plan must not be regenerated every step',
    );
    assert(branch.properties.plan);
    assert(branch.properties.verifiedCheckpoints);
  }
  const legacy = computerActionSchema(view, evidence);
  assert(legacy.anyOf.every((branch) => !branch.required.includes('plan')));
  const pending = computerActionSchema(
    {
      ...view,
      taskPlan: {
        revision: 1,
        completedCheckpoints: [{ id: 'browser' }],
        remainingCheckpoints: [site],
      },
    },
    evidence,
  );
  for (const branch of pending.anyOf)
    assert.deepEqual(branch.properties.verifiedCheckpoints.items.properties.id.enum, [
      'browser',
      'site',
    ]);
  const finish = pending.anyOf.find((branch) => branch.properties.action.const === 'finish');
  assert(finish.required.includes('verifiedCheckpoints'));
  assert.equal(finish.properties.verifiedCheckpoints.minItems, 1);
});
