// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { FullComputerAccess } from '../apps/desktop/full-computer-access.mjs';
import { ComputerRequests } from '../apps/desktop/computer-requests.mjs';
import { Confirmations } from '../apps/desktop/main/confirmations.mjs';
import { ChatService } from '../apps/desktop/chat-service.mjs';
import { CompanionActions } from '../apps/desktop/companion-actions.mjs';
import { SETTINGS_SCHEMA } from '../integrations/companion-tools/index.mjs';
import {
  computerModeRequest,
  dedicatedMusicRequest,
  mentionsDiscord,
  ownerAppLaunch,
} from '../apps/desktop/computer-mode-request.mjs';
import { computerIntentClassifier } from '../apps/desktop/computer-planner.mjs';
import { toolDomain } from '../apps/desktop/task-route.mjs';

test('explicit computer commands preserve full goals; questions, negations and quotations do not enable access', () => {
  for (const text of [
    'Capri, enable full computer access.',
    'Could you please turn on full computer control?',
    'Включи режим полного управления компьютером.',
    'Капри, можешь включить полный доступ ко всему компьютеру?',
    'Включи полное управление компьютером, пожалуйста.',
  ])
    assert.deepEqual(computerModeRequest(text), { enabled: true, run: false }, text);
  for (const text of [
    'Use full computer control to open Chrome, search for Capri and click the first result.',
    'Enable full computer access and play music in Spotify, then calculate 2+2.',
    'Капри, включи режим полного управления компьютером и открой Chrome, затем введи Capri.',
    'Используй полное управление компьютером: открой Spotify и найди трек.',
    'В режиме полного управления компьютером открой браузер и введи Capri.',
    'Open Spotify using full computer control.',
    'Открой Chrome через полное управление компьютером.',
  ])
    assert.deepEqual(computerModeRequest(text), { enabled: true, run: true }, text);
  for (const text of ['Disable full computer access.', 'Капри, отзови полный доступ к компьютеру.'])
    assert.deepEqual(computerModeRequest(text), { enabled: false, run: false }, text);
  for (const text of [
    'Can you control my PC?',
    'Explain full computer control.',
    'Do not enable full computer access.',
    'Не включай полное управление компьютером.',
    'Write "enable full computer access" in Notepad.',
    'What does full computer access do?',
    'Play music in Spotify.',
    'Enable full access to Spotify.',
    'Включи полный доступ к Spotify.',
  ])
    assert.equal(computerModeRequest(text), null, text);
  for (const fullComputerAccess of [false, true]) {
    const state = {
      fullComputerAccess,
      spotify: { enabled: true, prepared: true },
      applications: { calculator: true },
    };
    for (const text of [
      'Use full computer control to play Spotify and calculate 2+2.',
      'I would like you to play Spotify using full computer control.',
    ])
      assert.equal(toolDomain(text, state), 'desktop');
    assert.equal(toolDomain('Play music in Spotify.', state), 'spotify');
    assert.equal(toolDomain('Calculate 2+2.', state), 'calculator');
  }
});

