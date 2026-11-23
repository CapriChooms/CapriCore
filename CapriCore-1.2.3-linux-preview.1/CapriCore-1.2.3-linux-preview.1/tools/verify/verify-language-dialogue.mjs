import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { runCli } from '../../packages/runtime/src/index.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
/** Tool-free real Qwen language check with synthetic shared dialogue context. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  root,
  runtime,
  settings,
  personaPrompt,
  request,
} from '../../packages/runtime/src/index.mjs';
import { conversationInstruction } from '../../apps/desktop/language-context.mjs';
import { LANGUAGE_DEFAULTS } from '../../apps/desktop/renderer/language-settings.mjs';
const rt = runtime(),
  report = { passed: false, ownerHistoryChanged: false, toolsEnabled: false, samples: [] },
  history = [];
for (const [language, question, script] of [
  [
    'ru',
    'My temporary test color is periwinkle. Say briefly that you are here. Do not store this test detail.',
    /\p{Script=Cyrillic}/u,
  ],
  [
    'ja',
    'What test color did I just mention? Answer in one short sentence.',
    /\p{Script=Hiragana}|\p{Script=Katakana}/u,
  ],
  ['en', 'Say briefly that you are here.', /[a-z]/i],
]) {
  const started = performance.now();
  const result = await request(rt.ollamaUrl + '/api/chat', {
    method: 'POST',
    timeout: 90000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      think: false,
      truncate: false,
      shift: false,
      keep_alive: -1,
      tools: [],
      options: { num_ctx: settings.contextTokens, num_predict: 128, ...settings.generation },
      messages: [
        {
          role: 'system',
          content:
            personaPrompt(rt) +
            '\n' +
            conversationInstruction({ ...LANGUAGE_DEFAULTS, conversation: language }),
        },
        ...history,
        { role: 'user', content: question },
      ],
    }),
  });
  const text = result.message?.content ?? '';
  assert.match(text, script);
  assert.ok(!text.includes('*'));
  history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
  report.samples.push({ language, text, elapsedMs: Math.round(performance.now() - started) });
}
if (process.argv.includes('--gateway')) {
  const sessionKey = `agent:${settings.agentId}:language-verification-${randomUUID()}`,
    messages = new Map(),
    events = [];
  const service = new ChatService({
    gatewayUrl: rt.gatewayUrl,
    agentId: settings.agentId,
    sessionKey,
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
    persona: () => personaPrompt(rt),
    avatarSprites: loadAvatarCatalog(ACTIVE_AVATAR_CATALOG).publicSprites(),
    interfaceState: () => ({ languages: { ...LANGUAGE_DEFAULTS, conversation: 'ru' } }),
    requestRouter: { classify: async () => ({ mode: 'fast', reason: 'synthetic_greeting' }) },
    store: { snapshot: () => [...messages.values()], put: (m) => messages.set(m.id, { ...m }) },
  });
  try {
    const start = performance.now();
    await service.send(
      {
        id: randomUUID(),
        text: 'Say briefly that you are here. This is a temporary language test, no tools or saved memory needed.',
      },
      (e) => events.push(e),
    );
    assert.equal(events.at(-1)?.type, 'turn.completed', events.at(-1)?.message);
    assert.match(events.at(-1).assistant.text, /\p{Script=Cyrillic}/u);
    assert.ok(!events.some((e) => e.type === 'turn.tool'));
    report.gateway = {
      passed: true,
      language: 'ru',
      elapsedMs: Math.round(performance.now() - start),
      text: events.at(-1).assistant.text,
      toolsExecuted: false,
    };
  } finally {
    await runCli(
      [
        'gateway',
        'call',
        'sessions.delete',
        '--params',
        JSON.stringify({ key: sessionKey, deleteTranscript: true }),
        '--json',
        '--timeout',
        '15000',
      ],
      rt,
    );
  }
}
report.passed = true;
writeFileSync(
  path.join(root, 'logs/language-dialogue-verification.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
