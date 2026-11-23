import { personaPrompt } from '../../packages/runtime/src/context.mjs';
/** Real Qwen -> OpenClaw -> Spotify check in an isolated conversation. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import { root, runtime, settings, runCli } from '../../packages/runtime/src/index.mjs';
import { invokeSpotify } from '../../integrations/spotify/cli.mjs';
import { normalizeSpotifyUri, spotifyLinkTitle } from '../../integrations/spotify/service.mjs';

const rt = runtime(),
  key = `agent:${settings.agentId}:spotify-verification-${randomUUID()}`;
const history = async (sessionKey) => {
  const r = await runCli(
    [
      'gateway',
      'call',
      'chat.history',
      '--params',
      JSON.stringify({ sessionKey, limit: 200 }),
      '--json',
      '--timeout',
      '60000',
    ],
    rt,
  );
  return JSON.parse(r.stdout);
};
const digest = async () =>
  createHash('sha256')
    .update(JSON.stringify((await history(settings.sessionKey)).messages))
    .digest('hex');
const before = await digest(),
  initial = await invokeSpotify({ action: 'status' }),
  messages = new Map();
const thinkingIndex = process.argv.indexOf('--thinking');
if (thinkingIndex >= 0) {
  const level = process.argv[thinkingIndex + 1];
  assert.ok(['off', 'low'].includes(level));
  await runCli(
    [
      'gateway',
      'call',
      'sessions.patch',
      '--params',
      JSON.stringify({ key, thinkingLevel: level }),
      '--json',
      '--timeout',
      '60000',
    ],
    rt,
  );
}
const playback = process.argv.includes('--playback'),
  uriIndex = process.argv.indexOf('--restore-uri');
const restoreUri = uriIndex >= 0 ? normalizeSpotifyUri(process.argv[uriIndex + 1]) : null;
let restoreTrack = restoreUri ? { action: 'play', uri: restoreUri } : null;
if (playback) {
  if (restoreUri)
    assert.equal((await spotifyLinkTitle(restoreUri)).toLowerCase(), initial.title.toLowerCase());
  else {
    const comparable = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const artist = initial.artist.split(',')[0].trim();
    const search = await invokeSpotify({
      action: 'search',
      query: (initial.title + ' ' + artist).slice(0, 180),
      type: 'track',
    });
    const original = search.results.find(
      (item) =>
        comparable(item.label).includes(comparable(initial.title)) &&
        comparable(item.label).includes(comparable(artist)) &&
        (!initial.album || comparable(item.detail).includes(comparable(initial.album))),
    );
    assert.ok(original, 'The original track/version must be identifiable before changing playback');
    restoreTrack = { action: 'play', resultId: original.resultId };
  }
}
const report = {
  timestamp: new Date().toISOString(),
  passed: false,
  route: 'qwen-native-tool-only',
  turns: [],
  toolCalls: [],
  ownerHistoryUnchanged: false,
};
const chat = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: settings.agentId,
  sessionKey: key,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () =>
    personaPrompt(rt) +
    '\nTemporary integration verification: do not write files or save long-term memories.',
  avatarSprites: loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG)).publicSprites(),
  store: {
    snapshot: () => [...messages.values()],
    put: (message) => messages.set(message.id, structuredClone(message)),
  },
});
const cases = [
  {
    input:
      'The Spotify music is overpowering you. Bring its volume down to twenty-five percent, please.',
    action: 'volume',
    value: 25,
  },
  { input: 'Which song have we got loaded in Spotify at the moment?', action: 'status' },
  { input: 'Hold the music for a moment, would you?', action: 'pause' },
  { input: 'Okay, let the music carry on from there.', action: 'resume' },
  { input: 'A little less volume on that, please.', action: 'volume', relative: true },
  {
    input: 'Leave the music exactly as it is. Just check what its volume is right now.',
    action: 'status',
    readOnly: true,
  },
  ...(playback
    ? [
        {
          input:
            'I fancy that Cyberpunk song I Really Want to Stay at Your House, the original Rosa Walton version. Put that on for me.',
          action: 'play',
        },
      ]
    : []),
];
let collected = false;
async function collectCalls() {
  if (collected) return;
  let turn;
  for (const message of (await history(key)).messages ?? []) {
    if (message.role === 'user') {
      const text =
        typeof message.content === 'string'
          ? message.content
          : (message.content ?? [])
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n');
      const matched = report.turns.find((item) => text.includes(item.input));
      if (matched) turn = matched;
    }
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      if (['toolCall', 'tool_use'].includes(value.type) && value.name === 'spotify_control') {
        let args = value.arguments ?? value.input;
        if (typeof args === 'string') args = JSON.parse(args);
        const call = { ...args, source: 'qwen' };
        report.toolCalls.push(call);
        if (turn) turn.toolCalls.push(call);
      }
      for (const nested of Object.values(value))
        if (nested && typeof nested === 'object')
          Array.isArray(nested) ? nested.forEach(walk) : walk(nested);
    };
    walk(message);
  }
  collected = true;
}
try {
  for (const item of cases) {
    const { input, action } = item;
    // Simulate an external state change: a prior paused result must not let
    // the model skip the new pause request.
    if (action === 'pause') await invokeSpotify({ action: 'resume' });
    const before = await invokeSpotify({ action: 'status' });
    let answer;
    const started = performance.now();
    await chat.send({ id: randomUUID(), text: input }, (event) => {
      if (event.type === 'turn.completed') answer = event.assistant;
    });
    assert.ok(answer?.text, 'The real model must finish the turn');
    report.turns.push({
      input,
      reply: answer.text,
      elapsedMs: Math.round(performance.now() - started),
      expectedAction: action,
      toolCalls: [],
    });
    console.log(JSON.stringify(report.turns.at(-1)));
    const state = await invokeSpotify({ action: 'status' });
    try {
      if (['volume', 'pause', 'resume'].includes(action)) {
        const sentences = [
          ...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(answer.text),
        ].filter((item) => item.segment.trim());
        assert.equal(
          sentences.length,
          1,
          'A simple command must receive one confirmation sentence',
        );
        assert.ok(
          answer.text.trim().split(/\s+/).length <= 24,
          'A simple confirmation must remain brief',
        );
        assert.ok(
          !answer.text.includes('?'),
          'A confirmation must not append a follow-up question',
        );
      }
      if (action === 'volume' && !item.relative) assert.equal(state.volumePercent, item.value);
      if (item.relative) assert.ok(state.volumePercent < before.volumePercent);
      if (action === 'pause') assert.equal(state.playing, false);
      if (action === 'resume') assert.equal(state.playing, true);
      if (action === 'status' && !item.readOnly && /^[\x20-\x7e]+$/.test(initial.title))
        assert.ok(
          answer.text.toLowerCase().includes(before.title.toLowerCase()),
          'Answer must identify the current Spotify song',
        );
      if (item.readOnly) {
        assert.equal(state.volumePercent, before.volumePercent);
        assert.equal(state.playing, before.playing);
      }
      if (action === 'play') {
        assert.equal(state.title, 'I Really Want to Stay at Your House');
        assert.match(state.artist, /Rosa Walton/);
        assert.equal(state.playing, true);
      }
    } catch (error) {
      report.turns.at(-1).error = error.message;
      console.error('FAIL ' + action + ': ' + error.message);
    }
  }
  await collectCalls();
  for (const [index, turn] of report.turns.entries()) {
    assert.ok(!turn.error, turn.error);
    assert.ok(
      turn.toolCalls.some((call) => call.action === turn.expectedAction),
      `Qwen must actually call Spotify ${turn.expectedAction} for: ${turn.input}`,
    );
    if (cases[index].readOnly)
      assert.ok(
        turn.toolCalls.every((call) =>
          ['status', 'search', 'queue', 'library'].includes(call.action),
        ),
        'Read-only requests must not change music',
      );
  }
  report.ownerHistoryUnchanged = (await digest()) === before;
  assert.equal(report.ownerHistoryUnchanged, true);
  report.passed = true;
} finally {
  try {
    await collectCalls();
  } catch (error) {
    report.historyError = error.message;
  }
  report.restoreErrors = [];
  const restore = async (command) => {
    try {
      await invokeSpotify(command);
    } catch (error) {
      report.restoreErrors.push(error.message);
    }
  };
  if (playback) {
    const current = await invokeSpotify({ action: 'status' });
    if (
      current.title !== initial.title ||
      current.artist !== initial.artist ||
      current.album !== initial.album
    )
      await restore(restoreTrack);
  }
  await restore({ action: 'pause' });
  if (initial.canSeek) await restore({ action: 'seek', seconds: initial.positionMs / 1000 });
  await restore({ action: 'volume', value: initial.volumePercent });
  if (initial.playing) await restore({ action: 'resume' });
  try {
    await runCli(
      [
        'gateway',
        'call',
        'sessions.delete',
        '--params',
        JSON.stringify({ key, deleteTranscript: true }),
        '--json',
        '--timeout',
        '60000',
      ],
      rt,
    );
  } finally {
    if (report.restoreErrors.length) {
      report.passed = false;
      process.exitCode = 1;
    }
    writeFileSync(
      path.join(root, 'logs/spotify-dialogue-verification.json'),
      JSON.stringify(report, null, 2),
    );
  }
}
console.log(
  JSON.stringify({
    passed: report.passed,
    tools: report.toolCalls,
    ownerHistoryUnchanged: report.ownerHistoryUnchanged,
  }),
);
