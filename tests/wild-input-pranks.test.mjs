// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAFE_WILD_KEYS,
  WildInputPranks,
  classifyWildTarget,
  fallbackWildPrank,
  isSafeWildChord,
  sanitizeWildPlan,
  wildPrankPlanner,
} from '../apps/desktop/wild-input-pranks.mjs';

test('SAFE_WILD_KEYS and isSafeWildChord enforce safe keys and forbid CTRL shortcut chords', () => {
  for (const key of [
    'A',
    'Z',
    '0',
    '9',
    'SPACE',
    'TAB',
    'SHIFT',
    'CTRL',
    'LEFT',
    'UP',
    'RIGHT',
    'DOWN',
  ])
    assert.equal(SAFE_WILD_KEYS.has(key), true);

  for (const chord of [
    ['W'],
    ['0'],
    ['SPACE'],
    ['TAB'],
    ['SHIFT'],
    ['CTRL'],
    ['W', 'SHIFT'],
    ['A', 'W', 'SPACE'],
    ['LEFT', 'UP', 'RIGHT'],
  ])
    assert.equal(isSafeWildChord(chord), true, `expected safe chord ${JSON.stringify(chord)}`);

  for (const unsafe of [
    null,
    undefined,
    'W',
    [],
    ['W', 'A', 'S', 'D'],
    ['w'],
    ['space'],
    ['W', 'W'],
    [1],
    ['CTRL', 'C'],
    ['CTRL', 'W'],
    ['SHIFT', 'CTRL'],
    ['CTRL', 'SHIFT', 'A'],
    ['WIN'],
    ['ALT'],
    ['ALT', 'F4'],
    ['ESCAPE'],
    ['ENTER'],
    ['DELETE'],
    ['BACKSPACE'],
    ['INSERT'],
    ['HOME'],
    ['END'],
    ['PAGEUP'],
    ['PAGEDOWN'],
    ['F1'],
    ['F12'],
    ['F24'],
  ])
    assert.equal(isSafeWildChord(unsafe), false, `expected unsafe chord ${JSON.stringify(unsafe)}`);
});

test('classifyWildTarget blocks sensitive, system, Capri, modal, and excluded targets', () => {
  assert.equal(classifyWildTarget(null).blocked, true);
  assert.equal(classifyWildTarget({ processName: 'notepad.exe', modal: true }).blocked, true);
  assert.equal(classifyWildTarget({ processName: 'Capri.exe' }).blocked, true);
  assert.equal(classifyWildTarget({ processName: 'capri' }).blocked, true);
  assert.equal(
    classifyWildTarget({ processName: 'electron.exe', executable: 'C:\\Apps\\Capri\\Capri.exe' })
      .blocked,
    true,
  );

  for (const proc of [
    'taskmgr.exe',
    'regedit',
    'CMD.EXE',
    'powershell.exe',
    'pwsh.exe',
    'WindowsTerminal.exe',
    'wt.exe',
    'conhost.exe',
    'mmc.exe',
    'control.exe',
    'msiexec.exe',
    'consent.exe',
    'lsass.exe',
    '1Password.exe',
    'Bitwarden.exe',
    'KeePass.exe',
    'KeePassXC.exe',
    'Dashlane.exe',
    'LastPass.exe',
    'Authy.exe',
  ]) {
    const result = classifyWildTarget({ processName: proc, untrustedTitle: 'Normal window' });
    assert.equal(result.blocked, true, `expected ${proc} to be blocked`);
  }

  for (const title of [
    'Enter your Password',
    'GPG Passphrase',
    'Sign in - Accounts',
    'Log in to Dashboard',
    'Member Login',
    'Store Checkout',
    'Payment confirmation',
    'Billing settings',
    'Online Banking Portal',
    'Bank transfer',
    'Hardware Wallet',
    'Recovery Seed Phrase',
    'Enter 2FA code',
    'Two-Factor Verification',
    'Microsoft Authenticator',
    'Windows Credential Manager',
    'UAC Elevation',
    'Administrator: Tools',
  ]) {
    const result = classifyWildTarget({ processName: 'chrome.exe', untrustedTitle: title });
    assert.equal(result.blocked, true, `expected title "${title}" to be blocked`);
  }

  // Word-boundary check on \buac\b
  assert.equal(
    classifyWildTarget({ processName: 'chrome.exe', untrustedTitle: 'Guacamole recipe' }).blocked,
    false,
  );

  // Excluded app via initiativeAppExcluded
  assert.equal(
    classifyWildTarget(
      { processName: 'Discord.exe', untrustedTitle: 'General chat' },
      { excludedApps: ['discord', 'obs64'] },
    ).blocked,
    true,
  );
});

