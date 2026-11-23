// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../packages/runtime/src/host/paths.mjs';

test(
  'the real failure-page buttons save a ZIP and open one combined log in an isolated native UI',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'ui-'));
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'packages/installer/windows/wizard.ps1'),
        '-VerificationDirectory',
        folder,
        '-VerificationFault',
        'report-export',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const record = JSON.parse(readFileSync(path.join(folder, 'report-export.json'), 'utf8'));
    assert.equal(record.ownerDataAccessed, false);
    assert.ok(record.file.startsWith(folder));
    assert.equal(readFileSync(record.file).subarray(0, 2).toString(), 'PK');
    assert.ok(record.log.startsWith(folder));
    assert.equal(path.basename(record.log), 'setup.log');
    assert.match(readFileSync(record.log, 'utf8'), /Injected installation failure/);
    assert.match(readFileSync(record.log, 'utf8'), /ui-start/);
  },
);

const parent = path.join(root, '.runtime/setup-report-tests');
mkdirSync(parent, { recursive: true });
const put = (file, text) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
};
function exportReport({ registry, session, target, uiLog, output }) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'packages/installer/windows/export-diagnostics.ps1'),
      '-RegistryRoot',
      registry,
      ...(session ? ['-SessionDirectory', session] : []),
      ...(target ? ['-Target', target] : []),
      ...(uiLog ? ['-UiLogPath', uiLog] : []),
      '-OutputDirectory',
      output,
      '-Failure',
      'Injected ECONNRESET failure',
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, HF_TOKEN: 'hf-secret-canary-12345678' },
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const archive = result.stdout.trim().split(/\r?\n/).at(-1);
  const extracted = path.join(path.dirname(archive), 'extract-' + path.basename(archive));
  mkdirSync(extracted);
  const unpacked = spawnSync('tar', ['-xf', archive, '-C', extracted], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const files = new Map();
  const walk = (folder) => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const name = path.join(folder, item.name);
      if (item.isDirectory()) walk(name);
      else
        files.set(
          path.relative(extracted, name).split(path.sep).join('/'),
          readFileSync(name, 'utf8'),
        );
    }
  };
  walk(extracted);
  return { archive, files };
}

test(
  'setup exports ZIP without Node, including failed-session/npm tails and redacting secrets',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const registry = path.join(folder, 'registry'),
      session = path.join(registry, 'sessions', 'a'.repeat(32)),
      target = path.join(folder, 'installation');
    const providerKey = 'sk-or-v1-' + 'b'.repeat(64);
    const hubToken = 'hf_' + 'SyntheticCredentialCanary'.repeat(2);
    put(path.join(session, 'session.json'), { releaseTag: 'v0.3.3', id: 'a'.repeat(32) });
    put(path.join(session, 'request.json'), {
      target,
      profile: 'balanced',
      password: 'request-secret-canary',
      voicePack: 'private-voice-pack-canary',
    });
    put(
      path.join(session, 'events.jsonl'),
      'x'.repeat(300000) +
        '\nECONNRESET registry.npmjs.org\nAuthorization: Bearer header-secret-canary\nHF_TOKEN=hf-secret-canary-12345678\n{"password":"json-secret-canary"}\nhttps://user:uri-secret-canary@example.org/?token=query-secret-canary\n' +
        providerKey +
        '\n' +
        hubToken +
        '\n',
    );
    put(path.join(session, 'worker.done.json'), { exitCode: 1 });
    const uiLog = path.join(registry, 'logs', 'ui-fixture.jsonl');
    put(uiLog, 'ui process fixture marker');
    put(path.join(session, 'worker.log'), `Verifying ${target} before launch`);
    put(
      path.join(session, 'worker.error.log'),
      'Authorization: Bearer ' + 'z'.repeat(300000) + 'partial-line-secret-canary',
    );
    put(path.join(target, '.runtime/npm-cache/_logs/npm-debug.log'), 'npm error code ECONNRESET\n');
    put(path.join(target, '.runtime/installer/state.json'), {
      status: 'failed',
      error: {
        message: 'Authorization: Bearer state-secret-canary',
        token: 'nested-secret-canary',
      },
    });
    put(
      path.join(target, 'logs/ollama.stderr.log'),
      'runtime fixture shutdown\nAuthorization: Bearer header-secret-canary\n',
    );
    put(path.join(target, 'data/desktop/transcript.json'), 'private-history-canary');
    const { files } = exportReport({
      registry,
      session,
      uiLog,
      output: path.join(folder, 'reports'),
    });
    const text = [...files.values()].join('\n');
    for (const secret of [
      'header-secret-canary',
      'hf-secret-canary-12345678',
      'json-secret-canary',
      'uri-secret-canary',
      'query-secret-canary',
      'private-history-canary',
      'request-secret-canary',
      'private-voice-pack-canary',
      'partial-line-secret-canary',
      'state-secret-canary',
      'nested-secret-canary',
      providerKey,
      hubToken,
      target,
    ])
      assert.ok(!text.includes(secret), secret);
    assert.deepEqual([...files.keys()].sort(), ['REPORT.md', 'setup.json', 'setup.log']);
    const log = files.get('setup.log');
    assert.match(log, /npm error code ECONNRESET/);
    assert.match(log, /runtime fixture shutdown/);
    assert.match(log, /Verifying <INSTALL> before launch/);
    assert.equal(log.split('ui process fixture marker').length - 1, 1);
    assert.ok(!log.includes('x'.repeat(100)));
    assert.match(files.get('REPORT.md'), /Nothing was uploaded/);
    const metadata = JSON.parse(files.get('setup.json'));
    assert.equal(metadata.request.profile, 'balanced');
    assert.equal(metadata.worker.exitCode, 1);
    assert.equal(metadata.installation.state.error.message, 'Authorization: [REDACTED]');
    const events = metadata.logs.find(({ file }) => file === 'session/events.jsonl');
    assert.equal(events.truncated, true);
    assert.ok(events.capturedBytes <= 256 * 1024);
  },
);

test(
  'broken metadata, linked sources and an unwritable chosen folder still produce a partial report',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const registry = path.join(folder, 'registry'),
      session = path.join(registry, 'sessions', 'b'.repeat(32));
    put(path.join(registry, 'active.json'), '{invalid JSON');
    put(path.join(session, 'request.json'), '{truncated');
    put(path.join(session, 'events.jsonl'), 'partial installation failed');
    const outside = path.join(folder, 'outside');
    put(path.join(outside, 'unsafe.jsonl'), 'outside-secret-canary');
    symlinkSync(outside, path.join(registry, 'logs'), 'junction');
    const output = path.join(folder, 'blocked-output');
    writeFileSync(output, 'not a directory');
    const { archive, files } = exportReport({ registry, output });
    assert.ok(archive.startsWith(path.join(registry, 'reports')));
    assert.ok(JSON.parse(files.get('setup.json')).warnings.length > 0);
    assert.ok(![...files.values()].join('\n').includes('outside-secret-canary'));
    assert.match(files.get('setup.log'), /partial installation failed/);
  },
);
