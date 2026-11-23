// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  CAMERA_FRAME_BYTES,
  CAMERA_RUNTIME_FOLDER,
  CALL_CAMERA_FILES,
  CAMERA_LICENSE_FILE,
} from '../apps/desktop/call-camera-protocol.mjs';
import { CallCamera } from '../apps/desktop/main/call-camera.mjs';
import {
  CAMERA_BUNDLES_FOLDER,
  readCameraBundleReceipt,
} from '../apps/desktop/main/camera-bundle.mjs';
import { cameraI420 } from '../apps/desktop/renderer/call-camera-frame.mjs';
import { prepareBundledCamera } from '../packages/installer/src/camera-package.mjs';
import { temporaryFolders } from './temporary-folders.mjs';

const temp = temporaryFolders('capri-camera-test-');

function bundle(folder) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, CAMERA_LICENSE_FILE), 'Camera license fixture.');
  for (const name of CALL_CAMERA_FILES) {
    const pe = Buffer.alloc(128);
    pe.writeUInt16LE(0x5a4d, 0);
    pe.writeUInt32LE(64, 0x3c);
    pe.writeUInt32LE(0x4550, 64);
    pe.writeUInt16LE(name.endsWith('-x86.dll') ? 0x014c : 0x8664, 68);
    pe.writeUInt16LE(name.endsWith('.dll') ? 0x2000 : 0, 86);
    writeFileSync(path.join(folder, name), pe);
  }
}

test('camera frame converts RGB to independent I420 luminance and chroma planes', () => {
  const rgba = Uint8Array.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const converted = cameraI420(rgba, new Uint8Array(6), 2, 2);
  assert.deepEqual([...converted], [82, 144, 41, 235, 128, 128]);
});

test('camera starts only after opt-in and emits only full frames until stopped', async () => {
  const root = temp();
  bundle(path.join(root, CAMERA_RUNTIME_FOLDER));
  const fake = new EventEmitter();
  fake.stdout = new PassThrough();
  fake.stdin = new PassThrough();
  const published = [];
  fake.stdin.on('data', (bytes) => published.push(bytes));
  fake.stdin.on('end', () => fake.emit('close', 0));
  const states = [];
  let starts = 0;
  const camera = new CallCamera({
    root,
    platform: 'win32',
    notify: (state) => states.push(state),
    spawnProcess(executable, args) {
      starts++;
      assert.equal(executable, path.join(root, CAMERA_RUNTIME_FOLDER, CALL_CAMERA_FILES[0]));
      assert.deepEqual(args, []);
      queueMicrotask(() => fake.stdout.write('READY\n'));
      return fake;
    },
  });
  assert.equal(camera.snapshot().enabled, false);
  const frame = new Uint8Array(CAMERA_FRAME_BYTES);
  assert.equal(camera.frame(frame), false);
  assert.equal(starts, 0);
  const results = await Promise.all([camera.setEnabled(true), camera.setEnabled(true)]);
  assert.ok(results.every(({ enabled, pending }) => enabled && !pending));
  assert.equal(starts, 1);
  assert.equal(camera.frame(new Uint8Array(8)), false);
  assert.equal(camera.frame(frame), true);
  assert.equal(camera.frame(frame), false);
  assert.equal(published.length, 1);
  assert.equal((await camera.stop()).enabled, false);
  assert.equal(camera.frame(frame), false);
  assert.ok(states.some(({ pending }) => pending));
});

test('native registration failure returns a recoverable camera error', async () => {
  const root = temp();
  bundle(path.join(root, CAMERA_RUNTIME_FOLDER));
  const camera = new CallCamera({
    root,
    platform: 'win32',
    spawnProcess() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      queueMicrotask(() => {
        child.stdout.write('REGISTRATION_FAILED\n');
        child.emit('close', 4);
      });
      return child;
    },
  });
  assert.deepEqual(await camera.setEnabled(true), {
    supported: true,
    enabled: false,
    pending: false,
    error: 'Capri Camera could not start.',
  });
});

test('Setup validates the complete native camera bundle before copying any component', async () => {
  const source = temp(),
    target = temp();
  const directory = path.join(target, CAMERA_RUNTIME_FOLDER);
  const files = path.join(source, '.bundled-camera');
  await prepareBundledCamera(source, target);
  assert.equal(existsSync(directory), false);
  bundle(files);
  writeFileSync(
    path.join(files, CALL_CAMERA_FILES[2]),
    readFileSync(path.join(files, CALL_CAMERA_FILES[1])),
  );
  await assert.rejects(prepareBundledCamera(source, target), /unexpected Windows architecture/);
  assert.equal(existsSync(directory), false);
  bundle(files);
  const activate = await prepareBundledCamera(source, target);
  assert.equal(readCameraBundleReceipt(directory).bundleId, null);
  activate();
  const { bundleId } = readCameraBundleReceipt(directory);
  for (const name of [...CALL_CAMERA_FILES, CAMERA_LICENSE_FILE])
    assert.deepEqual(
      readFileSync(path.join(directory, CAMERA_BUNDLES_FOLDER, bundleId, name)),
      readFileSync(path.join(files, name)),
    );
});

test('setup switches a complete camera generation at commit and can roll activation back', async () => {
  const source = temp(),
    root = temp();
  const directory = path.join(root, CAMERA_RUNTIME_FOLDER);
  const bundles = path.join(directory, CAMERA_BUNDLES_FOLDER);
  const bundleSource = path.join(source, '.bundled-camera');
  const [hostName, dllName] = CALL_CAMERA_FILES;
  bundle(directory);
  bundle(bundleSource);
  const camera = new CallCamera({ root });
  const activateFirst = await prepareBundledCamera(source, root);
  assert.equal(camera.executable(), path.join(directory, hostName));
  activateFirst();
  const first = readCameraBundleReceipt(directory).bundleId;
  const firstHost = path.join(bundles, first, hostName);
  assert.equal(camera.executable(), firstHost);

  const newDll = readFileSync(path.join(bundleSource, dllName));
  newDll[newDll.length - 1] = 1;
  writeFileSync(path.join(bundleSource, dllName), newDll);
  const activateSecond = await prepareBundledCamera(source, root);
  assert.equal(camera.executable(), firstHost);
  const rollback = activateSecond();
  const second = readCameraBundleReceipt(directory).bundleId;
  assert.notEqual(second, first);
  assert.equal(camera.executable(), path.join(bundles, second, hostName));
  assert.notDeepEqual(readFileSync(path.join(bundles, first, dllName)), newDll);
  assert.notDeepEqual(readFileSync(path.join(directory, dllName)), newDll);
  assert.equal(await prepareBundledCamera(source, root), undefined);

  rollback();
  assert.equal(camera.executable(), firstHost);
  const retry = await prepareBundledCamera(source, root);
  retry();
  assert.equal(readCameraBundleReceipt(directory).bundleId, second);
  assert.deepEqual(readdirSync(bundles).sort(), [first, second].sort());

  const receipt = readCameraBundleReceipt(directory).file;
  writeFileSync(receipt, JSON.stringify({ schemaVersion: 1, bundleId: second + '\n' }));
  assert.equal(camera.executable(), path.join(directory, hostName));
});
