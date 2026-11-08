// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync, crc32 } from 'node:zlib';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { createDiagnosticReport, validateReport } from '../apps/desktop/diagnostics/report.mjs';
import { redactor } from '../apps/desktop/diagnostics/redact.mjs';
import { diagnosticZip } from '../apps/desktop/diagnostics/archive.mjs';
import { VoiceService } from '../apps/desktop/voice-service.mjs';
import { registerCompanionIpc } from '../apps/desktop/main/companion-ipc.mjs';
import { readFileSync } from 'node:fs';
import { ACTIVE_AVATAR_CATALOG } from '../apps/desktop/avatar-catalog.mjs';
import { probeResourceUsage } from '../apps/desktop/diagnostics/resources.mjs';

const parent = path.join(root, '.runtime/diagnostic-unit');
mkdirSync(parent, { recursive: true });
const fixture = () => mkdtempSync(path.join(parent, 'case-'));
const put = (base, name, data) => {
  const file = path.join(base, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof data === 'object' ? JSON.stringify(data) : data);
};
const unpack = (buffer) => {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 8);
    const size = buffer.readUInt32LE(offset + 18),
      length = buffer.readUInt16LE(offset + 26),
      extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + length).toString('utf8'),
      start = offset + 30 + length + extra;
    const data = inflateRawSync(buffer.subarray(start, start + size));
    assert.equal(data.length, buffer.readUInt32LE(offset + 22));
    assert.equal(crc32(data), buffer.readUInt32LE(offset + 14));
    assert.ok(!files.has(name));
    files.set(name, data.toString('utf8'));
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  assert.equal(buffer.readUInt16LE(buffer.length - 12), files.size);
  return files;
};

test('high system RAM and partial model offload are separate diagnostic evidence, not an attributed Capri leak', async () => {
  const report = await createDiagnosticReport({
    root: fixture(),
    input: { category: 'model', includeLogs: false },
    hardware: async () => ({ ramBytes: 16 * 2 ** 30, availableRamBytes: 0.1 * 2 ** 30 }),
    pythonProbe: async () => ({}),
    installerDirectory: null,
    resourceProbe: () =>
      probeResourceUsage({
        model: 'local-model',
        readModels: async () => ({
          models: [
            {
              name: 'local-model',
              size: 8 * 2 ** 30,
              size_vram: 6 * 2 ** 30,
              context_length: 32768,
            },
          ],
        }),
        readProcess: async () => ({ ramBytes: 2 * 2 ** 30, vramBytes: 6 * 2 ** 30 }),
      }),
  });
  const files = unpack(report.bytes),
    resources = JSON.parse(files.get('resources.json'));
  assert.equal(resources.localModels.models[0].offload, 'partial');
  assert.equal(resources.capriProcesses.workingSetBytes, 2 * 2 ** 30);
  assert.match(files.get('REPORT.md'), /partial GPU offload/);
  assert.match(files.get('REPORT.md'), /does not attribute all memory use to Capri/);
});

test('reports redact credentials, structured dialogue and personal paths without corrupting JSON', () => {
  const clean = redactor({
    root: 'C:\\Users\\Alice\\Capri',
    home: 'C:\\Users\\Alice',
    secrets: ['private-bare-token-12345'],
  });
  const source =
    'C:\\Users\\Alice\\Capri\\logs\\voice.log\nAuthorization: Basic auth-header-canary\nCookie: session=cookie-value-canary\npassword="a secret with spaces"\nhttps://name:credential@example.org/model?token=QUERY\nprivate-bare-token-12345';
  const text = clean.text(source);
  assert.equal(
    clean.text('speech_start_token = self.hp.start * torch.ones_like(text_tokens)'),
    'speech_start_token = self.hp.start * torch.ones_like(text_tokens)',
  );
  for (const secret of [
    'Alice',
    'auth-header-canary',
    'cookie-value-canary',
    'a secret with spaces',
    'credential',
    'QUERY',
    'private-bare',
  ])
    assert.ok(!text.includes(secret), secret);
  const json = JSON.parse(
    clean.log(
      JSON.stringify({
        error: 'Authorization: Bearer abcdefg',
        prompt: 'dialogue canary',
        details: { token: 'opaque secret' },
      }),
    ),
  );
  assert.equal(json.event, 'failure');
  assert.equal(json.prompt, undefined);
  assert.equal(json.details, undefined);
});

