// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';
import { computerPlanner, computerActionSchema } from '../apps/desktop/computer-planner.mjs';
import { ChatService } from '../apps/desktop/chat-service.mjs';
import { steamGameGoal, steamMilestones } from '../apps/desktop/steam-task-state.mjs';
import { cyberpunkSteamLaunch, steamGameLauncher } from '../apps/desktop/steam-game-launch.mjs';
import { edgerunnersPages, edgerunnersTeaserRequest } from '../apps/desktop/edgerunners-teaser.mjs';
import {
  browserSearchState,
  browserPageState,
  browserNavigationState,
  requiresPageSearch,
} from '../apps/desktop/browser-search-state.mjs';

test('an authorized Cyberpunk request hands the fixed AppID to Steam without a plan or a click', async () => {
  for (const text of [
    'Do not launch Cyberpunk 2077.',
    'How do I launch Cyberpunk 2077?',
    'Launch Cyberpunk 2077 from GOG.',
    'Launch Cyberpunk 2077 and then open Discord.',
    'Open Steam, go to Cyberpunk 2077 and click Play, then open Discord.',
    'Launch another game in Steam.',
  ])
    assert.equal(cyberpunkSteamLaunch(text), false, text);
  for (const state of ['installed', 'running', 'not-installed', 'client-unavailable', 'revoked']) {
    const opened = [];
    const control = {
      session: null,
      async begin() {
        this.session = { controller: new AbortController() };
      },
      requireSession() {
        if (state === 'revoked') throw new Error('Access was revoked.');
      },
      async stop() {
        this.session = null;
      },
      async execute() {
        assert.fail('The Steam handoff does not use mouse or keyboard input');
      },
    };
    const agent = new ComputerAgent({
      control,
      launchSteamGame: steamGameLauncher({
        readState: async () =>
          ['client-unavailable', 'revoked'].includes(state) ? 'installed' : state,
        openExternal: async (uri) => {
          opened.push(uri);
          if (state === 'client-unavailable') throw new Error('No registered protocol handler');
        },
      }),
      plan: async () => assert.fail('The Steam handoff does not require an LLM'),
    });
    const result = await agent.run('Use my computer and turn on Cyberpunk’s 2077 please.');
    assert.equal(
      result.status,
      state === 'installed' ? 'submitted' : state === 'running' ? 'completed' : 'incomplete',
    );
    assert.deepEqual(
      opened,
      ['installed', 'client-unavailable'].includes(state) ? ['steam://rungameid/1091500'] : [],
    );
    assert.equal(control.session, null);
  }
});

test('an exact foreground-verified application can open without a model; chained goals continue with fresh controls', async () => {
  for (const single of [true, false]) {
    const controller = new AbortController();
    const calls = [];
    let launched = false;
    const control = {
      session: null,
      async begin() {
        this.session = { controller };
      },
      async stop() {
        this.session = null;
      },
      requireSession() {},
      async execute({ action }) {
        calls.push(action);
        return {
          window: {
            windowId: launched ? '42' : '1',
            untrustedTitle: launched ? 'Steam' : 'Desktop',
          },
          targets: launched ? [{ targetId: 'library', untrustedLabel: 'Library' }] : [],
        };
      },
    };
    const agent = new ComputerAgent({
      control,
      applications: {
        async findApplications(query, _signal, options) {
          assert.equal(query, 'steam');
          assert.equal(options.exact, true);
          return [{ name: 'Steam' }];
        },
        async execute(_id, args) {
          calls.push(args.action);
          launched = true;
          return { ok: true, focused: true, windowVerified: true, windowId: '42' };
        },
      },
      async plan(context) {
        assert.equal(single, false);
        assert.equal(context.currentObservation.window.windowId, '42');
        assert.equal(context.actualSteps[0].action, 'launch');
        return { action: 'ask_user', summary: 'Test reached the Library controls.' };
      },
    });
    const result = await agent.run(
      'useful computer access and open steam' + (single ? '.' : ' then go to my library.'),
    );
    assert.equal(result.status, single ? 'completed' : 'needs_user');
    assert.deepEqual(calls, single ? ['observe', 'launch'] : ['observe', 'launch', 'observe']);
  }
});

test('page-search wording excludes the toolbar and preserves explicit negative address-bar instructions', () => {
  assert(requiresPageSearch('Type Capri into the search bar, then open Images.'));
  assert(requiresPageSearch('Use the page search field. Do not use the address bar.'));
  assert(requiresPageSearch('Введи Капри в поле поиска. Не используй адресную строку.'));
  assert(!requiresPageSearch('Type Capri in the address bar.'));
});

test('a pending page query cannot finish or send keys before a real search field contains text', () => {
  const fields = [
    { targetId: 'unrelated', editable: true, untrustedLabel: 'Page field' },
    { targetId: 'images', untrustedLabel: 'Images', pageContent: true },
  ];
  let schema = computerActionSchema(
    { pageSearchRequired: true, pageQueryPending: true, targets: fields },
    { type: 'string' },
  );
  assert(
    !schema.anyOf.some((b) =>
      ['press_keys', 'finish', 'browser_input', 'click'].includes(b.properties.action.const),
    ),
  );
  fields.push({
    targetId: 'search',
    editable: true,
    browserSearch: true,
    focused: true,
    untrustedValue: 'Capri',
  });
  schema = computerActionSchema(
    { pageSearchRequired: true, pageQueryPending: true, targets: fields },
    { type: 'string' },
  );
  assert(schema.anyOf.some((b) => b.properties.action.const === 'press_keys'));
});

test('navigation accepts Chrome hiding www, while rejecting another site, port, path or requested query', () => {
  const target = { windowId: '123', navigationUrl: 'https://www.google.com/' };
  const view = {
    window: { windowId: '123', untrustedTitle: 'Google' },
    targets: [{ browserAddress: true, focused: false, untrustedValue: 'google.com' }],
  };
  assert.equal(browserNavigationState(view, target), 'ready');
  for (const address of [
    'https://google.com.evil.invalid/',
    'http://google.com/',
    'https://google.com:444/',
    'https://google.com/search',
  ]) {
    view.targets[0].untrustedValue = address;
    assert.equal(browserNavigationState(view, target), 'loading');
  }
  view.targets[0].untrustedValue = 'https://google.com/?q=wrong';
  assert.equal(
    browserNavigationState(view, { ...target, navigationUrl: 'https://google.com/?q=Capri' }),
    'loading',
  );
});