test('classifyWildTarget distinguishes game vs desktop modes and button/key permissions', () => {
  // Game via visionKind
  assert.deepEqual(
    classifyWildTarget(
      { processName: 'indie.exe', untrustedTitle: 'Indie Arena', editableFocus: true },
      { visionKind: 'game' },
    ),
    { blocked: false, mode: 'game', allowButtons: true, allowKeys: true },
  );

  // Game via known install paths
  for (const executable of [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe',
    'D:\\Epic Games\\Fortnite\\FortniteGame.exe',
    'C:\\Riot Games\\VALORANT\\live\\VALORANT.exe',
    'C:\\XboxGames\\Halo Infinite\\game\\Halo.exe',
    'C:\\Program Files (x86)\\Battle.net\\Overwatch\\Overwatch.exe',
    'D:\\GOG Galaxy\\Games\\Witcher 3\\witcher3.exe',
    'D:\\EA Games\\Apex\\r5apex.exe',
    'D:\\Ubisoft\\Siege\\RainbowSix.exe',
  ]) {
    const res = classifyWildTarget({ processName: 'game.exe', executable, fullscreen: false });
    assert.equal(res.blocked, false);
    assert.equal(res.mode, 'game', `expected game mode for ${executable}`);
    assert.equal(res.allowButtons, true);
    assert.equal(res.allowKeys, true);
  }

  // Fullscreen unknown app -> game
  assert.deepEqual(
    classifyWildTarget({ processName: 'eldenring.exe', fullscreen: true, editableFocus: false }),
    { blocked: false, mode: 'game', allowButtons: true, allowKeys: true },
  );

  // Fullscreen non-game apps -> desktop
  for (const proc of [
    'chrome.exe',
    'msedge.exe',
    'firefox.exe',
    'vlc.exe',
    'code.exe',
    'discord.exe',
    'obs64.exe',
    'resolve.exe',
    'spotify.exe',
  ]) {
    const res = classifyWildTarget({ processName: proc, fullscreen: true, editableFocus: false });
    assert.equal(res.blocked, false);
    assert.equal(res.mode, 'desktop', `expected desktop mode for fullscreen ${proc}`);
    assert.equal(res.allowButtons, false);
    assert.equal(res.allowKeys, true);
  }

  // Desktop editable focus disables keys
  assert.deepEqual(
    classifyWildTarget({ processName: 'notepad.exe', fullscreen: false, editableFocus: true }),
    { blocked: false, mode: 'desktop', allowButtons: false, allowKeys: false },
  );
});