test('exported computer-task traces preserve safe stop reasons across both privacy passes', async () => {
  const privateText = 'PRIVATE_DISCORD_MESSAGE_AND_DESTINATION';
  const report = await createDiagnosticReport({
    root: fixture(),
    input: { category: 'other', includeLogs: false },
    snapshot: {
      computerTask: {
        phase: 'stopped',
        steps: 1,
        lastFailure: null,
        lastOutcome: { status: 'needs_user', reason: 'discord_control_unresolved', steps: 1 },
        actions: [
          { action: 'launch', outcome: 'applied' },
          { action: 'enter_text', outcome: 'discord_structured_step_required' },
        ],
        text: privateText,
        goal: privateText,
        channel: privateText,
        draft: privateText,
        discordPaneId: 'ab'.repeat(32),
      },
    },
    hardware: async () => ({}),
    pythonProbe: async () => ({}),
    installerDirectory: null,
  });
  const files = unpack(report.bytes);
  const task = JSON.parse(files.get('session.json')).computerTask;
  assert.equal(task.lastFailure, null);
  assert.equal(task.lastOutcome.reason, 'discord_control_unresolved');
  assert.equal(task.lastOutcome.status, 'needs_user');
  assert.equal(task.actions[1].outcome, 'discord_structured_step_required');
  assert.match(
    files.get('REPORT.md'),
    /computer task ended with needs_user after 1 input steps; discord_control_unresolved/,
  );
  const all = [...files.values()].join('\n');
  assert(!all.includes(privateText));
  assert(!all.includes('ab'.repeat(32)));
});

test('a useful report survives missing voice components and includes bounded redacted logs', async () => {
  const base = fixture();
  put(base, 'package.json', { version: '0.3.0' });
  put(base, 'config/release.json', { tag: 'v0.3.0-preview.22' });
  put(base, 'config/companion-voice.json', {
    engine: 'chatterbox-turbo',
    enabled: true,
    profileDir: 'data/voice',
  });
  put(base, 'config/voice-training.json', { modelDir: 'data/speech/base' });
  put(base, 'config/voice-upstream.json', { model: { files: ['missing.safetensors'] } });
  put(base, 'data/speech/companion-voice-token', 'voice-secret-canary-12345');
  put(base, 'data/desktop/transcript.json', { messages: 'history canary' });
  put(base, 'logs/conversation-history.txt', 'history canary');
  put(
    base,
    'logs/companion-voice.stderr.log',
    'x'.repeat(300000) +
      '\nModuleNotFoundError: missing_voice_module\n' +
      base +
      '\nvoice-secret-canary-12345',
  );
  const report = await createDiagnosticReport({
    root: base,
    input: {
      category: 'voice',
      description: 'Не работает голос',
      steps: 'Install, enable voice, send a message',
    },
    snapshot: {
      voice: { enabled: true, ready: false },
      response: { lastFailure: { phase: 'model', elapsedMs: 30000, errorName: 'TimeoutError' } },
      recognition: {
        performance: {
          lastFailure: {
            code: 'ASR_START_NATIVE_CRASH',
            startupStage: 'ASR_START_MODEL',
          },
        },
      },
      messages: 'history canary',
      lastVoiceFailure: { message: 'Authorization: Bearer private_token' },
    },
    hardware: async () => ({
      cpu: 'Fixture CPU',
      ramBytes: 8 * 1024 ** 3,
      gpus: [{ name: 'Fixture GPU', vramMiB: 4096 }],
    }),
    pythonProbe: async () => ({
      available: true,
      cuda: { available: false },
      errors: ['Fixture DLL failure'],
    }),
    installerDirectory: null,
  });
  const files = unpack(report.bytes),
    all = [...files.values()].join('\n');
  for (const value of ['history canary', 'voice-secret-canary', base, 'private_token'])
    assert.ok(!all.includes(value), value);
  assert.match(files.get('REPORT.md'), /Не работает голос/);
  assert.match(files.get('REPORT.md'), /CUDA unavailable/);
  assert.match(files.get('REPORT.md'), /missing Python module/);
  assert.match(files.get('REPORT.md'), /last reply failed during model after 30000 ms/);
  assert.deepEqual(JSON.parse(files.get('session.json')).recognition.performance.lastFailure, {
    code: 'ASR_START_NATIVE_CRASH',
    startupStage: 'ASR_START_MODEL',
  });
  assert.match(files.get('system.json'), /Fixture GPU/);
  assert.equal(JSON.parse(files.get('avatar.json')).files[0].exists, false);
  assert.match(files.get('REPORT.md'), /Missing avatar component/);
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.inventory.length, 1);
  assert.equal(manifest.inventory[0].truncated, true);
  assert.equal(manifest.inventory[0].capturedBytes, 256 * 1024);
  for (const [name, content] of files)
    if (name.endsWith('.json')) assert.doesNotThrow(() => JSON.parse(content), name);
});