test('Netflix home verifies its browse redirect and reports login or profile selection', () => {
  const target = { windowId: '123', navigationUrl: 'https://www.netflix.com/' };
  const view = {
    window: { windowId: '123', untrustedTitle: 'Netflix' },
    targets: [{ browserAddress: true, focused: false, untrustedValue: 'netflix.com/browse' }],
  };
  assert.equal(browserNavigationState(view, target), 'ready');
  view.targets[0].untrustedValue = 'netflix.com/login';
  assert.equal(browserNavigationState(view, target), 'sign_in');
  view.targets[0].untrustedValue = 'netflix.com/ManageProfiles';
  assert.equal(browserNavigationState(view, target), 'profile');
  view.targets[0].untrustedValue = 'netflix.com.example.org/login';
  assert.equal(browserNavigationState(view, target), 'loading');
  const title = { ...target, navigationUrl: edgerunnersPages.netflix };
  view.targets[0].untrustedValue = 'netflix.com/se-en/title/81001476';
  assert.equal(browserNavigationState(view, title), 'loading');
  view.targets[0].untrustedValue = 'netflix.com/se-en/title/81054853';
  assert.equal(browserNavigationState(view, title), 'ready');
  view.targets[0].focused = true;
  assert.equal(browserNavigationState(view, title), 'loading');
});

test('an official web search is not blocked by a later Netflix step', async () => {
  const actions = [];
  const agent = new ComputerAgent({
    control: { requireSession() {} },
    applications: {
      execute: async (_id, args) => {
        actions.push(args);
        return { ok: true, windowId: '123', navigationRequested: true };
      },
    },
  });
  const step = { action: 'browser_search', query: 'Google Chrome', text: 'official show website' };
  const view = { targets: [] };
  const signal = new AbortController().signal;
  const result = await agent.applicationStep(
    step,
    'Open Chrome and search for the official show website. After that watch it on Netflix.',
    view,
    signal,
  );
  assert.equal(result.searchSubmitted, true);
  assert.equal(actions[0].action, 'open_url');
  assert.equal(new URL(actions[0].url).searchParams.get('q'), step.text);
  assert.equal(
    (await agent.applicationStep(step, 'Search for the show on Netflix.', view, signal)).ok,
    false,
  );
  assert.equal(actions.length, 1);
});

test('the Edgerunners workflow opens both verified pages, scrolls and clicks only the first season-two teaser', async () => {
  const goal =
    'Please use my computer to open Google Chrome and search for the official Cyberpunk Adrinas 2 website. After that watch it on Netflix, scroll down a bit and play the teaser.';
  for (const phrase of [
    goal,
    'открыть хром -> найти официальный сайт Cyberpung Edgerunners 2 -> посмотреть его на Netflix, scroll down, play the teaser',
  ])
    assert.equal(edgerunnersTeaserRequest(phrase), true);
  assert.equal(edgerunnersTeaserRequest(goal + ' Then open Discord.'), false);
  assert.equal(edgerunnersTeaserRequest('Do not ' + goal), false);
  for (const signIn of [false, true]) {
    const calls = [];
    let page,
      scrolled = false,
      playing = false;
    const control = {
      async begin() {
        this.session = { controller: new AbortController() };
      },
      async stop() {
        this.session = null;
      },
      requireSession() {
        assert.ok(this.session);
      },
      async execute(step) {
        if (step.action === 'observe') {
          const isNetflix = page === edgerunnersPages.netflix;
          const address = isNetflix && signIn ? 'https://www.netflix.com/se-en/login' : page;
          const button = (targetId, untrustedLabel) => ({
            targetId,
            untrustedLabel,
            pageContent: true,
            role: 'ControlType.Button',
          });
          return {
            observationId: 'fresh',
            window: { windowId: '123', untrustedTitle: 'Cyberpunk: Edgerunners 2' },
            targets: [
              { browserAddress: true, untrustedValue: address },
              ...(scrolled
                ? [
                    button('second', '1m 12s TEASER Teaser 2: Cyberpunk: Edgerunners 2'),
                    button('first', '1m 24s TEASER Teaser: Cyberpunk: Edgerunners 2'),
                    button('season-one', 'Teaser: Cyberpunk: Edgerunners'),
                  ]
                : []),
              ...(playing ? [button('pause', 'Pause')] : []),
            ],
          };
        }
        if (step.action === 'press_keys') {
          assert.equal(page, edgerunnersPages.netflix);
          assert.equal(step.observationId, 'fresh');
          assert.deepEqual(step.keys, ['PAGEDOWN']);
          scrolled = true;
        }
        if (step.action === 'click') {
          assert.equal(step.targetId, 'first');
          playing = true;
        }
        calls.push(step.action);
        return { ok: true };
      },
    };
    const agent = new ComputerAgent({
      control,
      plan: async () =>
        assert.fail('Known workflow must not ask a model to invent links or controls'),
      applications: {
        async execute(_id, args) {
          assert.equal(args.action, 'open_url');
          assert.equal(args.query, 'Google Chrome');
          page = args.url;
          calls.push(page);
          return { ok: true, navigationRequested: true, windowId: '123' };
        },
        operation: (_id, _args, run) => run(),
      },
    });
    const result = await agent.run(goal);
    assert.deepEqual(calls, [
      edgerunnersPages.official,
      edgerunnersPages.netflix,
      ...(signIn ? [] : ['press_keys', 'click']),
    ]);
    assert.equal(result.status, signIn ? 'needs_user' : 'completed');
    assert.equal(result.verified, !signIn);
  }
});

