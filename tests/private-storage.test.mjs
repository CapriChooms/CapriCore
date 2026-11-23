// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  diagnosticModelId,
  privateLog,
  privateLogRecord,
  sanitizeLegacyLogs,
  writeModelSelectionLog,
} from '../packages/runtime/src/privacy-log.mjs';
import { diagnosticState } from '../apps/desktop/diagnostics/state.mjs';
import { requiresPrivacyRestart } from '../packages/runtime/src/host/processes.mjs';
function folder() {
  const parent = path.resolve('.runtime/test-data/privacy-log');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, 'fixture-'));
}
test('model metadata has a bounded identifier syntax and excludes credentials, prose and private paths', () => {
  for (const id of [
    'capri-qwen3.5:0.8b',
    'deepseek/deepseek-v4.1-flash-1017',
    'nvidia/nemotron-3.5-super-vl:free',
    'Phi-4-mini-instruct-NPU',
    'hf.co/bartowski/model-GGUF:Q4_K_M',
  ]) {
    assert.equal(diagnosticModelId(id), id);
    assert.equal(diagnosticState({ inference: { model: id } }).inference.model, id);
  }
  for (const value of [
    '',
    'x'.repeat(201),
    'Do not share this private conversation',
    'sk-test-secret-1234567890',
    'github_pat_' + ['private', 'fixture', '1234567890'].join('_'),
    'hf_private_fixture_1234567890',
    'AIzaSySyntheticCredentialForMetadataTest',
    'https://host.example/model?api_key=private',
    'https://name:password@host.example/model',
    'C:/Users/Alice/private-model',
    'C:\\Users\\Alice\\private-model',
    '/home/alice/private-model',
    '../private-model',
    'vendor/../private-model',
    'alice@example.org',
    'vendor/model\nAuthorization:Bearer-secret',
  ]) {
    assert.equal(diagnosticModelId(value), undefined, value);
    assert.equal(diagnosticState({ model: value }).model, '[PRIVATE TEXT OMITTED]');
  }
  const flags = diagnosticState({
    receivedText: true,
    text: 'private response',
    futureText: false,
  });
  assert.equal(flags.receivedText, true);
  assert.equal(flags.text, '[PRIVATE DATA OMITTED]');
  assert.equal(flags.futureText, '[PRIVATE DATA OMITTED]');
});

test('only dedicated desktop model events retain IDs, remain idempotent and discard other fields', () => {
  const modelId = 'vendor/model:free';
  const source = JSON.stringify({
    schemaVersion: 1,
    event: 'model-selected',
    modelId,
    prompt: 'SYNTHETIC_PRIVATE_CONTENT',
    apiKey: 'sk-synthetic-secret-1234567890',
  });
  const record = privateLogRecord(source, { service: 'desktop', stream: 'stdout' });
  assert.equal(record.modelId, modelId);
  assert.equal(record.event, 'model-selected');
  assert.equal(JSON.stringify(record).includes('SYNTHETIC_PRIVATE_CONTENT'), false);
  assert.equal(JSON.stringify(record).includes('sk-synthetic-secret'), false);
  assert.equal(privateLogRecord(source).modelId, undefined);
  assert.equal(privateLogRecord(source, { service: 'capri' }).modelId, undefined);
  assert.equal(
    privateLogRecord(JSON.stringify({ event: 'failure', modelId }), { service: 'desktop' }).modelId,
    undefined,
  );
  const sanitized = privateLog(JSON.stringify(record));
  assert.equal(JSON.parse(sanitized).modelId, modelId);
  assert.equal(privateLog(sanitized), sanitized);
  const invalid = privateLogRecord(
    JSON.stringify({
      schemaVersion: 1,
      event: 'model-selected',
      modelId: 'sk-test-secret-1234567890',
    }),
    { service: 'desktop' },
  );
  assert.equal(invalid.modelId, undefined);
});

test('model selection logging is bounded, re-exportable and cannot overwrite linked files', () => {
  const directory = folder();
  assert.equal(writeModelSelectionLog(directory, 'vendor/first-model:free'), true);
  assert.equal(writeModelSelectionLog(directory, 'Phi-4-mini-instruct-NPU'), true);
  const file = path.join(directory, 'desktop-model.jsonl');
  const stored = readFileSync(file, 'utf8');
  assert.equal(stored.trim().split('\n').length, 1);
  assert.equal(JSON.parse(stored).modelId, 'Phi-4-mini-instruct-NPU');
  assert.equal(JSON.parse(privateLog(stored)).modelId, 'Phi-4-mini-instruct-NPU');
  assert.equal(writeModelSelectionLog(directory, 'sk-private-fixture-123456789'), false);
  assert.equal(readFileSync(file, 'utf8'), stored);
  const linked = folder(),
    outside = path.join(linked, 'unchanged.txt');
  writeFileSync(outside, 'Unchanged');
  linkSync(outside, path.join(linked, 'desktop-model.jsonl'));
  assert.equal(writeModelSelectionLog(linked, 'vendor/model'), false);
  assert.equal(readFileSync(outside, 'utf8'), 'Unchanged');
});

