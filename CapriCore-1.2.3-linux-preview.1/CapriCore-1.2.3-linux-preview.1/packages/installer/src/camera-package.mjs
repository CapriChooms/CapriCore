// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import {
  CAMERA_RUNTIME_FOLDER,
  CALL_CAMERA_FILES,
  CAMERA_LICENSE_FILE,
} from '../../../apps/desktop/call-camera-protocol.mjs';
import {
  CAMERA_BUNDLES_FOLDER,
  readCameraBundleReceipt,
} from '../../../apps/desktop/main/camera-bundle.mjs';
import { writePrivateBytesAtomic } from '../../runtime/src/safe-file.mjs';
import { fileHash } from './download.mjs';
import { noLinks } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function matchesBundle(directory, files, signal) {
  for (const { name, hash } of files) {
    const file = path.join(directory, name);
    noLinks(file);
    if (
      !lstatSync(file, { throwIfNoEntry: false })?.isFile() ||
      (await fileHash(file, signal)) !== hash
    )
      return false;
  }
  return true;
}

/** Stage all camera binaries together. COM clients may keep earlier DLLs mapped. */
export async function prepareBundledCamera(sourceRoot, root, signal) {
  const source = path.join(sourceRoot, '.bundled-camera');
  if (!existsSync(source)) return;
  const license = path.join(source, CAMERA_LICENSE_FILE);
  noLinks(license);
  const licenseInfo = lstatSync(license);
  if (!licenseInfo.isFile() || licenseInfo.size === 0 || licenseInfo.size > 128 * 1024)
    throw new Error('Invalid bundled camera license file.');
  const files = CALL_CAMERA_FILES.map((name) => {
    const file = path.join(source, name);
    noLinks(file);
    const info = lstatSync(file);
    if (!info.isFile() || info.size < 64 || info.size > 3 * 1024 * 1024)
      throw new Error('Invalid bundled camera component.');
    const bytes = readFileSync(file);
    const offset = bytes.readUInt32LE(0x3c);
    const machine = name.endsWith('-x86.dll') ? 0x014c : 0x8664;
    if (
      bytes.readUInt16LE(0) !== 0x5a4d ||
      offset > bytes.length - 24 ||
      bytes.readUInt32LE(offset) !== 0x00004550 ||
      bytes.readUInt16LE(offset + 4) !== machine ||
      Boolean(bytes.readUInt16LE(offset + 22) & 0x2000) !== name.endsWith('.dll')
    )
      throw new Error('Bundled camera component has an unexpected Windows architecture.');
    return { name, file, hash: sha256(bytes) };
  });
  files.push({ name: CAMERA_LICENSE_FILE, file: license, hash: sha256(readFileSync(license)) });
  const directory = path.join(root, CAMERA_RUNTIME_FOLDER);
  const bundles = path.join(directory, CAMERA_BUNDLES_FOLDER);
  noLinks(bundles);
  const current = readCameraBundleReceipt(directory);
  let bundleId = sha256(files.map(({ hash }) => hash).join('')).slice(0, 32);
  if (
    current.bundleId &&
    (await matchesBundle(path.join(bundles, current.bundleId), files, signal))
  )
    return;
  let destination = path.join(bundles, bundleId);
  if (!(await matchesBundle(destination, files, signal))) {
    // Repair a damaged bundle without touching any files a running camera has mapped.
    if (existsSync(destination)) {
      bundleId = randomBytes(16).toString('hex');
      destination = path.join(bundles, bundleId);
    }
    mkdirSync(bundles, { recursive: true });
    using staging = mkdtempDisposableSync(path.join(bundles, 'stage-'));
    for (const { name, file } of files) {
      signal?.throwIfAborted();
      copyFileSync(file, path.join(staging.path, name), constants.COPYFILE_EXCL);
    }
    if (!(await matchesBundle(staging.path, files, signal)))
      throw new Error('Capri Camera files changed while preparing the bundle.');
    signal?.throwIfAborted();
    renameSync(staging.path, destination);
  }
  return () => {
    signal?.throwIfAborted();
    writePrivateBytesAtomic(
      current.file,
      Buffer.from(JSON.stringify({ schemaVersion: 1, bundleId }) + '\n'),
    );
    return () => {
      if (current.bytes) writePrivateBytesAtomic(current.file, current.bytes);
      else {
        noLinks(current.file);
        unlinkSync(current.file);
      }
    };
  };
}
