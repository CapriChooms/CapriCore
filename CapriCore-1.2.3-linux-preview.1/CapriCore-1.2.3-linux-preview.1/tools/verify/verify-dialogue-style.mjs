import { personaPrompt } from '../../packages/runtime/src/context.mjs';
/** Real local model comparison using synthetic history or an explicit baseline fixture. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import { AvatarStreamParser } from '../../apps/desktop/avatar-protocol.mjs';
import { repeatedPhrasing } from '../../apps/desktop/dialogue-style.mjs';
import { plainDialogueText } from '../../scripts/plain-text.mjs';
import { root, settings, runtime } from '../../packages/runtime/src/index.mjs';
import { defaultPersonality } from '../../packages/runtime/src/personality.mjs';

const rt = runtime();
const argument = process.argv.indexOf('--baseline');
const baseline =
  argument >= 0 ? JSON.parse(readFileSync(path.resolve(process.argv[argument + 1]), 'utf8')) : null;
const journal = baseline?.history ?? [
  { role: 'user', text: 'I like talking about ordinary things between tasks.' },
  { role: 'assistant', text: 'Then let us keep it easy. What caught your attention today?' },
  { role: 'user', text: 'I was checking my microphone, not asking for a technical report.' },
  { role: 'assistant', text: 'Got it. The microphone check can stay a microphone check.' },
];
const history = journal
  .filter((m) => m.text?.trim() && ['user', 'assistant'].includes(m.role))
  .slice(-24);
const model = JSON.parse(readFileSync(rt.configPath, 'utf8')).models.providers.ollama.models.find(
  (m) => m.id === settings.model,
);
const { thinking, keep_alive, ...options } = model.params;
const {
  thinking: baselineThinking,
  keep_alive: baselineKeepAlive,
  ...baselineOptions
} = baseline?.params ?? model.params;
const currentOptions = { ...options };
for (const [flag, key] of [
  ['--temperature', 'temperature'],
  ['--repeat-last-n', 'repeat_last_n'],
]) {
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    const value = Number(process.argv[index + 1]);
    assert.ok(
      Number.isFinite(value) &&
        (key === 'temperature'
          ? value >= 0.1 && value <= 1.5
          : Number.isInteger(value) && value >= 64 && value <= 2048),
    );
    currentOptions[key] = value;
  }
}
const avatars = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG)).publicSprites();
const cases = [
  'I was just checking the microphone. It works.',
  'I meant manipulate the computer, not an implant. What can you actually do with files?',
  'I meant a text file named test.txt in your workspace. Do not create it now; just tell me whether that is supported.',
  'I like spending time with you.',
  'Let us have a quiet minute.',
];
let system;
const capture = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: settings.agentId,
  sessionKey: 'style-test',
  token: () => 'unused',
  persona: () => personaPrompt(rt, { personality: defaultPersonality(), style: 'neutral' }),
  avatarSprites: avatars,
  interfaceState: () => ({ microphone: true }),
  store: { snapshot: () => structuredClone(history), put: () => {} },
  fetchImpl: async (_url, request) => {
    system = JSON.parse(request.body).messages[0].content;
    return new Response('data: {"choices":[{"delta":{"content":"Okay."}}]}\n\ndata: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  },
});
await capture.send({ id: randomUUID(), text: 'Capture test instructions only.' }, () => {});

async function generate(prompt, user, seed, sampling) {
  const started = performance.now();
  let firstTextMs = null,
    raw = '',
    buffer = '',
    done;
  const response = await fetch(`${rt.ollamaUrl}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      think: false,
      keep_alive: keep_alive ?? -1,
      truncate: false,
      shift: false,
      options: { ...sampling, num_predict: 192, seed },
      messages: [
        { role: 'system', content: prompt },
        ...history.map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Local model HTTP ${response.status}`);
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.error) throw new Error('Local model rejected the style test');
      if (item.message?.content) {
        firstTextMs ??= performance.now() - started;
        raw += item.message.content;
      }
      if (item.done) done = item;
    }
  }
  assert.ok(done && done.done_reason !== 'length', 'Style probe must finish, not be truncated');
  const parser = new AvatarStreamParser(avatars);
  const events = [...parser.push(raw), ...parser.finish()];
  const text = plainDialogueText(
    events
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join(''),
  ).trim();
  assert.ok(text.length > 0);
  return { text, firstTextMs, totalMs: performance.now() - started, outputTokens: done.eval_count };
}
const opening = (value) =>
  (
    value
      .toLowerCase()
      .replaceAll('’', "'")
      .match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []
  )
    .slice(0, 3)
    .join(' ');
function metrics(answers) {
  const previous = new Set(
    history
      .filter((m) => m.role === 'assistant')
      .slice(-12)
      .map((m) => opening(m.text)),
  );
  return {
    cases: answers.length,
    reusedOpenings: answers.filter((a) => previous.has(opening(a.text))).length,
    stockPhrases: answers.filter((a) =>
      /\b(?:whoa[, ]+hold up|still got that edge|but don't think this means|i don't have (?:actual )?ears)\b/i.test(
        a.text,
      ),
    ).length,
    distinctOpenings: new Set(answers.map((a) => opening(a.text))).size,
  };
}
const result = {
  timestamp: new Date().toISOString(),
  model: settings.model,
  baselineOptions,
  currentOptions,
  fixedSeedsForTestOnly: true,
  originalSessionModified: false,
  historicalPatterns: repeatedPhrasing(history),
  cases: [],
  baseline: null,
  current: null,
};
for (const [index, input] of cases.entries()) {
  const before = baseline
    ? await generate(baseline.system, input, 417 + index, baselineOptions)
    : null;
  const after = await generate(system, input, 417 + index, currentOptions);
  result.cases.push({ input, before, after });
  console.log(JSON.stringify({ case: index + 1, input, before: before?.text, after: after.text }));
}
result.baseline = baseline ? metrics(result.cases.map((c) => c.before)) : null;
result.current = metrics(result.cases.map((c) => c.after));
const output = path.join(root, '.runtime/desktop-verification');
mkdirSync(output, { recursive: true, mode: 0o700 });
writeFileSync(
  path.join(output, 'dialogue-style-verification.json'),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    baseline: result.baseline,
    current: result.current,
    originalSessionModified: false,
  }),
);
