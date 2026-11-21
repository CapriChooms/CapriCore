// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';
import { ComputerControl } from '../apps/desktop/computer-control.mjs';

test('an indicator geometry failure reports why computer control stopped before performing input', async () => {
  const geometry = {
    expected: { x: 0, y: 0, width: 1280, height: 720 },
    actual: { x: 0, y: 0, width: 1280, height: 680 },
    scaleFactor: 1.5,
  };
  const control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    bridge: () => assert.fail('Input must wait for a verified indicator'),
    registerEscape: () => true,
    unregisterEscape: () => {},
    showBorder: async () => {
      throw Object.assign(new Error('Overlay geometry'), {
        code: 'COMPUTER_INDICATOR_BOUNDS_FAILED',
        geometry,
      });
    },
    hideBorder: () => {},
  });
  const agent = new ComputerAgent({
    control,
    plan: () => assert.fail('Planning must wait for a verified indicator'),
    language: () => 'en',
  });
  const result = await agent.run('Open Notepad.');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.steps, 0);
  assert.match(result.summary, /indicator frame did not match the display bounds/);
  assert.equal(agent.diagnostics().lastOutcome.reason, 'indicator_bounds_failed');
  assert.deepEqual(agent.diagnostics().lastFailure.geometry, geometry);
  assert.equal(control.snapshot().active, false);
});

test('Escape registration failure has a specific reply and reports that zero actions ran', async () => {
  const control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    registerEscape: () => false,
    unregisterEscape: () => {},
    showBorder: () => assert.fail('No indicator may start without its emergency stop'),
    hideBorder: () => {},
  });
  const agent = new ComputerAgent({ control, language: () => 'en' });
  const result = await agent.run('Create a text file in Downloads.');
  assert.equal(result.steps, 0);
  assert.match(result.summary, /Escape emergency stop was unavailable/);
  assert.equal(agent.diagnostics().lastOutcome.reason, 'escape_unavailable');
  assert.equal(control.snapshot().active, false);
});

function fixture({
  verified = true,
  ambiguous = false,
  abortLaunch = false,
  semanticLaunch = false,
  observationError = 'COMPUTER_APPLICATION_UNAVAILABLE',
} = {}) {
  const calls = [],
    controller = new AbortController();
  let launched = false;
  const control = {
    session: null,
    async begin() {
      this.session = { controller };
    },
    requireSession() {
      controller.signal.throwIfAborted();
    },
    async stop() {
      this.session = null;
    },
    async execute({ action }) {
      calls.push(action);
      if (!launched)
        throw Object.assign(new Error('No controllable application.'), {
          code: observationError,
        });
      assert.equal(action, 'observe', 'No input can use a missing observation');
      return { window: { windowId: '42', untrustedTitle: 'Owned application' }, targets: [] };
    },
  };
  const agent = new ComputerAgent({
    control,
    applications: {
      async findApplications() {
        return ambiguous ? [{ name: 'Spotify' }, { name: 'Spotify' }] : [{ name: 'Spotify' }];
      },
      async execute(_id, args) {
        assert.equal(args.action, 'launch');
        calls.push('launch');
        launched = true;
        if (abortLaunch) controller.abort();
        return {
          ok: true,
          focused: verified,
          windowVerified: verified,
          windowId: verified ? '42' : undefined,
        };
      },
    },
    plan: async ({ currentObservation }) => {
      if (semanticLaunch && currentObservation.observationUnavailable)
        return { action: 'launch', query: 'Spotify', summary: '' };
      if (currentObservation.observationUnavailable)
        return { action: 'click', targetId: 'invented', summary: 'Unsafe invented input' };
      return { action: 'ask_user', summary: 'Owned target is now observable.' };
    },
    maxDecisions: 5,
  });
  return { agent, control, calls };
}

test('an explicit launch works when Capri is the only available window, including Spanish and French requests', async () => {
  for (const goal of [
    'Open Spotify.',
    'Открой Spotify.',
    'Abre Spotify.',
    'Por favor, inicia Spotify.',
    'Ouvre Spotify.',
  ]) {
    const { agent, control, calls } = fixture();
    const result = await agent.run(goal);
    assert.equal(result.status, 'completed', goal);
    assert.equal(result.verified, true);
    assert.equal(calls.filter((action) => action === 'launch').length, 1);
    assert.equal(control.session, null);
  }
});

test('the semantic planner can bootstrap other languages, but must observe the real app before continuing', async () => {
  for (const goal of ['Spotifyを開いてください。', 'Abra Spotify.']) {
    const { agent, calls } = fixture({ semanticLaunch: true });
    const result = await agent.run(goal);
    assert.equal(result.status, 'needs_user');
    assert.equal(calls.filter((action) => action === 'launch').length, 1);
    assert(calls.lastIndexOf('observe') > calls.indexOf('launch'));
  }
});

