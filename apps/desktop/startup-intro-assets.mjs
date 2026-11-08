// SPDX-License-Identifier: GPL-3.0-only
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const ACTIVE_STARTUP_INTRO = 'assets/capri/intro-v1/runtime-intro.json';
export const STARTUP_INTRO_IDS = Object.freeze([
  '01-signal',
  '02-gaze',
  '03-arrival',
  '04-landing',
  '05-greeting',
  '06-wink',
  '07-ready',
]);
const introFolder = 'assets/capri/intro-v1';
const masterFile = 'assets/capri/sprites/v1/capri-neutral.png';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hasOnly = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

function readAsset(root, name, limit) {
  let current = root;
  for (const segment of name.split('/')) {
    current = path.join(current, segment);
    if (lstatSync(current).isSymbolicLink())
      throw new Error('Linked intro artwork is not allowed.');
  }
  const info = lstatSync(current);
  const relative = path.relative(root, realpathSync(current));
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.size > limit ||
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  )
    throw new Error('Intro artwork is invalid.');
  const fd = openSync(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > limit ||
      opened.dev !== info.dev ||
      opened.ino !== info.ino
    )
      throw new Error('Intro artwork changed while opening.');
    const bytes = Buffer.alloc(opened.size + 1);
    // Asset files are immutable package contents; a changed read fails closed.
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd);
    if (
      length !== opened.size ||
      length > limit ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs
    )
      throw new Error('Intro artwork changed while reading.');
    return { file: current, bytes: bytes.subarray(0, length) };
  } finally {
    closeSync(fd);
  }
}

/** Validate the complete reviewed pack; the app treats any failure as an optional intro miss. */
export function validateStartupIntro(sourceRoot) {
  const root = path.resolve(sourceRoot);
  if (lstatSync(root).isSymbolicLink()) throw new Error('Linked intro root is not allowed.');
  const manifest = JSON.parse(
    readAsset(root, ACTIVE_STARTUP_INTRO, 16 * 1024).bytes.toString('utf8'),
  );
  if (
    !hasOnly(manifest, ['schemaVersion', 'canvas', 'anchor', 'fps', 'frames']) ||
    !hasOnly(manifest.canvas, ['width', 'height']) ||
    !hasOnly(manifest.anchor, ['name', 'x', 'y']) ||
    manifest.schemaVersion !== 1 ||
    manifest.fps !== 24 ||
    manifest.canvas?.width !== 1254 ||
    manifest.canvas?.height !== 1254 ||
    manifest.anchor?.name !== 'ground' ||
    manifest.anchor.x !== 627 ||
    manifest.anchor.y !== 1166 ||
    !Array.isArray(manifest.frames) ||
    manifest.frames.length !== STARTUP_INTRO_IDS.length
  )
    throw new Error('Invalid startup intro manifest.');
  const frames = manifest.frames.map((item, index) => {
    const id = STARTUP_INTRO_IDS[index];
    const bounds = item.visibleBounds;
    if (
      !hasOnly(item, ['id', 'file', 'ms', 'visibleBounds', 'sha256']) ||
      !hasOnly(bounds, ['x', 'y', 'width', 'height']) ||
      item.id !== id ||
      item.file !== `PNG/${id}.png` ||
      !Number.isInteger(item.ms) ||
      item.ms < 80 ||
      item.ms > 1000 ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !bounds ||
      !['x', 'y', 'width', 'height'].every((key) => Number.isInteger(bounds[key])) ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.width < 1 ||
      bounds.height < 1 ||
      bounds.x + bounds.width > 1254 ||
      bounds.y + bounds.height > 1254
    )
      throw new Error('Invalid startup intro frame.');
    const { file, bytes } = readAsset(root, `${introFolder}/${item.file}`, 4 * 1024 * 1024);
    if (
      sha256(bytes) !== item.sha256 ||
      bytes.length < 33 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== 1254 ||
      bytes.readUInt32BE(20) !== 1254 ||
      bytes[24] !== 8 ||
      bytes[25] !== 6
    )
      throw new Error('Startup intro frame verification failed.');
    return {
      id,
      file,
      url: `capri://desktop/intro/${id}.png`,
      ms: item.ms,
      visibleBounds: Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((key) => [key, bounds[key]]),
      ),
    };
  });
  const durationMs = frames.reduce((total, frame) => total + frame.ms, 0);
  if (
    durationMs !== 3000 ||
    sha256(readAsset(root, masterFile, 4 * 1024 * 1024).bytes) !== manifest.frames.at(-1).sha256
  )
    throw new Error('Startup intro must finish on the exact approved main sprite.');
  return {
    canvas: { width: 1254, height: 1254 },
    anchor: { name: 'ground', x: 627, y: 1166 },
    fps: 24,
    frames,
    durationMs,
  };
}

export function loadStartupIntro(root) {
  try {
    return validateStartupIntro(root);
  } catch {
    return null;
  }
}

/** The renderer never receives package paths, hashes, generation prompts or source metadata. */
export function startupIntroSnapshot(intro) {
  if (!intro) return null;
  return {
    canvas: { ...intro.canvas },
    anchor: { ...intro.anchor },
    fps: intro.fps,
    durationMs: intro.durationMs,
    frames: intro.frames.map((frame) => ({
      id: frame.id,
      url: frame.url,
      ms: frame.ms,
      visibleBounds: Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((key) => [key, frame.visibleBounds[key]]),
      ),
    })),
  };
}

export function startupIntroSourceFiles(root) {
  const intro = validateStartupIntro(root);
  return [
    ACTIVE_STARTUP_INTRO,
    ...intro.frames.map((frame) => path.relative(root, frame.file).split(path.sep).join('/')),
  ];
}
