// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildDesktopTeleport, helperName } from '../scripts/desktop-teleport-build.mjs';

const root = path.resolve('fixture-root');

test('a successful cargo build is copied to the runtime folder the app reads', () => {
  const calls = { run: [], copy: [], mkdir: [] };
  const destination = buildDesktopTeleport(root, {
    run: (command, args, options) => {
      calls.run.push([command, args, options]);
      return { status: 0 };
    },
    copy: (from, to) => calls.copy.push([from, to]),
    mkdir: (folder, options) => calls.mkdir.push([folder, options]),
  });
  assert.equal(calls.run.length, 1);
  const [command, args, options] = calls.run[0];
  assert.equal(command, 'cargo');
  assert.deepEqual(args, [
    'build',
    '--release',
    '--manifest-path',
    path.join(root, 'native/desktop-teleport/Cargo.toml'),
  ]);
  assert.equal(options.cwd, root);
  assert.equal(helperName, 'capri-teleport.exe');
  assert.equal(destination, path.join(root, '.runtime', 'desktop-teleport', 'capri-teleport.exe'));
  assert.deepEqual(calls.mkdir, [[path.dirname(destination), { recursive: true }]]);
  assert.deepEqual(calls.copy, [
    [path.join(root, 'native/desktop-teleport/target/release/capri-teleport.exe'), destination],
  ]);
});

test('a failing cargo build stops before anything is copied', () => {
  let copied = false;
  assert.throws(
    () =>
      buildDesktopTeleport(root, {
        run: () => ({ status: 101 }),
        copy: () => (copied = true),
        mkdir: () => {},
      }),
    /cargo build failed with status 101/,
  );
  assert.equal(copied, false);
});

test('cargo that cannot be started reports the spawn error', () => {
  const failure = new Error('spawn cargo ENOENT');
  assert.throws(
    () =>
      buildDesktopTeleport(root, {
        run: () => ({ error: failure }),
        copy: () => {},
        mkdir: () => {},
      }),
    failure,
  );
});
