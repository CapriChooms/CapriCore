// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { updateBlocksStartup } from '../packages/runtime/src/host/update-state.mjs';

const parent = path.join(root, '.runtime/update-startup-tests');
mkdirSync(parent, { recursive: true });
const cases = [];
function fixture(name, blocked, { phase = 'complete', journal = {}, pending = {}, lock } = {}) {
  const folder = mkdtempSync(path.join(parent, 'case-'));
  const id = randomUUID();
  const put = (name, value) => {
    const file = path.join(folder, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
  const active = put('.runtime/updates/active.json', { schemaVersion: 1, id, ...pending });
  const saved = put(`.runtime/updates/backups/${id}/journal.json`, {
    schemaVersion: 1,
    id,
    phase,
    entries: [],
    ...journal,
  });
  if (lock !== undefined) put('.runtime/installer/install.lock.json', lock);
  const entry = { name, blocked, folder, active, saved, put };
  cases.push(entry);
  return entry;
}
fixture('completed update with leftover receipt', false);
fixture('completed rollback with leftover receipt', false, { phase: 'rolled-back' });
for (const phase of ['installing', 'backing-up', 'recovering', 'failed', 'unknown'])
  fixture(`nonterminal ${phase}`, true, { phase });
fixture('live installer still finishing commit', true, { lock: { pid: process.pid } });
fixture('invalid lock', true, { lock: { pid: 0 } });
fixture('oversized lock PID', true, { lock: { pid: 2147483648 } });
fixture('missing lock PID', true, { lock: {} });
fixture('wrong journal identity', true, { journal: { id: randomUUID() } });
fixture('wrong journal schema', true, { journal: { schemaVersion: 2 } });
fixture('wrong marker schema', true, { pending: { schemaVersion: 2 } });
fixture('marker path traversal', true, { pending: { id: '../outside' } });
fixture('missing journal', true, { pending: { id: randomUUID() } });
const malformed = fixture('malformed journal', true);
writeFileSync(malformed.saved, '{broken');
const huge = fixture('oversized journal', true);
writeFileSync(huge.saved, ' '.repeat(2 * 1024 ** 2 + 1));
const empty = mkdtempSync(path.join(parent, 'empty-'));
cases.push({ name: 'no pending update', folder: empty, blocked: false });
const dead = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
assert.equal(dead.status, 0);
fixture('terminal journal and exited installer', false, { lock: { pid: dead.pid } });
fixture('exited installer does not prove rollback', true, {
  phase: 'installing',
  lock: { pid: dead.pid },
});
const hardLinked = fixture('hard-linked journal', true);
linkSync(hardLinked.saved, path.join(parent, randomUUID() + '.json'));

for (const entry of cases) {
  test(`runtime startup: ${entry.name}`, () => {
    const before = entry.active && readFileSync(entry.active);
    assert.equal(updateBlocksStartup(entry.folder), entry.blocked);
    if (before)
      assert.deepEqual(readFileSync(entry.active), before, 'startup never removes receipts');
  });
}

test('linked update metadata never permits startup', () => {
  const f = fixture('linked journal', true);
  const outside = mkdtempSync(path.join(parent, 'linked-'));
  f.put('.runtime/updates/active.json', { schemaVersion: 1, id: randomUUID() });
  const pending = JSON.parse(readFileSync(f.active, 'utf8'));
  writeFileSync(
    path.join(outside, 'journal.json'),
    JSON.stringify({ ...pending, phase: 'complete' }),
  );
  symlinkSync(outside, path.join(f.folder, '.runtime/updates/backups', pending.id), 'junction');
  assert.equal(updateBlocksStartup(f.folder), true);
});

test(
  'native Capri.exe and runtime agree on startup recovery',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'native-'));
    const harness = path.join(folder, 'Harness.cs');
    const exe = path.join(folder, 'Harness.exe');
    writeFileSync(
      harness,
      `
internal static class CapriApplicationInfo {internal const string NodeDirectory="fixture";}
internal static class CapriSetupLocale {
 internal static bool RightToLeft=false;
 internal static void SelectInstalled(string root){}
 internal static string Text(string key,string fallback){return fallback;}
}
internal static class UpdateStateHarness {
 public static void Main(string[] args) {
  foreach(string root in args)System.Console.WriteLine(CapriUpdateState.BlocksStartup(root)?"blocked":"allowed");
 }
}`,
    );
    const built = spawnSync(
      path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      [
        '/nologo',
        '/target:exe',
        '/main:UpdateStateHarness',
        `/out:${exe}`,
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Web.Extensions.dll',
        path.join(root, 'packages/installer/windows/app-launcher.cs'),
        harness,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const checked = spawnSync(
      exe,
      cases.map(({ folder }) => folder),
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(
      checked.stdout.trim().split(/\r?\n/),
      cases.map(({ blocked }) => (blocked ? 'blocked' : 'allowed')),
    );
  },
);
