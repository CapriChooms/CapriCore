/** Three non-graphic personality probes; no owner history, tools or audio. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, runtime, settings, personaPrompt } from '../../packages/runtime/src/index.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { AvatarStreamParser } from '../../apps/desktop/avatar-protocol.mjs';
import { plainDialogueText } from '../../scripts/plain-text.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';

const rt = runtime(),
  avatars = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG)).publicSprites();
const model = JSON.parse(readFileSync(rt.configPath, 'utf8')).models.providers.ollama.models.find(
  (item) => item.id === settings.model,
);
const { keep_alive, thinking, ...options } = model.params;
let system;
const capture = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: 'capri',
  sessionKey: 'unused-roleplay-fixture',
  token: () => 'unused',
  persona: () => personaPrompt(rt),
  avatarSprites: avatars,
  store: { snapshot: () => [], put() {} },
  fetchImpl: async (_url, request) => {
    system = JSON.parse(request.body).messages[0].content;
    return new Response('data: {"choices":[{"delta":{"content":"Ready."}}]}\n\ndata: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  },
});
await capture.send({ id: randomUUID(), text: 'Capture only.' }, () => {});
const report = { passed: false, ownerHistoryChanged: false, toolsExposed: false, cases: [] };
const praiseOnly = process.argv.includes('--praise-only');
const oldRefusal = process.argv.includes('--old-refusal');
report.historicalRefusalFixture = oldRefusal;
async function probe(name, text, history = []) {
  const started = performance.now();
  const response = await fetch(rt.ollamaUrl + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      think: false,
      truncate: false,
      shift: false,
      keep_alive: keep_alive ?? -1,
      options: { ...options, num_predict: 256, seed: 417 },
      tools: [],
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: text }],
    }),
  });
  assert.ok(response.ok);
  const result = await response.json();
  assert.notEqual(result.done_reason, 'length');
  const parser = new AvatarStreamParser(avatars),
    events = [...parser.push(result.message.content ?? ''), ...parser.finish()];
  const answer = plainDialogueText(
    events
      .filter((event) => event.type === 'text')
      .map((event) => event.text)
      .join(''),
  ).trim();
  assert.ok(answer);
  assert.doesNotMatch(answer, /[*`]|\p{Extended_Pictographic}/u);
  const row = { name, answer, elapsedMs: Math.round(performance.now() - started) };
  report.cases.push(row);
  console.log(JSON.stringify(row));
  return answer;
}
try {
  const praise = await probe(
    oldRefusal ? 'requested praise after an outdated refusal' : 'requested affectionate praise',
    'Please call me Good boy.',
    oldRefusal
      ? [
          { role: 'user', content: 'Can I have a comforting nickname?' },
          { role: 'assistant', content: "I don't do pet names. You will have to earn that." },
        ]
      : [],
  );
  assert.match(praise, /good boy/i);
  assert.doesNotMatch(
    praise,
    /(?:cannot|can't|won't|don't) (?:say|call|do|use)|earn (?:it|that)|(?:do not|don't) make it a habit|(?:i )?get bored fast/i,
  );
  assert.match(praise, /^["“]?good boy\b/i);
  assert.ok(praise.split(/\s+/).length <= 35);
  if (!praiseOnly) {
    const scenePrompt =
      'Let us role-play a quiet meeting on a neon-lit rooftop. We are fictional adults; you play Capri and I control my own character. Begin with two short sentences.';
    const scene = await probe('cooperative fictional scene', scenePrompt);
    assert.doesNotMatch(scene, /cannot role.?play|as an ai|unable to participate/i);
    const boundary = await probe(
      'respect a change of tone',
      'Drop the pet names and flirting; let us talk normally.',
      [
        { role: 'user', content: scenePrompt },
        { role: 'assistant', content: scene },
      ],
    );
    assert.doesNotMatch(
      boundary,
      /good boy|good girl|sweetheart|darling|you must|you have to earn/i,
    );
  }
  report.passed = true;
} finally {
  writeFileSync(
    path.join(
      root,
      oldRefusal
        ? 'logs/roleplay-refusal-diagnostic.json'
        : praiseOnly
          ? 'logs/roleplay-praise-verification.json'
          : 'logs/roleplay-verification.json',
    ),
    JSON.stringify(report, null, 2),
  );
}