test('avatar diagnostics identify missing frames without including images or accepting paths outside the pack', async () => {
  const base = fixture();
  put(base, ACTIVE_AVATAR_CATALOG, {
    schemaVersion: 2,
    canvas: { width: 1254, height: 1254 },
    defaultSprite: 'neutral',
    sprites: [{ file: 'capri-neutral.png' }, { file: '../../private.txt' }],
  });
  put(base, 'private.txt', 'private avatar canary');
  const report = await createDiagnosticReport({
    root: base,
    input: { category: 'interface', includeLogs: false },
    snapshot: { artwork: { mode: 'fallback' } },
    hardware: async () => ({}),
    pythonProbe: async () => ({}),
    installerDirectory: null,
  });
  const files = unpack(report.bytes);
  const artwork = JSON.parse(files.get('avatar.json'));
  assert.equal(artwork.runtime.mode, 'fallback');
  assert.equal(artwork.files.length, 2);
  assert.equal(artwork.files[0].exists, true);
  assert.equal(artwork.files[1].exists, false);
  assert.match(files.get('REPORT.md'), /procedural fallback/);
  assert.match(files.get('REPORT.md'), /capri-neutral\.png/);
  assert.ok(![...files.keys()].some((name) => name.endsWith('.png')));
  assert.ok(![...files.values()].join('').includes('private avatar canary'));
});

test('logs are optional and a linked log directory cannot read another folder', async () => {
  const base = fixture(),
    outside = fixture();
  put(outside, 'private.log', 'outside canary');
  symlinkSync(outside, path.join(base, 'logs'), process.platform === 'win32' ? 'junction' : 'dir');
  const options = {
    root: base,
    hardware: async () => ({}),
    pythonProbe: async () => ({}),
    installerDirectory: null,
  };
  for (const includeLogs of [true, false]) {
    const result = await createDiagnosticReport({
      ...options,
      input: { description: 'Fixture', includeLogs },
    });
    const files = unpack(result.bytes);
    assert.equal(
      [...files.keys()].some((name) => name.startsWith('logs/')),
      false,
    );
    assert.ok(![...files.values()].join('').includes('outside canary'));
  }
});