test('dense windows retain visual click targets and keep the observation within a bounded prompt', async () => {
  const targets = Array.from({ length: 140 }, (_, i) => ({
    targetId: 'ui-' + i,
    untrustedLabel: 'Decorative label ' + i + 'x'.repeat(90),
    untrustedValue: 'v'.repeat(500),
    role: 'ControlType.Text',
    editable: false,
    focused: false,
  }));
  targets.push({
    targetId: 'visible-image',
    source: 'vision',
    untrustedLabel: 'Actual image to open',
  });
  const plan = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body),
        payload = JSON.parse(body.messages[1].content.split('\n\nORIGINAL OWNER GOAL')[0]);
      assert(JSON.stringify(payload.currentObservation.targets).length < 12500);
      assert(payload.currentObservation.targets.some((t) => t.source === 'vision'));
      const target = payload.currentObservation.targets.find((t) => t.source === 'vision');
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({
            action: 'click',
            targetId: target.targetId,
            summary: 'Open the observed picture.',
          }),
        },
      });
    },
  });
  assert.equal(
    (
      await plan({
        originalOwnerGoal: 'Open the picture',
        currentObservation: { window: { untrustedTitle: 'Fixture' }, targets },
      })
    ).targetId,
    'visible-image',
  );
});

test('browser_search uses the observed page field, clicks/types through computer control and submits exactly once', async () => {
  const actions = [];
  const field = {
    targetId: 'page-field',
    editable: true,
    browserSearch: true,
    focused: true,
    untrustedValue: 'Capri',
  };
  const view = { window: { windowId: '123', untrustedTitle: 'Google' }, targets: [field] };
  const agent = new ComputerAgent({
    control: {
      requireSession() {},
      execute: async (args) => {
        actions.push(args);
        return args.action === 'observe' ? view : { ok: true, typed: true, windowId: '123' };
      },
    },
    applications: {
      execute: () => assert.fail('Page input must not fall back to the omnibox'),
      operation: (_id, _args, run) => run(),
    },
  });
  const result = await agent.applicationStep(
    { action: 'browser_search', query: 'Chrome', text: 'Capri' },
    'Use the search bar.',
    view,
    new AbortController().signal,
  );
  assert(result.searchSubmitted);
  assert.deepEqual(
    actions.map((a) => a.action),
    ['enter_text', 'observe', 'press_keys'],
  );
  assert.deepEqual(actions.at(-1).keys, ['ENTER']);
});

test('a missing page field loads Google home without claiming that the requested query was searched', async () => {
  const urls = [];
  const view = { window: { windowId: '123', untrustedTitle: 'New Tab' }, targets: [] };
  const agent = new ComputerAgent({
    control: {
      requireSession() {},
      execute: async () => assert.fail('Opening Google must not type a draft into the address bar'),
    },
    applications: {
      execute: async (_id, args) => {
        assert.equal(args.action, 'open_url');
        urls.push(args.url);
        return { ok: true, navigationRequested: true, windowId: '123' };
      },
      operation: (_id, _args, run) => run(),
    },
  });
  const result = await agent.applicationStep(
    { action: 'browser_search', query: 'Chrome', text: 'Capri' },
    'Use the search bar.',
    view,
    new AbortController().signal,
  );
  assert.deepEqual(urls, ['https://www.google.com/']);
  assert.equal(result.searchSubmitted, false);
  assert.equal(result.navigationUrl, 'https://www.google.com/');
  assert.equal(
    browserNavigationState(
      {
        window: { windowId: '123', untrustedTitle: 'Google' },
        targets: [{ browserAddress: true, untrustedValue: 'https://www.google.com/' }],
      },
      result,
    ),
    'ready',
  );
});

test('fullscreen is required by observed window state before a finish claim can succeed', async () => {
  const f = fixture(async () => ({
    action: 'finish',
    evidence: 'Owned test window',
    summary: 'Done.',
  }));
  const result = await f.agent.run('Show the picture in fullscreen.');
  assert.equal(result.ok, false);
  assert.equal(result.steps, 0);
});

test('only an explicit no-text-sent preflight failure may be replanned; uncertain input is never replayed', async () => {
  const f = fixture(async ({ currentObservation: view }) =>
    view.targets[0].untrustedValue === 'Capri'
      ? { action: 'finish', evidence: 'Capri', summary: 'Typed Capri.' }
      : {
          action: 'enter_text',
          targetId: view.targets[0].targetId,
          text: 'Capri',
          summary: 'Type Capri.',
        },
  );
  const execute = f.control.execute.bind(f.control);
  let attempts = 0;
  f.control.execute = async (args, signal) => {
    if (args.action === 'enter_text' && ++attempts === 1)
      throw Object.assign(new Error('No text was sent.'), {
        code: 'COMPUTER_FIELD_STALE',
        inputPerformed: false,
      });
    return execute(args, signal);
  };
  assert.equal((await f.agent.run('Type Capri.')).ok, true);
  assert.equal(attempts, 2);
  assert.equal(f.calls.filter((c) => c.action === 'enter_text').length, 1);
});

test('a foreground change rejected before input replans against a new observation', async () => {
  let plans = 0;
  const f = fixture(async ({ currentObservation: view, correction }) => {
    if (++plans === 2) assert.match(correction, /restore the intended app/);
    return view.targets[1].untrustedLabel === 'Saved draft'
      ? { action: 'finish', evidence: 'Saved draft', summary: 'Saved.' }
      : { action: 'click', targetId: view.targets[1].targetId };
  });
  const execute = f.control.execute.bind(f.control);
  let attempts = 0;
  f.control.execute = async (args, signal) => {
    if (args.action === 'click' && ++attempts === 1)
      throw Object.assign(new Error('The foreground changed before input.'), {
        code: 'COMPUTER_FOREGROUND_CHANGED',
        inputPerformed: false,
      });
    return execute(args, signal);
  };
  assert.equal((await f.agent.run('Click Save.')).ok, true);
  assert.equal(attempts, 2);
  assert.equal(f.calls.filter((call) => call.action === 'click').length, 1);
});