test('a localized Steam launch or library request never becomes a browser search', async () => {
  for (const [matches, verified, library, expected] of [
    [0, true, false, 'needs_user'],
    [2, true, true, 'needs_user'],
    [1, false, false, 'needs_user'],
    [1, true, false, 'completed'],
    [1, true, true, 'completed'],
  ]) {
    const f = fixture({ verified });
    f.agent.applications.findApplications = async (query, _signal, options) => {
      assert.equal(options.exact, true);
      if (query === 'la bibliothèque Steam') return [];
      assert.equal(query, 'Steam');
      return Array.from({ length: matches }, () => ({ name: 'Steam' }));
    };
    f.agent.plan = async () => assert.fail('A Steam client request must not run a web plan');
    f.agent.plan.outline = f.agent.plan;
    const observe = f.control.execute.bind(f.control);
    let clicked = false;
    f.control.execute = async (args) => {
      if (args.action === 'click') {
        assert.equal(args.targetId, 'library');
        assert.equal(args.observationId, 'steam-ui');
        clicked = true;
        return { ok: true };
      }
      const view = await observe(args);
      return {
        ...view,
        observationId: 'steam-ui',
        targets: [
          {
            targetId: 'library',
            untrustedLabel: 'Bibliothèque',
            role: 'ControlType.TabItem',
            selected: clicked,
          },
        ],
      };
    };
    f.agent.applications.operation = async (_id, _args, invoke) => invoke();
    const result = await f.agent.run(library ? 'Ouvre la bibliothèque Steam.' : 'Ouvre Steam.');
    assert.equal(
      result.status,
      expected,
      JSON.stringify({ matches, verified, library, result, diagnostics: f.agent.diagnostics() }),
    );
    assert.equal(f.calls.filter((action) => action === 'launch').length, Number(matches === 1));
    assert.equal(clicked, library && expected === 'completed');
  }
});

test('a chained launch continues only after observing the newly opened application', async () => {
  const { agent, calls } = fixture();
  const result = await agent.run('Open Spotify, then click the search field.');
  assert.equal(result.status, 'needs_user');
  assert(calls.lastIndexOf('observe') > calls.indexOf('launch'));
});

test('a named launch can establish a new observation when Windows rejects the initial foreground', async () => {
  const { agent, calls } = fixture({ observationError: 'COMPUTER_FOREGROUND_CHANGED' });
  const result = await agent.run('Open Spotify, then click the search field.');
  assert.equal(result.status, 'needs_user');
  assert.deepEqual(calls, ['observe', 'launch', 'observe']);
});

test('missing observations never authorize guessed clicks, ambiguous launch targets, or false completion', async () => {
  for (const options of [{ ambiguous: true }, { verified: false }, { abortLaunch: true }]) {
    const { agent, control, calls } = fixture(options);
    if (options.abortLaunch)
      await assert.rejects(agent.run('Open Spotify.'), { name: 'AbortError' });
    else assert.notEqual((await agent.run('Open Spotify.')).status, 'completed');
    assert.equal(control.session, null);
    assert(!calls.includes('click'));
    assert(calls.filter((action) => action === 'launch').length <= 1);
  }
});

test('opening YouTube works without a model or an existing input window', async () => {
  for (const goal of ['Open YouTube', 'Capre use full computer access and open YouTube.']) {
    const f = fixture({ ambiguous: true });
    let sent = 0;
    let browserStillOpening = true;
    f.agent.applications.findApplications = async (query) =>
      query === 'Microsoft Edge' ? [{ name: query, executable: 'C:/Browser/msedge.exe' }] : [];
    f.agent.applications.execute = async (_id, args) => {
      assert.equal(args.action, 'open_url');
      assert.equal(args.query, 'Microsoft Edge');
      assert.equal(args.url, 'https://www.youtube.com/');
      sent++;
      return { ok: true, navigationRequested: true, windowId: '42' };
    };
    f.control.execute = async (args) => {
      assert.deepEqual(args, { action: 'observe', vision: false });
      if (!sent)
        throw Object.assign(new Error('No application.'), {
          code: 'COMPUTER_APPLICATION_UNAVAILABLE',
        });
      if (browserStillOpening) {
        browserStillOpening = false;
        throw Object.assign(new Error('The browser is still opening.'), {
          code: 'COMPUTER_FOREGROUND_CHANGED',
        });
      }
      return {
        window: { windowId: '42', untrustedTitle: 'YouTube' },
        targets: [{ browserAddress: true, untrustedValue: 'https://www.youtube.com/' }],
      };
    };
    f.agent.plan = async () => assert.fail('A home-page request must not use a model step');
    f.agent.plan.outline = async () => assert.fail('A home-page request must not need an outline');
    const result = await f.agent.run(goal);
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(result.steps, 1);
    assert.equal(sent, 1);
    assert.equal(f.control.session, null);
  }
});

test('unavailable observations cannot bootstrap typing into an owner-selected existing tab', async () => {
  const f = fixture();
  f.agent.applications.execute = async () => assert.fail('No unobserved tab may receive input');
  const result = await f.agent.applicationStep(
    { action: 'open_url', query: 'Google Chrome', url: 'https://www.youtube.com/' },
    'Open YouTube in the current tab.',
    { observationUnavailable: true, targets: [] },
    new AbortController().signal,
  );
  assert.equal(result.needsWindow, true);
  assert.equal(result.inputPerformed, false);
});