test('custom voice profile names, reference paths and health prose never enter diagnostic exports', async () => {
  const base = fixture(),
    privateName = 'PERSONAL_VOICE_CANARY';
  const profileDir = 'data/voices/' + privateName;
  put(base, 'config/companion-voice.json', {
    enabled: true,
    engine: 'chatterbox-turbo',
    profileDir,
  });
  put(base, profileDir + '/voice-profile.json', {
    id: privateName,
    engine: 'chatterbox-turbo',
    language: 'en',
    references: { neutral: { file: privateName + '.wav' } },
  });
  put(base, '.runtime/installer/state.json', {
    status: 'ready',
    failure: { unknownFutureField: privateName },
  });
  const report = await createDiagnosticReport({
    root: base,
    input: { category: 'voice', includeLogs: false },
    hardware: async () => ({}),
    pythonProbe: async () => ({}),
    installerDirectory: null,
    health: async () => ({ ready: true, profile: privateName, message: privateName }),
  });
  const files = unpack(report.bytes);
  assert.equal([...files.values()].join('\n').includes(privateName), false);
  const voice = JSON.parse(files.get('voice.json'));
  assert.equal(voice.config.engine, 'chatterbox-turbo');
  assert.equal(voice.profile.language, 'en');
  assert.equal(voice.health.ready, true);
  assert.match(files.get('REPORT.md'), /Missing voice component/);
});

test('bug reports validate bounded fields and ZIP entries before writing any file', async () => {
  assert.equal(validateReport('legacy description').description, 'legacy description');
  for (const value of [
    null,
    { category: '../voice' },
    { description: 'x'.repeat(4001) },
    { includeLogs: 'yes' },
    { file: 'private' },
  ])
    assert.throws(() => validateReport(value));
  await assert.rejects(diagnosticZip([{ name: '../escape', bytes: 'bad' }]));
  await assert.rejects(
    diagnosticZip([{ name: 'large.log', bytes: Buffer.alloc(16 * 1024 ** 2 + 1) }]),
  );
});

test('voice diagnostics retain technical preparation failure without including dialogue', async () => {
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({}),
    emit: () => {},
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  await voice.prepareLanguage();
  const state = voice.diagnostics();
  assert.equal(state.lastFailure.phase, 'prepare');
  assert.match(state.lastFailure.message, /503/);
  assert.equal(state.ready, false);
  assert.equal(state.preparing, false);
  assert.ok(!('turn' in state));
});

test('report IPC cancels before collection, serializes exports and atomically saves a ZIP', async () => {
  const base = fixture(),
    handlers = new Map(),
    saved = path.join(base, 'report.zip');
  let resolveDialog,
    collected = 0,
    shown = null;
  const bytes = await diagnosticZip([{ name: 'REPORT.md', bytes: 'Synthetic diagnostic report' }]);
  registerCompanionIpc((name, fn) => handlers.set(name, fn), {
    root: base,
    state: base,
    rt: {},
    preferences: {},
    getWindow: () => null,
    dialog: {
      showSaveDialog: () =>
        new Promise((resolve) => {
          resolveDialog = resolve;
        }),
    },
    shell: {
      showItemInFolder: (file) => {
        shown = file;
      },
    },
    diagnosticSnapshot: () => ({ voice: { ready: false } }),
    createReport: async ({ snapshot }) => {
      collected++;
      assert.equal(snapshot.voice.ready, false);
      return { id: 'fixture', bytes, fileCount: 1 };
    },
  });
  const save = handlers.get('capri:bug-report'),
    pending = save('Synthetic description');
  await assert.rejects(save('Second export'), /already being collected/);
  resolveDialog({ canceled: true });
  assert.equal(await pending, false);
  assert.equal(collected, 0);
  const exportReport = save({ category: 'voice', description: 'Synthetic description' });
  resolveDialog({ canceled: false, filePath: saved });
  const result = await exportReport;
  assert.equal(result.saved, true);
  assert.equal(collected, 1);
  assert.equal(shown, saved);
  assert.equal(unpack(readFileSync(saved)).get('REPORT.md'), 'Synthetic diagnostic report');
});
