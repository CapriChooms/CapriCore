// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import { sourceFiles } from '../packages/installer/src/payload.mjs';
import {
  compareVersions,
  selectRelease,
  EXPERIMENTAL_REPOSITORY,
  REPOSITORY,
} from '../packages/updater/src/releases.mjs';
import { githubFetch, listReleases, approvedUrl } from '../packages/updater/src/github.mjs';
import { downloadUpdate } from '../packages/updater/src/download.mjs';
import {
  applyUpdate,
  verifyPayload,
  managedInstallation,
} from '../packages/updater/src/transaction.mjs';
import { UpdateService } from '../apps/desktop/update-service.mjs';

const parent = path.join(root, '.runtime/update-unit');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'case-'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
function put(base, name, bytes) {
  const file = path.join(base, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
function fixture({ modular = false } = {}) {
  const source = folder(),
    target = folder();
  for (const base of [source, target]) {
    writeJsonAtomic(path.join(base, 'package.json'), { name: 'capri', version: '0.3.0' });
    writeJsonAtomic(path.join(base, 'package-lock.json'), { lockfileVersion: 3 });
    writeJsonAtomic(path.join(base, 'config/release.json'), {
      schemaVersion: 1,
      repository: base === source ? REPOSITORY : 'CapriChooms/Capri',
      tag: base === source ? 'v0.3.0-preview.14' : 'v0.3.0-preview.13',
    });
    put(base, 'config/installer.json', readFileSync(path.join(root, 'config/installer.json')));
    put(base, 'packages/installer/windows/register.ps1', '# fixture');
    put(base, 'apps/desktop/sample.mjs', base === source ? 'new source' : 'old source');
    put(
      base,
      'config/companion-voice.json',
      base === source ? '{"default":true}' : '{"myVoice":true}',
    );
  }
  writeJsonAtomic(path.join(target, '.capri-install.json'), {
    schemaVersion: 1,
    productId: 'capri.desktop',
    root: target,
    version: '0.3.0',
    installId: randomUUID(),
  });
  put(target, 'data/desktop/transcript.json', 'private conversation');
  put(target, 'data/workspace/PERSONALITY.md', 'my personality');
  put(target, 'config/core.local.json', '{"myProfile":true}');
  if (modular) {
    const workspaces = ['packages/core', 'packages/skill-sdk', 'packages/skills'];
    const packages = { '': { name: 'capri', version: '0.3.0', workspaces } };
    writeJsonAtomic(path.join(source, 'package.json'), {
      name: 'capri',
      version: '0.3.0',
      workspaces,
    });
    for (const workspace of workspaces) {
      const name = '@capri/' + path.basename(workspace);
      const metadata = { name, version: '0.3.0' };
      packages[workspace] = metadata;
      packages['node_modules/' + name] = { resolved: workspace, link: true };
      writeJsonAtomic(path.join(source, workspace, 'package.json'), metadata);
      put(source, workspace + '/src/index.mjs', 'export const ready = true;');
    }
    writeJsonAtomic(path.join(source, 'package-lock.json'), { lockfileVersion: 3, packages });
  }
  const files = sourceFiles(source).map((name) => {
    const bytes = readFileSync(path.join(source, name));
    return { path: name, bytes: bytes.length, sha256: digest(bytes) };
  });
  writeJsonAtomic(path.join(source, 'SOURCE_MANIFEST.json'), { schemaVersion: 1, files });
  return { root: target, source, tag: 'v0.3.0-preview.14' };
}
const release = (tag, prerelease = true, id = 1) => ({
  tag_name: tag,
  prerelease,
  draft: false,
  assets: [
    {
      id,
      name: 'Capri-0.3.0-source.zip',
      state: 'uploaded',
      size: 123,
      digest: 'sha256:' + 'a'.repeat(64),
    },
  ],
});

test('updates use semantic ordering, stable/experimental channels and never downgrade', () => {
  assert.ok(compareVersions('v0.3.0-preview.13', 'v0.3.0-preview.9') > 0);
  assert.ok(compareVersions('v0.3.0', 'v0.3.0-preview.99') > 0);
  assert.equal(compareVersions('v0.3.0', '0.3.0'), 0);
  const items = [
    release('v0.3.0-preview.9'),
    release('v0.3.0-preview.14'),
    release('v0.3.0-preview.13'),
  ];
  assert.equal(
    selectRelease(items, { current: 'v0.3.0-preview.12', experimental: true }).tag_name,
    'v0.3.0-preview.14',
  );
  assert.equal(selectRelease(items, { current: 'v0.3.0-preview.12' }), null);
  assert.equal(
    selectRelease([...items, release('v0.3.0', false)], { current: 'v0.3.0-preview.12' }).tag_name,
    'v0.3.0',
  );
  assert.equal(selectRelease(items, { current: 'v0.3.0', experimental: true }), null);
  assert.equal(
    selectRelease([{ ...items[1], assets: [] }], {
      current: 'v0.3.0-preview.12',
      experimental: true,
    }),
    null,
  );
});

test('the legacy private E1 tag sorts before E2 and E3 without redefining stable 1.1.0', () => {
  const build = (tag, prerelease) => {
    const value = release(tag, prerelease);
    value.assets[0].name = 'Capri-1.1.0-source.zip';
    return value;
  };
  const items = [
    build('v1.1.0', true),
    build('v1.1.0-experimental.3', false),
    build('v1.1.0-experimental.2', false),
  ];
  const experimental = { experimental: true, repository: EXPERIMENTAL_REPOSITORY };
  for (const current of ['v1.0.4', 'v1.1.0-experimental.1', 'v1.1.0-experimental.2'])
    assert.equal(
      selectRelease(items, { ...experimental, current }).tag_name,
      'v1.1.0-experimental.3',
    );
  for (const current of ['v1.1.0-experimental.3', 'v1.1.0'])
    assert.equal(selectRelease(items, { ...experimental, current }), null);
  assert.equal(
    selectRelease([build('v1.1.0', false)], { current: 'v1.1.0-experimental.3' }).tag_name,
    'v1.1.0',
  );
});

test('GitHub metadata is bounded and tokens never follow asset redirects', async () => {
  const calls = [];
  const request = githubFetch({
    token: 'fixture-private-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response('[]');
    },
  });
  await request(`https://api.github.com/repos/${REPOSITORY}/releases`);
  await request('https://release-assets.githubusercontent.com/a/file.zip', {
    headers: { Authorization: 'Bearer stray', Cookie: 'session=private', Range: 'bytes=5-' },
  });
  assert.equal(calls[0].options.headers.authorization, 'Bearer fixture-private-token');
  assert.equal(calls[1].options.headers.authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Cookie, undefined);
  assert.equal(calls[1].options.headers.Range, 'bytes=5-');
  for (const url of [
    'http://github.com/file',
    'https://api.github.com/repos/attacker/repo/releases',
    'https://github.com.evil/file',
    `https://secret@api.github.com/repos/${REPOSITORY}/releases`,
    'https://api.github.com/repos/CapriChooms/Capri/releases',
  ])
    assert.throws(() => approvedUrl(url), /Unapproved/);
  const items = await listReleases({
    fetchImpl: async () => new Response(JSON.stringify([release('v0.3.0-preview.14')])),
  });
  assert.equal(items.length, 1);
  await assert.rejects(
    listReleases({ fetchImpl: async () => new Response('', { status: 404 }) }),
    /public CapriChooms\/CapriCore releases/,
  );
});

test('update downloads resume partial bytes, validate SHA-256 and reuse verified cache', async () => {
  const target = folder(),
    bytes = Buffer.from('a verified update archive');
  const asset = { id: 123, bytes: bytes.length, sha256: digest(bytes) };
  put(target, asset.sha256 + '.zip.part', bytes.subarray(0, 5));
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    assert.equal(options.headers.Range, 'bytes=5-');
    return new Response(bytes.subarray(5), {
      status: 206,
      headers: {
        'content-length': String(bytes.length - 5),
        'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}`,
      },
    });
  };
  const file = await downloadUpdate(asset, target, { fetchImpl });
  assert.deepEqual(readFileSync(file), bytes);
  await downloadUpdate(asset, target, { fetchImpl });
  assert.equal(calls, 1);
  await assert.rejects(
    downloadUpdate({ ...asset, sha256: '0'.repeat(64) }, folder(), {
      fetchImpl: async () => new Response(bytes),
    }),
    /checksum/,
  );
});