function fixture(overrides = {}) {
  const parent = path.resolve('.runtime/computer-chat-tests');
  mkdirSync(parent, { recursive: true });
  const records = new Map(),
    events = [],
    dialogs = [],
    goals = [],
    taskContexts = [],
    ownerCallGoals = [];
  let now = 0,
    modelCalls = 0,
    discoveries = 0;
  const confirmations = new Confirmations({
    show() {},
    now: () => now,
    emit: (event) => dialogs.push(event),
  });
  const access = new FullComputerAccess({
    file: path.join(mkdtempSync(path.join(parent, 'case-')), 'access.json'),
    discover: async () => {
      discoveries++;
      return ['C:\\'];
    },
    confirm: (options) => confirmations.request(options),
    onChange: (state) => chat.computerApproval(state.enabling),
  });
  const requests = new ComputerRequests({
    access,
    run: async (goal, { signal, previousTask, ownerRequestedCall }) => {
      signal.throwIfAborted();
      goals.push(goal);
      taskContexts.push(previousTask);
      if (ownerRequestedCall) ownerCallGoals.push(goal);
      return { ok: true, status: 'completed', steps: 3, summary: 'Verified the requested result.' };
    },
  });
  const chat = new ChatService({
    gatewayUrl: 'http://127.0.0.1:1234',
    agentId: 'capri',
    store: {
      snapshot: () => [...records.values()],
      put: (item) => records.set(item.id, structuredClone(item)),
    },
    interfaceState: () => ({
      fullComputerAccess: access.enabled,
      spotify: { enabled: true, prepared: true },
      applications: { calculator: true },
    }),
    computerAccess: (value, options) => requests.configure(value, options),
    computerTask: (goal, options) => requests.execute(goal, options),
    prepareModel: async () => {
      modelCalls++;
    },
    fetchImpl: () => assert.fail('Explicit mode must not call ordinary model chat'),
    prepareContext: () => assert.fail('Background observation must not divert computer control'),
    requestRouter: { classify: () => assert.fail('Narrow skill classifier must not intercept') },
    ...overrides,
  });
  return {
    access,
    requests,
    chat,
    confirmations,
    dialogs,
    events,
    records,
    goals,
    taskContexts,
    ownerCallGoals,
    get modelCalls() {
      return modelCalls;
    },
    get discoveries() {
      return discoveries;
    },
    send: (text) => chat.send({ id: randomUUID(), text }, (event) => events.push(event)),
    accept: () => {
      now += 3000;
      return confirmations.respond({ id: dialogs.at(-1).id, choice: 'confirm' });
    },
  };
}

test('access complaints use ordinary conversation without desktop classification or a permission dialog', async () => {
  for (const fullComputerAccess of [false, true]) {
    let replies = 0;
    const f = fixture({
      interfaceState: () => ({ fullComputerAccess }),
      requestRouter: null,
      prepareContext: null,
      token: () => 'fixture',
      persona: () => 'fixture',
      computerIntent: () => assert.fail('Access discussion must not invoke desktop intent'),
      fetchImpl: async (_url, options) => {
        replies++;
        assert.equal(options.headers['x-capri-tools-once'], 'conversation');
        return new Response(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: 'We can talk normally.' } }] }) +
            '\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    for (const text of [
      'Why do you keep saying full computer access is off?',
      'I never asked you to enable full computer access.',
      'What does full computer access do?',
      'Can you control my PC?',
      'Почему ты повторяешь, что полный доступ к компьютеру выключен?',
    ]) {
      await f.send(text);
      assert.equal(f.events.at(-1).type, 'turn.completed');
      assert.equal(f.events.at(-1).assistant.text, 'We can talk normally.');
    }
    assert.equal(replies, 5);
    assert.deepEqual(f.goals, []);
    assert.deepEqual(f.dialogs, []);
    assert.equal(f.discoveries, 0);
  }
});

test('ordinary Spotify playback cannot become an application-name computer task', () => {
  for (const text of [
    'Can you open my Spotify and turn on some music like Example Artist?',
    'Play music on Spotify.',
    'Start some music in Spotify.',
    'Открой Spotify и включи музыку Example Artist.',
    'Капри, поставь песню в спотифай.',
  ]) {
    assert.equal(dedicatedMusicRequest(text), true, text);
    assert.equal(computerModeRequest(text, { fullComputerAccess: true }), null, text);
  }
  for (const text of [
    'Use full computer control to play music in Spotify.',
    'Open Spotify using full computer control.',
    'Click the Spotify play button with the mouse.',
    'Play Spotify, then open Notepad and type a note.',
  ])
    assert.equal(dedicatedMusicRequest(text), false, text);
  assert.deepEqual(computerModeRequest('Use full computer control to play music in Spotify.'), {
    enabled: true,
    run: true,
  });
});