test('private logging retains useful failure classes but drops prose, unknown JSON, tools, keys and paths', () => {
  const canary = 'SYNTHETIC_PRIVATE_CONTENT';
  const raw = `${canary}\nRuntimeError: ${canary} ECONNRESET\n${JSON.stringify({ event: 'stage', stage: 'voice-runtime', prompt: canary, messages: [{ content: canary }], token: canary, path: canary })}`;
  const log = privateLog(raw);
  assert.equal(log.includes(canary), false);
  assert.match(log, /RuntimeError/);
  assert.match(log, /ECONNRESET/);
  assert.match(log, /voice-runtime/);
  assert.equal(privateLogRecord('HTTP 429 too many requests').httpStatus, 429);
  assert.equal(privateLogRecord('CUDA out of memory').code, 'CUDA_OUT_OF_MEMORY');
  assert.equal(
    privateLogRecord(JSON.stringify({ event: canary, stage: canary })).event,
    'activity',
  );
});

test('legacy log cleanup removes context text without removing bounded failure codes', () => {
  const directory = folder(),
    file = path.join(directory, 'voice.log');
  writeFileSync(
    file,
    'SYNTHETIC_PRIVATE_CONTENT\nRuntimeError: SYNTHETIC_PRIVATE_CONTENT ECONNRESET\n',
  );
  const result = sanitizeLegacyLogs(directory);
  assert.equal(result.sanitized, 1);
  const stored = readFileSync(file, 'utf8');
  assert.equal(stored.includes('SYNTHETIC_PRIVATE_CONTENT'), false);
  assert.match(stored, /ECONNRESET/);
  assert.deepEqual(readdirSync(directory), ['voice.log']);
});

test('diagnostic state omits new arbitrary text fields, but retains technical counters and startup failures', () => {
  const source = {
    unknownFutureField: 'SYNTHETIC_PRIVATE_CONTENT',
    messages: 'SYNTHETIC_PRIVATE_CONTENT',
    task: { goal: 'SYNTHETIC_PRIVATE_CONTENT' },
    response: { phase: 'model', contextTokens: 32768, errorName: 'TimeoutError' },
    recognition: {
      lastFailure: { code: 'ASR_START_NATIVE_CRASH', startupStage: 'ASR_START_MODEL' },
    },
  };
  const state = diagnosticState(source);
  assert.equal(JSON.stringify(state).includes('SYNTHETIC_PRIVATE_CONTENT'), false);
  assert.equal(state.response.phase, 'model');
  assert.equal(state.response.contextTokens, 32768);
  assert.equal(state.recognition.lastFailure.code, 'ASR_START_NATIVE_CRASH');
  assert.equal(requiresPrivacyRestart({ pid: 1 }), true);
  assert.equal(requiresPrivacyRestart({ privateLogSchema: 1 }), false);
  assert.equal(requiresPrivacyRestart(null), false);
});

test('computer diagnostics retain bounded host actions and stop codes without chat or target data', () => {
  const canary = 'PRIVATE_DISCORD_DESTINATION_AND_MESSAGE';
  const state = diagnosticState({
    computerTask: {
      phase: 'stopped',
      status: 'needs_user',
      steps: 1,
      lastFailure: { reason: 'discord_control_unresolved', code: 'COMPUTER_TARGET_COVERED' },
      actions: [
        { action: 'launch', outcome: 'applied' },
        { action: 'enter_text', outcome: 'discord_structured_step_required' },
        { action: canary, outcome: canary, reason: canary },
      ],
      text: canary,
      goal: canary,
      server: canary,
      channel: canary,
      untrustedValue: canary,
      untrustedValueSha256: 'ab'.repeat(32),
      targetId: canary,
      windowTitle: canary,
      arbitrary: canary,
    },
  });
  assert.deepEqual(state.computerTask.actions.slice(0, 2), [
    { action: 'launch', outcome: 'applied' },
    { action: 'enter_text', outcome: 'discord_structured_step_required' },
  ]);
  assert.equal(state.computerTask.status, 'needs_user');
  assert.equal(state.computerTask.lastFailure.reason, 'discord_control_unresolved');
  assert.equal(state.computerTask.lastFailure.code, 'COMPUTER_TARGET_COVERED');
  assert.equal(JSON.stringify(state).includes(canary), false);
  assert.equal(JSON.stringify(state).includes('ab'.repeat(32)), false);
  assert.equal(state.computerTask.text, '[PRIVATE DATA OMITTED]');
  assert.equal(state.computerTask.actions[2].action, '[PRIVATE TEXT OMITTED]');
});