test('a verified launch with denied focus uses a unique observed Windows taskbar button', async () => {
  let activated = false;
  const f = fixture(async ({ actualSteps }) =>
    actualSteps.length
      ? { action: 'finish', evidence: 'Discord', summary: 'Discord is open.' }
      : { action: 'launch', query: 'Discord' },
  );
  f.agent.applications.execute = async () => ({ ok: true, focused: false, windowId: '456' });
  const execute = f.control.execute.bind(f.control);
  f.control.execute = async (args, signal) => {
    const result = await execute(args, signal);
    if (args.action === 'click') {
      assert.equal(args.targetId, 'discord-button');
      activated = true;
    }
    if (args.action === 'observe') {
      result.window = {
        windowId: activated ? '456' : '123',
        untrustedTitle: activated ? 'Discord' : 'Fixture',
      };
      result.targets.push({
        targetId: 'discord-button',
        surface: 'taskbar',
        untrustedLabel: 'Приложение Discord —1 запущенное окно закреплено',
      });
    }
    return result;
  };
  assert.equal((await f.agent.run('Open Discord.')).ok, true);
  assert.equal(f.calls.filter((call) => call.action === 'click').length, 1);
});

function fixture(plan) {
  let text = '',
    clicked = false,
    revision = 0;
  const calls = [],
    phases = [];
  const control = {
    session: null,
    async begin() {
      this.session = { controller: new AbortController() };
    },
    async stop() {
      this.session?.controller.abort();
      this.session = null;
    },
    requireSession() {
      if (!this.session) throw Error('Stopped');
      return this.session;
    },
    async execute(args, signal) {
      signal?.throwIfAborted();
      calls.push(args);
      if (args.action === 'observe')
        return {
          observationId: String(++revision),
          window: { untrustedTitle: 'Owned test window' },
          targets: [
            {
              targetId: `${revision}-edit`,
              untrustedLabel: 'Draft',
              editable: true,
              untrustedValue: text,
            },
            {
              targetId: `${revision}-button`,
              untrustedLabel: clicked ? 'Saved draft' : 'Save',
              editable: false,
            },
          ],
        };
      if (args.action === 'enter_text') text = args.text;
      if (args.action === 'click') clicked = true;
      return { ok: true };
    },
  };
  const agent = new ComputerAgent({
    control,
    plan,
    maxDecisions: 8,
    applications: {
      operation: (_id, _args, run) => run(),
      execute: async () => {
        throw Error('Uncertain native failure');
      },
    },
    emit: (event) => phases.push(event.phase),
  });
  return { agent, control, calls, phases, values: () => ({ text, clicked }) };
}
test('host task loop observes each mutation and independently reviews the entire goal before success', async () => {
  let reviews = 0;
  const f = fixture(async (context, { review }) => {
    assert.equal(context.originalOwnerGoal, 'Write Capri and save the draft');
    if (review) reviews++;
    const [field, button] = context.currentObservation.targets;
    if (field.untrustedValue !== 'Capri')
      return { action: 'enter_text', targetId: field.targetId, text: 'Capri', summary: 'Type' };
    if (button.untrustedLabel === 'Save')
      return { action: 'click', targetId: button.targetId, summary: 'Save' };
    return { action: 'finish', evidence: 'Saved draft', summary: 'Wrote and saved Capri.' };
  });
  const result = await f.agent.run('Write Capri and save the draft');
  assert.equal(result.verified, true);
  assert.equal(result.steps, 2);
  assert.equal(reviews, 1);
  assert.deepEqual(
    f.calls.map((c) => c.action),
    ['observe', 'enter_text', 'observe', 'click', 'observe', 'observe'],
  );
  assert(f.calls.filter((c) => c.action === 'observe').every((c) => c.vision === false));
  assert.equal(f.control.session, null);
  assert.equal(f.agent.running, false);
});
test('completion prose without actual evidence never finishes a task', async () => {
  const f = fixture(async () => ({
    action: 'finish',
    evidence: 'Made up success',
    summary: 'Done',
  }));
  assert.equal((await f.agent.run('Do a task')).ok, false);
  assert(f.calls.every((c) => c.action === 'observe'));
});

test('a Steam chain cannot finish at the Library or play a game that was not selected', async () => {
  const goal =
    'open steam then go to my library go to cyberpunk twenty seventy seven and click play';
  assert.deepEqual(steamGameGoal(goal), { name: 'cyberpunk 2077', play: true });
  const f = fixture(async () => ({
    action: 'finish',
    evidence: 'Owned test window',
    summary: 'Done',
  }));
  assert.equal((await f.agent.run(goal)).ok, false);
  assert(f.calls.every((call) => call.action === 'observe'));

  const view = {
    window: { windowId: '42' },
    targets: [
      { targetId: 'game', role: 'ControlType.ListItem', untrustedLabel: 'Cyberpunk 2077' },
      { targetId: 'play', role: 'ControlType.Button', untrustedLabel: 'Играть' },
    ],
  };
  const launch = { ok: true, action: 'launch', query: 'steam', windowId: '42' };
  const wrong = { ok: true, action: 'click', target: 'Another game', windowId: '42' };
  const correct = { ...wrong, target: 'Cyberpunk 2077' };
  assert.equal(steamMilestones(steamGameGoal(goal), view, [launch, wrong]).gamePage, false);
  assert.equal(steamMilestones(steamGameGoal(goal), view, [launch, wrong]).gameTarget, 'game');
  const selected = steamMilestones(steamGameGoal(goal), view, [launch, correct]);
  assert.equal(selected.gamePage, true);
  assert.match(selected.remaining, /has not been clicked/);
  const played = steamMilestones(steamGameGoal(goal), view, [
    launch,
    correct,
    { ...correct, target: 'Играть' },
  ]);
  assert.equal(played.remaining, null);
});

