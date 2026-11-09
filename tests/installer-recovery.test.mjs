// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
const windows = process.platform === 'win32';
const parent = path.join(root, '.runtime/installer-recovery-unit');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'fixture-'));
const native = path.join(folder(), 'session-harness.exe');
if (windows) {
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/out:' + native,
      '/reference:System.Web.Extensions.dll',
      path.join(root, 'packages/installer/windows/session.cs'),
      path.join(root, 'tests/fixtures/installer-session-harness.cs'),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function until(check, timeout = 7000) {
  const end = Date.now() + timeout;
  do {
    if (check()) return;
    await delay(75);
  } while (Date.now() < end);
  assert.fail('Timed out waiting for owned installer fixture');
}
async function waitForGuardEvent(folder, pattern) {
  const file = path.join(folder, 'worker-guard.jsonl');
  // The native guard writes the pause flag before appending its diagnostic event.
  await until(() => existsSync(file) && pattern.test(readFileSync(file, 'utf8')));
}
function child(file, args) {
  const value = spawn(file, args, { stdio: 'ignore', windowsHide: true });
  value.on('error', () => {});
  return value;
}
const kill = (value) => {
  if (value?.exitCode === null) value.kill();
};
const ps = (args) =>
  spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 45000,
  });

function launcherHarness(fixture) {
  const harness = path.join(fixture, 'launcher-harness.exe');
  const compiled = spawnSync(
    path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/main:InstallerLauncherHarness',
      '/out:' + harness,
      '/reference:System.Web.Extensions.dll',
      '/reference:System.IO.Compression.dll',
      '/reference:System.IO.Compression.FileSystem.dll',
      path.join(root, 'packages/installer/windows/launcher.cs'),
      path.join(root, 'packages/installer/windows/setup-localization.cs'),
      path.join(root, 'tests/fixtures/installer-launcher-harness.cs'),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  return harness;
}

test(
  'native UI attachment tolerates a brief exclusive control-file lock without losing ownership',
  { skip: !windows },
  () => {
    const result = spawnSync(native, ['attach-busy', folder()], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);

test(
  'launcher reports startup errors but releases a lost wizard that already handed off its worker',
  { skip: !windows },
  () => {
    const fixture = folder();
    const harness = launcherHarness(fixture);
    const result = spawnSync(harness, [fixture], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  },
);

test(
  'folder provisioning grants inherited write access only to the setup user and preserves existing ACLs',
  { skip: !windows },
  () => {
    const fixture = folder();
    const result = spawnSync(launcherHarness(fixture), ['provision-fixture', fixture], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  },
);

test(
  'resume, brief heartbeat delays, clock adjustments and busy control locks never pause a responsive owner',
  { skip: !windows },
  () => {
    for (const mode of [
      'resume-stale',
      'transient-stale',
      'clock-jump',
      'busy-control',
      'cursor-burst',
    ]) {
      const result = spawnSync(native, [mode, folder()], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      assert.equal(result.status, 0, mode + ': ' + result.stdout + result.stderr);
    }
  },
);

test(
  'power-loss damage to UI JSON is archived and repaired without discarding the request or partial downloads',
  { skip: !windows },
  () => {
    for (const name of ['ui-owner.json', 'ui-heartbeat.json']) {
      for (const damaged of ['primitive', '{"id":', '', '\0\0\0', 'null', '[]', '42']) {
        const f = folder();
        writeFileSync(path.join(f, 'ui-owner.json'), '{}');
        writeFileSync(path.join(f, 'ui-heartbeat.json'), '{}');
        writeFileSync(path.join(f, name), damaged);
        const request = '{"target":"unchanged fixture target"}';
        const partial = Buffer.from([0, 1, 2, 255, 10]);
        writeFileSync(path.join(f, 'request.json'), request);
        writeFileSync(path.join(f, 'download.part'), partial);
        const result = spawnSync(native, ['recover', f], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
        });
        assert.equal(result.status, 0, name + ': ' + result.stderr);
        const backups = readdirSync(f).filter(
          (file) => file.startsWith(name + '.') && file.endsWith('.corrupt'),
        );
        assert.equal(backups.length, 1, name + ' / ' + JSON.stringify(damaged));
        assert.equal(readFileSync(path.join(f, backups[0]), 'utf8'), damaged);
        assert.equal(readFileSync(path.join(f, 'request.json'), 'utf8'), request);
        assert.deepEqual(readFileSync(path.join(f, 'download.part')), partial);
        assert.equal(
          existsSync(path.join(f, 'pause')),
          true,
          'Recovery must never resume unattended',
        );
        assert.match(readFileSync(path.join(f, 'ui-events.jsonl'), 'utf8'), /ui-record-recovered/);
        assert.match(
          JSON.parse(readFileSync(path.join(f, 'ui-owner.json'), 'utf8')).id,
          /^[a-f0-9]{32}$/,
        );
      }
    }
  },
);

test(
  'UI JSON recovery cannot follow links or quarantine files outside its session',
  { skip: !windows },
  () => {
    const f = folder(),
      outside = folder();
    writeFileSync(path.join(outside, 'canary'), 'outside remains untouched');
    symlinkSync(outside, path.join(f, 'ui-owner.json'), 'junction');
    writeFileSync(path.join(f, 'ui-heartbeat.json'), '{}');
    const result = spawnSync(native, ['recover', f], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot contain links/);
    assert.equal(readFileSync(path.join(outside, 'canary'), 'utf8'), 'outside remains untouched');
    assert.equal(
      readdirSync(f).some((file) => file.endsWith('.corrupt')),
      false,
    );
  },
);
test(
  'losing the real UI process pauses its worker; reattachment requires explicit resume',
  { skip: !windows },
  async () => {
    const f = folder();
    let ui = child(native, ['ui', f]),
      guard;
    try {
      await until(() => existsSync(path.join(f, 'ui-ready')));
      guard = child(native, ['guard', f]);
      await delay(600);
      assert.equal(existsSync(path.join(f, 'pause')), false);
      ui.kill();
      await until(() => existsSync(path.join(f, 'pause')));
      await waitForGuardEvent(f, /ui-process-exited/);
      assert.match(readFileSync(path.join(f, 'worker-guard.jsonl'), 'utf8'), /ui-process-exited/);
      unlinkSync(path.join(f, 'ui-ready'));
      ui = child(native, ['ui', f]);
      await until(() => existsSync(path.join(f, 'ui-ready')));
      await delay(650);
      assert.equal(
        existsSync(path.join(f, 'pause')),
        true,
        'Connecting must retain the automatic pause',
      );
      writeFileSync(path.join(f, 'resume-request'), 'resume');
      await until(() => !existsSync(path.join(f, 'pause')));
    } finally {
      kill(ui);
      kill(guard);
    }
  },
);
test(
  'a live but unresponsive UI also pauses; stale/reused identities cannot retain control',
  { skip: !windows },
  async () => {
    const f = folder();
    const ui = child(native, ['ui', f]);
    let guard;
    try {
      await until(() => existsSync(path.join(f, 'ui-ready')));
      guard = child(native, ['guard', f]);
      writeFileSync(path.join(f, 'hang'), 'hang');
      await until(() => existsSync(path.join(f, 'pause')));
      await waitForGuardEvent(f, /ui-heartbeat-stale/);
      assert.match(readFileSync(path.join(f, 'worker-guard.jsonl'), 'utf8'), /ui-heartbeat-stale/);
    } finally {
      kill(ui);
      kill(guard);
    }
    for (const mode of ['mismatch', 'cursor']) {
      const result = spawnSync(native, [mode, folder()], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      assert.equal(result.status, 0, mode + ': ' + result.stderr);
    }
  },
);
test(
  'an invisible UI cannot keep an installation running unattended',
  { skip: !windows },
  async () => {
    const f = folder(),
      ui = child(native, ['ui', f]);
    let guard;
    try {
      await until(() => existsSync(path.join(f, 'ui-ready')));
      guard = child(native, ['guard', f]);
      writeFileSync(path.join(f, 'hidden'), 'hidden');
      await until(() => existsSync(path.join(f, 'pause')));
      assert.equal(
        JSON.parse(readFileSync(path.join(f, 'ui-heartbeat.json'), 'utf8')).connected,
        false,
      );
    } finally {
      kill(ui);
      kill(guard);
    }
  },
);
for (const automatic of [false, true])
  test(
    `native UI ${automatic ? 'automatically reopens after termination' : 'reconnects manually after a logged failure'} and restores progress, pause and cancellation`,
    { skip: !windows },
    async () => {
      const f = folder(),
        registry = path.join(f, 'registry'),
        id = randomUUID().replaceAll('-', ''),
        session = path.join(registry, 'sessions', id);
      mkdirSync(session, { recursive: true });
      writeJsonAtomic(path.join(registry, 'active.json'), { schemaVersion: 1, id });
      writeJsonAtomic(path.join(session, 'session.json'), {
        schemaVersion: 1,
        id,
        sourceRoot: root,
        language: 'en',
      });
      writeJsonAtomic(path.join(session, 'request.json'), {
        schemaVersion: 1,
        target: path.join(f, 'unused-target'),
        profile: 'balanced',
        interfaceLanguage: 'en',
        conversationLanguage: 'en',
        recognition: false,
        router: false,
        downloadModels: false,
        desktopShortcut: false,
        startMenuShortcut: false,
        voicePack: '',
        acceptLicense: true,
        acceptDownloads: true,
      });
      writeFileSync(
        path.join(session, 'events.jsonl'),
        Array.from({ length: 500 }, (_value, index) =>
          JSON.stringify({
            type: 'log',
            step: 'voice-runtime',
            message: 'Buffered model setup line ' + index,
          }),
        ).join('\n') +
          '\n{"type":"stage-plan","stages":["node","models","finalize"]}\n{"type":"stage","step":"models"}\n{"type":"download","received":256,"total":1024}\n',
      );
      const worker = child('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'packages/installer/windows/worker.ps1'),
        '-RequestFile',
        path.join(session, 'request.json'),
        '-EventsFile',
        path.join(session, 'events.jsonl'),
        '-CancelFile',
        path.join(session, 'cancel'),
        '-SessionDirectory',
        session,
        '-VerificationWorker',
      ]);
      let originalUi;
      try {
        await until(() => existsSync(path.join(session, 'pause')), 12000);
        if (automatic) {
          originalUi = child(native, ['ui', session]);
          await until(() => existsSync(path.join(session, 'ui-ready')));
          await waitForGuardEvent(session, /ui-reconnected/);
          writeFileSync(path.join(session, 'resume-request'), 'resume');
          await until(() => !existsSync(path.join(session, 'pause')));
          originalUi.kill();

          const report = path.join(session, 'recovered-ui', 'recovery.json');
          await until(() => existsSync(report), 30000);
          assert.equal(JSON.parse(readFileSync(report, 'utf8')).pausedUntilExplicitResume, true);
          const log = readFileSync(path.join(session, 'worker-guard.jsonl'), 'utf8');
          assert.match(log, /ui-process-exited; recovery=attempted; exitCode=0x[0-9A-F]{8}/);
          assert.equal([...log.matchAll(/ui-recovery-launched/g)].length, 1);
          assert.equal(existsSync(path.join(f, 'unused-target')), false);
          return;
        }
        const failedUi = path.join(f, 'failed-ui');
        const failed = ps([
          '-File',
          path.join(root, 'packages/installer/windows/wizard.ps1'),
          '-VerificationDirectory',
          failedUi,
          '-VerificationSessionRoot',
          registry,
          '-VerificationFault',
          'after-attach',
        ]);
        assert.notEqual(failed.status, 0);
        assert.equal(
          JSON.parse(readFileSync(path.join(failedUi, 'ui.worker.json'), 'utf8')).session,
          id,
        );
        assert.match(
          readFileSync(path.join(session, 'ui-events.jsonl'), 'utf8'),
          /Injected UI failure after attaching/,
        );
        assert.equal(existsSync(path.join(session, 'pause')), true);
        assert.doesNotMatch(
          readFileSync(path.join(session, 'worker-guard.jsonl'), 'utf8'),
          /ui-recovery-launched/,
        );
        // Simulate the damaged lease left on disk after an interrupted write/power loss.
        writeFileSync(path.join(session, 'ui-owner.json'), 'primitive');
        writeFileSync(path.join(session, 'ui-heartbeat.json'), '{"id":');
        const output = path.join(f, 'ui');
        const result = ps([
          '-File',
          path.join(root, 'packages/installer/windows/wizard.ps1'),
          '-VerificationDirectory',
          output,
          '-VerificationSessionRoot',
          registry,
          '-VerificationFault',
          'reconnect',
          '-Language',
          'en',
        ]);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(readdirSync(session).filter((name) => name.endsWith('.corrupt')).length, 2);
        const report = JSON.parse(readFileSync(path.join(output, 'recovery.json'), 'utf8'));
        assert.equal(report.reconnected, true);
        assert.equal(report.progress, 20);
        assert.equal(report.pausedUntilExplicitResume, true);
        assert.equal(report.cancelWorked, true);
        assert.equal(
          JSON.parse(readFileSync(path.join(session, 'worker.done.json'), 'utf8')).exitCode,
          2,
        );
        assert.equal(existsSync(path.join(f, 'unused-target')), false);
      } finally {
        kill(originalUi);
        kill(worker);
      }
    },
  );
test(
  'UI initialization exceptions are saved independently of the background installation log',
  { skip: !windows },
  () => {
    const output = path.join(folder(), 'ui');
    const result = ps([
      '-File',
      path.join(root, 'packages/installer/windows/wizard.ps1'),
      '-VerificationDirectory',
      output,
      '-VerificationFault',
      'initialization',
    ]);
    assert.notEqual(result.status, 0);
    const log = readFileSync(path.join(output, 'ui.jsonl'), 'utf8');
    assert.match(log, /ui-script-exception/);
    assert.match(log, /Injected installer UI initialization failure/);
    assert.match(log, /ui-exit/);
  },
);