test('an ordinary music turn rejects generated desktop escalation before any native service runs', async () => {
  for (const spotify of [
    { enabled: true, prepared: true },
    { enabled: true, prepared: false },
    { enabled: false, prepared: true },
    { enabled: false, prepared: false },
  ]) {
    let nativeCalls = 0;
    let spotifyCalls = 0;
    const f = fixture({
      interfaceState: () => ({ fullComputerAccess: true, spotify }),
      requestRouter: null,
      prepareContext: null,
      token: () => 'fixture',
      persona: () => 'fixture',
      computerIntent: () => assert.fail('A dedicated music request must not reach desktop intent'),
      fetchImpl: async (_url, options) => {
        assert.equal(
          options.headers['x-capri-tools-once'],
          spotify.enabled && spotify.prepared ? 'spotify' : 'conversation',
        );
        const host = {
          authorizeAction: (tool, args) => f.chat.assertToolAllowed(tool, args),
          runComputerTask: () => nativeCalls++,
          computer: { execute: () => nativeCalls++ },
          desktop: { execute: () => nativeCalls++, operation: () => nativeCalls++ },
          requestComputerAccess: () => nativeCalls++,
          spotify: {
            execute: () => {
              spotifyCalls++;
              return { ok: true, data: { playing: true } };
            },
          },
        };
        const execute = (tool, args) =>
          CompanionActions.prototype.executeAction.call(host, tool, randomUUID(), args);
        for (const action of ['begin_control', 'observe', 'run_task', 'click', 'launch'])
          await assert.rejects(
            execute('desktop_control', { action, goal: 'Model invented a different goal' }),
            { code: 'SPOTIFY_DEDICATED_ACTION_REQUIRED' },
          );
        await assert.rejects(
          execute('settings_control', {
            action: 'request',
            setting: 'fullComputerAccess',
            value: true,
          }),
          { code: 'SPOTIFY_DEDICATED_ACTION_REQUIRED' },
        );
        assert.equal(nativeCalls, 0);
        if (spotify.enabled && spotify.prepared) {
          const args = { action: 'play', query: 'Example Artist' };
          const result = await execute('spotify_control', args);
          f.chat.recordToolResult('spotify_control', args, result);
        }
        const reply =
          spotify.enabled && spotify.prepared
            ? 'Resumed.'
            : 'Enable Spotify in Settings → Application access first.';
        return new Response(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: reply } }] }) +
            '\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    await f.send('Can you open my Spotify and turn on some music like Example Artist?');
    assert.equal(f.events.at(-1).type, 'turn.completed', JSON.stringify(f.events.at(-1)));
    assert.deepEqual(f.goals, []);
    assert.deepEqual(f.dialogs, []);
    assert.equal(nativeCalls, 0);
    assert.equal(spotifyCalls, spotify.enabled && spotify.prepared ? 1 : 0);
    if (!spotify.enabled || !spotify.prepared)
      assert.match(f.events.at(-1).assistant.text, /Enable Spotify in Settings/);
  }
});

test('explicit Spotify GUI interaction keeps the authorized computer route', async () => {
  const f = fixture({
    requestRouter: null,
    computerIntent: async () => ({ intent: 'task', usesPrevious: false }),
  });
  const enabled = f.send('Enable full computer access.');
  f.accept();
  await enabled;
  const goal = 'Click the Spotify play button with the mouse.';
  await f.send(goal);
  assert.deepEqual(f.goals, [goal]);
  assert.equal(f.events.at(-1).type, 'turn.completed');
});

test('Escape cancellation rejects late music and explicit computer inputs while retaining cleanup', async () => {
  for (const dedicatedMusic of [false, true]) {
    const controller = new AbortController();
    const chat = {
      active: { controller, dedicatedMusic },
      interfaceState: () => ({ spotify: { enabled: true, prepared: true } }),
    };
    const calls = [];
    const host = {
      authorizeAction: (tool, args) =>
        ChatService.prototype.assertToolAllowed.call(chat, tool, args),
      computer: { execute: (args) => calls.push(args.action) },
      desktop: { execute: () => assert.fail('Cancelled native input reached desktop dispatch') },
      runComputerTask: () => assert.fail('Cancelled task reached the executor'),
      requestComputerAccess: () => assert.fail('Cancelled task requested access'),
    };
    const execute = (tool, args) =>
      CompanionActions.prototype.executeAction.call(host, tool, randomUUID(), args);
    controller.abort(new DOMException('Stopped by Escape', 'AbortError'));
    for (const action of ['begin_control', 'run_task', 'observe', 'click', 'launch', 'press_keys'])
      await assert.rejects(execute('desktop_control', { action }), { name: 'AbortError' });
    await assert.rejects(
      execute('settings_control', {
        action: 'request',
        setting: 'fullComputerAccess',
        value: true,
      }),
      { name: 'AbortError' },
    );
    await execute('desktop_control', { action: 'end_control' });
    await execute('desktop_control', { action: 'control_status' });
    assert.deepEqual(calls, ['end_control', 'control_status']);
  }
});

