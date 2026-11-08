// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  COMPANION_DEFAULTS,
  validateCompanionSettings,
} from '../apps/desktop/companion-settings.mjs';
import {
  savePersonality,
  readPersonality,
  defaultPersonality,
} from '../packages/runtime/src/personality.mjs';
import { clearSavedMemory } from '../apps/desktop/memory-controls.mjs';
import { TranscriptStore } from '../apps/desktop/storage.mjs';
import { AvatarStreamParser, avatarInstructions } from '../apps/desktop/avatar-protocol.mjs';
import { WakePhraseGate } from '../apps/desktop/wake-phrase.mjs';
import { fetchArtifact } from '../packages/installer/src/download.mjs';
import { StartupProgress } from '../apps/desktop/startup-progress.mjs';
import { StartupPanel } from '../apps/desktop/renderer/startup-panel.mjs';
import { MicrophoneService } from '../apps/desktop/microphone-service.mjs';
import { EventEmitter } from 'node:events';
import { pullModel } from '../packages/runtime/src/providers/pull-model.mjs';

const fixture = () => mkdtempSync(path.join(os.tmpdir(), 'capri-companion-'));
test('Ollama model download pauses its owned request and resumes through the verified pull API', async () => {
  const pauseFile = path.join(fixture(), 'pause');
  let requests = 0;
  await pullModel({ ollamaUrl: 'http://127.0.0.1:11434' }, 'fixture-model', {
    pauseFile,
    pollMs: 5,
    emit: (line) => {
      if (line.includes('pulling') && requests === 1) {
        writeFileSync(pauseFile, 'pause');
        setTimeout(() => unlinkSync(pauseFile), 40);
      }
    },
    fetchImpl: async (_url, options) => {
      requests++;
      if (requests > 1) return new Response('{"status":"success"}');
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"status":"pulling layer","completed":10,"total":100}\n'),
            );
            options.signal.addEventListener(
              'abort',
              () => controller.error(options.signal.reason),
              { once: true },
            );
          },
        }),
      );
    },
  });
  assert.equal(requests, 2);
  await assert.rejects(
    pullModel({ ollamaUrl: 'http://127.0.0.1:11434' }, 'fixture', {
      emit: () => {},
      fetchImpl: async () => new Response('{"status":"pulling"}'),
      sleep: async () => {},
    }),
    /before verification completed/,
  );
});
test('manual voice input opens the existing wake gate without requiring a name or enabling an absent capture', () => {
  const worker = new EventEmitter();
  worker.send = async () => {};
  const service = new MicrophoneService({
    worker,
    config: {},
    emit: () => {},
    interrupt: () => {},
    submit: async () => {},
  });
  assert.equal(service.listenNow(), false);
  const wake = new WakePhraseGate({ enabled: true });
  service.capture = { id: 'fixture', wake, latestUtterance: 0, followUps: 3 };
  service.status = 'listening';
  assert.equal(service.listenNow(), true);
  assert.equal(wake.state, 'command');
  assert.equal(service.capture.followUps, 0);
  assert.equal(service.listenNow(), true);
  assert.equal(wake.state, 'waiting');
  wake.close();
});
test('private settings and personality validate input and restore default behavior', () => {
  assert.deepEqual(validateCompanionSettings({}), COMPANION_DEFAULTS);
  for (const value of [
    { wakeSound: 'https://external' },
    { wakeVolume: Infinity },
    { followUp: 'yes' },
    { unknown: true },
  ])
    assert.throws(() => validateCompanionSettings(value));
  const workspace = fixture();
  assert.equal(readPersonality(workspace), defaultPersonality());
  savePersonality(workspace, 'A playful fictional companion.');
  assert.equal(readPersonality(workspace), 'A playful fictional companion.');
  assert.throws(() => savePersonality(workspace, 'x'.repeat(24001)));
  savePersonality(workspace, '');
  assert.equal(readPersonality(workspace), defaultPersonality());
});
test('teleport effect preferences upgrade old settings and validate their bounds', () => {
  const upgraded = validateCompanionSettings({ wakeSound: 'off', glitchStrength: 37 });
  assert.equal(upgraded.wakeSound, 'off');
  assert.equal(upgraded.glitchStrength, 37);
  assert.equal(upgraded.teleportIntensity, 75);
  assert.equal(upgraded.teleportJaggedness, 78);
  assert.equal(upgraded.teleportBranches, 75);
  assert.equal(upgraded.teleportReducedFlash, false);
  const custom = {
    teleportIntensity: 0,
    teleportJaggedness: 100,
    teleportBranches: 30,
    teleportReducedFlash: true,
  };
  assert.deepEqual(validateCompanionSettings(custom), { ...COMPANION_DEFAULTS, ...custom });
  for (const invalid of [
    { teleportIntensity: -1 },
    { teleportJaggedness: 101 },
    { teleportBranches: 1.5 },
    { teleportBranches: '10' },
    { teleportReducedFlash: 'true' },
  ])
    assert.throws(() => validateCompanionSettings(invalid), /Invalid companion settings/);
});
test('memory reset uses supported index maintenance and preserves persona and conversation files', async () => {
  const workspace = fixture();
  mkdirSync(path.join(workspace, 'memory'));
  for (const name of [
    'USER.md',
    'MEMORY.md',
    'memory/note.md',
    'PERSONALITY.md',
    'transcript.json',
  ])
    writeFileSync(path.join(workspace, name), 'private fixture');
  const calls = [];
  await clearSavedMemory({ workspace }, async (args) => calls.push(args));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['memory', 'reset', '--agent']);
  assert.equal(readFileSync(path.join(workspace, 'USER.md'), 'utf8'), '');
  assert.equal(existsSync(path.join(workspace, 'memory/note.md')), false);
  for (const name of ['PERSONALITY.md', 'transcript.json'])
    assert.equal(readFileSync(path.join(workspace, name), 'utf8'), 'private fixture');
  const store = new TranscriptStore(path.join(workspace, 'display.json'));
  store.clear();
  assert.deepEqual(new TranscriptStore(store.file).snapshot(), []);
});
test('model listening intent remains hidden across every stream split; gate stays bounded', () => {
  const sprites = [{ id: 'neutral', pose: 'idle', expression: 'smile', description: 'Relaxed' }];
  const text = '[avatar:neutral;listen]\nWhat would you like?';
  for (let at = 0; at < text.length; at++) {
    const parser = new AvatarStreamParser(sprites);
    const events = [
      ...parser.push(text.slice(0, at)),
      ...parser.push(text.slice(at)),
      ...parser.finish(),
    ];
    assert.equal(events.find((event) => event.type === 'avatar').followUp, true);
    assert.equal(
      events
        .filter((event) => event.type === 'text')
        .map((event) => event.text)
        .join('')
        .trim(),
      'What would you like?',
    );
  }
  assert.ok(!avatarInstructions(sprites).includes('LISTENING CONTROL'));
  assert.ok(avatarInstructions(sprites, { followUp: true }).includes('LISTENING CONTROL'));
  const gate = new WakePhraseGate({ enabled: true });
  gate.rearm(3);
  assert.equal(gate.continueListening(5000), true);
  assert.equal(gate.observe({ utterance: 3, text: 'stale', final: true }).accepted, false);
  assert.equal(
    gate.observe({ utterance: 4, text: 'Another song please.', final: true }).text,
    'Another song please.',
  );
  gate.close();
});
test('misplaced listening flags never leak from a partial stream or enable follow-up capture', () => {
  const sprites = [{ id: 'neutral', pose: 'idle', expression: 'smile' }];
  for (const suffix of [';listen', ';LISTEN', ';listen]', ';listen\n']) {
    const raw = '[avatar:neutral]\nWant to go elsewhere?' + suffix;
    for (let at = 0; at <= raw.length; at++) {
      const parser = new AvatarStreamParser(sprites);
      const events = [
        ...parser.push(raw.slice(0, at)),
        ...parser.push(raw.slice(at)),
        ...parser.finish(),
      ];
      assert.equal(
        events
          .filter((e) => e.type === 'text')
          .map((e) => e.text)
          .join('')
          .trim(),
        'Want to go elsewhere?',
        `${suffix}: split ${at}`,
      );
      assert.ok(
        events.every((e) => !e.followUp),
        'A malformed suffix cannot enable the microphone',
      );
    }
    const parser = new AvatarStreamParser([]);
    const events = [...[...raw].flatMap((char) => parser.push(char)), ...parser.finish()];
    assert.equal(
      events
        .filter((e) => e.type === 'text')
        .map((e) => e.text)
        .join('')
        .trim(),
      'Want to go elsewhere?',
    );
  }
  for (const raw of [
    'Just listen.',
    'A pause;listen carefully.',
    'A pause;listener.',
    'A list;list',
    'A pause;',
  ]) {
    const parser = new AvatarStreamParser([]);
    const events = [...[...raw].flatMap((char) => parser.push(char)), ...parser.finish()];
    assert.equal(events.map((e) => e.text).join(''), raw);
  }
  const parser = new AvatarStreamParser([]);
  assert.deepEqual(
    parser.push('An ordinary reply.'),
    [{ type: 'text', text: 'An ordinary reply.' }],
    'Normal speech is not buffered',
  );
  parser.push(';listen' + ' '.repeat(10000));
  assert.ok(parser.textTail.length <= 128, 'Suffix buffering remains bounded');
});
test('paused dependency transfer resumes a verified byte range instead of restarting', async () => {
  const folder = fixture(),
    pauseFile = path.join(folder, 'pause');
  const data = Buffer.alloc(512 * 1024, 37),
    ranges = [];
  let paused = false;
  const spec = {
    url: 'https://nodejs.org/fixture.zip',
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
  const file = await fetchArtifact(spec, folder, {
    pauseFile,
    progress: () => {
      if (!paused) {
        paused = true;
        writeFileSync(pauseFile, 'pause');
        setTimeout(() => unlinkSync(pauseFile), 60);
      }
    },
    fetchImpl: async (_url, options) => {
      const offset = Number(options.headers.Range?.match(/bytes=(\d+)-/)[1] ?? 0);
      ranges.push(offset);
      let cursor = offset;
      const body = new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 8));
          if (cursor >= data.length) return controller.close();
          const end = Math.min(data.length, cursor + 65536);
          controller.enqueue(data.subarray(cursor, end));
          cursor = end;
        },
      });
      return new Response(body, {
        status: offset ? 206 : 200,
        headers: {
          'content-length': String(data.length - offset),
          ...(offset
            ? { 'content-range': `bytes ${offset}-${data.length - 1}/${data.length}` }
            : {}),
        },
      });
    },
  });
  assert.ok(ranges.length > 1 && ranges[1] > 0, JSON.stringify(ranges));
  assert.deepEqual(readFileSync(file), data);
});
test('startup reports measured stages and saves only bounded timing data', () => {
  let now = 1000;
  const file = path.join(fixture(), 'timings.json');
  const startup = new StartupProgress({ file, emit: () => {}, now: () => now });
  startup.start(['core', 'voice']);
  startup.begin('core');
  now += 2000;
  startup.end('core');
  startup.begin('voice');
  now += 4000;
  startup.end('voice', true);
  startup.finish();
  assert.equal(startup.snapshot().finished, true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { core: 2 });
});

