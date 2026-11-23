// SPDX-License-Identifier: GPL-3.0-only
// Actual Windows extraction and checksum verification, using the public cached
// archive. No device capture, user installation changes, or Python execution.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMusicDetector } from '../../apps/desktop/music-detector-provision.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parent = path.join(root, '.runtime/music-provision-verification');
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(path.join(parent, 'fixture-'));
const config = JSON.parse(readFileSync(path.join(root, 'config/music-detector.json'), 'utf8'));
for (const name of [
  'config',
  'integrations/music_runtime',
  '.runtime/music-detector',
  '.runtime/router-venv/Scripts',
])
  mkdirSync(path.join(fixture, name), { recursive: true });
copyFileSync(
  path.join(root, 'config/music-detector.json'),
  path.join(fixture, 'config/music-detector.json'),
);
copyFileSync(
  path.join(root, 'integrations/music_runtime/extract.ps1'),
  path.join(fixture, 'integrations/music_runtime/extract.ps1'),
);
writeFileSync(
  path.join(fixture, '.runtime/router-venv/Scripts/python.exe'),
  'fixture-path-only-never-executed',
);
copyFileSync(
  path.join(root, '.runtime/music-detection-research/yamnet-onnx-float.zip'),
  path.join(fixture, '.runtime/music-detector', config.artifact.sha256 + '.zip'),
);
let calls = 0;
const fetchImpl = () => {
  calls++;
  throw Error('Network forbidden in extraction verification.');
};
const first = await prepareMusicDetector(fixture, { fetchImpl });
assert.equal(first.config.id, config.id);
for (const spec of config.files)
  assert.equal(readFileSync(path.join(first.folder, spec.name)).byteLength, spec.bytes);
const second = await prepareMusicDetector(fixture, {
  fetchImpl,
  execute: () => {
    throw Error('A verified model must not extract again.');
  },
});
assert.equal(first.folder, second.folder);
assert.equal(calls, 0);
const report = {
  passed: true,
  checks: [
    'Official archive extracted by actual PowerShell helper',
    'All four files pass pinned size and SHA-256',
    'Verified model reuses cache without network or extraction',
  ],
  noAudioCapture: true,
  noPythonExecution: true,
};
writeFileSync(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, folder: fixture }));
