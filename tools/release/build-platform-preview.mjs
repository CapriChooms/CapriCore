// SPDX-License-Identifier: GPL-3.0-only
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildMacApp } from './build-macos.mjs';
import { sourceFiles, validateSource } from './source-export.mjs';
import { parseVersion, REPOSITORY } from '../../packages/updater/src/releases.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const read = (name) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
const {
  values: { output },
  positionals: [target, ...rest],
} = parseArgs({
  allowPositionals: true,
  options: { output: { type: 'string', default: path.join(root, 'release/platform-previews') } },
});
if (!['linux', 'macos'].includes(target) || rest.length)
  throw new Error(
    'Usage: node tools/release/build-platform-preview.mjs <linux|macos> [--output DIRECTORY]',
  );

const expected = target === 'linux' ? 'linux:x64' : 'darwin:arm64';
if (process.platform + ':' + process.arch !== expected)
  throw new Error('This build needs a native ' + expected + ' host.');
const { tag, repository } = read('config/release.json');
const { version } = parseVersion(tag);
if (
  repository !== REPOSITORY ||
  !/^v\d+\.\d+\.\d+-experimental\.[1-9]\d*$/.test(tag) ||
  read('package.json').version !== version ||
  read('apps/desktop/package.json').version !== version ||
  read('package-lock.json').version !== version
)
  throw new Error(
    'Build from a Capri experimental source snapshot with matching release metadata.',
  );

const files = sourceFiles();
const manifest = validateSource(files);
const base = 'Capri-' + version;
mkdirSync(output, { recursive: true });
using stage = mkdtempDisposableSync(path.join(path.resolve(output), '.capri-'));
const name = target === 'linux' ? base + '-linux-x86_64.tar.gz' : base + '-macOS-arm64.zip';
const archive = path.join(stage.path, name);
let app;
if (target === 'linux') {
  const folder = name.slice(0, -'.tar.gz'.length);
  for (const { path: name } of manifest) {
    const dest = path.join(stage.path, folder, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(root, name), dest);
  }
  chmodSync(path.join(stage.path, folder, 'start-capri.sh'), 0o755);
  execFileSync('tar', ['-czf', archive, '-C', stage.path, folder], { stdio: 'inherit' });
} else {
  ({ app } = buildMacApp({ files }));
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], {
    stdio: 'inherit',
  });
}
const digest = createHash('sha256');
for await (const chunk of createReadStream(archive)) digest.update(chunk);
copyFileSync(archive, path.join(output, name));
writeFileSync(path.join(output, name + '.sha256'), digest.digest('hex') + '  ' + name + '\n');
console.log(JSON.stringify({ target, tag, file: path.resolve(output, name), ...(app && { app }) }));
