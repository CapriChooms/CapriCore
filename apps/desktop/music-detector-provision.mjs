// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  mkdtempSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { fileHash } from '../../packages/installer/src/download.mjs';
import { resumableArtifact } from '../../packages/installer/src/resumable-download.mjs';
import { runCommand } from '../../packages/installer/src/commands.mjs';

export function musicDetectorConfig(root) {
  const value = JSON.parse(readFileSync(path.join(root, 'config/music-detector.json'), 'utf8'));
  if (
    value.schemaVersion !== 1 ||
    !/^yamnet-[a-z0-9.-]+$/u.test(value.id) ||
    value.sampleRate !== 16000 ||
    value.packetSamples !== 8000 ||
    !Array.isArray(value.files) ||
    value.files.length !== 4 ||
    new Set(value.files.map((file) => file.name)).size !== 4 ||
    value.files.some(
      (file) =>
        !['yamnet.onnx', 'yamnet.data', 'labels.txt', 'metadata.json'].includes(file.name) ||
        !/^[a-f0-9]{64}$/u.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes <= 0 ||
        file.bytes > 20 * 1024 ** 2,
    )
  )
    throw Error('Invalid music detector package.');
  return value;
}

export function musicPython(root) {
  return (
    ['router-venv', 'asr-venv']
      .map((name) => path.join(root, '.runtime', name, 'Scripts/python.exe'))
      .find(existsSync) ?? null
  );
}

async function verifiedModel(folder, config) {
  noLinks(folder);
  for (const spec of config.files) {
    const file = path.join(folder, spec.name);
    noLinks(file);
    if (
      !existsSync(file) ||
      !statSync(file).isFile() ||
      statSync(file).size !== spec.bytes ||
      (await fileHash(file)) !== spec.sha256
    )
      return false;
  }
  return true;
}

export async function prepareMusicDetector(
  root,
  { signal, progress = () => {}, fetchImpl = fetch, execute = runCommand } = {},
) {
  const config = musicDetectorConfig(root),
    python = musicPython(root);
  if (!python) throw Error('Music listening is unavailable. Run Capri Setup again.');
  noLinks(python);
  const folder = path.join(root, 'data/models/music-detector', config.id);
  if (await verifiedModel(folder, config)) return { folder, python, config };
  const parent = path.join(root, '.runtime/music-detector');
  noLinks(parent);
  mkdirSync(parent, { recursive: true });
  const artifactUrl = (value) => {
    const url = new URL(value);
    if (
      url.origin !== 'https://qaihub-public-assets.s3.us-west-2.amazonaws.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/qai-hub-models\/models\/yamnet\/releases\/v[0-9.]+\/yamnet-onnx-float\.zip$/u.test(
        url.pathname,
      )
    )
      throw Error('Unapproved music detector download.');
    return url;
  };
  const spec = { ...config.artifact, url: config.artifact.urls?.[0] };
  if (spec.bytes > 32 * 1024 ** 2) throw Error('Invalid music detector package.');
  const archive = await resumableArtifact(
    spec,
    parent,
    { signal, progress, fetchImpl },
    { artifactUrl, fileHash },
  );
  signal?.throwIfAborted();
  const temporary = mkdtempSync(path.join(parent, 'verified-'));
  await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'integrations/music_runtime/extract.ps1'),
      '-Archive',
      archive,
      '-Destination',
      temporary,
    ],
    { cwd: root, timeoutMs: 30000, signal },
  );
  signal?.throwIfAborted();
  if (!(await verifiedModel(temporary, config))) throw Error('Music detector verification failed.');
  noLinks(folder);
  mkdirSync(folder, { recursive: true });
  for (const file of config.files) {
    signal?.throwIfAborted();
    const destination = path.join(folder, file.name),
      pending = destination + '.' + randomUUID() + '.tmp';
    noLinks(destination);
    noLinks(pending);
    copyFileSync(path.join(temporary, file.name), pending);
    renameSync(pending, destination);
  }
  if (!(await verifiedModel(folder, config))) throw Error('Music detector verification failed.');
  return { folder, python, config };
}
