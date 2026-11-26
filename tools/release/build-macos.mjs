// SPDX-License-Identifier: GPL-3.0-only
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFiles, validateSource } from './source-export.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const binary = (command, args, options) =>
  execFileSync(command, args, { encoding: 'utf8', ...options });
const id = 'org.caprichooms.capri';

function packageSources(payload) {
  const tracked = new Set(
    binary('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 8 * 1024 * 1024 }).split('\0'),
  );
  // These are the known sources of this target. Include them in a build from
  // a working patch before git add, without sweeping up untracked local files.
  for (const name of [
    'apps/desktop/main/macos-models.mjs',
    'tools/release/build-macos.mjs',
    'tools/release/macos-bootstrap.mjs',
    'tools/release/macos-runtime.mjs',
    'tools/setup/prepare-macos-llama.mjs',
    'tools/verify/verify-macos.mjs',
  ])
    tracked.add(name);
  const candidates = sourceFiles(root).filter((name) => tracked.has(name));
  validateSource(candidates);
  for (const name of candidates) {
    if (
      !/^(?:apps\/|assets\/|config\/|docs\/|integrations\/|packages\/|scripts\/|tools\/|LICENSE$|README\.md$|THIRD_PARTY_NOTICES\.md$|package(?:-lock)?\.json$)/.test(
        name,
      )
    )
      continue;
    const destination = path.join(payload, name);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(root, name), destination);
  }
}

function packageDependencies(payload, nodeHome) {
  // Reify the production lockfile from the cache populated by npm ci. This
  // excludes extraneous files, development packages and local npm credentials.
  const npm = path.join(nodeHome, 'lib/node_modules/npm/bin/npm-cli.js');
  binary(
    process.execPath,
    [
      npm,
      'ci',
      '--offline',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--cache',
      path.resolve(root, process.env.npm_config_cache || '.runtime/npm-cache'),
    ],
    {
      cwd: payload,
      env: {
        ...process.env,
        PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
      },
      stdio: ['ignore', 2, 2],
    },
  );
}

export function removeNpmLocalFiles(modules) {
  for (const item of readdirSync(modules, { withFileTypes: true })) {
    const file = path.join(modules, item.name);
    // Some upstream tarballs ship development environment fixtures (bottleneck
    // includes an .env). No npm/user settings or dot-env files belong on disk
    // in the installed Capri runtime.
    if (item.name === '.npmrc' || item.name === '.env' || item.name.startsWith('.env.')) {
      if (item.isDirectory())
        throw new Error('Unexpected settings directory in production package');
      rmSync(file);
    } else if (item.isDirectory()) {
      removeNpmLocalFiles(file);
    }
  }
}

function brandIcon(source, target) {
  // The repository's reviewed icon is already a square 512 px PNG. The ic09
  // element of an ICNS container stores exactly that PNG representation.
  const png = readFileSync(source);
  const header = Buffer.alloc(16);
  header.write('icns', 0);
  header.writeUInt32BE(header.length + png.length, 4);
  header.write('ic09', 8);
  header.writeUInt32BE(8 + png.length, 12);
  writeFileSync(target, Buffer.concat([header, png]));
}