test('an import cannot report success while its modal file picker is still open', async () => {
  const f = fixture(async () => ({
    action: 'finish',
    evidence: 'Owned test window',
    summary: 'Imported.',
  }));
  const original = f.control.execute.bind(f.control);
  f.control.execute = async (...args) => {
    const r = await original(...args);
    if (args[0].action === 'observe') r.window.modal = true;
    return r;
  };
  assert.equal((await f.agent.run('Import the test video into the media pool')).ok, false);
  assert(f.calls.every((c) => c.action === 'observe'));
});

test('long chains retain early milestones after the detailed history rolls over', async () => {
  let index = 0,
    remembered = false;
  const f = fixture(async (context, { review }) => {
    if (index >= 50) {
      remembered = context.completedSteps.some((s) => s.text === 'step 0');
      return { action: 'finish', evidence: 'step 49', summary: 'Completed fifty steps.' };
    }
    return {
      action: 'enter_text',
      targetId: context.currentObservation.targets[0].targetId,
      text: 'step ' + index++,
      summary: 'Advance workflow.',
    };
  });
  f.agent.maxDecisions = 100;
  const r = await f.agent.run('Complete the fifty-step test workflow.');
  assert.equal(r.ok, true);
  assert.equal(r.steps, 50);
  assert(remembered);
});
test('review can reject premature completion and continue the missing action', async () => {
  const f = fixture(async (context, { review }) => {
    const field = context.currentObservation.targets[0];
    if (review && field.untrustedValue !== 'Capri')
      return {
        action: 'enter_text',
        targetId: field.targetId,
        text: 'Capri',
        summary: 'Missing typing step',
      };
    return {
      action: 'finish',
      evidence: field.untrustedValue || 'Owned test window',
      summary: 'Entered Capri.',
    };
  });
  assert.equal((await f.agent.run('Enter Capri')).ok, true);
  assert.equal(f.values().text, 'Capri');
});
test('Escape during planning prevents dispatch and releases the session', async () => {
  const abort = new AbortController();
  const f = fixture(async () => {
    abort.abort();
    return { action: 'click', targetId: '1-button' };
  });
  await assert.rejects(f.agent.run('Click Save', { signal: abort.signal }), /abort/i);
  assert(f.calls.every((c) => c.action === 'observe'));
  assert.equal(f.control.session, null);
});
test('an uncertain native action stops without replay, and unchanged actions cannot loop forever', async () => {
  const f = fixture(async () => ({ action: 'launch', query: 'Fixture', summary: 'Open' }));
  const result = await f.agent.run('Open fixture');
  assert.equal(result.status, 'incomplete');
  assert.equal(f.calls.length, 1);
  const waiting = fixture(async () => ({ action: 'observe', summary: 'Look' }));
  assert.equal((await waiting.agent.run('Find button')).status, 'stalled');
});
test('planner uses the configured loopback boundary and keeps screenshots and secrets out of requests', async () => {
  const plan = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.tools.length, 0);
      assert.equal(body.stream, false);
      assert.match(body.messages[0].content, /UNTRUSTED data/i);
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({ action: 'finish', evidence: 'Ready', summary: 'Done.' }),
        },
      });
    },
  });
  assert.equal(
    (
      await plan({
        originalOwnerGoal: 'Test',
        currentObservation: { window: { untrustedTitle: 'Ready' }, targets: [] },
      })
    ).action,
    'finish',
  );
  assert.throws(
    () => computerPlanner({ url: 'https://example.org', model: 'fixture' }),
    /boundary/,
  );
});

test('the decoding schema requires app arguments and restricts pointer targets to the current observation', () => {
  const schema = computerActionSchema(
    { targets: [{ targetId: 'live-button' }, { targetId: 'live-field', editable: true }] },
    { type: 'string', enum: ['Ready'] },
  );
  const branch = (action) => schema.anyOf.find((b) => b.properties.action.const === action);
  assert(branch('browser_search').required.includes('query'));
  assert(branch('browser_search').required.includes('text'));
  assert.equal(branch('browser_search').properties.targetId, undefined);
  assert.deepEqual(branch('click').properties.targetId.enum, ['live-button', 'live-field']);
  assert.deepEqual(branch('enter_text').properties.targetId.enum, ['live-field']);
  assert.equal(branch('launch').required.includes('windowTitle'), false);
  assert.equal(
    computerActionSchema({ targets: [] }, { type: 'string' }).anyOf.some(
      (b) => b.properties.action.const === 'click',
    ),
    false,
  );
});

test('planner selection binds readable labels to their exact current native targets', async () => {
  let supplied = 'Images [obs-ui-38]';
  const plan = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      const click = body.format.anyOf.find((branch) => branch.properties.action.const === 'click');
      assert.deepEqual(click.properties.targetId.enum, [
        'Images [obs-ui-38]',
        'Search by image [obs-ui-23]',
      ]);
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({ action: 'click', targetId: supplied, summary: 'Open images' }),
        },
      });
    },
  });
  const state = {
    originalOwnerGoal: 'Open photos',
    currentObservation: {
      targets: [
        { targetId: 'obs-ui-23', untrustedLabel: 'Search by image' },
        { targetId: 'obs-ui-38', untrustedLabel: 'Images' },
      ],
    },
  };
  assert.equal((await plan(state)).targetId, 'obs-ui-38');
  supplied = 'Images [obs-ui-23]';
  await assert.rejects(plan(state), /Invalid computer plan/);
});

test('image search stages exclude unrelated login and source links before opening the actual thumbnail', () => {
  const targets = [
    { targetId: 'login', untrustedLabel: 'Sign in' },
    { targetId: 'images', untrustedLabel: 'Картинки' },
    { targetId: 'source', untrustedLabel: 'Visit website' },
    { targetId: 'image', untrustedLabel: 'Capri picture', imageCandidate: true },
  ];
  const branch = (schema, name) => schema.anyOf.find((b) => b.properties.action.const === name);
  let schema = computerActionSchema({ imageResultsPending: true, targets }, { type: 'string' });
  assert.deepEqual(branch(schema, 'click').properties.targetId.enum, ['images']);
  assert(!branch(schema, 'finish'));
  schema = computerActionSchema({ imagePreviewPending: true, targets }, { type: 'string' });
  assert.deepEqual(branch(schema, 'click').properties.targetId.enum, ['image']);
  assert(!branch(schema, 'browser_search'));
});

