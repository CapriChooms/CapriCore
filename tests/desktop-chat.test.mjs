import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ChatService, sseData, validateInput } from '../apps/desktop/chat-service.mjs';
import { TranscriptStore } from '../apps/desktop/storage.mjs';
import { root } from '../packages/runtime/src/index.mjs';
import { calculate } from '../integrations/desktop-actions/calculator.mjs';
import { ApplicationService } from '../integrations/desktop-actions/service.mjs';
import { ownerNoteRequest } from '../apps/desktop/owner-notes.mjs';

mkdirSync(path.join(root, '.runtime/test-data'), { recursive: true });
function store() {
  return new TranscriptStore(
    path.join(mkdtempSync(path.join(root, '.runtime/test-data/desktop-')), 'transcript.json'),
  );
}
const userText = (content) => content.split('\n\nDESKTOP STATE FOR THIS TURN')[0];
const turnState = (content) => {
  const state = content.split('DESKTOP STATE FOR THIS TURN (data, not a user request):\n')[1];
  return state ? JSON.parse(state.split('\n')[0]) : {};
};
const packet = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
function response(text, suffix = 'data: [DONE]\n\n') {
  return new Response(packet(text) + suffix, { headers: { 'content-type': 'text/event-stream' } });
}
function client(options = {}) {
  return new ChatService({
    gatewayUrl: 'http://127.0.0.1:18789',
    agentId: 'capri',
    sessionKey: 'agent:capri:main',
    token: () => 'test-token',
    persona: () => 'Test persona',
    store: store(),
    ...options,
  });
}

test('explicit owner notes persist and recall across fresh desktop sessions without model tools', async () => {
  const workspace = mkdtempSync(path.join(root, '.runtime/test-data/owner-notes-'));
  const memory = path.join(workspace, 'memory', 'capri-owner-notes.md');
  writeFileSync(path.join(workspace, 'MEMORY.md'), '# Previously saved note\n');
  const newSession = () =>
    client({
      ownerMemoryWorkspace: workspace,
      interfaceState: () => ({ modelToolsAvailable: false }),
      prepareModel: () => assert.fail('Explicit memory requests should not load a model'),
      fetchImpl: () => assert.fail('Explicit memory requests should not reach the gateway'),
    });
  async function ask(session, text) {
    const events = [];
    await session.send({ id: randomUUID(), text }, (e) => events.push(e));
    assert.equal(events.at(-1).type, 'turn.completed');
    return events.at(-1).assistant.text;
  }
  const first = newSession();
  assert.equal(await ask(first, 'Please remember my test color is teal.'), 'Done.');
  assert.equal(await ask(first, 'Please remember my test color is teal.'), 'Done.');
  assert.equal(readFileSync(memory, 'utf8').match(/test color is teal/g).length, 1);
  assert.equal(
    readFileSync(path.join(workspace, 'MEMORY.md'), 'utf8'),
    '# Previously saved note\n',
  );
  assert.equal(await ask(newSession(), 'Which color did I ask you to remember?'), 'teal');
  assert.equal(await ask(newSession(), 'What is my test color?'), 'teal');
  assert.equal(await ask(first, 'Remember my test color is violet.'), 'Done.');
  assert.equal(await ask(newSession(), 'What is my test color?'), 'violet');
});

test('explicit memory rejects credentials and linked paths without forwarding or falsely claiming success', async () => {
  const workspace = mkdtempSync(path.join(root, '.runtime/test-data/owner-notes-'));
  const outside = path.join(workspace, 'outside.md');
  const memory = path.join(workspace, 'memory', 'capri-owner-notes.md');
  mkdirSync(path.dirname(memory));
  writeFileSync(outside, 'Unchanged');
  linkSync(outside, memory);
  let modelCalls = 0;
  const session = client({
    ownerMemoryWorkspace: workspace,
    fetchImpl: () => {
      modelCalls++;
      return response('I can do that.');
    },
  });
  const ask = async (text) => {
    const events = [];
    await session.send({ id: randomUUID(), text }, (e) => events.push(e));
    return events.at(-1).assistant.text;
  };
  assert.match(await ask('Remember that my test color is teal.'), /could not be saved/);
  assert.match(
    await ask('Remember that my password is synthetic-private.'),
    /can’t save passwords/,
  );
  assert.doesNotMatch(JSON.stringify(session.store.snapshot()), /synthetic-private/);
  assert.equal(modelCalls, 0);
  await ask('Remember that my test color is teal, then open Chrome.');
  assert.equal(modelCalls, 1);
  assert.equal(readFileSync(outside, 'utf8'), 'Unchanged');
});

test('natural explicit memory requests persist across restarts without relying on local or API model tools', async () => {
  for (const modelToolsAvailable of [true, false])
    for (const [text, question, answer] of [
      ['Can you please remember that my test color is teal?', 'What is my test color?', 'teal'],
      ['Could you please remember my test color is teal?', 'What is my test color?', 'teal'],
      ['I want you to remember that my test color is teal.', 'What is my test color?', 'teal'],
      [
        'Remember that my test color is teal and write it down, please.',
        'What is my test color?',
        'teal',
      ],
      ['Please save my test color as teal.', 'What is my test color?', 'teal'],
      ['Store my test color is teal.', 'What is my test color?', 'teal'],
      ['Write down my test color is teal.', 'What is my test color?', 'teal'],
      [
        'Lembre-se de que minha cor de teste é verde-azulado.',
        'Qual é a minha cor de teste?',
        'verde-azulado',
      ],
      [
        'Por favor, anote minha cor de teste é verde-azulado e guarde isso na memória.',
        'Qual é minha cor de teste?',
        'verde-azulado',
      ],
      [
        'Você poderia por favor salvar minha cor de teste como verde-azulado?',
        'Qual é a minha cor de teste?',
        'verde-azulado',
      ],
      [
        'Por favor, salve a minha cor de teste como verde-azulado.',
        'Qual é a minha cor de teste?',
        'verde-azulado',
      ],
      ['Remember my favorite word is please.', 'What is my favorite word?', 'please'],
      ['Remember that my page count is 24.', 'What is my page count?', '24'],
      ['Remember my favorite browser is Firefox.', 'What is my favorite browser?', 'Firefox'],
      [
        'Lembre-se de que minha página favorita é documentação.',
        'Qual é minha página favorita?',
        'documentação',
      ],
    ]) {
      const workspace = mkdtempSync(path.join(root, '.runtime/test-data/owner-notes-'));
      const newSession = () =>
        client({
          ownerMemoryWorkspace: workspace,
          interfaceState: () => ({ modelToolsAvailable, languages: { conversation: 'en' } }),
          prepareModel: () => assert.fail('Saving a supplied fact must not start a model'),
          fetchImpl: () => assert.fail('Saving a supplied fact must not depend on provider tools'),
        });
      const ask = async (session, text) => {
        const events = [];
        await session.send({ id: randomUUID(), text }, (event) => events.push(event));
        assert.equal(events.at(-1).type, 'turn.completed');
        return events.at(-1).assistant.text;
      };
      assert.equal(await ask(newSession(), text), 'Done.', text);
      assert.equal(await ask(newSession(), question), answer, text);
      assert(
        !readFileSync(path.join(workspace, 'memory/capri-owner-notes.md'), 'utf8').includes(
          'write it down',
        ),
      );
    }
});