test('direct call commands wait for the existing full-access grant and reach the executor without a model', async () => {
  const f = fixture();
  const join = 'Join this meeting in Google Meet.';
  const draft = 'Write "Hello from Capri" in the call chat.';
  assert.equal((await f.requests.execute(join)).status, 'needs_user');
  await f.send('Send hello in the call chat.');
  assert.deepEqual(f.dialogs, []);
  const pending = f.send(join);
  assert.deepEqual(f.ownerCallGoals, []);
  assert.equal(f.accept(), true);
  await pending;
  await f.send(draft);
  assert.deepEqual(f.ownerCallGoals, [join, draft]);
  assert.equal(f.modelCalls, 0);
});

test('the reported ASR variants and Steam chains preserve the original task', () => {
  for (const [text, name] of [
    ['useful computer access and open steam then go to cyberpunk 2077 and click launch', 'steam'],
    [
      'open steam then go to my library go to cyberpunk twenty seventy seven and click play',
      'steam',
    ],
    ['useful computer access and open war thunder', 'war thunder'],
    ['useful computer access and open chat Gpt.', 'chat Gpt'],
    ['Открой Блокнот, затем напиши тест.', 'Блокнот'],
  ]) {
    assert.deepEqual(computerModeRequest(text, { fullComputerAccess: true }), {
      enabled: true,
      run: true,
    });
    assert.equal(ownerAppLaunch(text)?.name, name);
  }
  assert.equal(computerModeRequest('Useful computer access is hard to set up'), null);
  assert.equal(ownerAppLaunch('Then open it.'), null);
});

test('spoken Cyberpunk launch requests use the authorized computer route without warming a model', async () => {
  const phrases = [
    'I need to test your ability. See, I want you to use uh full access to my PC, then go to Steam and uh launch Cyberpunk twenty seventy seven, please.',
    "Use my computer and turn on Cyberpunk's 2077 please.",
    'Капри, запусти Киберпанк в Стиме.',
    'Капри, открой Steam и запусти Киберпанк.',
  ];
  const f = fixture();
  for (const phrase of phrases) assert.equal(computerModeRequest(phrase), null);
  const enabling = f.send('Enable full computer access.');
  assert.equal(f.accept(), true);
  await enabling;
  for (const phrase of phrases) await f.send(phrase);
  assert.deepEqual(f.goals, phrases);
  assert.equal(f.modelCalls, 0);
});

