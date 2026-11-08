// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';

function fixture({
  verified = true,
  ambiguous = false,
  abortLaunch = false,
  semanticLaunch = false,
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
          code: 'COMPUTER_APPLICATION_UNAVAILABLE',
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

test('an explicit launch works when Capri is the only available window, including Spanish requests', async () => {
  for (const goal of [
    'Open Spotify.',
    'Открой Spotify.',
    'Abre Spotify.',
    'Por favor, inicia Spotify.',
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
  for (const goal of ['Ouvre Spotify.', 'Spotifyを開いてください。', 'Abra Spotify.']) {
    const { agent, calls } = fixture({ semanticLaunch: true });
    const result = await agent.run(goal);
    assert.equal(result.status, 'needs_user');
    assert.equal(calls.filter((action) => action === 'launch').length, 1);
    assert(calls.lastIndexOf('observe') > calls.indexOf('launch'));
  }
});

test('a chained launch continues only after observing the newly opened application', async () => {
  const { agent, calls } = fixture();
  const result = await agent.run('Open Spotify, then click the search field.');
  assert.equal(result.status, 'needs_user');
  assert(calls.lastIndexOf('observe') > calls.indexOf('launch'));
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

test('a requested website can bootstrap direct navigation without an existing input window', async () => {
  const f = fixture({ ambiguous: true });
  let opened = false;
  f.agent.applications.findApplications = async () => [];
  f.agent.applications.execute = async (_id, args) => {
    assert.equal(args.action, 'open_url');
    assert.equal(args.url, 'https://www.youtube.com/');
    opened = true;
    return { ok: true, navigationRequested: true, windowId: '42' };
  };
  f.control.execute = async ({ action }) => {
    assert.equal(action, 'observe');
    if (!opened)
      throw Object.assign(new Error('No application.'), {
        code: 'COMPUTER_APPLICATION_UNAVAILABLE',
      });
    return {
      window: { windowId: '42', untrustedTitle: 'YouTube' },
      targets: [{ browserAddress: true, untrustedValue: 'https://www.youtube.com/' }],
    };
  };
  f.agent.plan = async () =>
    opened
      ? { action: 'finish', evidence: 'YouTube', summary: 'Opened YouTube.' }
      : { action: 'open_url', query: 'Google Chrome', url: 'https://www.youtube.com/' };
  const result = await f.agent.run('Open YouTube.');
  assert.equal(result.ok, true);
  assert.equal(result.steps, 1);
  assert.equal(f.control.session, null);
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