test('new public updater preserves existing private installation data when applying a verified public release', async () => {
  const plan = fixture(),
    commands = [],
    phases = [];
  const result = await applyUpdate(plan, {
    execute: async (exe, args) => commands.push({ exe, args }),
    emit: (event) => phases.push(event.phase),
  });
  assert.equal(result.tag, plan.tag);
  assert.equal(json(path.join(plan.root, 'config/release.json')).repository, REPOSITORY);
  assert.equal(readFileSync(path.join(plan.root, 'apps/desktop/sample.mjs'), 'utf8'), 'new source');
  assert.equal(
    readFileSync(path.join(plan.root, 'config/companion-voice.json'), 'utf8'),
    '{"myVoice":true}',
  );
  assert.equal(
    readFileSync(path.join(plan.root, 'data/desktop/transcript.json'), 'utf8'),
    'private conversation',
  );
  assert.equal(
    readFileSync(path.join(plan.root, 'data/workspace/PERSONALITY.md'), 'utf8'),
    'my personality',
  );
  assert.equal(
    readFileSync(path.join(plan.root, 'config/core.local.json'), 'utf8'),
    '{"myProfile":true}',
  );
  assert.ok(!commands.some((call) => call.args.includes('ci') || call.args.includes('models')));
  assert.ok(phases.includes('complete'));
  assert.equal(existsSync(path.join(plan.root, '.runtime/updates/active.json')), false);
  await assert.rejects(applyUpdate(plan, { execute: async () => {} }), /already installed/);
});