test('an open image preview cannot finish before actual fullscreen and can request F11', () => {
  const schema = computerActionSchema(
    {
      fullscreenPending: true,
      imageFullscreenPending: true,
      targets: [{ targetId: 'source', untrustedLabel: 'Visit website' }],
    },
    { type: 'string' },
  );
  assert(!schema.anyOf.some((b) => b.properties.action.const === 'finish'));
  assert(!schema.anyOf.some((b) => b.properties.action.const === 'click'));
  assert.deepEqual(
    schema.anyOf.find((b) => b.properties.action.const === 'press_keys').properties.keys.items,
    { const: 'F11' },
  );
});

test('browser page context distinguishes loaded image results from web results and unsubmitted drafts', () => {
  const view = {
    window: { windowId: '123', untrustedTitle: 'Capri cyberpunk - Google Search' },
    targets: [
      {
        browserAddress: true,
        focused: false,
        untrustedValue: 'google.com/search?q=Capri+cyberpunk&udm=2',
      },
    ],
  };
  assert.equal(browserPageState(view).results, 'images');
  assert.equal(browserPageState(view).query, 'Capri cyberpunk');
  view.targets[0].focused = true;
  assert.equal(browserPageState(view), null);
  view.targets[0].focused = false;
  view.targets[0].untrustedValue = 'google.com/search?q=Capri+cyberpunk';
  assert.equal(browserPageState(view).results, 'web');
  view.targets[0].untrustedValue = 'example.com/search?q=Capri+cyberpunk&udm=2';
  assert.equal(browserPageState(view), null);
});

test('a browser draft is not typed repeatedly as the page controls change', async () => {
  let plans = 0;
  const f = fixture(async (context) => {
    if (++plans === 3) {
      assert.match(context.correction, /ALREADY in the address bar/);
      return { action: 'ask_user', summary: 'The draft is ready.' };
    }
    return { action: 'browser_input', query: 'Chrome', text: 'Capri' };
  });
  const execute = f.control.execute.bind(f.control);
  f.control.execute = async (...args) => {
    const result = await execute(...args);
    if (result.window) {
      result.window.windowId = '123';
      result.targets[0].browserAddress = true;
      result.targets[1].untrustedLabel += plans;
    }
    return result;
  };
  f.agent.applications.execute = async (_id, args) => {
    await f.control.execute({ action: 'enter_text', text: args.text });
    return { ok: true, typed: true, windowId: '123' };
  };
  await f.agent.run('Type Capri in Chrome');
  assert.equal(f.calls.filter((call) => call.action === 'enter_text').length, 1);
});

test('a repeated click is reviewed before input, but genuinely unfinished repeated actions can continue', async () => {
  for (const requiredClicks of [1, 3]) {
    let clicks = 0;
    const f = fixture(async (ctx, { review }) =>
      review
        ? clicks >= requiredClicks
          ? { action: 'finish', evidence: 'Images', summary: 'Opened images.' }
          : { action: 'continue', summary: 'The owner requested more clicks.' }
        : { action: 'click', targetId: ctx.currentObservation.targets[1].targetId },
    );
    const execute = f.control.execute.bind(f.control);
    f.control.execute = async (...args) => {
      if (args[0].action === 'click') clicks++;
      const view = await execute(...args);
      if (view.window) {
        view.window.windowId = '123';
        view.targets[0].untrustedValue = String(clicks);
        view.targets[1].untrustedLabel = 'Images';
      }
      return view;
    };
    assert.equal((await f.agent.run('Click the requested number of times')).ok, true);
    assert.equal(clicks, requiredClicks);
  }
});
test('browser helper uses the active full-access session and a fresh value for completion', async () => {
  const f = fixture(async (ctx, { review }) => {
    if (review || ctx.actualSteps.length) {
      assert.equal(ctx.actualSteps[0].keys, undefined, 'Unused model arguments did not run.');
      assert.equal(ctx.actualSteps[0].submitted, false);
      return { action: 'finish', evidence: 'Draft: Capri', summary: 'Entered Capri.' };
    }
    return {
      action: 'browser_input',
      query: 'Google Chrome',
      text: 'Capri',
      summary: 'Type',
      keys: ['ENTER'],
    };
  });
  f.agent.applications.execute = async (_id, _args, approvals) =>
    approvals.propose({
      execute: async () => {
        await f.control.execute({ action: 'enter_text', text: 'Capri' });
        return { ok: true, typed: true, submitted: false };
      },
    });
  assert.equal((await f.agent.run('Type Capri in Chrome')).ok, true);
});
test('explicit no-Enter instruction is enforced even when the planner proposes submission', async () => {
  const f = fixture(async () => ({ action: 'press_keys', keys: ['ENTER'], summary: 'Submit' }));
  assert.equal((await f.agent.run('Write a draft. Do not press Enter.')).ok, false);
  assert(f.calls.every((c) => c.action === 'observe'));
});
test('a result that changes during the completion review is not reported as verified', async () => {
  let read = 0;
  const f = fixture(async () => ({
    action: 'finish',
    evidence: 'Owned test window',
    summary: 'Done.',
  }));
  const base = f.control.execute.bind(f.control);
  f.control.execute = async (...args) => {
    const v = await base(...args);
    if (v.window) v.window.untrustedTitle = ++read % 2 ? 'Owned test window' : 'Changed window';
    return v;
  };
  assert.equal((await f.agent.run('Inspect the owned window')).ok, false);
});
test('explicit computer task mode bypasses chat routing and persists the actual result', async () => {
  const records = new Map(),
    events = [];
  const service = new ChatService({
    gatewayUrl: 'http://127.0.0.1:1234',
    agentId: 'capri',
    store: {
      snapshot: () => [...records.values()],
      put: (item) => records.set(item.id, structuredClone(item)),
    },
    computerTask: async (goal) => {
      assert.equal(goal, 'Write Capri');
      return { status: 'completed', steps: 2, summary: 'Entered Capri.' };
    },
    fetchImpl: () => {
      throw Error('Must not use ordinary chat');
    },
  });
  await service.send(
    { id: '11111111-1111-4111-8111-111111111111', text: 'Write Capri', mode: 'computer' },
    (event) => events.push(event),
  );
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Entered Capri.');
  assert.equal(events.at(-1).assistant.computerTask.status, 'completed');
});