test('memory wording never consumes quoted, negated, file or combined app requests', () => {
  for (const text of [
    'Do not remember that my test color is teal.',
    'Never save my test color as teal.',
    'Não salve minha cor de teste como verde-azulado.',
    '"Remember that my test color is teal."',
    'Translate: remember that my test color is teal.',
    'Can you save documents?',
    'Save my report as monthly.pdf.',
    'Save my file as C:\\folder\\result.txt.',
    'Salve meu documento como resultado.pdf.',
    'Record my screen as MP4.',
    'Save my work as backup.',
    'Registre minha tela como MP4.',
    'Save my tab as a PDF.',
    'Save my current page as an HTML file.',
    'Save my window as an image.',
    'Save my bookmarks as backup.',
    'Save my selection as plain text.',
    'Save my clipboard contents as text.',
    'Save my selected text as a PDF.',
    'Salve minha aba como PDF.',
    'Salve minha guia como PDF.',
    'Salve a minha página como PDF.',
    'Salve minha janela como imagem.',
    'Salve meus favoritos como backup.',
    'Salve minha seleção como texto.',
    'Salve minha área de transferência como texto.',
    'Remember that my test color is teal and write it down, then open Chrome.',
    'Save my test color as teal and please open Chrome.',
    'Remember that my test color is teal and play Spotify.',
    'Anote minha cor de teste é verde-azulado e por favor abra o Chrome.',
  ])
    assert.equal(ownerNoteRequest(text), null, text);
});

test('new memory request forms still refuse Portuguese secrets before persistence, transcript or provider calls', async () => {
  for (const text of [
    'Lembre-se de que minha senha é synthetic-private.',
    'Salve minha chave de API como synthetic-private.',
    'Anote meu código de acesso é synthetic-private.',
    'Guarde minha frase de recuperação é synthetic-private.',
    'Anote meu token de acesso é synthetic-private.',
    'Salve minha chave API como synthetic-private.',
    'Salve a minha senha como synthetic-private.',
    'Anote meu PIN é synthetic-private.',
  ]) {
    const workspace = mkdtempSync(path.join(root, '.runtime/test-data/owner-notes-'));
    const session = client({
      ownerMemoryWorkspace: workspace,
      fetchImpl: () => assert.fail('Credentials must not reach a model'),
    });
    const events = [];
    await session.send({ id: randomUUID(), text }, (event) => events.push(event));
    assert.match(events.at(-1).assistant.text, /can’t save passwords/);
    assert(!JSON.stringify(session.store.snapshot()).includes('synthetic-private'));
    assert(!JSON.stringify(events).includes('synthetic-private'));
  }
});