test('an update from an older installation includes and synchronizes new local Capri packages', async () => {
  const plan = fixture({ modular: true });
  let installs = 0;
  await applyUpdate(plan, {
    execute: async (_exe, args, { cwd }) => {
      if (!args.includes('ci')) return;
      installs++;
      assert.equal(cwd, plan.root);
      const { workspaces } = json(path.join(plan.root, 'package.json'));
      assert.deepEqual(workspaces, ['packages/core', 'packages/skill-sdk', 'packages/skills']);
      const lock = json(path.join(plan.root, 'package-lock.json'));
      for (const workspace of workspaces) {
        const name = '@capri/' + path.basename(workspace);
        assert.equal(json(path.join(plan.root, workspace, 'package.json')).name, name);
        assert.equal(lock.packages['node_modules/' + name].resolved, workspace);
        assert.ok(existsSync(path.join(plan.root, workspace, 'src/index.mjs')));
      }
    },
  });
  assert.equal(installs, 1);
  assert.equal(
    readFileSync(path.join(plan.root, 'data/desktop/transcript.json'), 'utf8'),
    'private conversation',
  );
  assert.equal(json(path.join(plan.root, '.capri-install.json')).releaseTag, plan.tag);
});

test('failed registration rolls back source and identity, and a retry succeeds', async () => {
  const plan = fixture();
  await assert.rejects(
    applyUpdate(plan, {
      execute: async (_exe, args) => {
        if (args.some((arg) => arg.endsWith('register.ps1')))
          throw new Error('fixture registration failure');
      },
    }),
    /restored/,
  );
  assert.equal(readFileSync(path.join(plan.root, 'apps/desktop/sample.mjs'), 'utf8'), 'old source');
  assert.equal(json(path.join(plan.root, 'config/release.json')).tag, 'v0.3.0-preview.13');
  assert.equal(json(path.join(plan.root, '.capri-install.json')).releaseTag, undefined);
  await applyUpdate(plan, { execute: async () => {} });
  assert.equal(json(path.join(plan.root, 'config/release.json')).tag, plan.tag);
});