test('invented Chrome titles are discarded; a sole verified window can resolve selection without repeating input', async () => {
  const requests = [];
  const f = fixture(async (ctx, { review }) =>
    review || ctx.actualSteps.length
      ? { action: 'finish', evidence: 'Draft: Capri', summary: 'Typed Capri.' }
      : {
          action: 'browser_input',
          query: 'Google Chrome',
          windowTitle: 'Capri - Google Chrome',
          text: 'Capri',
        },
  );
  f.agent.applications.execute = async (_id, args) => {
    requests.push(args);
    if (!args.windowId)
      return {
        ok: true,
        needsWindow: true,
        inputPerformed: false,
        windows: [{ windowId: '123', untrustedTitle: 'A different page - Google Chrome' }],
      };
    assert.equal(args.windowId, '123');
    await f.control.execute({ action: 'enter_text', text: args.text });
    return { ok: true, typed: true, submitted: false };
  };
  const result = await f.agent.run('Type Capri in Chrome');
  assert.equal(result.ok, true);
  assert.equal(result.steps, 1);
  assert.equal(requests.length, 2);
  assert(requests.every((args) => args.windowTitle === undefined));
  assert.equal(f.calls.filter((c) => c.action === 'enter_text').length, 1);
  assert(!JSON.stringify(f.agent.diagnostics()).includes('A different page'));
});

test('ambiguous windows or an explicitly requested missing title never cause arbitrary input or count as completed steps', async () => {
  for (const specific of [false, true]) {
    let count = 0;
    const f = fixture(async () => ({
      action: 'browser_input',
      query: 'Chrome',
      windowTitle: specific ? 'Owner selected tab' : '',
      text: 'Capri',
    }));
    f.agent.applications.execute = async () => {
      count++;
      return {
        ok: true,
        needsWindow: true,
        inputPerformed: false,
        windows: specific ? [{ windowId: '123' }] : [{ windowId: '123' }, { windowId: '456' }],
      };
    };
    const result = await f.agent.run(
      specific ? 'In Owner selected tab, type Capri' : 'Type Capri in Chrome',
    );
    assert.equal(result.status, 'needs_user');
    assert.equal(result.steps, 0);
    assert.equal(count, 1);
    assert(f.calls.every((c) => c.action === 'observe'));
  }
});

test('only a currently observed window among returned candidates is selected when several browser windows exist', async () => {
  const f = fixture(async (ctx, { review }) =>
    review || ctx.actualSteps.length
      ? { action: 'finish', evidence: 'Draft: Capri', summary: 'Done.' }
      : { action: 'browser_input', query: 'Chrome', text: 'Capri' },
  );
  const base = f.control.execute.bind(f.control);
  f.control.execute = async (...args) => {
    const v = await base(...args);
    if (v.window) v.window.windowId = '456';
    return v;
  };
  f.agent.applications.execute = async (_id, args) => {
    if (!args.windowId)
      return {
        ok: true,
        needsWindow: true,
        inputPerformed: false,
        windows: [{ windowId: '123' }, { windowId: '456' }],
      };
    assert.equal(args.windowId, '456');
    await f.control.execute({ action: 'enter_text', text: 'Capri' });
    return { ok: true, typed: true };
  };
  assert.equal((await f.agent.run('Type Capri in Chrome')).ok, true);
});

test('failed application attempts remain failures in the next plan and completion review cannot erase the correction', async () => {
  let normal = 0;
  const f = fixture(async (ctx, { review }) => {
    if (review) return { action: 'continue', summary: 'Still need to type.' };
    if (++normal === 1)
      return { action: 'click', targetId: ctx.currentObservation.targets[1].targetId };
    if (normal === 2) return { action: 'browser_input', query: 'missing', text: 'Capri' };
    assert.match(ctx.correction, /unknown_app/);
    assert.equal(ctx.actualSteps.at(-1).ok, false);
    return { action: 'ask_user', summary: 'Choose the app.' };
  });
  f.agent.applications.execute = async () => ({ ok: false, error: 'unknown_app' });
  const result = await f.agent.run('Type Capri in a browser');
  assert.equal(result.steps, 1);
});

test('browser search bypasses Chrome autocomplete and verifies exact results before completion', async () => {
  let submitted = false,
    reviews = 0;
  const f = fixture(async (ctx, { review }) => {
    if (review || ctx.actualSteps.length) {
      if (review) reviews++;
      assert(submitted);
      return { action: 'finish', evidence: 'Capri - Google Search', summary: 'Searched.' };
    }
    return { action: 'browser_search', query: 'Chrome', text: 'Capri' };
  });
  const base = f.control.execute.bind(f.control);
  f.control.execute = async (args, signal) => {
    const result = await base(args, signal);
    assert.notEqual(args.action, 'press_keys');
    if (result.window) {
      result.window = {
        windowId: '123',
        untrustedTitle: submitted ? 'Capri - Google Search' : 'Old page',
      };
      Object.assign(result.targets[0], {
        browserAddress: true,
        focused: !submitted,
        untrustedValue: submitted
          ? 'https://www.google.com/search?q=Capri'
          : 'https://www.google.com/search?q=Capri+cyberpunk',
      });
    }
    return result;
  };
  f.agent.applications.execute = async (_id, args, approvals) =>
    approvals.propose({
      execute: async () => {
        assert.equal(args.action, 'open_url');
        assert.equal(args.url, 'https://www.google.com/search?q=Capri');
        submitted = true;
        return { ok: true, navigationRequested: true, windowId: '123' };
      },
    });
  const result = await f.agent.run('Google Capri in Chrome');
  assert.equal(result.ok, true);
  assert.equal(result.steps, 1);
  assert.equal(reviews, 1);
  assert.equal(f.calls.filter((c) => c.action === 'press_keys').length, 0);
});

