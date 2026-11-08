// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { replaceSourceFile } from '../packages/installer/src/replace-source-file.mjs';

const cache = path.join(root, '.runtime/source-replacement-unit');
mkdirSync(cache, { recursive: true });
function fixture() {
  const base = mkdtempSync(path.join(cache, 'case-'));
  const installation = path.join(base, 'Повторная установка Capri');
  const target = path.join(installation, 'tools/setup/python-runtime.ps1');
  const source = path.join(base, 'new.ps1');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(source, 'new source');
  writeFileSync(target, 'previous source');
  return { base, root: installation, target, source };
}
const stagedFiles = (f) => {
  const staging = path.join(f.root, '.runtime/installer/staging');
  return existsSync(staging) ? readdirSync(staging) : [];
};

test(
  'read-only Windows destination reproduces copyfile EPERM and can be replaced safely',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const f = fixture();
    chmodSync(f.target, 0o444);
    assert.throws(() => copyFileSync(f.source, f.target), { code: 'EPERM', syscall: 'copyfile' });
    await replaceSourceFile(f.source, f.target, { root: f.root });
    assert.equal(readFileSync(f.target, 'utf8'), 'new source');
    assert.ok(lstatSync(f.target).mode & 0o200);
    assert.deepEqual(stagedFiles(f), []);
  },
);

test('source replacement rejects escape and junction paths without changing outside files', async () => {
  const f = fixture();
  await assert.rejects(replaceSourceFile(f.target, f.source, { root: f.root }), /escaped/);
  const outside = path.join(f.base, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'canary.ps1'), 'private outside source');
  const linked = path.join(f.root, 'linked');
  symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    replaceSourceFile(f.source, path.join(linked, 'canary.ps1'), { root: f.root }),
    /links/,
  );
  assert.equal(readFileSync(path.join(outside, 'canary.ps1'), 'utf8'), 'private outside source');
  assert.equal(readFileSync(f.source, 'utf8'), 'new source');
});

test('cancellation preserves old source and a hard-linked read-only file is not modified', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort(new Error('cancelled fixture'));
  await assert.rejects(
    replaceSourceFile(f.source, f.target, { root: f.root, signal: controller.signal }),
    /cancelled fixture/,
  );
  assert.equal(readFileSync(f.target, 'utf8'), 'previous source');
  if (process.platform === 'win32') {
    const alias = path.join(f.base, 'outside-hardlink.ps1');
    linkSync(f.target, alias);
    chmodSync(f.target, 0o444);
    try {
      await assert.rejects(
        replaceSourceFile(f.source, f.target, { root: f.root }),
        /hard-linked|filesystem links/,
      );
      assert.equal(readFileSync(alias, 'utf8'), 'previous source');
      assert.equal(lstatSync(alias).mode & 0o200, 0);
    } finally {
      chmodSync(f.target, 0o644);
    }
  }
  assert.deepEqual(stagedFiles(f), []);
});

async function holdWindowsFile(t, f) {
  const ready = path.join(f.base, 'ready'),
    release = path.join(f.base, 'release');
  const script = `
    $ErrorActionPreference = 'Stop'
    $capriStream = [IO.File]::Open($env:CAPRI_TEST_LOCK_TARGET, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      [IO.File]::WriteAllText($env:CAPRI_TEST_LOCK_READY, 'ready')
      while (-not [IO.File]::Exists($env:CAPRI_TEST_LOCK_RELEASE)) { Start-Sleep -Milliseconds 25 }
    } finally { $capriStream.Dispose() }
  `;
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        CAPRI_TEST_LOCK_TARGET: f.target,
        CAPRI_TEST_LOCK_READY: ready,
        CAPRI_TEST_LOCK_RELEASE: release,
      },
    },
  );
  let error = '',
    spawnError;
  child.stderr.on('data', (chunk) => {
    error = (error + chunk).slice(-3000);
  });
  child.on('error', (failure) => {
    spawnError = failure;
  });
  const stopped = new Promise((resolve) => child.once('close', resolve));
  const unlock = async () => {
    writeFileSync(release, 'release');
    const timer = setTimeout(() => child.kill(), 3000);
    timer.unref();
    try {
      await stopped;
    } finally {
      clearTimeout(timer);
    }
  };
  t.after(unlock);
  for (let i = 0; i < 100 && !existsSync(ready) && child.exitCode === null && !spawnError; i++)
    await delay(100);
  assert.ok(existsSync(ready), spawnError?.message || error || 'Lock fixture did not start');
  return unlock;
}

test(
  'a short Windows sharing lock recovers; a persistent lock preserves contents and read-only state',
  {
    skip: process.platform !== 'win32',
    timeout: 20000,
  },
  async (t) => {
    const transient = fixture();
    const unlock = await holdWindowsFile(t, transient);
    const pending = replaceSourceFile(transient.source, transient.target, { root: transient.root });
    await delay(300);
    await unlock();
    await pending;
    assert.equal(readFileSync(transient.target, 'utf8'), 'new source');
    assert.deepEqual(stagedFiles(transient), []);

    const persistent = fixture();
    chmodSync(persistent.target, 0o444);
    const unlockPersistent = await holdWindowsFile(t, persistent);
    try {
      await assert.rejects(
        replaceSourceFile(persistent.source, persistent.target, { root: persistent.root }),
        (error) => {
          assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
          assert.match(error.message, /tools[\\/]setup[\\/]python-runtime\.ps1/);
          assert.match(error.message, /Existing file contents were preserved/);
          return true;
        },
      );
      assert.equal(readFileSync(persistent.target, 'utf8'), 'previous source');
      assert.equal(lstatSync(persistent.target).mode & 0o200, 0);
      assert.deepEqual(stagedFiles(persistent), []);
    } finally {
      await unlockPersistent();
      chmodSync(persistent.target, 0o644);
    }
  },
);