test('update payload rejects tampering, unsafe paths and development checkouts before writes', () => {
  const plan = fixture();
  put(plan.source, 'apps/desktop/sample.mjs', 'tampered');
  assert.throws(() => verifyPayload(plan.source, plan.tag), /checksum/);
  const other = fixture(),
    file = path.join(other.source, 'SOURCE_MANIFEST.json'),
    manifest = json(file);
  manifest.files[0].path = '../data/secret';
  writeJsonAtomic(file, manifest);
  assert.throws(() => verifyPayload(other.source, other.tag), /Unsafe/);
  mkdirSync(path.join(other.root, '.git'));
  assert.throws(() => managedInstallation(other.root), /Development/);
});

test('update preferences persist and private-preview errors can be retried', async () => {
  const plan = fixture(),
    state = path.join(plan.root, 'data/desktop');
  let fail = true;
  const settings = {
    root: plan.root,
    state,
    node: process.execPath,
    credential: async () => null,
    releases: async () => {
      if (fail) throw new Error('GitHub private preview');
      return [release('v0.3.0-preview.14')];
    },
  };
  const service = new UpdateService(settings);
  service.setSettings({ experimental: true });
  assert.equal((await service.check()).phase, 'error');
  fail = false;
  assert.equal((await service.check()).phase, 'available');
  assert.equal(new UpdateService(settings).snapshot().experimental, true);
  service.close();
});

test('an explicit check can use a draft update channel without persisting it', async () => {
  const plan = fixture();
  const settings = {
    root: plan.root,
    state: path.join(plan.root, 'data/desktop'),
    node: process.execPath,
    credential: async () => null,
    releases: async () => [release('v0.3.0-preview.14')],
  };
  const service = new UpdateService(settings);
  assert.equal((await service.check()).phase, 'current');
  const preview = await service.check({ experimental: true });
  assert.equal(preview.phase, 'available');
  assert.equal(preview.checkedExperimental, true);
  assert.equal(preview.experimental, false);
  assert.equal(new UpdateService(settings).snapshot().experimental, false);
  assert.deepEqual(service.setSettings({ experimental: true }).release, preview.release);
  assert.equal(new UpdateService(settings).snapshot().experimental, true);
  service.close();
});

test('a runtime upgrade downloads the full installer and admits only one install action', async () => {
  const plan = fixture(),
    state = path.join(plan.root, 'data/desktop');
  const runtime = json(path.join(plan.source, 'config/installer.json'));
  runtime.artifacts.node.sha256 = '0'.repeat(64);
  writeJsonAtomic(path.join(plan.source, 'config/installer.json'), runtime);
  const bytes = Buffer.from('synthetic installer, never executed'),
    sha = digest(bytes);
  const item = release('v0.3.0-preview.14');
  item.assets.push({
    id: 2,
    name: 'CapriSetup-0.3.0.exe',
    state: 'uploaded',
    size: bytes.length,
    digest: 'sha256:' + sha,
  });
  const downloads = [];
  let launched = 0,
    stopped = 0;
  const service = new UpdateService({
    root: plan.root,
    state,
    node: process.execPath,
    credential: async () => null,
    releases: async () => [item],
    stage: async () => plan.source,
    download: async (asset) => {
      downloads.push(asset.id);
      const file = path.join(folder(), asset.id + '.zip');
      writeFileSync(file, bytes);
      return file;
    },
    launch: () => {
      launched++;
      const child = new EventEmitter();
      child.unref = () => {};
      setTimeout(() => child.emit('spawn'), 15);
      return child;
    },
  });
  service.setSettings({ experimental: true });
  await service.check();
  assert.equal((await service.prepare()).installerRequired, true);
  assert.deepEqual(downloads, [1, 2]);
  const installing = service.install({
    parentPid: process.pid,
    language: 'en',
    shutdown: async () => {
      stopped++;
    },
  });
  assert.equal(await service.install({}), false);
  assert.throws(() => service.setSettings({ experimental: false }), /finish/);
  assert.equal(await installing, true);
  assert.equal(launched, 1);
  assert.equal(stopped, 1);
});