test('browser search cannot submit a draft into a changed window or override a no-Enter instruction', async () => {
  const f = fixture(async () => ({
    action: 'browser_search',
    query: 'Chrome',
    text: 'Capri',
    windowTitle: 'Test window',
  }));
  let dispatches = 0;
  f.agent.applications.execute = async () => {
    dispatches++;
    return { ok: true, typed: true, windowId: '123' };
  };
  assert.equal((await f.agent.run('Type Capri. Do not press Enter.')).ok, false);
  assert.equal(dispatches, 0);
  assert.equal((await f.agent.run('Google Capri in the Test window')).ok, false);
  assert.equal(dispatches, 1);
  assert(f.calls.every((c) => c.action === 'observe'));
});

test('search completion distinguishes a draft, a loading page, a CAPTCHA, and actual search results', () => {
  const search = { windowId: '123', text: 'кто такая Капри' };
  const view = {
    window: { windowId: '123', untrustedTitle: 'Old page - Google Chrome' },
    targets: [
      {
        browserAddress: true,
        focused: true,
        untrustedValue: 'https://www.google.com/search?q=' + encodeURIComponent(search.text),
      },
    ],
  };
  assert.equal(browserSearchState(view, search), 'loading');
  view.targets[0].focused = false;
  assert.equal(browserSearchState(view, search), 'loading');
  view.targets[0].untrustedValue = 'google.com/sorry/index?continue=https://www.google.com/search';
  assert.equal(browserSearchState(view, search), 'challenge');
  view.targets[0].untrustedValue = 'google.com/search?q=кто%20такая%20Капри';
  view.window.untrustedTitle = 'кто такая Капри - Поиск в Google - Google Chrome';
  assert.equal(browserSearchState(view, search), 'ready');
  view.window.windowId = '456';
  assert.equal(browserSearchState(view, search), 'window_changed');
});

test('malformed app arguments are replanned before dispatch rather than aborting the entire task', async () => {
  let planned = 0;
  const f = fixture(async (ctx, { review }) => {
    if (review || ctx.actualSteps.length)
      return { action: 'finish', evidence: 'Draft: Capri', summary: 'Typed Capri.' };
    if (++planned === 1) return { action: 'browser_input', query: '', text: 'Capri' };
    assert.match(ctx.correction, /application name/);
    return {
      action: 'enter_text',
      targetId: ctx.currentObservation.targets[0].targetId,
      text: 'Capri',
    };
  });
  assert.equal((await f.agent.run('Type Capri')).ok, true);
  assert.equal(f.calls.filter((call) => call.action === 'enter_text').length, 1);
  assert.deepEqual(f.agent.diagnostics().actions[0], {
    action: 'browser_input',
    outcome: 'invalid_arguments',
  });
});

test('planner and executor can hover a current target without clicking', async () => {
  let moved = false;
  const f = fixture(async (ctx, { review }) =>
    review || ctx.actualSteps.length
      ? { action: 'finish', evidence: 'Save', summary: 'Hovered Save.' }
      : { action: 'move_pointer', targetId: ctx.currentObservation.targets[1].targetId },
  );
  const base = f.control.execute.bind(f.control);
  f.control.execute = async (...args) => {
    if (args[0].action === 'move_pointer') moved = true;
    return base(...args);
  };
  assert.equal((await f.agent.run('Hover Save without clicking')).ok, true);
  assert.equal(moved, true);
  assert.equal(
    f.calls.some((call) => call.action === 'click'),
    false,
  );
  const planner = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, request) => {
      assert(
        JSON.parse(request.body).format.anyOf.some(
          (branch) => branch.properties.action.const === 'move_pointer',
        ),
      );
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({
            action: 'move_pointer',
            targetId: 'Save [current]',
            summary: 'Hover',
          }),
        },
      });
    },
  });
  assert.equal(
    (
      await planner({
        originalOwnerGoal: 'Hover',
        currentObservation: { targets: [{ targetId: 'current', untrustedLabel: 'Save' }] },
      })
    ).action,
    'move_pointer',
  );
});

test('verified search is not resubmitted when the next required step is clicking Images', async () => {
  let submitted = false,
    submissions = 0,
    planned = 0;
  const f = fixture(async (ctx, { review }) => {
    if (f.values().clicked)
      return { action: 'finish', evidence: 'Images', summary: 'Opened images.' };
    if (review)
      return f.values().clicked
        ? { action: 'finish', evidence: 'Images', summary: 'Opened images.' }
        : { action: 'continue', summary: 'Click Images on the results page.' };
    if (++planned <= 2) return { action: 'browser_search', query: 'Chrome', text: 'Capri' };
    assert.match(ctx.correction, /DO NOT search again/);
    return { action: 'click', targetId: ctx.currentObservation.targets[1].targetId };
  });
  const base = f.control.execute.bind(f.control);
  f.control.execute = async (...args) => {
    assert.notEqual(args[0].action, 'press_keys');
    const value = await base(...args);
    if (value.window) {
      value.window = {
        windowId: '123',
        untrustedTitle: submitted ? 'Capri - Google Search' : 'Chrome',
      };
      Object.assign(value.targets[0], { browserAddress: true, focused: !submitted });
      value.targets[1].untrustedLabel = 'Images';
      if (submitted) value.targets[0].untrustedValue = 'https://www.google.com/search?q=Capri';
      if (f.values().clicked)
        value.targets[0].untrustedValue = 'https://www.google.com/search?q=Capri&udm=2';
    }
    return value;
  };
  f.agent.applications.execute = async (_id, args) => {
    assert.equal(args.url, 'https://www.google.com/search?q=Capri');
    submitted = true;
    submissions++;
    return { ok: true, navigationRequested: true, windowId: '123' };
  };
  const result = await f.agent.run('Search Capri and open photos');
  assert.equal(result.ok, true);
  assert.equal(submissions, 1);
  assert.equal(f.values().clicked, true);
});