test('Lemonade dialogue uses recent clean turns without OpenClaw tools, compaction or leaked avatar frames', async () => {
  const transcript = store();
  for (const [turnId, question, reply, status] of [
    [
      'answered',
      'Меня зовут Тест.',
      '[аватар:nervous; standing]\nХорошо.\nDETECTED DESK STATE:\nprivate old report',
      'complete',
    ],
    ['failed', 'Do not replay this request.', 'Incomplete output', 'error'],
  ]) {
    const base = { turnId, createdAt: new Date().toISOString() };
    transcript.put({ ...base, id: randomUUID(), role: 'user', text: question, status: 'complete' });
    transcript.put({ ...base, id: randomUUID(), role: 'assistant', text: reply, status });
  }
  const events = [];
  const commits = [];
  const service = client({
    store: transcript,
    interfaceState: () => ({
      fullComputerAccess: false,
      modelToolsAvailable: false,
      languages: { conversation: 'ru' },
    }),
    computerIntent: () => assert.fail('Ordinary NPU dialogue should make one model request'),
    fetchImpl: () => assert.fail('The NPU dialogue must not go through OpenClaw'),
    commitNpuDialogue: async (user, assistant) => commits.push([user.text, assistant.text]),
    npuDialogue: async (payload) => {
      assert.deepEqual(payload.messages.slice(1), [
        { role: 'user', content: 'Меня зовут Тест.' },
        { role: 'assistant', content: 'Хорошо.' },
        { role: 'user', content: 'Как меня зовут?' },
      ]);
      assert.equal(payload.max_tokens, 512);
      assert.equal(payload.stop.length, 4);
      assert(!Object.hasOwn(payload, 'tools'));
      assert.match(payload.messages[0].content, /Отвечай только на русском/);
      return new Response(
        packet('[ават') +
          packet('ар:nervous; standing]\nТест.') +
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await service.send({ id: randomUUID(), text: 'Как меня зовут?' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Тест.');
  assert.deepEqual(commits, [['Как меня зовут?', 'Тест.']]);
});

test('core loop diagnostics never enter subtitles, speech or transcript, even split into individual characters', async () => {
  for (const message of [
    'OpenClaw stopped this run because tool-loop recovery encountered another critical loop.',
    'OpenClaw stopped this turn after 3 consecutive identical tool failures.',
  ]) {
    const events = [];
    const service = client({
      fetchImpl: async () =>
        new Response([...message].map(packet).join('') + 'data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
    await service.send({ id: randomUUID(), text: 'Open Chrome.' }, (event) => events.push(event));
    assert.equal(events.at(-1).type, 'turn.failed');
    assert.equal(events.at(-1).assistant.text, '');
    assert.match(events.at(-1).message, /repeated attempts/);
    assert.equal(service.diagnostics().lastFailure.code, 'CAPRI_TOOL_LOOP');
    assert.equal(events.filter((event) => event.type === 'turn.delta').length, 0);
    assert.doesNotMatch(JSON.stringify(service.store.snapshot()), /OpenClaw stopped/);
  }
});

test('reason-only gateway tool-loop errors are classified without retrying the turn', async () => {
  const events = [];
  let requests = 0;
  const service = client({
    fetchImpl: async () => {
      requests++;
      return new Response(
        'data: {"error":{"message":"after 3 consecutive identical tool failures"}}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await service.send({ id: randomUUID(), text: 'Open Chrome.' }, (event) => events.push(event));
  assert.equal(requests, 1);
  assert.equal(events.at(-1).type, 'turn.failed');
  assert.match(events.at(-1).message, /repeated attempts/);
  assert.equal(service.diagnostics().lastFailure.code, 'CAPRI_TOOL_LOOP');
  assert.doesNotMatch(JSON.stringify(service.store.snapshot()), /identical tool failures/);
});

test('three failed local calls stop the current turn as a recoverable error, not a user cancellation', async () => {
  const events = [];
  const service = client({
    fetchImpl: async (_url, { signal }) => {
      for (let n = 0; n < 3; n++)
        service.recordToolResult('desktop_control', { action: 'type_text' }, { ok: false });
      assert.equal(signal.aborted, true);
      signal.throwIfAborted();
    },
  });
  await service.send({ id: randomUUID(), text: 'Type Capri in Chrome.' }, (event) =>
    events.push(event),
  );
  assert.equal(events.at(-1).type, 'turn.failed');
  assert.equal(service.diagnostics().lastFailure.code, 'CAPRI_TOOL_LOOP');
});

test('opening Chrome cannot hide a later failed typing step behind an opening receipt', async () => {
  const events = [];
  const service = client({
    fetchImpl: async () => {
      service.recordToolResult(
        'desktop_control',
        { action: 'launch' },
        { ok: true, windowVerified: true },
      );
      service.recordToolResult(
        'desktop_control',
        { action: 'inspect' },
        { ok: false, error: { code: 'missing_app_id' } },
      );
      return response('Chrome is open, but no text was entered.');
    },
  });
  await service.send(
    { id: randomUUID(), text: 'Open Chrome and type Capri in the search bar.' },
    (e) => events.push(e),
  );
  assert.equal(events.at(-1).assistant.text, 'Chrome is open, but no text was entered.');
});

test('an incomplete computer task reports the executor result instead of asking for access again', async () => {
  const events = [];
  const service = client({
    fetchImpl: async () => {
      service.recordToolResult(
        'desktop_control',
        { action: 'run_task' },
        { ok: false, status: 'incomplete', steps: 1, summary: 'The foreground window changed.' },
      );
      return response('Please give me the green light again.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Get the Discord window ready, please.' }, (event) =>
    events.push(event),
  );
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'The foreground window changed.');
  assert.deepEqual(events.at(-1).assistant.computerTask, { status: 'incomplete', steps: 1 });
});

test('a later tool failure invalidates an earlier successful receipt rather than concealing incomplete work', async () => {
  const events = [];
  const service = client({
    fetchImpl: async () => {
      service.recordToolResult(
        'desktop_control',
        { action: 'browser_input' },
        { ok: true, typed: true, submitted: false },
      );
      service.recordToolResult(
        'desktop_control',
        { action: 'inspect' },
        { ok: false, error: { code: 'window_changed' } },
      );
      return response('The draft was entered, but I could not verify the next step.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Enter Capri and inspect the next step.' }, (e) =>
    events.push(e),
  );
  assert.match(events.at(-1).assistant.text, /could not verify/);
});

test('music acknowledgements use local verified volume, and an invented completion is never displayed or spoken', async () => {
  const events = [];
  let verified = false;
  const service = client({
    interfaceState: () => ({
      spotify: { enabled: true, prepared: true },
      languages: { conversation: 'en' },
    }),
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['x-capri-tools-once'], 'spotify');
      if (verified)
        service.recordToolResult(
          'spotify_control',
          { action: 'volume', delta: -10 },
          { ok: true, data: { volumePercent: 25 } },
        );
      return response('Volume set even lower. What is on your mind?');
    },
  });
  await service.send({ id: randomUUID(), text: 'Set the volume even lower.' }, (e) =>
    events.push(e),
  );
  assert.match(events.at(-1).assistant.text, /Spotify did not confirm/);
  assert.doesNotMatch(
    events
      .filter((e) => e.type === 'turn.delta')
      .map((e) => e.text)
      .join(''),
    /Volume set even lower/,
  );
  verified = true;
  events.length = 0;
  await service.send({ id: randomUUID(), text: 'Set the volume even lower.' }, (e) =>
    events.push(e),
  );
  assert.equal(events.at(-1).assistant.text, 'Spotify volume: 25%.');
  assert.equal(events.at(-1).assistant.followUp, false);
});

test('music opinions keep the model answer without requiring a player action, including after playback', async () => {
  const events = [];
  const opinion = 'I like its rhythm.';
  let action = true;
  let playerCalls = 0;
  const service = client({
    interfaceState: () => ({
      spotify: { enabled: true, prepared: true },
      fullComputerAccess: true,
      languages: { conversation: 'en' },
    }),
    requestRouter: { classify: () => ({ mode: 'normal', reason: 'task-cue' }) },
    computerIntent: () => assert.fail('Music discussion must not start desktop intent'),
    fetchImpl: async (_url, options) => {
      if (action) {
        assert.equal(options.headers['x-capri-tools-once'], 'spotify');
        playerCalls++;
        service.recordToolResult(
          'spotify_control',
          { action: 'pause' },
          { ok: true, data: { playing: false } },
        );
        return response('Paused.');
      }
      assert.notEqual(options.headers['x-capri-tools-once'], 'spotify');
      assert.match(JSON.parse(options.body).messages[0].content, /ordinary conversation/);
      return response(opinion);
    },
  });
  await service.send({ id: randomUUID(), text: 'Pause Spotify.' }, (e) => events.push(e));
  assert.equal(events.at(-1).assistant.text, 'Paused.');
  action = false;
  for (const text of [
    'Do you like this music?',
    'Do you like to play music?',
    'What do you think of this song?',
    'Тебе нравится громкая музыка?',
    '¿Te gusta esta música de Spotify?',
    'Tu aimes cette chanson sur Spotify ?',
    'Gefällt dir dieses Lied auf Spotify?',
    'Você gosta desta música no Spotify?',
    'Spotifyのこの曲は好き？',
    'هل تعجبك هذه الأغنية على Spotify؟',
  ]) {
    events.length = 0;
    await service.send({ id: randomUUID(), text }, (e) => events.push(e));
    assert.equal(events.at(-1).type, 'turn.completed', text);
    assert.equal(events.at(-1).assistant.text, opinion, text);
    assert.equal(
      events
        .filter((e) => e.type === 'turn.delta')
        .map((e) => e.text)
        .join(''),
      opinion,
      text,
    );
    assert.equal(playerCalls, 1, text);
  }
});

test('unfamiliar Spotify wording keeps normal model tools without implicit computer control', async () => {
  const events = [];
  const service = client({
    interfaceState: () => ({
      fullComputerAccess: true,
      spotify: { enabled: true, prepared: true },
    }),
    computerIntent: () => assert.fail('Spotify must not implicitly become a desktop task'),
    computerTask: () => assert.fail('No computer session was requested'),
    fetchImpl: () => {
      assert.throws(() => service.assertToolAllowed('desktop_control', { action: 'run_task' }), {
        code: 'SPOTIFY_DEDICATED_ACTION_REQUIRED',
      });
      service.assertToolAllowed('spotify_control', { action: 'play' });
      service.recordToolResult(
        'spotify_control',
        { action: 'play' },
        { ok: true, data: { playing: true } },
      );
      return response('Resumed.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Reproduce esta canción en Spotify.' }, (e) =>
    events.push(e),
  );
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Resumed.');
});

test('a calculator answer comes from its verified numeric result rather than generated arithmetic', async () => {
  const events = [];
  const service = client({
    interfaceState: () => ({ applications: { calculator: true } }),
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['x-capri-tools-once'], 'calculator');
      service.recordToolResult(
        'application_control',
        { action: 'calculate' },
        { ok: true, result: '32.18695387886216' },
      );
      return response('The answer is 30. Would you like more?');
    },
  });
  await service.send({ id: randomUUID(), text: 'Square root of 1036?' }, (e) => events.push(e));
  assert.equal(events.at(-1).assistant.text, 'Result: 32.18695387886216');
});

test('explicit named Spotify play executes once without model preparation or generated tool syntax', async () => {
  const events = [],
    calls = [];
  const service = client({
    interfaceState: () => ({ spotify: { enabled: true, prepared: true } }),
    prepareModel: () => assert.fail('A named Spotify command must not load the LLM'),
    fetchImpl: () => assert.fail('A named Spotify command must not reach the gateway'),
    localMusic: (input, args, signal) => {
      calls.push({ id: input.id, args });
      assert.equal(signal.aborted, false);
      return Promise.resolve({ ok: true, data: { playing: true } });
    },
  });
  const id = randomUUID();
  await service.send({ id, text: 'Play Example Artist - Example Title on Spotify' }, (e) =>
    events.push(e),
  );
  assert.deepEqual(calls, [
    { id, args: { action: 'play', query: 'Example Artist - Example Title' } },
  ]);
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Resumed.');
  assert.deepEqual(
    events.filter((e) => e.type === 'turn.tool').map((e) => e.phase),
    ['start', 'result'],
  );
});

test('named Spotify play respects permissions and never claims unverified playback or retries', async () => {
  let enabled = false,
    prepared = true,
    calls = 0;
  const service = client({
    interfaceState: () => ({ spotify: { enabled, prepared } }),
    fetchImpl: () => response('Hello.'),
    localMusic: async () => {
      calls++;
      return { ok: true, data: { playing: false } };
    },
  });
  await service.send(
    { id: randomUUID(), text: 'Play Example Artist - Example Title on Spotify' },
    () => {},
  );
  enabled = true;
  prepared = false;
  await service.send(
    { id: randomUUID(), text: 'Play Example Artist - Example Title on Spotify' },
    () => {},
  );
  assert.equal(calls, 0);
  prepared = true;
  for (const execute of [
    async () => ({ ok: true, data: { playing: false } }),
    async () => ({ ok: false }),
    async () => {
      throw new Error('No player receipt');
    },
  ]) {
    service.localMusic = () => {
      calls++;
      return execute();
    };
    const events = [];
    await service.send(
      { id: randomUUID(), text: 'Play Example Artist - Example Title on Spotify' },
      (e) => events.push(e),
    );
    assert.equal(
      events.at(-1).assistant.text,
      'Spotify did not confirm this action. Check the player.',
    );
  }
  assert.equal(calls, 3);
});

test('ordinary music and unqualified artist requests use an isolated plan and verified Spotify receipts', async () => {
  const calls = [],
    plans = [],
    events = [];
  const service = client({
    interfaceState: () => ({ spotify: { enabled: true, prepared: true } }),
    fetchImpl: () => assert.fail('Music must not use the general gateway conversation'),
    prepareModel: () => assert.fail('Isolated planning owns its inference'),
    computerTask: () => assert.fail('No desktop session for music'),
    prepareMusic: async (text) => {
      plans.push(text);
      return text.includes('Artist')
        ? { action: 'play', query: 'Example Artist' }
        : { action: 'resume' };
    },
    localMusic: async (_input, args) => {
      calls.push(args);
      return { ok: true, data: { playing: true } };
    },
  });
  for (const text of ['Play some nice music', 'Play Example Artist'])
    await service.send({ id: randomUUID(), text }, (e) => events.push(e));
  assert.deepEqual(plans, ['Play some nice music', 'Play Example Artist']);
  assert.deepEqual(calls, [{ action: 'resume' }, { action: 'play', query: 'Example Artist' }]);
  assert.equal(events.filter((e) => e.type === 'turn.completed').length, 2);
  assert(
    events.filter((e) => e.type === 'turn.completed').every((e) => e.assistant.text === 'Resumed.'),
  );
});

test('Spotify planning respects permissions, cancellation and non-music verdicts without side effects', async () => {
  let enabled = false,
    modelCalls = 0,
    planning = 0;
  const service = client({
    interfaceState: () => ({ spotify: { enabled, prepared: true } }),
    prepareMusic: async () => {
      planning++;
      return null;
    },
    localMusic: () => assert.fail('A rejected plan must never execute'),
    fetchImpl: () => {
      modelCalls++;
      return response('Hello.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Play Example Artist' }, () => {});
  assert.equal(planning, 0);
  enabled = true;
  await service.send({ id: randomUUID(), text: 'Play chess' }, () => {});
  assert.equal(planning, 1);
  assert.equal(modelCalls, 2);
  const id = randomUUID(),
    events = [];
  service.prepareMusic = async () => {
    service.cancel(id);
    return { action: 'resume' };
  };
  await service.send({ id, text: 'Play some nice music' }, (e) => events.push(e));
  assert.equal(events.at(-1).type, 'turn.cancelled');
});

test('standalone calculator requests return the local result without preparing a model or opening a window', async () => {
  const events = [];
  const service = client({
    interfaceState: () => ({ applications: { calculator: true } }),
    prepareModel: () => assert.fail('A standalone calculation does not need model context'),
    fetchImpl: () => assert.fail('A standalone calculation does not need the gateway'),
    localCalculation: (_input, args, signal) => {
      assert.deepEqual(args, {
        action: 'calculate',
        app: 'calculator',
        expression: 'sqrt(2653)',
        showWindow: false,
      });
      return calculate(args, { signal });
    },
  });
  await service.send({ id: randomUUID(), text: 'What is the square root of 2653?' }, (event) =>
    events.push(event),
  );
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Result: 51.50728103870364');
  assert.equal(service.store.snapshot().at(-2).text, 'What is the square root of 2653?');
  service.prepareModel = null;
  let followUpSent = false;
  service.fetchImpl = (_url, { body }) => {
    assert.deepEqual(turnState(JSON.parse(body).messages[1].content).previousCalculation, {
      expression: 'sqrt(2653)',
      result: '51.507281038703644621641238381440686429296643267178',
    });
    followUpSent = true;
    return response('About 52 when rounded.');
  };
  await service.send({ id: randomUUID(), text: 'Round that to the nearest integer.' }, () => {});
  assert.equal(followUpSent, true);
});

test('standalone calculations respect app permissions and leave compound requests on the model route', async () => {
  let calculator = false;
  let modelCalls = 0;
  const service = client({
    interfaceState: () => ({ applications: { calculator } }),
    localCalculation: () => assert.fail('This request cannot bypass the gateway'),
    fetchImpl: () => {
      modelCalls++;
      return response('Hello.');
    },
  });
  for (const text of [
    'Капри, вычисли квадратный корень из 2653',
    'Calculate 3^4 + 6! - sqrt(949) via calculator',
  ])
    await service.send({ id: randomUUID(), text }, () => {});
  calculator = true;
  for (const text of [
    'Calculate sqrt(2653) and explain the result.',
    'Calculate 3^4 + 6! - sqrt(949) via calculator and explain the result.',
  ])
    await service.send({ id: randomUUID(), text }, () => {});
  assert.equal(modelCalls, 4);
});

test('calculator requests with app wording and postfix factorial use verified local results and preserve their expressions', async () => {
  const applications = new ApplicationService({
    root,
    database: ':memory:',
    permissionSnapshot: () => ({ calculator: true, notepad: false }),
    bridge: () => assert.fail('Standalone arithmetic must not open Windows Calculator'),
  });
  const calls = [];
  const service = client({
    interfaceState: () => ({ applications: { calculator: true } }),
    prepareModel: () => assert.fail('Standalone arithmetic must not load a model'),
    fetchImpl: () => assert.fail('Standalone arithmetic must not reach the gateway'),
    localCalculation: (input, args, signal) => {
      calls.push(args);
      return applications.execute(input.id, args, signal);
    },
  });
  try {
    for (const [text, expression, result, display] of [
      [
        'Calculate 3^4 + 6! - sqrt(949) via calculator',
        '3^4 + 6! - sqrt(949)',
        '770.19415639850127395963027903809915957741222136939',
        '770.1941563985013',
      ],
      ['Calculate 6!', '6!', '720', '720'],
    ]) {
      const id = randomUUID();
      const events = [];
      await service.send({ id, text }, (event) => events.push(event));
      assert.deepEqual(calls.at(-1), {
        action: 'calculate',
        app: 'calculator',
        expression,
        showWindow: false,
      });
      assert.equal(events.at(-1).type, 'turn.completed');
      const assistant = events.at(-1).assistant;
      assert.equal(assistant.text, 'Result: ' + display);
      assert.equal(assistant.followUp, false);
      assert.deepEqual(assistant.localCalculation, { expression, result });
      const history = service.store.snapshot();
      assert.equal(history.at(-2).text, text);
      assert.equal(history.at(-2).turnId, id);
      assert.deepEqual(history.at(-1), assistant);
      assert.deepEqual(
        JSON.parse(readFileSync(service.store.file, 'utf8')).messages.at(-1),
        assistant,
      );
    }
    assert.equal(calls.length, 2);
  } finally {
    await applications.close();
  }
});

test('live clocks, permissions and repetition hints do not invalidate the system prefix or enter visible history', async () => {
  const seen = [];
  let state = {
    temporalContext: 'Elapsed: 26',
    microphone: true,
    followUp: true,
    screenObservation: { active: false },
  };
  const service = client({
    interfaceState: () => state,
    fetchImpl: async (_url, options) => {
      seen.push(JSON.parse(options.body).messages);
      return response('This fixture repeats its opening deliberately.');
    },
  });
  for (let n = 0; n < 4; n++) {
    state = {
      ...state,
      temporalContext: 'Elapsed: ' + (26 + n),
      microphone: n % 2 === 0,
      recentScreenshot: n ? { path: 'never-serialize-this' } : null,
    };
    await service.send({ id: randomUUID(), text: 'Test ' + n }, () => {});
  }
  for (const [n, messages] of seen.entries()) {
    assert.equal(messages[0].content, seen[0][0].content);
    assert.equal(turnState(messages[1].content).liveClock, 'Elapsed: ' + (26 + n));
    assert.equal(turnState(messages[1].content).followUp, n % 2 === 0);
    assert.doesNotMatch(messages[1].content, /never-serialize-this/);
    assert.equal(userText(messages[1].content), 'Test ' + n);
  }
  assert.equal(turnState(seen[3][1].content).varyRepeatedWording, true);
  assert.ok(service.store.snapshot().every((m) => !m.text.includes('DESKTOP STATE')));
});

test('typed chat stays independent of microphone and voice state for both tool and text-only models', async () => {
  for (const modelToolsAvailable of [true, false]) {
    const sent = [];
    const service = client({
      interfaceState: () => ({ modelToolsAvailable, microphone: false, microphoneLanguage: 'en' }),
      fetchImpl: async (_url, options) => {
        sent.push(JSON.parse(options.body).messages);
        return response('Hello.');
      },
    });
    await service.send({ id: randomUUID(), text: 'Hello' }, () => {});
    const [system, owner] = sent[0];
    assert.match(
      system.content,
      /latest user message is available as text regardless of the current microphone state/,
    );
    assert.match(
      system.content,
      /Text chat, microphone capture and spoken replies are independent/,
    );
    assert.match(system.content, /Never infer internet status or hardware faults from audio flags/);
    assert.doesNotMatch(system.content, /input is currently switched off/);
    assert.equal(userText(owner.content), 'Hello');
    assert.equal(turnState(owner.content).microphone, undefined);
    assert.equal(service.store.snapshot().at(-1).text, 'Hello.');
  }
});

test('cold model preparation has its own phase and does not spend the first-text deadline or repeat input', async () => {
  let prepared = false,
    calls = 0;
  const service = client({
    firstTextTimeoutMs: 15,
    timeoutMs: 1000,
    prepareModel: async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 45));
      signal.throwIfAborted();
      prepared = true;
      return { cold: true };
    },
    prepareContext: () => {
      assert.equal(prepared, true, 'capture fresh context after cold loading, not before');
      return {};
    },
    fetchImpl: async (_url, options) => {
      assert.equal(prepared, true);
      assert.equal(userText(JSON.parse(options.body).messages.at(-1).content), 'Hello Capri');
      assert.match(JSON.parse(options.body).messages[0].content, /never invent a view/);
      assert.doesNotMatch(JSON.parse(options.body).messages[1].content, /fullComputerAccess/);
      calls++;
      return response('Hello.');
    },
  });
  const events = [];
  await service.send({ id: randomUUID(), text: 'Hello Capri' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(calls, 1);
  assert.equal(service.diagnostics().lastPreparation.cold, true);
  assert.ok(service.diagnostics().lastPreparation.elapsedMs >= 40);
});

test('conversation prefill can outlast the warm first-text window without replaying the prompt', async () => {
  let calls = 0;
  const events = [];
  const service = client({
    firstTextTimeoutMs: 15,
    timeoutMs: 500,
    prepareModel: async () => ({
      cold: false,
      conversationBudget: {
        firstTextTimeoutMs: 200,
        promptTokens: 30460,
        source: 'gateway-estimate',
      },
    }),
    fetchImpl: async (_url, { signal }) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 55));
      signal.throwIfAborted();
      return response('Hello, choom.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Hello.' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(calls, 1);
  assert.equal(service.diagnostics().lastPreparation.conversationBudget.promptTokens, 30460);
});

test('extra prefill allowance cannot disable cancellation or the absolute deadline', async () => {
  for (const cancel of [false, true]) {
    const events = [];
    const service = client({
      firstTextTimeoutMs: 15,
      timeoutMs: 70,
      prepareModel: async () => ({ conversationBudget: { firstTextTimeoutMs: 10000 } }),
      fetchImpl: async (_url, { signal }) => {
        if (cancel) setTimeout(() => service.cancel(), 20);
        await new Promise((resolve) => setTimeout(resolve, 110));
        signal.throwIfAborted();
        return response('Must never arrive.');
      },
    });
    await service.send({ id: randomUUID(), text: 'Hello.' }, (event) => events.push(event));
    assert(!events.some((event) => event.type === 'turn.completed'));
    assert.equal(
      events.some((event) => event.type === 'turn.delta'),
      false,
    );
    assert.equal(service.active, null);
  }
});

test('failed or cancelled model preparation never submits the user command to the agent', async () => {
  const events = [];
  const service = client({
    prepareModel: async () => {
      throw Object.assign(new Error('Could not load'), { code: 'CAPRI_MODEL_NOT_READY' });
    },
    fetchImpl: async () => assert.fail('Agent called before preparation'),
  });
  await service.send({ id: randomUUID(), text: 'Play music' }, (event) => events.push(event));
  assert.match(events.at(-1).message, /local model could not load/);
  assert.equal(service.diagnostics().lastFailure.phase, 'model-loading');
  assert.equal(service.diagnostics().lastFailure.code, 'CAPRI_MODEL_NOT_READY');
  service.prepareModel = ({ signal }) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  const id = randomUUID();
  const pending = service.send({ id, text: 'Play music' }, (event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));
  service.cancel(id);
  await pending;
  assert.equal(events.at(-1).type, 'turn.cancelled');
});

test('compaction failures report context recovery guidance without replaying user commands', async () => {
  let calls = 0;
  const events = [];
  const service = client({
    fetchImpl: async () => {
      calls++;
      return new Response(
        'data: ' +
          JSON.stringify({
            error: {
              message:
                'Preflight compaction required but failed: Compaction safeguard finalized summary failed quality checks.',
            },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await service.send({ id: randomUUID(), text: 'Hello Capri' }, (event) => events.push(event));
  assert.equal(calls, 1);
  assert.match(
    events.find((event) => event.type === 'turn.failed').message,
    /context could not be compacted/,
  );
  assert.equal(service.diagnostics().lastFailure.code, 'CONTEXT_COMPACTION_FAILED');
  assert.equal(service.diagnostics().lastFailure.receivedText, false);
});

test('chat waits for current screen context and never silently substitutes a stale summary', async () => {
  let prepared = false,
    received;
  const service = client({
    interfaceState: () => ({
      screenObservation: { active: true, observation: { summary: 'Stale frame', capturedAt: 0 } },
    }),
    prepareContext: async (input, { signal }) => {
      assert.equal(signal.aborted, false);
      assert.equal(input.text, 'Look now');
      prepared = true;
      return {
        screenObservation: {
          active: true,
          current: true,
          observation: { summary: 'Fresh frame', capturedAt: Date.now() },
        },
      };
    },
    fetchImpl: async (_url, options) => {
      assert.equal(prepared, true);
      received = JSON.parse(options.body);
      return response('I see it.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Look now' }, () => {});
  assert.match(received.messages[1].content, /Fresh frame/);
  assert.doesNotMatch(received.messages[1].content, /Stale frame/);
  service.prepareContext = async () => {
    throw new Error('Capture unavailable');
  };
  const events = [];
  await service.send({ id: randomUUID(), text: 'Again' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.failed');
});

test('stream parser preserves UTF-8 and SSE events across arbitrary packet boundaries', async () => {
  const text = ': keepalive\r\ndata: {"text":\r\ndata: "Hi, Капри ✨"}\r\n\r\ndata: [DONE]\n\n';
  const bytes = Buffer.from(text);
  const result = [];
  for await (const data of sseData(Readable.from([...bytes].map((byte) => Buffer.from([byte])))))
    result.push(data);
  assert.deepEqual(result, ['{"text":\n"Hi, Капри ✨"}', '[DONE]']);
});

test('stream parser rejects truncated events and unbounded unterminated lines', async () => {
  for (const value of ['data: {"unfinished":true}', 'data: ' + 'x'.repeat(270000)]) {
    await assert.rejects(async () => {
      for await (const _data of sseData(Readable.from([Buffer.from(value)]))) {
      }
    });
  }
});

test('desktop sends only new input and hot-read persona to the existing shared session', async () => {
  const seen = [],
    events = [];
  let persona = 'Original persona';
  const service = client({
    persona: () => persona,
    fetchImpl: async (url, options) => {
      seen.push({ url, ...options, body: JSON.parse(options.body) });
      return response('Hello.');
    },
  });
  await service.send({ id: randomUUID(), text: 'First message' }, (event) => events.push(event));
  persona = 'Updated persona';
  await service.send({ id: randomUUID(), text: 'Second message' }, (event) => events.push(event));
  assert.equal(seen.length, 2);
  for (const item of seen) {
    assert.equal(item.headers.authorization, 'Bearer test-token');
    assert.equal(item.headers['x-openclaw-session-key'], 'agent:capri:main');
    assert.equal(item.headers['x-openclaw-message-channel'], 'webchat');
    assert.equal(item.body.model, 'openclaw/capri');
    assert.equal(item.body.stream, true);
    assert.equal(item.body.messages.length, 2);
    assert.match(item.body.messages[0].content, /CURRENT CONVERSATION LANGUAGE: "English"/);
    assert.equal(item.redirect, 'error');
  }
  assert.match(seen[1].body.messages[0].content, /^Updated persona/);
  assert.equal(userText(seen[1].body.messages[1].content), 'Second message');
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(service.store.snapshot().length, 4);
});

test('desktop music instructions reflect actual disabled and enabled Spotify settings', async () => {
  const prompts = [];
  let spotify = { enabled: false, prepared: false };
  const service = client({
    interfaceState: () => ({ spotify }),
    fetchImpl: async (_url, options) => {
      prompts.push(JSON.parse(options.body).messages);
      return response('Fixture.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Can you use Spotify?' }, () => {});
  assert.match(prompts[0][0].content, /Settings → Application access → Spotify/);
  assert.equal(turnState(prompts[0][1].content).spotify.enabled, false);
  spotify = { enabled: true, prepared: true };
  await service.send({ id: randomUUID(), text: 'Can you use Spotify?' }, () => {});
  assert.match(prompts[1][0].content, /Only when spotify_control is actually listed/);
  assert.equal(turnState(prompts[1][1].content).spotify.enabled, true);
  assert.equal(prompts[0][0].content, prompts[1][0].content);
});

test('aborted request releases the active turn; duplicates and concurrent sends are rejected', async () => {
  let received;
  const service = client({
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        received = true;
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }),
  });
  const id = randomUUID(),
    events = [];
  const pending = service.send({ id, text: 'Wait' }, (event) => events.push(event));
  assert.ok(received);
  await assert.rejects(
    service.send({ id: randomUUID(), text: 'Overlap' }, () => {}),
    /already in progress/,
  );
  assert.equal(service.cancel(id), true);
  await pending;
  assert.equal(events.at(-1).type, 'turn.cancelled');
  assert.equal(service.active, null);
  await assert.rejects(
    service.send({ id, text: 'Wait' }, () => {}),
    /already been submitted/,
  );
  service.fetchImpl = async () => response('Recovered');
  await service.send({ id: randomUUID(), text: 'Next' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.completed');
});
test('microphone capability reflects current capture without changing shared conversation or input', async () => {
  let microphone = false;
  const seen = [];
  const service = client({
    interfaceState: () => ({ microphone }),
    fetchImpl: async (_url, options) => {
      seen.push({ headers: options.headers, body: JSON.parse(options.body) });
      return response('Hello.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Typed input' }, () => {});
  microphone = true;
  await service.send({ id: randomUUID(), text: 'RECOGNIZED INPUT' }, () => {});
  assert.equal(turnState(seen[0].body.messages[1].content).microphone, false);
  assert.equal(turnState(seen[1].body.messages[1].content).microphone, true);
  assert.equal(turnState(seen[1].body.messages[1].content).speechLanguage, 'English');
  assert.equal(seen[0].body.messages[0].content, seen[1].body.messages[0].content);
  assert.equal(userText(seen[1].body.messages[1].content), 'RECOGNIZED INPUT');
  assert.equal(
    seen[0].headers['x-openclaw-session-key'],
    seen[1].headers['x-openclaw-session-key'],
  );
});

test('social routing preserves shared history and leaves task tools available on the next turn', async () => {
  const seen = [],
    requests = [],
    events = [];
  const modes = ['fast', 'normal'];
  const service = client({
    requestRouter: {
      classify: async (text, options) => {
        requests.push({ text, context: options.context });
        return { mode: modes.shift(), reason: 'fixture' };
      },
    },
    fetchImpl: async (_url, options) => {
      seen.push({ headers: options.headers, body: JSON.parse(options.body) });
      return response('Hello.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Hello Capri.' }, (e) => events.push(e));
  await service.send({ id: randomUUID(), text: 'Check Spotify volume.' }, (e) => events.push(e));
  assert.equal(seen[0].headers['x-capri-thinking-once'], 'off');
  assert.equal(seen[0].headers['x-capri-tools-once'], 'dialogue');
  assert.equal(seen[1].headers['x-capri-tools-once'], undefined);
  assert.equal(seen[1].headers['x-capri-thinking-once'], 'off');
  assert.equal(
    seen[0].headers['x-openclaw-session-key'],
    seen[1].headers['x-openclaw-session-key'],
  );
  assert.deepEqual(requests[1].context, ['Hello Capri.']);
  assert.equal(userText(seen[1].body.messages[1].content), 'Check Spotify volume.');
  assert.doesNotMatch(seen[0].body.messages[0].content, /spotify_control/);
  assert.match(seen[1].body.messages[0].content, /spotify_control/);
  assert.deepEqual(
    events.filter((e) => e.type === 'turn.routing').map((e) => e.mode),
    ['fast', 'normal'],
  );
});

test('a classified conversation cannot inherit action tools, while the next feature request keeps them', async () => {
  const seen = [],
    events = [];
  const service = client({
    requestRouter: { classify: async () => ({ mode: 'normal', reason: 'unavailable' }) },
    computerIntent: async (text) => ({
      intent:
        text === 'Set a timer for ten minutes.'
          ? 'feature'
          : text === 'What is my favourite game?'
            ? 'memory'
            : 'chat',
      usesPrevious: false,
    }),
    interfaceState: () => ({ fullComputerAccess: true }),
    computerTask: () => assert.fail('Conversation and built-in features must not control the PC'),
    fetchImpl: async (_url, options) => {
      seen.push({ headers: options.headers, body: JSON.parse(options.body) });
      return response('No worries. We can just hang out.');
    },
  });
  for (const text of [
    'Not much, just chilling.',
    'Да ничего особенного.',
    'Rien de spécial.',
    'Set a timer for ten minutes.',
    'What is my favourite game?',
  ])
    await service.send({ id: randomUUID(), text }, (event) => events.push(event));
  for (const request of seen.slice(0, 3)) {
    assert.equal(request.headers['x-capri-tools-once'], 'dialogue');
    assert.match(request.body.messages[0].content, /Tools are unavailable/);
    assert.doesNotMatch(request.body.messages[0].content, /filesystem_control trash/);
  }
  assert.equal(seen[3].headers['x-capri-tools-once'], undefined);
  assert.match(seen[3].body.messages[0].content, /timer/);
  assert.equal(seen[4].headers['x-capri-tools-once'], 'conversation');
  assert.match(seen[4].body.messages[0].content, /memory tools/);
  assert.equal(new Set(seen.map((request) => request.headers['x-openclaw-session-key'])).size, 1);
  assert.equal(events.filter((event) => event.type === 'turn.completed').length, 5);
  assert(!events.some((event) => event.type === 'turn.failed'));
});

test('greetings use the dialogue scope without exposing permissions, including the fast CPU route', async () => {
  for (const fullComputerAccess of [false, true]) {
    const seen = [];
    const service = client({
      interfaceState: () => ({
        fullComputerAccess,
        microphone: true,
        applications: { calculator: true },
      }),
      requestRouter: { classify: async () => ({ mode: 'fast', reason: 'simple-dialogue' }) },
      computerTask: () => assert.fail('A greeting must never run a computer task'),
      fetchImpl: async (_url, options) => {
        seen.push({ headers: options.headers, body: JSON.parse(options.body) });
        return response('Hey! Good to see you.');
      },
    });
    for (const text of ['hi capri', 'Hello.', 'Привет, Капри!', 'Salut Capri!', 'Hola Capri!'])
      await service.send({ id: randomUUID(), text }, () => {});
    for (const request of seen) {
      assert.equal(request.headers['x-capri-tools-once'], 'dialogue');
      assert.match(request.body.messages[0].content, /one or two short sentences/);
      assert.doesNotMatch(
        request.body.messages[1].content,
        /fullComputerAccess|applications|microphone|screenObservation/,
      );
      assert.equal(turnState(request.body.messages[1].content).fullComputerAccess, undefined);
    }
    assert.equal(seen[0].body.messages[1].content, 'hi capri');
  }
});

test('router failure falls back, while cancellation during classification sends no model request', async () => {
  let fetched = 0;
  const service = client({
    requestRouter: {
      classify: async () => {
        throw new Error('fixture failure');
      },
    },
    fetchImpl: async () => {
      fetched++;
      return response('Hello.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Hello.' }, () => {});
  assert.equal(fetched, 1);
  service.requestRouter.classify = (_text, { signal }) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  const events = [],
    id = randomUUID();
  const pending = service.send({ id, text: 'Wait.' }, (e) => events.push(e));
  service.cancel(id);
  await pending;
  assert.equal(fetched, 1);
  assert.equal(events.at(-1).type, 'turn.cancelled');
});

test('all Spotify wording reaches the model unchanged without a separate command route or invented execution results', async () => {
  const seen = [];
  const service = client({
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith('/v1/chat/completions'));
      seen.push(JSON.parse(options.body));
      return response('Confirmed by the music tool.');
    },
  });
  const inputs = [
    'Pause Spotify.',
    'Hold the music for a moment, would you?',
    'Bring it down a notch.',
    'Play the original Rosa Walton version of that Cyberpunk song.',
    'Do not change the music.',
  ];
  for (const text of inputs) await service.send({ id: randomUUID(), text }, () => {});
  assert.equal(seen.length, inputs.length);
  for (const [index, request] of seen.entries()) {
    assert.equal(request.messages.length, 2);
    assert.equal(userText(request.messages[1].content), inputs[index]);
    assert.doesNotMatch(
      request.messages[0].content,
      /CURRENT REQUEST RESULT|spotify_result>|already called spotify_control/,
    );
  }
  assert.equal(service.store.snapshot().length, inputs.length * 2);
});

test('upstream failures never become assistant text and partial output is marked incomplete', async () => {
  for (const upstream of [
    new Response('secret upstream details', { status: 401 }),
    response('Partial', ''),
    response('Partial', 'data: not-json\n\n'),
  ]) {
    const events = [],
      service = client({ fetchImpl: async () => upstream });
    await service.send({ id: randomUUID(), text: 'Hello' }, (event) => events.push(event));
    assert.equal(events.at(-1).type, 'turn.failed');
    assert.equal(events.at(-1).assistant.status, 'error');
    assert.ok(!JSON.stringify(events).includes('secret upstream details'));
    assert.equal(service.active, null);
  }
});

test('response diagnostics distinguish gateway HTTP, framing, events, EOF and empty answers without private detail', async () => {
  const cases = [
    [
      () => new Response('private-http-body-canary', { status: 429 }),
      'CAPRI_GATEWAY_HTTP_ERROR',
      429,
    ],
    [() => Response.json({ private: 'private-json-body-canary' }), 'CAPRI_GATEWAY_STREAM_INVALID'],
    [() => response('', 'data: private-invalid-event-canary\n\n'), 'CAPRI_GATEWAY_EVENT_INVALID'],
    [
      () =>
        response(
          '',
          'data: ' +
            JSON.stringify({ error: { message: 'private-provider-body-canary' } }) +
            '\n\n',
        ),
      'CAPRI_GATEWAY_REPORTED_ERROR',
    ],
    [() => response('Partial', ''), 'CAPRI_GATEWAY_STREAM_INCOMPLETE'],
    [() => response(''), 'CAPRI_GATEWAY_RESPONSE_EMPTY'],
  ];
  for (const [reply, code, httpStatus] of cases) {
    let calls = 0;
    const events = [],
      service = client({
        fetchImpl: async () => {
          calls++;
          return reply();
        },
      });
    await service.send({ id: randomUUID(), text: 'Hello' }, (event) => events.push(event));
    const failure = service.diagnostics().lastFailure;
    assert.equal(events.at(-1).type, 'turn.failed');
    assert.equal(failure.code, code);
    assert.equal(failure.httpStatus, httpStatus);
    assert.equal(typeof failure.receivedText, 'boolean');
    assert.doesNotMatch(JSON.stringify({ failure, events }), /private-[a-z-]+-canary/);
    assert.equal(calls, 1, 'A failed turn must not be replayed.');
  }
});

test('empty external-model replies use the existing API message and network diagnostics retain only known codes', async () => {
  const events = [],
    service = client({ externalInference: true, fetchImpl: async () => response('') });
  await service.send({ id: randomUUID(), text: 'Hello' }, (event) => events.push(event));
  assert.equal(events.at(-1).message, 'API model returned no text.');
  assert.equal(service.diagnostics().lastFailure.code, 'CAPRI_GATEWAY_RESPONSE_EMPTY');
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'private-network-detail-canary']) {
    const failed = client({
      fetchImpl: async () => {
        throw new TypeError('private-network-message-canary', { cause: { code } });
      },
    });
    await failed.send({ id: randomUUID(), text: 'Hello' }, () => {});
    assert.equal(
      failed.diagnostics().lastFailure.networkCode,
      code.startsWith('UND_') ? code : undefined,
    );
    assert.doesNotMatch(JSON.stringify(failed.diagnostics()), /private-network/);
  }
});

test('input, output and endpoints are bounded; output overflow still finalizes the turn', async () => {
  for (const text of ['', ' ', 'x'.repeat(8001), 'bad\0text'])
    assert.throws(() => validateInput({ id: randomUUID(), text }));
  assert.throws(() => client({ gatewayUrl: 'https://example.com' }), /loopback/);
  const events = [],
    service = client({ fetchImpl: async () => response('x'.repeat(65537)) });
  await service.send({ id: randomUUID(), text: 'Hello' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.failed');
  assert.equal(service.active, null);
});

test('silent SSE keepalives and avatar markers cannot keep a turn waiting indefinitely', async () => {
  for (const prefix of ['', '[avatar:neutral]']) {
    const events = [];
    let calls = 0,
      aborted = false;
    const service = client({
      firstTextTimeoutMs: 35,
      fetchImpl: async (_url, { signal }) => {
        calls++;
        return new Response(
          new ReadableStream({
            start(stream) {
              if (prefix) stream.enqueue(Buffer.from(packet(prefix)));
              const heartbeat = setInterval(
                () => stream.enqueue(Buffer.from(': keepalive\n\n')),
                5,
              );
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  clearInterval(heartbeat);
                  stream.error(signal.reason);
                },
                { once: true },
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    await service.send({ id: randomUUID(), text: 'Wait silently.' }, (event) => events.push(event));
    assert.equal(aborted, true);
    assert.equal(calls, 1, 'Never automatically replay a potentially completed tool action');
    assert.equal(events.at(-1).type, 'turn.failed');
    assert.match(events.at(-1).message, /too long/);
    assert.equal(service.active, null);
    assert.equal(service.diagnostics().lastFailure.phase, 'model');
    assert.equal(service.diagnostics().lastFailure.errorName, 'TimeoutError');
    assert.ok(!JSON.stringify(service.diagnostics()).includes('Wait silently.'));
    service.fetchImpl = async () => response('Recovered.');
    await service.send({ id: randomUUID(), text: 'Continue.' }, (event) => events.push(event));
    assert.equal(events.at(-1).type, 'turn.completed');
  }
});

test('context and CPU routing do not spend the first model text budget on a cold machine', async () => {
  const events = [];
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let requests = 0;
  const service = client({
    timeoutMs: 1000,
    firstTextTimeoutMs: 40,
    prepareContext: async () => {
      await pause(65);
      return {};
    },
    requestRouter: {
      classify: async () => {
        await pause(65);
        return { mode: 'normal' };
      },
    },
    fetchImpl: async (_url, { signal }) => {
      requests++;
      assert.equal(signal.aborted, false);
      return response('Here I am.');
    },
  });
  await service.send({ id: randomUUID(), text: 'Hello.' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Here I am.');
  assert.equal(requests, 1);
  assert.equal(service.diagnostics().lastFailure, null);
});

test('preparation still obeys the overall request limit without making an inference request', async () => {
  const events = [];
  const service = client({
    timeoutMs: 45,
    firstTextTimeoutMs: 10,
    prepareContext: (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        const hold = setTimeout(() => reject(new Error('test exceeded its safety bound')), 1000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(hold);
            reject(signal.reason);
          },
          { once: true },
        );
      }),
    fetchImpl: () => assert.fail('model request started after preparation expired'),
  });
  await service.send({ id: randomUUID(), text: 'Look at the screen.' }, (event) =>
    events.push(event),
  );
  assert.equal(events.at(-1).type, 'turn.failed');
  assert.equal(service.diagnostics().lastFailure.phase, 'context');
  assert.equal(service.diagnostics().lastFailure.errorName, 'TimeoutError');
  assert.equal(service.active, null);
});

test('first-text watchdog is cleared after visible prose and does not cut a healthy long reply', async () => {
  const events = [],
    service = client({
      firstTextTimeoutMs: 20,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(Buffer.from(packet('Hello.')));
              setTimeout(() => {
                stream.enqueue(Buffer.from('data: [DONE]\n\n'));
                stream.close();
              }, 55);
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
  await service.send({ id: randomUUID(), text: 'Hello.' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Hello.');
});

test('real tool progress grants bounded execution time and a fresh final-answer window', async () => {
  const events = [],
    progress = (phase, callId = 'music-1') =>
      'data: ' +
      JSON.stringify({ capri: { type: 'tool', phase, name: 'spotify_control', callId } }) +
      '\n\n';
  const service = client({
    firstTextTimeoutMs: 25,
    toolTimeoutMs: 100,
    fetchImpl: async (_url, { headers, signal }) => {
      assert.equal(headers['x-capri-tool-progress'], '1');
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(Buffer.from(progress('start')));
            const result = setTimeout(() => stream.enqueue(Buffer.from(progress('result'))), 45);
            const final = setTimeout(() => {
              stream.enqueue(Buffer.from(packet('Playing your song.') + 'data: [DONE]\n\n'));
              stream.close();
            }, 60);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(result);
                clearTimeout(final);
                stream.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await service.send({ id: randomUUID(), text: 'Play a song in Spotify.' }, (event) =>
    events.push(event),
  );
  assert.equal(events.at(-1).type, 'turn.completed');
  assert.equal(events.at(-1).assistant.text, 'Playing your song.');
  assert.deepEqual(
    events.filter((e) => e.type === 'turn.tool').map((e) => e.phase),
    ['start', 'result'],
  );
});

test('duplicate tool starts and unmatched results cannot postpone a stalled action forever', async () => {
  const events = [];
  let calls = 0;
  const service = client({
    firstTextTimeoutMs: 20,
    toolTimeoutMs: 40,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Response(
        new ReadableStream({
          start(stream) {
            const progress = (value) =>
              stream.enqueue(
                Buffer.from(
                  'data: ' +
                    JSON.stringify({ capri: { type: 'tool', name: 'spotify_control', ...value } }) +
                    '\n\n',
                ),
              );
            progress({ phase: 'start', callId: 'music-1' });
            const tick = setInterval(() => {
              progress({ phase: 'start', callId: 'music-1' });
              progress({ phase: 'result', callId: 'unknown' });
            }, 5);
            signal.addEventListener(
              'abort',
              () => {
                clearInterval(tick);
                stream.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await service.send({ id: randomUUID(), text: 'Play a song.' }, (event) => events.push(event));
  assert.equal(calls, 1);
  assert.equal(events.at(-1).type, 'turn.failed');
  assert.match(events.at(-1).message, /Check the player before trying again/);
  assert.equal(events.filter((e) => e.type === 'turn.tool').length, 1);
});

test('the absolute request deadline still bounds a sequence of new tool calls', async () => {
  const events = [];
  const service = client({
    timeoutMs: 60,
    firstTextTimeoutMs: 20,
    toolTimeoutMs: 40,
    fetchImpl: async (_url, { signal }) =>
      new Response(
        new ReadableStream({
          start(stream) {
            let sequence = 0;
            const progress = () =>
              stream.enqueue(
                Buffer.from(
                  'data: ' +
                    JSON.stringify({
                      capri: {
                        type: 'tool',
                        phase: 'start',
                        name: 'spotify_control',
                        callId: 'music-' + sequence++,
                      },
                    }) +
                    '\n\n',
                ),
              );
            progress();
            const tick = setInterval(progress, 10);
            signal.addEventListener(
              'abort',
              () => {
                clearInterval(tick);
                stream.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  await service.send({ id: randomUUID(), text: 'Play music.' }, (event) => events.push(event));
  assert.equal(events.at(-1).type, 'turn.failed');
  assert.equal(service.active, null);
});

test('display journal restores completed history and marks unfinished work as interrupted', () => {
  const journal = store();
  const entry = {
    id: randomUUID(),
    turnId: randomUUID(),
    role: 'assistant',
    text: '<img src=x onerror=alert(1)>',
    status: 'streaming',
    createdAt: new Date().toISOString(),
  };
  journal.put(entry);
  const restored = new TranscriptStore(journal.file);
  assert.equal(restored.snapshot()[0].status, 'interrupted');
  assert.equal(restored.snapshot()[0].text, entry.text);
  assert.equal(JSON.parse(readFileSync(journal.file, 'utf8')).schemaVersion, 1);
  writeFileSync(journal.file, 'broken');
  const invalid = new TranscriptStore(journal.file);
  assert.deepEqual(invalid.snapshot(), []);
  assert.ok(invalid.warning);
});

test('journal size bound also accounts for the actual formatted file on disk', () => {
  const journal = store();
  for (let index = 0; index < 36; index++)
    journal.put({
      id: randomUUID(),
      turnId: randomUUID(),
      role: 'assistant',
      text: 'x'.repeat(65500),
      status: 'complete',
      createdAt: new Date().toISOString(),
    });
  assert.ok(readFileSync(journal.file).length <= 2 * 1024 * 1024);
  const restored = new TranscriptStore(journal.file);
  assert.equal(restored.warning, null);
  assert.equal(restored.snapshot().length, journal.snapshot().length);
});