test('source updates hand off to a windowed host before closing Capri, with persistent logs', async () => {
  const plan = fixture();
  const archive = path.join(plan.root, 'fixture.zip');
  writeFileSync(archive, 'verified fixture');
  let request,
    stopped = 0;
  const service = new UpdateService({
    root: plan.root,
    state: path.join(plan.root, 'data/desktop'),
    node: process.execPath,
    prepareHost: async (root) => {
      assert.equal(root, plan.root);
      return 'fixture-update-host.exe';
    },
    launch: (executable, args, options) => {
      assert.equal(executable, 'fixture-update-host.exe');
      assert.equal(options.detached, true);
      assert.equal(options.windowsHide, true);
      assert.equal(args[0], path.join(plan.source, 'packages/updater/windows/update.ps1'));
      assert.deepEqual(args.slice(2), [
        path.join(plan.root, 'logs/update-ui.stdout.log'),
        path.join(plan.root, 'logs/update-ui.stderr.log'),
      ]);
      assert(options.stdio.slice(1).every(Number.isInteger), 'Diagnostics must not be discarded');
      request = json(args[1]);
      const child = Object.assign(new EventEmitter(), {
        pid: 12345,
        exitCode: null,
        signalCode: null,
        unref() {},
      });
      setImmediate(() => {
        writeFileSync(request.ready, 'ready');
        child.emit('spawn');
      });
      return child;
    },
  });
  service.prepared = { ...plan, archive, asset: { sha256: digest(readFileSync(archive)) } };
  service.value.phase = 'ready';
  const installed = service.install({
    parentPid: process.pid,
    language: 'en',
    shutdown: async () => {
      assert(existsSync(request.ready));
      assert(!existsSync(request.proceed), 'No files may change before the owner shuts down');
      stopped++;
    },
  });
  assert.equal(await service.install({}), false);
  assert.equal(await installed, true);
  assert.equal(stopped, 1);
  assert.equal(service.handoff, true);
  assert(existsSync(request.proceed));
  assert(!existsSync(request.cancel));
  assert.match(
    readFileSync(path.join(plan.root, 'logs/update-ui.stdout.log'), 'utf8'),
    /handoff-approved/,
  );
});