test('startup countdown follows the running stage and becomes indeterminate if it overruns', () => {
  const elements = {
    p: {},
    '.startup-eta': {},
    progress: {
      removeAttribute(name) {
        delete this[name];
      },
    },
  };
  const value = {
    stages: [
      { id: 'core', state: 'running', estimate: 15, started: 1000 },
      { id: 'models', state: 'waiting', estimate: 12 },
    ],
  };
  const panel = { hidden: false, querySelector: (selector) => elements[selector] };
  const renderer = {
    value,
    panel,
    ui: { text: (message, { seconds } = {}) => message.replace('{seconds}', String(seconds)) },
  };
  const eta = () => elements['.startup-eta'].textContent;
  StartupPanel.prototype.render.call(renderer, 10000);
  assert.equal(eta(), 'Estimated remaining: 6 s');
  StartupPanel.prototype.render.call(renderer, 17000);
  assert.equal(eta(), 'Still preparing. First startup may take longer.');
  assert.equal(elements.progress.value, undefined);

  value.stages[0].state = 'ready';
  Object.assign(value.stages[1], { state: 'running', started: 18000 });
  StartupPanel.prototype.render.call(renderer, 22000);
  assert.equal(eta(), 'Estimated remaining: 8 s');
  assert.ok(elements.progress.value > 50);
  value.finished = true;
  StartupPanel.prototype.render.call(renderer, 30000);
  assert.equal(panel.hidden, true);
});
