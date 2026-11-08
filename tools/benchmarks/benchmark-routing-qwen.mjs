/** Research-only A/B: identical Capri interface, Qwen low/off, isolated sessions.
 * Does not install a router, change owner settings, write memories or mutate Spotify.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import {
  root,
  settings,
  runtime,
  personaPrompt,
  runCli,
} from '../../packages/runtime/src/index.mjs';

const rt = runtime(),
  sessions = [],
  rows = [];
const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));
const rpc = async (method, params) =>
  JSON.parse(
    (
      await runCli(
        [
          'gateway',
          'call',
          method,
          '--params',
          JSON.stringify(params),
          '--json',
          '--timeout',
          '60000',
        ],
        rt,
      )
    ).stdout,
  );
const history = (sessionKey) => rpc('chat.history', { sessionKey, limit: 200 });
const ownerDigest = async () =>
  createHash('sha256')
    .update(JSON.stringify((await history(settings.sessionKey)).messages))
    .digest('hex');
const before = await ownerDigest();
const cases = [
  { type: 'dialogue', text: 'Hey Capri, how is your evening going?' },
  { type: 'dialogue', text: 'I had an exhausting day. Keep me company for a moment?' },
  { type: 'dialogue', text: 'What should we do for a quiet evening?' },
  { type: 'simple_question', text: 'What is two plus two?' },
  {
    type: 'reasoning',
    text: 'I have 17 red and 23 blue marbles. Without replacement, what is the probability that two draws are both red? Give the exact fraction.',
  },
  {
    type: 'music_read_only',
    text: 'Which song is playing in Spotify right now? Just check, do not change anything.',
  },
];
const report = {
  timestamp: new Date().toISOString(),
  model: settings.model,
  reasoningBudget: settings.reasoningBudget,
  productionChanged: false,
  realGateway: true,
  conditions:
    'Paired fresh isolated sessions; order alternates; same persona, tools, avatar and interface. No TTS. Session-setting RPC excluded. Small exploratory sample, no broad quality or latency guarantee.',
  rows,
};

function save() {
  writeFileSync(
    path.join(root, 'logs/request-routing-qwen-benchmark.json'),
    JSON.stringify(report, null, 2),
  );
}
try {
  for (const [index, item] of cases.entries()) {
    for (const thinking of index % 2 ? ['off', 'low'] : ['low', 'off']) {
      const key = `agent:${settings.agentId}:router-ab-${randomUUID()}`;
      sessions.push(key);
      await rpc('sessions.patch', { key, thinkingLevel: thinking });
      const messages = new Map();
      const chat = new ChatService({
        gatewayUrl: rt.gatewayUrl,
        agentId: settings.agentId,
        sessionKey: key,
        token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
        persona: () =>
          personaPrompt(rt) +
          '\nTemporary verification: never write files or save memories. For a Spotify request use only the read-only status action. Answer in at most two short sentences.',
        avatarSprites: catalog.publicSprites(),
        defaultAvatarId: catalog.defaultId,
        timeoutMs: 90000,
        store: {
          snapshot: () => [...messages.values()],
          put: (message) => messages.set(message.id, structuredClone(message)),
        },
      });
      const row = { ...item, thinking };
      const started = performance.now();
      await chat.send({ id: randomUUID(), text: item.text }, (event) => {
        if (event.type === 'turn.delta' && row.firstTextMs === undefined)
          row.firstTextMs = Math.round(performance.now() - started);
        if (event.type === 'turn.completed') row.answer = event.assistant.text;
        if (event.type === 'turn.failed') row.error = event.message;
      });
      row.totalMs = Math.round(performance.now() - started);
      const transcript = await history(key);
      row.thinkingCharacters = 0;
      row.toolCalls = [];
      for (const message of transcript.messages ?? []) {
        for (const part of Array.isArray(message.content) ? message.content : []) {
          if (part.type === 'thinking') row.thinkingCharacters += (part.thinking ?? '').length;
          if (['toolCall', 'tool_use'].includes(part.type)) {
            let args = part.arguments ?? part.input;
            if (typeof args === 'string') args = JSON.parse(args);
            row.toolCalls.push({ name: part.name, action: args?.action });
          }
        }
      }
      if (item.type === 'simple_question') row.correct = /\b(four|4)\b/i.test(row.answer ?? '');
      if (item.type === 'reasoning')
        row.correct = /(?:34\s*\/\s*195|136\s*\/\s*780|272\s*\/\s*1560)/.test(row.answer ?? '');
      if (item.type === 'music_read_only')
        row.correct = row.toolCalls.some(
          (c) => c.name === 'spotify_control' && c.action === 'status',
        );
      rows.push(row);
      save();
      console.log(JSON.stringify(row));
      assert.ok(
        row.toolCalls.every((c) => c.name === 'spotify_control' && c.action === 'status'),
        'The experiment must not execute other tools',
      );
    }
  }
  const median = (values) => {
    const sorted = values.toSorted((a, b) => a - b);
    return sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  };
  report.dialogue = Object.fromEntries(
    ['low', 'off'].map((mode) => [
      mode,
      {
        medianFirstTextMs: median(
          rows
            .filter((r) => r.type === 'dialogue' && r.thinking === mode)
            .map((r) => r.firstTextMs),
        ),
        completed: rows.filter((r) => r.type === 'dialogue' && r.thinking === mode && r.answer)
          .length,
      },
    ]),
  );
} finally {
  report.ownerHistoryUnchanged = (await ownerDigest()) === before;
  report.cleanupErrors = [];
  for (const key of sessions) {
    try {
      await rpc('sessions.delete', { key, deleteTranscript: true });
    } catch {
      report.cleanupErrors.push(key);
    }
  }
  save();
}
assert.ok(report.ownerHistoryUnchanged, 'Owner history must remain unchanged');
console.log(
  JSON.stringify({
    dialogue: report.dialogue,
    ownerHistoryUnchanged: report.ownerHistoryUnchanged,
    cleanupErrors: report.cleanupErrors.length,
  }),
);