test('an update UI exiting before readiness keeps Capri open and the downloaded update retryable', async () => {
  const plan = fixture(),
    archive = path.join(plan.root, 'fixture.zip');
  writeFileSync(archive, 'verified fixture');
  let request;
  const service = new UpdateService({
    root: plan.root,
    state: path.join(plan.root, 'data/desktop'),
    node: process.execPath,
    prepareHost: async () => 'fixture-update-host.exe',
    launch: (_executable, args) => {
      request = json(args[1]);
      const child = Object.assign(new EventEmitter(), {
        exitCode: 1,
        signalCode: null,
        unref() {},
      });
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  service.prepared = { ...plan, archive, asset: { sha256: digest(readFileSync(archive)) } };
  service.value.phase = 'ready';
  await assert.rejects(
    service.install({
      parentPid: process.pid,
      language: 'en',
      shutdown: () => assert.fail('The running app must be kept'),
    }),
    /update window could not start/,
  );
  assert.equal(service.snapshot().phase, 'ready');
  assert.equal(service.handoff, false);
  assert.equal(service.busy(), false);
  assert.equal(service.prepared.archive, archive);
  assert(existsSync(request.cancel));
  assert(!existsSync(request.proceed));
  const log = readFileSync(path.join(plan.root, 'logs/update-ui.stdout.log'), 'utf8');
  assert.match(log, /"phase":"failed"/);
  assert.match(log, /"exitCode":1/);
});

test(
  'Windows PowerShell rewrites existing registration JSON in a Unicode path',
  { skip: process.platform !== 'win32' },
  () => {
    const target = path.join(folder(), 'Тест повторной установки'),
      script = path.join(folder(), 'rewrite.ps1');
    mkdirSync(target);
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    writeFileSync(
      script,
      '\uFEFF' +
        `. ${quote(path.join(root, 'packages/installer/windows/common.ps1'))}\n$capriMetadata=Join-Path ${quote(target)} 'registration.json'\nWrite-CapriJson $capriMetadata @{version=1}\nWrite-CapriJson $capriMetadata @{version=2}\nif((Read-CapriJson $capriMetadata).version -ne 2){throw 'Wrong JSON value'}\n`,
    );
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(target), ['registration.json']);
  },
);

test('a voice runtime profile update repairs an existing voice environment through hardware selection', async () => {
  const plan = fixture(),
    calls = [];
  put(
    plan.source,
    'config/voice-runtime.json',
    readFileSync(path.join(root, 'config/voice-runtime.json')),
  );
  put(plan.root, '.runtime/voice-training-venv/Scripts/python.exe', 'fixture only');
  const files = sourceFiles(plan.source).map((name) => {
    const bytes = readFileSync(path.join(plan.source, name));
    return { path: name, bytes: bytes.length, sha256: digest(bytes) };
  });
  writeJsonAtomic(path.join(plan.source, 'SOURCE_MANIFEST.json'), { schemaVersion: 1, files });
  await applyUpdate(plan, {
    register: false,
    execute: async (exe, args) => {
      calls.push({ exe, args });
    },
  });
  const repair = calls.filter((call) =>
    call.args.some((arg) => arg.endsWith('setup-voice-training.ps1')),
  );
  assert.equal(repair.length, 1);
  assert.ok(repair[0].args.includes('-DependenciesOnly'));
  assert.equal(
    readFileSync(path.join(plan.root, 'data/desktop/transcript.json'), 'utf8'),
    'private conversation',
  );
});

test('an interrupted source transaction recovers before retrying the update', async () => {
  const plan = fixture(),
    id = randomUUID(),
    backups = path.join(plan.root, '.runtime/updates/backups', id);
  const previous = Buffer.from('old source');
  put(backups, 'files/apps/desktop/sample.mjs', previous);
  writeJsonAtomic(path.join(backups, 'journal.json'), {
    schemaVersion: 1,
    id,
    phase: 'installing',
    changed: [],
    dependenciesStarted: false,
    entries: [{ path: 'apps/desktop/sample.mjs', existed: true, sha256: digest(previous) }],
  });
  writeJsonAtomic(path.join(plan.root, '.runtime/updates/active.json'), { schemaVersion: 1, id });
  put(plan.root, 'apps/desktop/sample.mjs', 'incomplete transaction');
  const phases = [];
  await applyUpdate(plan, {
    execute: async () => {},
    register: false,
    emit: (event) => phases.push(event.phase),
  });
  assert.equal(phases[0], 'recovering');
  assert.equal(readFileSync(path.join(plan.root, 'apps/desktop/sample.mjs'), 'utf8'), 'new source');
  assert.equal(json(path.join(backups, 'journal.json')).phase, 'rolled-back');
});

test(
  'real Windows registration can overwrite its metadata and shortcuts twice',
  { skip: process.platform !== 'win32' },
  () => {
    const plan = fixture(),
      target = path.join(plan.root, 'Повторная установка Capri 東京');
    mkdirSync(target);
    const installId = randomUUID();
    for (const name of [
      'packages/installer/windows/register.ps1',
      'packages/installer/windows/common.ps1',
      'packages/installer/windows/uninstall.ps1',
      'packages/installer/windows/uninstall-window.cs',
      'packages/installer/windows/uninstall-launcher.cs',
      'packages/installer/windows/setup-localization.cs',
      'packages/installer/windows/localization.ps1',
      'packages/installer/windows/app-launcher.cs',
      'packages/installer/windows/shell-link.cs',
      'assets/default/app.ico',
      'config/installer.json',
      'config/installer-shell-text.json',
      'config/uninstaller-text.json',
    ])
      put(target, name, readFileSync(path.join(root, name)));
    writeJsonAtomic(path.join(target, '.capri-install.json'), {
      schemaVersion: 1,
      productId: 'capri.desktop',
      root: target,
      version: '0.3.0',
      installId,
    });
    writeJsonAtomic(path.join(target, '.runtime/installer/source-files.json'), { files: [] });
    writeJsonAtomic(path.join(target, 'data/desktop/languages.json'), {
      settings: { interface: 'ru' },
    });
    const verification = path.join(target, '.runtime/verification');
    const registrationCheck = path.join(target, '.runtime/registration-check.ps1');
    writeFileSync(
      registrationCheck,
      `param([string]$InstallRoot,[string]$VerificationRoot)
$ErrorActionPreference='Stop'
try {
    & (Join-Path $InstallRoot 'packages/installer/windows/register.ps1') -InstallRoot $InstallRoot -VerificationRoot $VerificationRoot -DesktopShortcut -StartMenuShortcut
    $registration=Get-Content -LiteralPath (Join-Path $InstallRoot '.runtime/installer/registration.json') -Raw -Encoding UTF8|ConvertFrom-Json
    $shell=Get-Content -LiteralPath (Join-Path $InstallRoot 'config/installer-shell-text.json') -Raw -Encoding UTF8|ConvertFrom-Json
    foreach($file in $registration.shortcuts){
        $link=[Capri.Setup.Shortcuts]::Read($file)
        if($link.TargetPath -cne (Join-Path $InstallRoot 'Capri.exe') -or $link.WorkingDirectory -cne $InstallRoot -or $link.IconPath -cne (Join-Path $InstallRoot 'Capri.exe') -or $link.IconIndex -ne 0 -or $link.ShowCommand -ne 1 -or $link.Description -ne $shell.ru.shortcutDescription){throw 'Shortcut lost its Unicode target, working directory, icon or launch properties.'}
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    [Console]::Error.WriteLine($_.InvocationInfo.PositionMessage)
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    exit 1
}
`,
      'utf8',
    );
    try {
      for (let pass = 0; pass < 2; pass++) {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-STA',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            registrationCheck,
            '-InstallRoot',
            target,
            '-VerificationRoot',
            verification,
          ],
          { encoding: 'utf8', windowsHide: true },
        );
        assert.equal(
          result.status,
          0,
          `Registration pass ${pass + 1}:\n${result.stderr}\n${result.stdout}`,
        );
      }
      assert.equal(
        json(path.join(target, '.runtime/installer/registration.json')).shortcuts.length,
        2,
      );
      assert.equal(
        readdirSync(path.join(verification, 'Desktop')).filter((name) => name.endsWith('.lnk'))
          .length,
        1,
      );
      assert.ok(existsSync(path.join(target, 'Capri.exe')));
      assert.ok(
        existsSync(path.join(verification, 'Uninstall', installId, 'shell-link.cs')),
        'The recovery uninstaller needs its own Unicode shortcut reader.',
      );
    } finally {
      // This fixed test-only key contains no owner registration or personal data.
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Remove-Item -LiteralPath 'HKCU:\\Software\\CapriInstallerTests\\${installId}' -ErrorAction SilentlyContinue`,
        ],
        { windowsHide: true },
      );
    }
  },
);