test('multilingual desktop intent uses the host grant and keeps the current goal and reference separate', async () => {
  const requests = [];
  const classifier = computerIntentClassifier({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, '/api/chat');
      const payload = JSON.parse(options.body);
      assert.equal(payload.options.num_predict, 64);
      const request = JSON.parse(payload.messages[1].content);
      requests.push(request);
      const intent =
        request.latestOwnerMessage === '¿Qué es Steam?'
          ? 'chat'
          : request.latestOwnerMessage === '请启用完整电脑控制。'
            ? 'enable'
            : 'task';
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify({
            intent,
            usesPrevious: request.latestOwnerMessage === 'Dann öffne es.',
          }),
        },
      });
    },
  });
  let ordinaryTurns = 0;
  const f = fixture({
    computerIntent: classifier,
    requestRouter: null,
    prepareContext: null,
    token: () => 'fixture',
    persona: () => 'fixture',
    fetchImpl: async () => {
      ordinaryTurns++;
      return new Response(
        'data: {"choices":[{"delta":{"content":"Steam is a game launcher."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  const enabled = f.send('请启用完整电脑控制。');
  for (let i = 0; i < 20 && !f.dialogs.length; i++) await new Promise(setImmediate);
  assert.deepEqual(f.goals, []);
  assert.equal(f.access.enabled, false);
  assert.equal(f.accept(), true);
  await enabled;
  await f.send('¿Qué es Steam?');
  await f.send('Dann öffne es.');
  await f.send('Ouvre le Bloc-notes puis saisis un brouillon.');
  assert.equal(ordinaryTurns, 1);
  assert.deepEqual(f.goals, ['Dann öffne es.', 'Ouvre le Bloc-notes puis saisis un brouillon.']);
  assert.deepEqual(f.taskContexts, [{ goal: '¿Qué es Steam?' }, undefined]);
  assert.equal(requests[2].previousOwnerMessage, '¿Qué es Steam?');
});

test('authorized browser chains use the complete host task, while drafts and conversation keep their narrow route', async () => {
  const goal =
    'I want you to open Google Chrome, type your name into the search bar and then go to the Images section and display your image in the full screen mode.';
  const spoken =
    'Can you use uh computer control skill uh to open my Google Chrome and type Capri. Then go to Pictures and open some pictures of Capri.';
  const russian = 'Открой Chrome, найди Capri, затем перейди в картинки и открой изображение.';
  for (const text of [goal, spoken, russian]) {
    assert.equal(computerModeRequest(text), null, 'An ordinary chain does not grant full access');
    assert.deepEqual(computerModeRequest(text, { fullComputerAccess: true }), {
      enabled: true,
      run: true,
    });
  }
  for (const text of [
    'Open Chrome and type Capri without pressing Enter.',
    'Can you control Chrome?',
    'Explain how to open Chrome and search for images.',
    'Can you explain how to open Chrome and search for images?',
    'I want you to explain how to open Chrome and search for images.',
    'Do not open Chrome and search for images.',
    'Write "open Chrome and search for images" in Notepad.',
  ])
    assert.equal(computerModeRequest(text, { fullComputerAccess: true }), null, text);
  const f = fixture();
  const enabling = f.send('Enable full computer access.');
  f.accept();
  await enabling;
  await f.send(goal);
  assert.deepEqual(f.goals, [goal]);
  assert.equal(f.events.at(-1).assistant.computerTask.status, 'completed');
  assert.equal(f.dialogs.filter((e) => e.type === 'confirmation.request').length, 1);
});

test('spoken Discord and Resolve tasks go to the executor, and a follow-up retains the Resolve context', async () => {
  const f = fixture();
  const enabling = f.send('Enable full computer access.');
  f.accept();
  await enabling;
  const discord = 'I want you to open my Discord server uh go to general channel and uh type test.';
  const resolve =
    'Use your computer access and turn on my DaVinci Resolve and open my recent project please.';
  const followUp = 'Open your latest project and press Alt plus F10 and export this video.';
  await f.send(discord);
  await f.send(resolve);
  await f.send(followUp);
  assert.deepEqual(f.goals, [discord, resolve, followUp]);
  assert.deepEqual(f.taskContexts, [undefined, undefined, { goal: resolve, status: 'completed' }]);
});

test('direct Discord navigation, voice and message requests use only an existing full-access grant', () => {
  for (const text of [
    'Join the General voice channel in Discord.',
    'Connect to Lounge in Discord.',
    'Leave the Discord voice channel.',
    'Disconnect from Discord.',
    'Go to General on Discord.',
    'Switch to the friends list in Discord.',
    'Send "Hello from Capri" in Discord General.',
    'Type "Hello" into Discord.',
    'Капри, подключись к голосовому каналу Общий в Дискорде.',
    'Присоединись к каналу General в Discord.',
    'Выйди из голосового канала в Дискорде.',
    'Перейди в канал Общий в Discord.',
    'Отправь «Привет» в Дискорде.',
    'Напиши «Привет» в Discord.',
  ]) {
    assert.equal(computerModeRequest(text), null, text);
    assert.deepEqual(
      computerModeRequest(text, { fullComputerAccess: true }),
      {
        enabled: true,
        run: true,
      },
      text,
    );
  }
  for (const text of [
    'Can you join Discord voice channels?',
    'Can you join Discord voice channels',
    'Капри, можешь подключаться к голосовым каналам в Дискорде',
    'Explain how to join a Discord voice channel.',
    'Do not join the General voice channel in Discord.',
    'Не подключайся к голосовому каналу в Дискорде.',
    'Write a guide about joining Discord.',
    'Напиши инструкцию о Дискорде.',
    'Write "Join the Discord voice channel" in Notepad.',
  ])
    assert.equal(computerModeRequest(text, { fullComputerAccess: true }), null, text);
  for (const text of [
    'Discord',
    'Дискорде',
    'ディスコードで',
    '디스코드에서',
    '迪斯科德',
    '狄斯科德',
    'ديسكورد',
    'דיסקורד',
    'डिस्कॉर्ड',
  ])
    assert.equal(mentionsDiscord(text), true, text);
  for (const text of ['discordant music', 'Привет, Капри', 'discussion'])
    assert.equal(mentionsDiscord(text), false, text);
});

test('Discord semantic intent can recover a CPU social route across languages without classifying ordinary greetings', async () => {
  const tasks = [
    'Could you join the General voice channel in Discord?',
    'Rejoins le salon vocal Général sur Discord.',
    'Entra al canal de voz General en Discord.',
    'ディスコードで一般のボイスチャンネルに参加して。',
    '디스코드에서 일반 음성 채널에 들어가 줘.',
    '加入迪斯科德的常规语音频道。',
    'انضم إلى القناة الصوتية العامة في ديسكورد.',
    'הצטרפי לערוץ הקולי הכללי בדיסקורד.',
    'डिस्कॉर्ड के General वॉइस चैनल में जुड़ो।',
  ];
  const questions = [
    'Can you join Discord voice channels?',
    'Переведи фразу «подключись к Discord».',
    'Do not join the Discord voice channel.',
  ];
  const classified = [];
  let ordinaryTurns = 0;
  const f = fixture({
    requestRouter: { classify: async () => ({ mode: 'fast', reason: 'simple-dialogue' }) },
    computerIntent: async (text, options) => {
      classified.push(text);
      assert.equal(options.fullComputerAccess, true);
      return { intent: tasks.includes(text) ? 'task' : 'chat', usesPrevious: false };
    },
    prepareContext: null,
    token: () => 'fixture',
    persona: () => 'fixture',
    fetchImpl: async () => {
      ordinaryTurns++;
      return new Response(
        'data: {"choices":[{"delta":{"content":"A normal reply."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  const enabling = f.send('Enable full computer access.');
  f.accept();
  await enabling;
  for (const text of [...tasks, ...questions, 'Hi Capri!']) await f.send(text);
  assert.deepEqual(classified, [...tasks, ...questions]);
  assert.deepEqual(f.goals, tasks);
  assert.equal(ordinaryTurns, questions.length + 1);
  assert.equal(f.dialogs.filter((event) => event.type === 'confirmation.request').length, 1);
});

test('Discord semantic recovery neither creates a grant nor resumes after cancellation', async () => {
  const intent = Promise.withResolvers();
  let classifications = 0;
  const f = fixture({
    requestRouter: { classify: async () => ({ mode: 'fast', reason: 'simple-dialogue' }) },
    computerIntent: async () => {
      classifications++;
      return intent.promise;
    },
    prepareContext: null,
    token: () => 'fixture',
    persona: () => 'fixture',
    fetchImpl: async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"A normal reply."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
  });
  const goal = 'Rejoins le salon vocal Général sur Discord.';
  await f.send(goal);
  assert.equal(classifications, 0);
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.goals, []);
  const enabling = f.send('Enable full computer access.');
  f.accept();
  await enabling;
  const task = f.send(goal);
  for (let i = 0; i < 20 && !classifications; i++) await new Promise(setImmediate);
  assert.equal(classifications, 1);
  f.chat.cancel();
  intent.resolve({ intent: 'task', usesPrevious: false });
  await task;
  assert.deepEqual(f.goals, []);
});

test('chat grants through the timed host dialog and runs every original step once, ahead of narrow skills', async () => {
  const f = fixture();
  const text = 'Enable full computer access and open Spotify, search for Capri and calculate 2+2.';
  const task = f.send(text);
  assert.equal(f.dialogs[0].delayMs, 3000);
  assert.equal('signal' in f.dialogs[0], false, 'AbortSignal must never cross Electron IPC');
  assert.equal(f.confirmations.respond({ id: f.dialogs[0].id, choice: 'confirm' }), false);
  assert.deepEqual(f.goals, []);
  assert.equal(f.modelCalls, 0, 'No unnecessary model loading while owner reviews access');
  assert.equal(f.accept(), true);
  await task;
  assert.deepEqual(f.goals, [text]);
  assert.equal(f.events.at(-1).assistant.computerTask.status, 'completed');
  assert.equal(f.events.at(-1).assistant.followUp, false);
  const another = 'Use full computer control to open Chrome and type Capri.';
  await f.send(another);
  assert.deepEqual(f.goals, [text, another]);
  assert.equal(f.dialogs.filter((event) => event.type === 'confirmation.request').length, 1);
  assert.equal(f.discoveries, 1);
});

test('activation alone does not load or run a model; revocation reports actual state', async () => {
  const f = fixture();
  const task = f.send('Включи режим полного управления компьютером.');
  f.accept();
  await task;
  assert.equal(f.access.enabled, true);
  assert.equal(f.events.at(-1).assistant.text, 'Full computer access is enabled.');
  assert.equal(f.modelCalls, 0);
  assert.deepEqual(f.goals, []);
  await f.send('Disable full computer access.');
  assert.equal(f.access.enabled, false);
  assert.equal(f.events.at(-1).assistant.text, 'Full computer access is off.');
});

test('declining, cancelling a turn or timing out cannot grant access or run a task later', async () => {
  for (const reason of ['decline', 'cancel', 'timeout']) {
    const f = fixture();
    const task = f.send('Use full computer control to open Chrome.');
    const id = f.dialogs[0].id;
    if (reason === 'decline') f.confirmations.respond({ id, choice: 'cancel' });
    if (reason === 'cancel') f.chat.cancel();
    if (reason === 'timeout') f.chat.active.failTurn(new DOMException('Expired', 'TimeoutError'));
    await task;
    assert.equal(f.access.enabled, false, reason);
    assert.equal(f.access.enabling, false, reason);
    assert.equal(f.confirmations.pending, null, reason);
    assert.equal(f.confirmations.respond({ id, choice: 'confirm' }), false, reason);
    assert.deepEqual(f.goals, [], reason);
    assert.equal(f.discoveries, 0, reason);
    assert.equal(f.modelCalls, 0, reason);
    if (reason === 'decline') assert.equal(f.events.at(-1).assistant.text, 'Cancelled.');
  }
});

test('cancel during drive discovery never persists a late permission grant', async () => {
  const f = fixture(),
    controller = new AbortController(),
    drive = Promise.withResolvers();
  f.access.discover = () => drive.promise;
  const task = f.requests.configure(true, { signal: controller.signal });
  f.accept();
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  drive.resolve(['C:\\']);
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal(f.access.enabled, false);
});

test('a busy confirmation or an already cancelled request cannot replace an unrelated owner dialog', async () => {
  const f = fixture(),
    controller = new AbortController();
  const other = f.confirmations.request({ title: 'Unrelated owner action' });
  const id = f.dialogs.at(-1).id;
  assert.equal((await f.requests.configure(true, { signal: controller.signal })).cancelled, true);
  controller.abort();
  await assert.rejects(f.requests.configure(true, { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(f.confirmations.pending.id, id);
  assert.equal(f.access.enabled, false);
  f.confirmations.cancel();
  assert.equal(await other, false);
});

test('model settings and run_task share real host permission and preserve arbitrary-language goals', async () => {
  const f = fixture();
  assert(SETTINGS_SCHEMA.properties.setting.enum.includes('fullComputerAccess'));
  const host = {
    requestComputerAccess: (value, options) => f.requests.configure(value, options),
    runComputerTask: (goal, options) => f.requests.execute(goal, options),
    settings: () => ({ fullComputerAccess: f.access.enabled }),
  };
  const execute = (tool, args, signal) =>
    CompanionActions.prototype.execute.call(host, tool, randomUUID(), args, signal);
  await assert.rejects(
    execute('settings_control', { action: 'set', setting: 'fullComputerAccess', value: true }),
  );
  await assert.rejects(
    execute('settings_control', {
      action: 'request',
      setting: 'fullComputerAccess',
      value: 'true',
    }),
  );
  const grant = execute('settings_control', { action: 'request', setting: 'fullComputerAccess' });
  f.accept();
  assert.equal((await grant).enabled, true);
  const goal = 'Ouvre Chrome, cherche Capri et vérifie les résultats.';
  const result = await execute(
    'desktop_control',
    { action: 'run_task', goal },
    new AbortController().signal,
  );
  assert.equal(result.status, 'completed');
  assert.deepEqual(f.goals, [goal]);
  await execute('settings_control', {
    action: 'request',
    setting: 'fullComputerAccess',
    value: false,
  });
  const next = execute(
    'desktop_control',
    { action: 'run_task', goal },
    new AbortController().signal,
  );
  f.confirmations.cancel();
  assert.equal((await next).cancelled, true);
  assert.deepEqual(f.goals, [goal]);
});
