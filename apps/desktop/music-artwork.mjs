// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MUSIC_ARTWORK_MANIFEST = 'assets/default/capri-music-v1/runtime-music.json';
const folderName = 'assets/default/capri-music-v1';
const frameFiles = new Map([
  ['music-window', ['capri-music-window.png', 'seat']],
  ['music-floor', ['capri-music-floor.png', 'ground']],
]);
const noteFiles = [
  '01-eighth-cyan.png',
  '02-beamed-lime.png',
  '03-quarter-pink.png',
  '04-sixteenth-violet.png',
];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const range = (value, max = 1254) => Number.isFinite(value) && value >= 0 && value <= max;
const exactKeys = (value, keys) =>
  object(value) && Object.keys(value).every((key) => keys.includes(key));

function regular(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 20 * 1024 * 1024)
    throw Error('Invalid reviewed music artwork file');
  return info;
}

function png(folder, item, width, height) {
  if (!/^[a-z0-9_-]+\.png$/u.test(item.file) || !/^[a-f0-9]{64}$/u.test(item.sha256))
    throw Error('Invalid reviewed music artwork path');
  const file = path.join(folder, item.file);
  regular(file);
  if (realpathSync(file) !== file) throw Error('Linked music artwork is not allowed');
  const bytes = readFileSync(file);
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(16) !== width ||
    bytes.readUInt32BE(20) !== height ||
    bytes[25] !== 6 ||
    createHash('sha256').update(bytes).digest('hex') !== item.sha256
  )
    throw Error('Reviewed music artwork checksum or PNG mismatch');
  return file;
}

/** This pack contains only reviewed runtime PNGs; previews and generation prompts never ship. */
export function loadMusicArtwork(root, { optional = true } = {}) {
  const file = path.join(root, MUSIC_ARTWORK_MANIFEST);
  if (!existsSync(file) && optional)
    return { canvas: { width: 1254, height: 1254 }, frames: [], notes: [] };
  if (regular(file).size > 16384) throw Error('Music artwork manifest exceeds its limit');
  const folder = path.join(realpathSync(root), folderName);
  if (realpathSync(path.dirname(file)) !== folder)
    throw Error('Linked music artwork directory is not allowed');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (
    !exactKeys(manifest, ['schemaVersion', 'canvas', 'frames', 'notes']) ||
    manifest.schemaVersion !== 1 ||
    !exactKeys(manifest.canvas, ['width', 'height']) ||
    manifest.canvas.width !== 1254 ||
    manifest.canvas.height !== 1254 ||
    !Array.isArray(manifest.frames) ||
    manifest.frames.length !== 2 ||
    !Array.isArray(manifest.notes) ||
    manifest.notes.length !== 4
  )
    throw Error('Invalid reviewed music artwork manifest');
  const ids = new Set();
  const frames = manifest.frames.map((item) => {
    const expected = frameFiles.get(item?.id);
    const bounds = item?.visibleBounds;
    if (
      !exactKeys(item, [
        'id',
        'file',
        'pose',
        'label',
        'description',
        'anchor',
        'visibleBounds',
        'face',
        'mouth',
        'emitters',
        'sha256',
      ]) ||
      !expected ||
      ids.has(item.id) ||
      item.file !== expected[0] ||
      item.anchor?.name !== expected[1] ||
      !exactKeys(item.anchor, ['name', 'x', 'y']) ||
      !range(item.anchor.x) ||
      !range(item.anchor.y) ||
      !exactKeys(bounds, ['x', 'y', 'width', 'height']) ||
      ![bounds.x, bounds.y].every((v) => range(v)) ||
      ![bounds.width, bounds.height].every((v) => range(v) && v > 0) ||
      bounds.x + bounds.width > 1254 ||
      bounds.y + bounds.height > 1254 ||
      typeof item.pose !== 'string' ||
      !/^music_(?:seat|ground)$/u.test(item.pose) ||
      typeof item.label !== 'string' ||
      item.label.length > 100 ||
      typeof item.description !== 'string' ||
      item.description.length > 240 ||
      !exactKeys(item.face, ['x', 'y']) ||
      !range(item.face.x) ||
      !range(item.face.y) ||
      !Array.isArray(item.mouth) ||
      item.mouth.length !== 4 ||
      !item.mouth.slice(0, 2).every((v) => range(v)) ||
      !Number.isFinite(item.mouth[2]) ||
      Math.abs(item.mouth[2]) > Math.PI ||
      !Number.isFinite(item.mouth[3]) ||
      item.mouth[3] < 20 ||
      item.mouth[3] > 60 ||
      !Array.isArray(item.emitters) ||
      item.emitters.length !== 2 ||
      !item.emitters.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => range(v)))
    )
      throw Error('Invalid reviewed music pose');
    ids.add(item.id);
    return Object.freeze({
      ...item,
      file: png(folder, item, 1254, 1254),
      frameId: item.id,
      kind: 'reviewed_music',
      canPersist: false,
      expression: 'happy',
      url: `capri://desktop/sprites/${item.id}.png`,
    });
  });
  const noteIds = new Set();
  const notes = manifest.notes.map((item, index) => {
    if (
      !exactKeys(item, ['id', 'file', 'width', 'height', 'sha256']) ||
      item.file !== noteFiles[index] ||
      item.id !== item.file.slice(0, -4) ||
      noteIds.has(item.id) ||
      item.width !== 256 ||
      item.height !== 256
    )
      throw Error('Invalid reviewed music note');
    noteIds.add(item.id);
    return Object.freeze({
      ...item,
      file: png(folder, item, 256, 256),
      url: `capri://desktop/music/${item.file}`,
    });
  });
  return { canvas: { width: 1254, height: 1254 }, frames, notes };
}

export function musicArtworkSourceFiles(root) {
  const pack = loadMusicArtwork(root, { optional: false });
  return [
    MUSIC_ARTWORK_MANIFEST,
    ...pack.frames.map((item) => `${folderName}/${path.basename(item.file)}`),
    ...pack.notes.map((item) => `${folderName}/${path.basename(item.file)}`),
  ];
}