test('sanitizeWildPlan clamps values, enforces mode/budget/step limits, and normalizes metadata', () => {
  assert.equal(sanitizeWildPlan(null), null);
  assert.equal(sanitizeWildPlan({ steps: [] }), null);
  assert.equal(
    sanitizeWildPlan({
      mode: 'desktop',
      steps: [
        { type: 'mouse_flick', dx: 0, dy: 0, durationMs: 200 },
        { type: 'mouse_button', button: 'left', holdMs: 100, count: 1 },
        { type: 'key_press', keys: ['W'], holdMs: 100 },
        { type: 'mouse_scroll', amount: 0 },
      ],
    }),
    null,
  );

  const displayBounds = { x: -1920, y: 100, width: 1920, height: 1080 };
  const capriBounds = { x: -120, y: 1120, width: 300, height: 300 }; // center (30, 1270) clamped inside display
  const desktop = sanitizeWildPlan(
    {
      idea: '  Steal cursor\x00 and scroll  ' + 'x'.repeat(200),
      quip: '  *Catch* `me` <tag>🔥 if you can!\n  ' + 'a'.repeat(200),
      expression: 'invalid_mood',
      steps: [
        { type: 'mouse_move', target: 'capri', durationMs: 20, pull: false },
        { type: 'mouse_move', xPct: 50, yPct: 100, durationMs: 9999, pull: false },
        { type: 'mouse_flick', dx: 9999, dy: -9999, durationMs: 5 },
        { type: 'mouse_button', button: 'left', holdMs: 100, count: 2 }, // stripped in desktop
        { type: 'key_press', keys: ['SPACE'], holdMs: 2500 },
        { type: 'key_press', keys: ['W'], holdMs: 100 }, // stripped in desktop
        { type: 'mouse_scroll', amount: -25 },
        { type: 'wait', ms: 5000 }, // 60+1400+40+1800+320=3620, +800=4420 <= 10500 -> kept!
        { type: 'wait', ms: 200 }, // 4420 + 200 = 4620 <= 10500 -> kept under 10.5s budget!
      ],
    },
    { mode: 'desktop', displayBounds, capriBounds, editableFocus: false },
  );

  assert.equal(desktop.kind, 'desktop');
  assert.equal(desktop.expression, 'smirk');
  assert.equal(desktop.idea.length, 120);
  assert.equal(desktop.quip.length, 140);
  assert.equal(desktop.quip.startsWith('Catch me tag if you can!'), true);
  assert.equal(/[*`<>\p{Cc}🔥]/u.test(desktop.quip), false);
  assert.deepEqual(desktop.steps, [
    { type: 'mouse_move', x: -1, y: 1179, durationMs: 60, pull: true },
    { type: 'mouse_move', x: -960, y: 1179, durationMs: 1400, pull: false },
    { type: 'mouse_flick', dx: 2400, dy: -1600, durationMs: 40 },
    { type: 'key_press', keys: ['SPACE'], holdMs: 1800 },
    { type: 'mouse_scroll', amount: -8 },
    { type: 'wait', ms: 800 },
    { type: 'wait', ms: 200 },
  ]);
  assert.deepEqual(desktop.releaseKeys, ['SPACE']);
  assert.deepEqual(desktop.releaseButtons, []);

  // editableFocus blocks all desktop key_press steps
  const editable = sanitizeWildPlan(
    {
      steps: [
        { type: 'key_press', keys: ['SPACE'], holdMs: 60 },
        { type: 'mouse_scroll', amount: 2 },
      ],
    },
    { mode: 'desktop', editableFocus: true },
  );
  assert.deepEqual(editable.steps, [{ type: 'mouse_scroll', amount: 2 }]);
  assert.deepEqual(editable.releaseKeys, []);

  // Game mode allows mouse_button, safe chords, enforces 16-step cap & 10500ms budget & deduplicates releases
  const game = sanitizeWildPlan(
    {
      idea: 'Chaos combo',
      quip: 'Spinning you around!',
      expression: 'flirty',
      steps: [
        { type: 'key_press', keys: ['CTRL', 'W'], holdMs: 100 }, // unsafe chord -> skipped
        { type: 'key_press', keys: ['ALT', 'F4'], holdMs: 100 }, // unsafe -> skipped
        { type: 'key_press', keys: ['CTRL'], holdMs: 100 }, // single crouch -> ok
        { type: 'key_press', keys: ['W', 'SHIFT'], holdMs: 200 },
        { type: 'key_press', keys: ['W'], holdMs: 0 }, // duplicate W in releaseKeys -> deduplicated
        { type: 'mouse_button', button: 'left', holdMs: 100, count: 5 }, // count clamped to 3 (cost 370)
        { type: 'mouse_button', button: 'right', holdMs: 0, count: 2 }, // cost 115
        { type: 'mouse_button', button: 'left', holdMs: 50, count: 1 }, // duplicate left -> deduplicated
        { type: 'mouse_flick', dx: 500, dy: 0, durationMs: 100 },
        { type: 'wait', ms: 10 }, // clamped to 20 (step 8)
        { type: 'key_press', keys: ['R'], holdMs: 50 }, // step 9
        { type: 'wait', ms: 50 }, // step 10
        { type: 'wait', ms: 50 }, // step 11
        { type: 'wait', ms: 50 }, // step 12
        { type: 'wait', ms: 50 }, // step 13
        { type: 'wait', ms: 50 }, // step 14
        { type: 'wait', ms: 50 }, // step 15
        { type: 'wait', ms: 50 }, // step 16
        { type: 'key_press', keys: ['E'], holdMs: 50 }, // 17th valid step -> dropped by 16-step cap!
      ],
    },
    { mode: 'game' },
  );
  assert.equal(game.kind, 'game');
  assert.equal(game.expression, 'flirty');
  assert.equal(game.steps.length, 16);
  assert.deepEqual(game.releaseKeys, ['CTRL', 'W', 'SHIFT', 'R']);
  assert.deepEqual(game.releaseButtons, ['left', 'right']);
  assert.equal(game.steps[3].count, 3);
  assert.equal(game.steps[7].ms, 20);

  // Align mouse_button budget with inter-click gaps against 10500ms limit:
  // two holdMs: 1500, count: 3 steps = 4570 + 4570 = 9140ms (kept),
  // third holdMs: 1000, count: 2 step = 2035ms (total 11175 > 10500 -> dropped).
  const gapBudgetBound = sanitizeWildPlan(
    {
      steps: [
        { type: 'mouse_button', button: 'left', holdMs: 1500, count: 3 },
        { type: 'mouse_button', button: 'right', holdMs: 1500, count: 3 },
        { type: 'mouse_button', button: 'left', holdMs: 1000, count: 2 },
      ],
    },
    { mode: 'game' },
  );
  assert.deepEqual(gapBudgetBound?.steps, [
    { type: 'mouse_button', button: 'left', holdMs: 1500, count: 3 },
    { type: 'mouse_button', button: 'right', holdMs: 1500, count: 3 },
  ]);
});

function planDurationMs(steps) {
  let total = 0;
  for (const step of steps) {
    if (step.type === 'mouse_flick' || step.type === 'mouse_move') total += step.durationMs;
    else if (step.type === 'mouse_button')
      total += Math.max(40, step.holdMs) * step.count + (step.count - 1) * 35;
    else if (step.type === 'key_press') total += Math.max(40, step.holdMs);
    else if (step.type === 'mouse_scroll') total += Math.abs(step.amount) * 40;
    else if (step.type === 'wait') total += step.ms;
  }
  return total;
}

test('fallbackWildPrank returns varied sanitized plans in both game and desktop modes', () => {
  const gameIdeas = new Set();
  for (const r of [0, 0.4, 0.9]) {
    const plan = fallbackWildPrank({
      mode: 'game',
      displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      random: () => r,
    });
    assert.ok(plan);
    assert.equal(plan.kind, 'game');
    assert.ok(plan.steps.length >= 10 && plan.steps.length <= 16);
    const totalMs = planDurationMs(plan.steps);
    assert.ok(totalMs >= 8000 && totalMs <= 10500, `game combo duration ${totalMs}ms out of range`);
    assert.ok(plan.quip.length > 0);
    gameIdeas.add(plan.idea);
  }
  assert.equal(gameIdeas.size, 3);

  const capriBounds = { x: 1600, y: 700, width: 200, height: 300 };
  const desktopIdeas = new Set();
  for (const r of [0, 0.4, 0.9]) {
    for (const editableFocus of [false, true]) {
      const plan = fallbackWildPrank({
        mode: 'desktop',
        displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        capriBounds,
        cursor: { x: 300, y: 300 },
        editableFocus,
        random: () => r,
      });
      assert.ok(plan);
      assert.equal(plan.kind, 'desktop');
      assert.ok(plan.steps.length >= 10 && plan.steps.length <= 16);
      const totalMs = planDurationMs(plan.steps);
      assert.ok(
        totalMs >= 8000 && totalMs <= 10500,
        `desktop combo (editableFocus=${editableFocus}) duration ${totalMs}ms out of range`,
      );
      if (editableFocus) assert.equal(plan.releaseKeys.length, 0);
      assert.equal(plan.releaseButtons.length, 0);
      desktopIdeas.add(plan.idea);
    }
  }
  assert.equal(desktopIdeas.size, 3);

  const desktopCapri = fallbackWildPrank({
    mode: 'desktop',
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    capriBounds,
    cursor: { x: 300, y: 300 },
    editableFocus: true,
    random: () => 0,
  });
  assert.equal(
    desktopCapri.steps.some(
      (step) =>
        step.type === 'mouse_move' && step.pull === true && step.x === 1700 && step.y === 850,
    ),
    true,
  );

  // Still works when capriBounds is omitted (2 combos)
  for (const r of [0, 0.9]) {
    const desktopNoCapri = fallbackWildPrank({
      mode: 'desktop',
      editableFocus: true,
      random: () => r,
    });
    assert.ok(desktopNoCapri);
    assert.equal(desktopNoCapri.kind, 'desktop');
    assert.ok(desktopNoCapri.steps.length >= 10 && desktopNoCapri.steps.length <= 16);
    const totalMs = planDurationMs(desktopNoCapri.steps);
    assert.ok(
      totalMs >= 8000 && totalMs <= 10500,
      `desktop no-capri duration ${totalMs}ms out of range`,
    );
  }
});

test('wildPrankPlanner enforces local endpoint, structured /api/chat payload, byte caps, and abort semantics', async () => {
  for (const badUrl of [
    'https://127.0.0.1:11434',
    'http://example.com:11434',
    'http://user:pass@127.0.0.1:11434',
  ])
    assert.throws(() => wildPrankPlanner({ url: badUrl, model: 'fixture' }));

  const requests = [];
  let responder;
  const plan = wildPrankPlanner({
    url: 'http://127.0.0.1:11434',
    model: 'capri-vlm',
    modelCapabilities: ['thinking', 'vision'],
    params: { num_ctx: 4096 },
    persona: () => 'Capri wild persona',
    style: () => 'wild',
    languages: () => ({ conversation: 'en' }),
    fetchImpl: async (endpoint, init) => {
      requests.push({ href: endpoint.href, body: JSON.parse(init.body) });
      return responder(init);
    },
  });

  responder = () =>
    Response.json({
      done: true,
      message: {
        content: JSON.stringify({
          kind: 'game',
          idea: 'Flick and reload',
          quip: 'Reloading your gun right now!',
          expression: 'smirk',
          steps: [
            { type: 'mouse_flick', dx: 480, dy: -40, durationMs: 160 },
            { type: 'key_press', keys: ['R'], holdMs: 80 },
            { type: 'key_press', keys: ['ALT', 'F4'], holdMs: 80 },
          ],
        }),
      },
    });

  const png = Buffer.from('fake-png-bytes');
  const withImage = await plan({
    state: {
      processName: 'Cyberpunk2077.exe',
      untrustedTitle: 'Cyberpunk 2077',
      fullscreen: true,
      editableFocus: false,
      displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    classification: { mode: 'game' },
    png,
    neglectSeconds: 185,
    recent: [{ idea: 'Old prank', quip: 'Old line' }],
  });

  assert.equal(requests[0].href, 'http://127.0.0.1:11434/api/chat');
  assert.equal(requests[0].body.stream, false);
  assert.equal(requests[0].body.think, false);
  assert.deepEqual(requests[0].body.tools, []);
  assert.deepEqual(requests[0].body.options, {
    num_ctx: 4096,
    num_predict: 768,
    temperature: 0.9,
  });
  assert.deepEqual(requests[0].body.format.required, [
    'kind',
    'idea',
    'quip',
    'expression',
    'steps',
  ]);
  assert.deepEqual(requests[0].body.messages[1].images, [png.toString('base64')]);
  assert.match(requests[0].body.messages[0].content, /untrusted data/i);
  assert.equal(withImage.kind, 'game');
  assert.equal(withImage.steps.length, 2);
  assert.deepEqual(withImage.releaseKeys, ['R']);

  // Without png Buffer, images is omitted; non-thinking model omits think
  const noThinkRequests = [];
  const noThinkPlanner = wildPrankPlanner({
    url: 'http://127.0.0.1:11434',
    model: 'plain-model',
    modelCapabilities: [],
    params: {},
    fetchImpl: async (_endpoint, init) => {
      noThinkRequests.push(JSON.parse(init.body));
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({
            kind: 'desktop',
            idea: 'Yoink pointer',
            quip: 'Borrowing your mouse.',
            expression: 'happy',
            steps: [{ type: 'mouse_scroll', amount: 3 }],
          }),
        },
      });
    },
  });
  const noImagePlan = await noThinkPlanner({
    state: { processName: 'chrome.exe', untrustedTitle: 'Docs' },
    classification: { mode: 'desktop' },
  });
  assert.equal('images' in noThinkRequests[0].messages[1], false);
  assert.equal('think' in noThinkRequests[0], false);
  assert.equal(noImagePlan.kind, 'desktop');

  // Error/invalid/oversized/incomplete responses return null without throwing
  for (const makeResponse of [
    () => new Response('server error', { status: 500 }),
    () => new Response('x'.repeat(32769), { status: 200 }),
    () => new Response('not json', { status: 200 }),
    () => Response.json({ done: false, message: { content: '{}' } }),
    () => Response.json({ done: true, done_reason: 'length', message: { content: '{}' } }),
    () =>
      Response.json({
        done: true,
        message: { content: '{}', tool_calls: [{ function: { name: 'click' } }] },
      }),
    () => Response.json({ done: true, message: { content: 'bad json' } }),
    () =>
      Response.json({
        done: true,
        message: {
          content: JSON.stringify({
            kind: 'desktop',
            idea: 'Bad',
            quip: 'Bad',
            expression: 'smirk',
            steps: [{ type: 'mouse_button', button: 'left', holdMs: 100 }],
          }),
        },
      }),
  ]) {
    responder = makeResponse;
    assert.equal(
      await plan({
        state: { processName: 'chrome.exe' },
        classification: { mode: 'desktop' },
      }),
      null,
    );
  }

  // Aborted signal rethrows
  const abortController = new AbortController();
  abortController.abort(new Error('cancelled by owner'));
  await assert.rejects(
    plan({
      state: { processName: 'chrome.exe' },
      classification: { mode: 'desktop' },
      signal: abortController.signal,
    }),
    /cancelled by owner/,
  );
});

test('WildInputPranks schedules with neglect gating, eligibility retry, recent cap, and preview countdown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 100_000;
  const pranks = new WildInputPranks({ now: () => clock, random: () => 0.5 });

  // delay formula: Math.max(60_000, intervalSeconds * 1000 * (0.85 + 0.3 * 0.5)) = intervalSeconds * 1000
  assert.equal(pranks.delay(300), 300_000);
  assert.equal(pranks.delay(30), 60_000);

  // record caps at 6 entries
  for (let i = 1; i <= 8; i++) pranks.record({ idea: `idea-${i}`, quip: `quip-${i}` });
  assert.equal(pranks.recent.length, 6);
  assert.equal(pranks.recent[0].idea, 'idea-3');
  assert.equal(pranks.recent[5].idea, 'idea-8');

  // First tick initializes nextAt = 100_000 + 100_000 = 200_000
  let runs = [];
  let isEligible = false;
  const run = async (args) => {
    runs.push(args);
    return { ok: true, preview: args.preview };
  };
  pranks.tick({ enabled: true, intervalSeconds: 100, eligible: () => isEligible, run });
  assert.equal(pranks.nextAt, 200_000);
  assert.equal(runs.length, 0);

  // Attention right before nextAt postpones by minNeglectMs = min(60_000, 100*500) = 50_000
  clock = 180_000;
  pranks.noteAttention();
  clock = 200_000;
  pranks.tick({ enabled: true, intervalSeconds: 100, eligible: () => true, run });
  assert.equal(runs.length, 0);
  assert.equal(pranks.nextAt, 230_000);

  // At 230_000 neglected enough, but !eligible -> retries in 10_000ms
  clock = 230_000;
  pranks.tick({ enabled: true, intervalSeconds: 100, eligible: () => isEligible, run });
  assert.equal(runs.length, 0);
  assert.equal(pranks.nextAt, 240_000);

  // At 240_000 eligible -> fires run with neglectSeconds = 60
  isEligible = true;
  clock = 240_000;
  const pendingRun = Promise.withResolvers();
  let activeSignal;
  pranks.tick({
    enabled: true,
    intervalSeconds: 100,
    eligible: () => isEligible,
    run: async (args) => {
      activeSignal = args.signal;
      runs.push(args);
      return pendingRun.promise;
    },
  });
  assert.equal(pranks.running, true);
  assert.equal(pranks.nextAt, 340_000);

  // Overlapping preview returns BUSY
  assert.deepEqual(await pranks.preview({ countdownMs: 3000, allowed: () => true, run }), {
    ok: false,
    code: 'CAPRI_WILD_PRANK_BUSY',
  });

  // Disabling via tick clears nextAt and aborts active controller
  pranks.tick({ enabled: false, intervalSeconds: 100, eligible: () => true, run });
  assert.equal(pranks.nextAt, undefined);
  await Promise.resolve();
  assert.equal(activeSignal.aborted, true);
  pendingRun.resolve({ ok: false, aborted: true });
  await new Promise(setImmediate);
  assert.equal(pranks.running, false);
  assert.equal(runs[0].preview, false);
  assert.equal(runs[0].neglectSeconds, 60);

  // Preview countdown runs 3 -> 2 -> 1 -> 0 -> run
  const ticks = [];
  const previewPromise = pranks.preview({
    countdownMs: 3000,
    allowed: () => true,
    onCountdown: (n) => ticks.push(n),
    run,
  });
  assert.deepEqual(ticks, [3]);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.deepEqual(ticks, [3, 2]);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.deepEqual(ticks, [3, 2, 1]);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  const previewOutcome = await previewPromise;
  assert.deepEqual(ticks, [3, 2, 1, 0]);
  assert.deepEqual(previewOutcome, { ok: true, preview: true });
  assert.equal(pranks.running, false);

  // Preview aborts immediately when pause() is called mid-countdown
  pranks.nextAt = 999_999;
  const abortedTicks = [];
  const cancelledPreview = pranks.preview({
    countdownMs: 3000,
    allowed: () => true,
    onCountdown: (n) => abortedTicks.push(n),
    run: async () => assert.fail('aborted preview must not invoke run'),
  });
  assert.deepEqual(abortedTicks, [3]);
  pranks.pause();
  assert.equal(pranks.nextAt, undefined);
  assert.deepEqual(await cancelledPreview, {
    ok: false,
    aborted: true,
    code: 'CAPRI_WILD_PRANK_ABORTED',
  });
  assert.equal(pranks.running, false);

  // Preview aborts when allowed() becomes false mid-countdown
  let allowPreview = true;
  const deniedPreview = pranks.preview({
    countdownMs: 2000,
    allowed: () => allowPreview,
    onCountdown: (n) => {
      if (n === 1) allowPreview = false;
    },
    run: async () => assert.fail('disallowed preview must not invoke run'),
  });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.deepEqual(await deniedPreview, {
    ok: false,
    aborted: true,
    code: 'CAPRI_WILD_PRANK_ABORTED',
  });
});

test('WildInputPranks tick({ enabled: false }) preserves an active preview while still aborting auto runs and pause() aborts preview', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 100_000;
  const scheduler = new WildInputPranks({ now: () => clock, random: () => 0.5 });

  // 1. Repeated tick({ enabled: false }) during preview must not abort preview or run.
  const previewTicks = [];
  let previewSignal = null;
  let previewAbortedInsideRun = null;
  const previewPromise = scheduler.preview({
    countdownMs: 2000,
    allowed: () => true,
    onCountdown: (n) => previewTicks.push(n),
    run: async ({ preview, signal }) => {
      previewSignal = signal;
      scheduler.tick({
        enabled: false,
        intervalSeconds: 300,
        eligible: () => true,
        run: async () => {},
      });
      previewAbortedInsideRun = signal.aborted;
      return { ok: true, preview };
    },
  });
  assert.deepEqual(previewTicks, [2]);
  scheduler.tick({
    enabled: false,
    intervalSeconds: 300,
    eligible: () => true,
    run: async () => {},
  });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.deepEqual(previewTicks, [2, 1]);
  scheduler.tick({
    enabled: false,
    intervalSeconds: 300,
    eligible: () => true,
    run: async () => {},
  });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  const previewOutcome = await previewPromise;
  assert.deepEqual(previewTicks, [2, 1, 0]);
  assert.equal(previewAbortedInsideRun, false);
  assert.equal(previewSignal?.aborted, false);
  assert.deepEqual(previewOutcome, { ok: true, preview: true });
  assert.equal(scheduler.previewing, false);
  assert.equal(scheduler.running, false);

  // 2. tick({ enabled: false }) while an automatic tick() run is active aborts the automatic run.
  clock = 200_000;
  scheduler.noteAttention();
  scheduler.tick({
    enabled: true,
    intervalSeconds: 60,
    eligible: () => false,
    run: async () => {},
  });
  clock = 300_000;
  const pendingAuto = Promise.withResolvers();
  let autoSignal = null;
  scheduler.tick({
    enabled: true,
    intervalSeconds: 60,
    eligible: () => true,
    run: async ({ signal }) => {
      autoSignal = signal;
      return pendingAuto.promise;
    },
  });
  assert.equal(scheduler.running, true);
  assert.equal(scheduler.previewing, false);
  await Promise.resolve();
  assert.ok(autoSignal);
  assert.equal(autoSignal.aborted, false);
  scheduler.tick({
    enabled: false,
    intervalSeconds: 60,
    eligible: () => true,
    run: async () => {},
  });
  assert.equal(autoSignal.aborted, true);
  pendingAuto.resolve({ ok: false, aborted: true });
  await new Promise(setImmediate);
  assert.equal(scheduler.running, false);

  // 3. pause() while preview is running still aborts the preview immediately.
  const cancelledPreview = scheduler.preview({
    countdownMs: 3000,
    allowed: () => true,
    run: async () => assert.fail('paused preview must not invoke run'),
  });
  assert.equal(scheduler.previewing, true);
  scheduler.pause();
  assert.deepEqual(await cancelledPreview, {
    ok: false,
    aborted: true,
    code: 'CAPRI_WILD_PRANK_ABORTED',
  });
  assert.equal(scheduler.previewing, false);
  assert.equal(scheduler.running, false);
});