function editPlist(plist, entries) {
  for (const [key, value] of Object.entries(entries)) {
    binary('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
  }
}

function brandBundle(contents, version) {
  const plist = path.join(contents, 'Info.plist');
  editPlist(plist, {
    CFBundleDisplayName: 'Capri',
    CFBundleName: 'Capri',
    CFBundleExecutable: 'Capri',
    CFBundleIdentifier: id,
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    CFBundleIconFile: 'Capri.icns',
    LSApplicationCategoryType: 'public.app-category.productivity',
    LSMinimumSystemVersion: '13.5',
    NSMicrophoneUsageDescription: 'Capri uses your microphone when you enable voice input.',
    NSCameraUsageDescription: 'Capri uses your camera when you enable the call camera.',
    NSAudioCaptureUsageDescription: 'Capri captures system audio when you enable audio listening.',
  });
  binary('/usr/bin/plutil', ['-remove', 'ElectronAsarIntegrity', plist]);
  renameSync(path.join(contents, 'MacOS/Electron'), path.join(contents, 'MacOS/Capri'));
  const frameworks = path.join(contents, 'Frameworks');
  for (const entry of readdirSync(frameworks).filter(
    (name) => name.startsWith('Electron Helper') && name.endsWith('.app'),
  )) {
    const from = path.basename(entry, '.app');
    const to = from.replace('Electron', 'Capri');
    const helper = path.join(frameworks, entry, 'Contents');
    editPlist(path.join(helper, 'Info.plist'), {
      CFBundleIdentifier: id + '.helper' + (from.match(/\((\w+)\)/)?.[1].toLowerCase() ?? ''),
      CFBundleName: to,
      CFBundleExecutable: to,
    });
    renameSync(path.join(helper, 'MacOS', from), path.join(helper, 'MacOS', to));
    renameSync(path.dirname(helper), path.join(frameworks, to + '.app'));
  }
  const resources = path.join(contents, 'Resources');
  rmSync(path.join(resources, 'default_app.asar'));
  rmSync(path.join(resources, 'electron.icns'));
  brandIcon(path.join(root, 'assets/default/icon-source.png'), path.join(resources, 'Capri.icns'));
}

export function buildMacApp({ llamaArchive } = {}) {
  const pin = readFileSync(path.join(root, '.node-version'), 'utf8').trim();
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.versions.node !== pin)
    throw new Error('Build Capri.app natively on Apple Silicon with Node ' + pin);
  const pkg = json(path.join(root, 'package.json'));
  const dist = path.join(root, 'node_modules/electron/dist');
  if (
    !existsSync(path.join(dist, 'version')) ||
    readFileSync(path.join(dist, 'version'), 'utf8').trim() !== pkg.devDependencies.electron
  )
    throw new Error(
      'Install the locked macOS Electron binary with npm ci and npm exec -- install-electron',
    );
  const template = path.join(dist, 'Electron.app');
  binary('/usr/bin/lipo', [
    path.join(template, 'Contents/MacOS/Electron'),
    '-verify_arch',
    'arm64',
  ]);
  const nodeHome = path.resolve(realpathSync(process.execPath), '../..');
  const release = path.join(root, 'release');
  mkdirSync(release, { recursive: true });
  if (!lstatSync(release).isDirectory())
    throw new Error('Release staging must be a regular directory');
  const stage = mkdtempSync(path.join(release, 'macos-arm64-'));
  const app = path.join(stage, 'Capri.app');
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  const payload = path.join(resources, 'capri');
  try {
    cpSync(template, app, { recursive: true, verbatimSymlinks: true });
    brandBundle(contents, pkg.version);
    packageSources(payload);
    packageDependencies(payload, nodeHome);
    removeNpmLocalFiles(path.join(payload, 'node_modules'));
    const llamaSetup = path.join(root, 'tools/setup/prepare-macos-llama.mjs');
    binary(process.execPath, [llamaSetup, payload, ...(llamaArchive ? [llamaArchive] : [])], {
      stdio: ['ignore', 2, 2],
    });
    mkdirSync(path.join(contents, 'Helpers'), { recursive: true });
    copyFileSync(process.execPath, path.join(contents, 'Helpers/node'));
    const licenses = path.join(resources, 'licenses');
    mkdirSync(licenses);
    copyFileSync(path.join(nodeHome, 'LICENSE'), path.join(licenses, 'node-LICENSE'));
    copyFileSync(path.join(dist, 'LICENSE'), path.join(licenses, 'electron-LICENSE'));
    copyFileSync(
      path.join(dist, 'LICENSES.chromium.html'),
      path.join(licenses, 'LICENSES.chromium.html'),
    );
    const entry = path.join(resources, 'app');
    mkdirSync(entry);
    for (const name of ['macos-bootstrap.mjs', 'macos-runtime.mjs'])
      copyFileSync(path.join(import.meta.dirname, name), path.join(entry, name));
    writeFileSync(
      path.join(entry, 'package.json'),
      JSON.stringify({
        name: 'capri',
        productName: 'Capri',
        version: pkg.version,
        type: 'module',
        main: 'macos-bootstrap.mjs',
      }) + '\n',
    );
    // Sign nested code before the outer app. Node installations can contain a
    // modified binary with a stale upstream signature; sign our private copy.
    binary('/usr/bin/codesign', ['--force', '--sign', '-', path.join(contents, 'Helpers/node')]);
    const frameworks = path.join(contents, 'Frameworks');
    for (const name of readdirSync(frameworks)) {
      if (name.endsWith('.app') || name.endsWith('.framework'))
        binary('/usr/bin/codesign', ['--force', '--sign', '-', path.join(frameworks, name)]);
    }
    binary('/usr/bin/codesign', ['--force', '--sign', '-', app]);
    binary('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    return { app, version: pkg.version, architecture: 'arm64', signature: 'ad-hoc' };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !/^--llama-archive=.+/.test(args[0])))
    throw new Error('Usage: node tools/release/build-macos.mjs [--llama-archive=<path>]');
  console.log(
    JSON.stringify(
      buildMacApp({
        llamaArchive: args[0] && path.resolve(args[0].slice('--llama-archive='.length)),
      }),
    ),
  );
}
