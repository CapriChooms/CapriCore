// SPDX-License-Identifier: GPL-3.0-only
// Real native UIA/input path, confined to a disposable synthetic Discord.exe.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

if (process.platform !== 'win32') throw Error('The native Discord verifier requires Windows.');
const parent = path.join(root, '.runtime/discord-control-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const executable = path.join(folder, 'Discord.exe');
const log = path.join(folder, 'synthetic-input.log');
execFileSync(
  path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  ),
  [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/out:' + executable,
    path.join(root, 'tools/verify/native/DiscordControlFixture.cs'),
  ],
  { windowsHide: true, timeout: 20000 },
);
const child = spawn(executable, [log], { stdio: 'ignore', windowsHide: false });
const report = {
  passed: false,
  folder,
  fixturePid: child.pid,
  ownerApplicationsTouched: false,
  syntheticMessagesOnly: true,
  checks: [],
  actions: [],
};
let control,
  turn = 0;
try {
  for (
    let attempt = 0;
    attempt < 50 && (!existsSync(log) || !readFileSync(log, 'utf8').includes('ready'));
    attempt++
  )
    await delay(100);
  assert.ok(existsSync(log), 'Synthetic fixture must start.');
  // Focus only the executable compiled in this unique disposable directory.
  await callApplicationBridge(root, { action: 'catalog_launch', executable });
  const initial = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(
    Number(initial.processId),
    child.pid,
    'Only the synthetic fixture may receive input.',
  );
  assert.equal(initial.applicationKind, 'discord');
  assert.ok(
    initial.untrustedControls
      .find((item) => item.untrustedName === 'Test Server')
      ?.untrustedAncestors.includes('Servers sidebar'),
  );
  assert.ok(
    initial.untrustedControls
      .find((item) => item.untrustedName === 'Lounge (voice channel)')
      ?.untrustedAncestors.includes('Channels'),
  );
  report.checks.push('native process identity and UIA landmark ancestry');
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    currentTurn: () => 'synthetic-' + turn,
    registerEscape: () => true,
    unregisterEscape: () => {},
    showBorder: async () => {},
    hideBorder: () => {},
    pointerDuration: () => 40,
    capture: async () => {
      throw Error('The synthetic verifier uses native accessibility only.');
    },
    bridge: async (command, options) => {
      // Even cleanup input is fenced. If another app gains focus, the verifier
      // immediately stops rather than sending a key, click or release to it.
      if (command.action === 'computer_release') {
        options?.signal?.throwIfAborted();
        try {
          execFileSync(executable, ['--assert-foreground', String(child.pid)], {
            windowsHide: true,
            timeout: 1200,
            stdio: 'ignore',
          });
        } catch {
          report.foregroundFenceBlocked = true;
          throw Error('The synthetic foreground cleanup fence stopped input.');
        }
        report.actions.push(command.action);
        return callApplicationBridge(root, command, options);
      }
      let live;
      try {
        live = await callApplicationBridge(root, { action: 'computer_state' }, options);
      } catch (error) {
        report.syntheticObservationFailure = { code: error.code ?? null, name: error.name };
        throw error;
      }
      if (Number(live.processId) !== child.pid) report.foregroundFenceBlocked = true;
      assert.equal(
        Number(live.processId),
        child.pid,
        'Never send verifier input to an owner application.',
      );
      if (command.action === 'computer_state') return live;
      report.actions.push(command.action);
      try {
        return await callApplicationBridge(root, command, options);
      } catch (error) {
        report.syntheticNativeError = {
          action: command.action,
          code: error.code,
          message: error.message,
        };
        if (command.action === 'computer_type') {
          await delay(1500);
          const settled = await callApplicationBridge(root, { action: 'computer_state' });
          assert.equal(Number(settled.processId), child.pid);
          const field = settled.untrustedControls.find(
            (item) => item.untrustedName === 'Message #general',
          );
          report.syntheticNativeError.draftMatchesAfterSettling =
            field?.untrustedValueSha256 === createHash('sha256').update(command.text).digest('hex');
          report.syntheticNativeError.visibleDraftLength = field?.untrustedValue?.length;
        }
        throw error;
      }
    },
  });
  const agent = new ComputerAgent({
    control,
    plan: async () => {
      throw Error('Exact synthetic Discord goals must use the dedicated adapter.');
    },
    applications: {
      operation: (_id, _args, run) => run(),
      execute: async () => {
        throw Error('The synthetic app is already open; installed app launches are forbidden.');
      },
    },
  });
  const run = async (goal) => {
    turn++;
    const result = await agent.run(goal);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(control.session, null);
    return result;
  };
  const joined = await run('Join Discord voice channel "Lounge" on server "Test Server".');
  assert.equal(joined.verified, true);
  assert.equal(joined.evidence, 'Lounge / Test Server');
  const left = await run('Leave the voice channel in Discord.');
  assert.equal(left.verified, true);
  report.checks.push('real ComputerAgent joins and leaves only the synthetic voice panel');
  const message = process.argv.includes('--short')
    ? 'Synthetic exact message.'
    : 'Synthetic exact Unicode ＄100  café message. '.repeat(18).trim();
  const submitted = await run(
    'Send message "' + message + '" in Discord channel #general on server "Test Server".',
  );
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.deliveryConfirmed, false);
  assert.equal(submitted.submitted, true);
  const lines = readFileSync(log, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.filter((line) => line === 'join').length, 1);
  assert.equal(lines.filter((line) => line === 'leave').length, 1);
  const expectedHash = createHash('sha256').update(message, 'utf8').digest('hex');
  assert.deepEqual(
    lines.filter((line) => line.startsWith('send:')),
    ['send:1:' + expectedHash],
  );
  const native = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(Number(native.processId), child.pid);
  assert.ok(native.untrustedControls.some((item) => item.untrustedTextSha256 === expectedHash));
  turn++;
  await control.begin('Inspect synthetic hashes and layout budget.');
  const forwarded = await control.execute({ action: 'observe', vision: false });
  assert.equal(forwarded.window.applicationKind, 'discord');
  assert.ok(forwarded.targets.some((item) => item.untrustedTextSha256 === expectedHash));
  assert.ok(
    forwarded.targets.find((item) => item.editable && item.untrustedLabel === 'Message #general')
      ?.untrustedValueSha256,
  );
  report.syntheticMessageLength = message.length;
  report.checks.push(
    'exact synthetic message submitted once; native full-text/value hashes forwarded',
  );
  const large = forwarded.targets.find((item) => item.untrustedLabel === 'Large layout');
  assert.ok(large);
  await control.execute({ action: 'click', targetId: large.targetId });
  const nativeBounded = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(Number(nativeBounded.processId), child.pid);
  const nativeBytes = Buffer.byteLength(JSON.stringify(nativeBounded));
  assert.ok(
    nativeBytes < 65536,
    'Worst-case non-ASCII ancestors and hashes must stay below the native response budget.',
  );
  const bounded = await control.execute({ action: 'observe', vision: false });
  assert.equal(bounded.window.controlsTruncated, true);
  assert.ok(bounded.targets.length <= 140);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) < 65536);
  assert.ok(nativeBounded.untrustedControls.some((item) => item.untrustedAncestors?.length >= 6));
  report.largeLayout = {
    nativeBytes,
    forwardedBytes: Buffer.byteLength(JSON.stringify(bounded)),
    targetCount: bounded.targets.length,
  };
  report.checks.push(
    'large non-ASCII ancestor/hash layout stays under 65KB and marks truncated observations',
  );
  await control.stop({ blockTurn: false });
  report.passed = true;
} finally {
  await control?.stop({ blockTurn: false });
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
