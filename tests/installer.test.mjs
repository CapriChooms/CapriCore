import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  copyFileSync,
  unlinkSync,
  chmodSync,
  readdirSync,
  renameSync,
  linkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import {
  validateTarget,
  validateRequest,
  profilesAgree,
} from '../packages/installer/src/policy.mjs';
import { fetchArtifact, artifactUrl, fileHash } from '../packages/installer/src/download.mjs';
import { runCommand } from '../packages/installer/src/commands.mjs';
import { install } from '../packages/installer/src/engine.mjs';
import { estimateInstallStorage } from '../packages/installer/src/storage-estimate.mjs';
import {
  copyRussianVoicePack,
  importVoicePack,
  validateRussianVoicePack,
  validateVoicePack,
} from '../packages/installer/src/voice-pack.mjs';
import { findFreePort } from '../packages/installer/src/ports.mjs';
import { installationLock } from '../packages/installer/src/lock.mjs';
import { ACTIVE_AVATAR_CATALOG, requireCapriAvatar } from '../apps/desktop/avatar-catalog.mjs';
import { LLAMA_VULKAN_FILES } from '../packages/runtime/src/host/llama-bundle.mjs';
import {
  ELECTRON_RUNTIME_FILES,
  electronBundleReady,
} from '../packages/runtime/src/host/electron-bundle.mjs';

const cache = path.join(root, '.runtime/installer-unit');
mkdirSync(cache, { recursive: true });
const folder = () => mkdtempSync(path.join(cache, 'case-'));
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const spec = json(path.join(root, 'config/installer.json'));
function extractElectronFixture(target) {
  const base = path.join(target, 'node_modules/electron/dist');
  for (const name of [...ELECTRON_RUNTIME_FILES, 'version']) {
    const file = path.join(base, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      name === 'version' ? spec.artifacts.electron.version : 'runtime fixture - never executed',
    );
  }
}
const hardware = {
  ramBytes: 48 * 2 ** 30,
  cpuThreads: 32,
  gpus: [{ name: 'NVIDIA fixture', vendor: 'NVIDIA', memoryKind: 'dedicated', vramMiB: 12282 }],
};
const request = (target) => ({
  schemaVersion: 1,
  target,
  profile: 'balanced',
  interfaceLanguage: 'ru',
  conversationLanguage: 'en',
  recognition: false,
  router: false,
  downloadModels: false,
  voicePack: '',
  desktopShortcut: false,
  startMenuShortcut: false,
  acceptLicense: true,
  acceptDownloads: true,
});

test(
  'resumable dependency downloads reject existing hard-linked or dangling-link partials before any request or write',
  { skip: process.platform !== 'win32' },
  async () => {
    const bytes = Buffer.from('reviewed download bytes'),
      sha256 = digest(bytes);
    for (const kind of ['hardlink', 'dangling']) {
      const base = folder(),
        cache = path.join(base, 'downloads'),
        outside = path.join(base, 'outside.dat');
      mkdirSync(cache);
      const partial = path.join(cache, sha256 + '.zip.part');
      if (kind === 'hardlink') {
        writeFileSync(outside, 'old');
        linkSync(outside, partial);
      } else symlinkSync(outside, partial, 'file');
      let requests = 0;
      await assert.rejects(
        fetchArtifact(
          {
            url: 'https://github.com/ollama/ollama/releases/download/fixture/runtime.zip',
            sha256,
            bytes: bytes.length,
          },
          cache,
          {
            pauseFile: path.join(base, 'pause'),
            fetchImpl: async () => {
              requests++;
              return new Response(bytes);
            },
          },
        ),
        /filesystem links/,
      );
      assert.equal(requests, 0);
      if (kind === 'hardlink') assert.equal(readFileSync(outside, 'utf8'), 'old');
      else assert.equal(existsSync(outside), false);
    }
  },
);

test('installer manifests match reviewed runtimes, hardware profiles and all interface languages', () => {
  assert.ok(profilesAgree(spec));
  const upstream = json(path.join(root, 'config/upstream-lock.json'));
  for (const name of ['node', 'llama', 'uv'])
    assert.equal(spec.artifacts[name].version, upstream[name].version);
  assert.equal(spec.artifacts.llama.sha256, upstream.llama.windowsArchiveSha256);
  assert.equal(
    spec.artifacts.electron.version,
    json(path.join(root, 'package.json')).devDependencies.electron,
  );
  assert.equal(
    spec.artifacts.electron.sha256,
    json(path.join(root, 'node_modules/electron/checksums.json'))[
      'electron-v' + spec.artifacts.electron.version + '-win32-x64.zip'
    ],
  );
  const ui = json(path.join(root, 'apps/shared/interface-locales.json')).locales;
  assert.deepEqual(
    json(path.join(root, 'config/installer-languages.json')),
    Object.values(ui).map(({ id, nativeName }) => ({ id, nativeName })),
  );
  const text = json(path.join(root, 'config/installer-text.json'));
  assert.deepEqual(Object.keys(text.en), Object.keys(text.ru));
  assert.deepEqual(Object.keys(text.en.stages), Object.keys(text.ru.stages));
});

test('desktop readiness requires the actual runtime, not just its npm package', () => {
  const target = folder(),
    base = path.join(target, 'node_modules/electron');
  writeJsonAtomic(path.join(base, 'package.json'), { version: spec.artifacts.electron.version });
  assert.equal(electronBundleReady(base), false);
  extractElectronFixture(target);
  assert.equal(electronBundleReady(base, spec.artifacts.electron.version), true);
  assert.equal(electronBundleReady(base, '0.0.1'), false);
  unlinkSync(path.join(base, 'dist/resources.pak'));
  assert.equal(electronBundleReady(base), false);
});
test('installer rejects source roots, unrelated files, filesystem links and mismatched repairs', () => {
  assert.throws(() => validateTarget(root, root, '0.3.0'), /cannot/);
  assert.throws(() => validateTarget(path.dirname(root), root, '0.3.0'), /cannot/);
  const target = folder();
  writeFileSync(path.join(target, 'private.txt'), 'do not overwrite');
  assert.throws(() => validateTarget(target, root, '0.3.0'), /unrelated/);
  writeJsonAtomic(path.join(target, '.capri-install.json'), {
    schemaVersion: 1,
    productId: 'capri.desktop',
    root: target,
    installId: randomUUID(),
    version: '0.3.0',
  });
  assert.equal(validateTarget(target, root, '0.3.0'), target);
  assert.equal(validateTarget(target, root, '0.4.0'), target);
  assert.throws(() => validateTarget(target, root, '0.2.0'), /newer/);
  const linked = path.join(folder(), 'link');
  symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateTarget(linked, root, '0.3.0'), /links/);
  assert.equal(readFileSync(path.join(target, 'private.txt'), 'utf8'), 'do not overwrite');
});
test('installer requires explicit consent, sufficient resources and supported language/voice combinations', () => {
  const context = { sourceRoot: root, version: '0.3.0', hardware, freeBytes: 100 * 2 ** 30 },
    input = request(path.join(folder(), 'new'));
  assert.throws(() => validateRequest({ ...input, acceptLicense: false }, context), /acceptance/);
  assert.throws(() => validateRequest({ ...input, router: 'yes' }, context), /option/);
  assert.throws(() => validateRequest(input, { ...context, freeBytes: 1 }), /free space/);
  assert.throws(
    () => validateRequest({ ...input, interfaceLanguage: 'invented' }, context),
    /language/,
  );
  assert.throws(
    () =>
      validateRequest(
        { ...input, voicePack: folder() },
        { ...context, hardware: { ...hardware, gpus: [] } },
      ),
    /NVIDIA/,
  );
  const plan = validateRequest(input, context);
  assert.equal(plan.languages.speech, 'off');
  assert.equal(plan.languages.recognition, 'off');
});
test('dependency downloads verify bytes and checksum, reuse verified cache and reject hostile redirects', async () => {
  const bytes = Buffer.from('approved dependency fixture'),
    info = { url: 'https://nodejs.org/fixture.zip', bytes: bytes.length, sha256: digest(bytes) };
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  };
  const target = folder(),
    file = await fetchArtifact(info, target, { fetchImpl });
  assert.equal(await fileHash(file), info.sha256);
  await fetchArtifact(info, target, { fetchImpl });
  assert.equal(calls, 1);
  await assert.rejects(
    fetchArtifact({ ...info, sha256: '0'.repeat(64) }, folder(), { fetchImpl }),
    /checksum/,
  );
  await assert.rejects(
    fetchArtifact(info, folder(), {
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    }),
    /Unapproved/,
  );
  for (const url of [
    'file:///secret',
    'https://github.com.evil.example/file',
    'https://name:secret@github.com/file',
  ])
    assert.throws(() => artifactUrl(url), /Unapproved/);
});
test('cancellation never promotes a partial dependency to the verified cache', async () => {
  const signal = new AbortController(),
    bytes = Buffer.from('complete'),
    info = { url: 'https://nodejs.org/fixture.zip', bytes: bytes.length, sha256: digest(bytes) },
    target = folder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      setTimeout(() => signal.abort(new Error('cancel fixture')), 25);
    },
    cancel() {},
  });
  await assert.rejects(
    fetchArtifact(info, target, {
      signal: signal.signal,
      fetchImpl: async () => new Response(stream),
    }),
  );
  assert.equal(existsSync(path.join(target, info.sha256 + '.zip')), false);
  assert.equal(existsSync(path.join(target, info.sha256 + '.zip.part')), false);
});
test('installation rejects an insufficient disk probe before writing or running dependencies', async () => {
  const target = path.join(folder(), 'disk-space-install');
  const events = [];
  let probes = 0;
  await assert.rejects(
    install(request(target), {
      sourceRoot: root,
      nodeExecutable: process.execPath,
      hardware,
      free: (selected) => {
        assert.equal(selected, target);
        probes++;
        return 0;
      },
      emit: (event) => events.push(event),
      execute: async () => assert.fail('Disk guard must run before runtime commands'),
      download: async () => assert.fail('Disk guard must run before downloads'),
    }),
    { code: 'CAPRI_DISK_SPACE' },
  );
  assert.equal(probes, 1);
  assert.equal(existsSync(target), false);
  assert.deepEqual(events, []);
});

test('voice pack imports only approved files, checks hashes and rejects path escapes', () => {
  const source = folder(),
    destination = folder(),
    model = { repository: 'fixture', revision: 'pinned' };
  const adapter = Buffer.from('adapter'),
    wav = Buffer.from('reference');
  mkdirSync(path.join(source, 'references'));
  writeFileSync(path.join(source, 'adapter.safetensors'), adapter);
  writeFileSync(path.join(source, 'references/neutral.wav'), wav);
  writeJsonAtomic(path.join(source, 'adapter.json'), {});
  const profile = {
    schemaVersion: 1,
    id: 'voice-fixture',
    engine: 'chatterbox-turbo',
    language: 'en',
    baseModel: model,
    adapter: 'adapter.safetensors',
    adapterConfig: 'adapter.json',
    adapterSha256: digest(adapter),
    references: { neutral: { file: 'references/neutral.wav', sha256: digest(wav) } },
  };
  writeJsonAtomic(path.join(source, 'voice-profile.json'), profile);
  writeFileSync(path.join(source, 'private-notes.txt'), 'must not copy');
  const relative = importVoicePack(source, destination, model);
  assert.equal(existsSync(path.join(destination, relative, 'private-notes.txt')), false);
  writeFileSync(path.join(source, 'adapter.safetensors'), 'corrupt');
  assert.throws(() => validateVoicePack(source, model), /checksum/);
  writeJsonAtomic(path.join(source, 'voice-profile.json'), { ...profile, adapter: '../escape' });
  assert.throws(() => validateVoicePack(source, model), /filenames/);
});
test('service-port selection avoids occupied and already reserved ports', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const used = server.address().port,
      reserved = new Set([used + 1]),
      free = await findFreePort(used, reserved);
    assert.ok(free > used + 1);
    assert.ok(reserved.has(free));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('installer child cancellation terminates its own command with bounded diagnostics', async () => {
  const controller = new AbortController();
  const running = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    signal: controller.signal,
    timeoutMs: 10000,
  });
  setTimeout(() => controller.abort(new Error('cancel owned child')), 100);
  await assert.rejects(running, /cancel owned child/);
  await assert.rejects(
    runCommand('capri-missing-executable-fixture', [], { timeoutMs: 1000 }),
    /ENOENT/,
  );
});

async function transactionFixture({
  fail = false,
  cancel = false,
  cancelModels = false,
  missingEmbedding = false,
  voiceLanguage = '',
  damageAvatar = false,
  readOnlySource = false,
  damagedLlama = false,
  inferenceMode,
  modelSource,
  voiceMode,
  includedReference = false,
  gpuName,
  llamaState,
  failLlamaPromotion = false,
  selectedProfile,
  languageUpgrade,
  routerNativeFailure = false,
  russianAdapter,
} = {}) {
  const qwen = voiceMode === 'qwen' || voiceMode === 'qwen-ru';
  const target = folder(),
    controller = new AbortController(),
    events = [],
    modelCommands = [];
  writeJsonAtomic(path.join(target, '.capri-install.json'), {
    schemaVersion: 1,
    productId: 'capri.desktop',
    root: target,
    installId: randomUUID(),
    version: '0.3.0',
  });
  const previousModel = {
    model: 'capri-qwen3.5:2b',
    upstreamModel: 'qwen3.5:2b',
    resourceProfile: 'balanced',
    gatewayPort: 19876,
    ollamaPort: 19877,
    contextTokens: 65536,
  };
  if (selectedProfile) writeJsonAtomic(path.join(target, 'config/core.local.json'), previousModel);
  const languageFile = path.join(target, 'data/desktop/languages.json');
  if (languageUpgrade)
    writeJsonAtomic(languageFile, { schemaVersion: 1, settings: languageUpgrade.previous });
  const canary = path.join(target, 'data/workspace/memory.md');
  mkdirSync(path.dirname(canary), { recursive: true });
  writeFileSync(canary, 'private memory canary');
  const replaced = path.join(target, 'tools/setup/python-runtime.ps1');
  if (readOnlySource) {
    mkdirSync(path.dirname(replaced), { recursive: true });
    writeFileSync(replaced, 'old managed source fixture');
    chmodSync(replaced, 0o444);
  }
  const bundle = path.join(target, '.runtime', spec.artifacts.llama.directory);
  const exe = path.join(bundle, 'llama-server.exe');
  const extractLlama = (destination = bundle) => {
    mkdirSync(destination, { recursive: true });
    for (const name of LLAMA_VULKAN_FILES)
      writeFileSync(path.join(destination, name), 'fixture llama.cpp runtime');
  };
  extractLlama();
  const receiptFile = path.join(target, '.runtime/installer/llama.json');
  const files = {};
  for (const name of LLAMA_VULKAN_FILES) files[name] = await fileHash(path.join(bundle, name));
  writeJsonAtomic(receiptFile, {
    sha256: spec.artifacts.llama.sha256,
    executableSha256: await fileHash(exe),
    files,
  });
  const previousReceipt = readFileSync(receiptFile, 'utf8');
  const plugin = path.join(bundle, 'ggml-vulkan.dll');
  if (damagedLlama) unlinkSync(plugin);
  if (llamaState === 'corrupt') writeFileSync(plugin, 'corrupt Vulkan backend');
  if (llamaState === 'empty') writeFileSync(plugin, '');
  if (llamaState === 'stale') {
    writeFileSync(plugin, 'corrupt Vulkan backend');
    writeFileSync(path.join(bundle, 'stale-backend.dll'), 'legacy file');
  }
  let voicePack = '';
  const multilingualCalls = [];
  const speechSetupCalls = [];
  let runtimeDownloads = 0;
  if (voiceLanguage) {
    voicePack = folder();
    const adapter = Buffer.from('adapter fixture'),
      wav = Buffer.from('reference fixture');
    mkdirSync(path.join(voicePack, 'references'));
    writeFileSync(path.join(voicePack, 'adapter.safetensors'), adapter);
    writeFileSync(path.join(voicePack, 'references/neutral.wav'), wav);
    writeJsonAtomic(path.join(voicePack, 'adapter.json'), {});
    writeJsonAtomic(path.join(voicePack, 'voice-profile.json'), {
      schemaVersion: 1,
      id: includedReference ? 'capri-en-v1' : 'language-fixture',
      engine: 'chatterbox-turbo',
      language: 'en',
      baseModel: json(path.join(root, 'config/voice-upstream.json')).model,
      adapter: 'adapter.safetensors',
      adapterConfig: 'adapter.json',
      adapterSha256: digest(adapter),
      references: { neutral: { file: 'references/neutral.wav', sha256: digest(wav) } },
    });
  }
  if (russianAdapter) copyRussianVoicePack(russianAdapter, path.join(voicePack, 'russian'));
  for (const name of voiceLanguage && !qwen ? ['uv', 'git'] : ['uv']) {
    const executable = path.join(
      target,
      '.runtime',
      name,
      name === 'uv' ? 'uv.exe' : 'cmd/git.exe',
    );
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, 'fixture executable - never executed');
    writeJsonAtomic(path.join(target, '.runtime/installer', name + '.json'), {
      sha256: spec.artifacts[name].sha256,
      executableSha256: await fileHash(executable),
    });
  }
  const execute = async (file, args, options) => {
    assert.equal(options.env.OPENCLAW_GATEWAY_TOKEN, undefined);
    if (args.some((arg) => arg.endsWith('setup-voice-training.ps1'))) {
      options.output('Downloading torch (2.4GiB)');
      options.output(
        JSON.stringify({
          capriFileTransfer: 'torch.whl',
          received: 9,
          total: 30,
          stageFraction: 0.2,
        }),
      );
    }
    if (args.some((arg) => arg.endsWith('setup-request-router.ps1'))) {
      speechSetupCalls.push('router');
      if (routerNativeFailure)
        throw Object.assign(new Error('Component exited 22'), {
          exitCode: 22,
          outputTail: 'CAPRI_ROUTER_NATIVE_LIBRARY_UNAVAILABLE',
        });
    }
    if (args.some((arg) => arg.endsWith('setup-qwen-tts.ps1'))) {
      assert.ok(args.includes('-DependenciesOnly'));
      speechSetupCalls.push('qwen-dependencies');
    }
    if (args.includes('integrations.voice_runtime.qwen_provision')) {
      assert.equal(file, path.join(target, '.runtime/qwen-tts-venv/Scripts/python.exe'));
      assert.equal(args.includes('--russian'), voiceMode === 'qwen-ru');
      speechSetupCalls.push('qwen-weights');
    }
    if (args.some((arg) => /setup-(voice-training|multilingual-voice)\.ps1$/.test(arg)))
      assert.equal(
        options.timeoutMs,
        8 * 60 * 60 * 1000,
        'Slow speech downloads need more than one hour',
      );
    if (args.includes('setup') || args.includes('doctor'))
      assert.equal(options.timeoutMs, 60 * 60 * 1000, 'Local setup keeps its original deadline');
    if (args.some((arg) => arg.endsWith('archive.ps1'))) {
      const destination = args[args.indexOf('-Destination') + 1];
      if (destination === path.join(target, 'node_modules/electron/dist')) {
        extractElectronFixture(target);
        return;
      }
      assert.ok(damagedLlama || llamaState);
      assert.ok(destination.startsWith(path.join(target, '.runtime/installer/staging') + path.sep));
      extractLlama(destination);
    }
    if (args.includes('ci')) {
      if (fail) throw new Error('network fixture failure');
      for (const name of ['electron', 'openclaw'])
        writeJsonAtomic(path.join(target, 'node_modules', name, 'package.json'), {
          name,
          version: spec.artifacts.electron.version,
        });
      if (cancel) controller.abort(new Error('cancel transaction fixture'));
      if (damageAvatar) unlinkSync(path.join(target, ACTIVE_AVATAR_CATALOG));
    }
    if (args.includes('setup'))
      writeJsonAtomic(path.join(target, 'config/core.local.json'), {
        model: 'capri-qwen3.5:2b',
        resourceProfile: 'balanced',
      });
    if (args.includes('models')) {
      modelCommands.push(args.slice(args.indexOf('models') + 1));
      if (selectedProfile) {
        const selected = spec.profiles.find((profile) => profile.id === selectedProfile);
        assert.equal(
          json(path.join(target, 'config/core.local.json')).upstreamModel,
          selected.model,
        );
      }
      if (cancelModels) controller.abort(new Error('cancel embedding fixture'));
      writeJsonAtomic(path.join(target, 'data/model-inventory.json'), {
        models: missingEmbedding
          ? []
          : [
              { name: 'capri-embed:latest' },
              ...(selectedProfile
                ? [{ name: json(path.join(target, 'config/core.local.json')).model }]
                : []),
            ],
      });
    }
    if (args.some((arg) => arg.endsWith('setup-multilingual-voice.ps1')))
      multilingualCalls.push(args.slice(args.indexOf('-Language')));
  };
  const running = install(
    {
      ...request(target),
      ...(routerNativeFailure && { router: true }),
      voicePack: includedReference ? '' : voicePack,
      ...(includedReference ? { bundledVoicePack: voicePack } : {}),
      ...(voiceMode ? { voiceMode } : {}),
      conversationLanguage: languageUpgrade?.conversation ?? (voiceLanguage || 'en'),
      ...(inferenceMode ? { inferenceMode, downloadModels: true } : {}),
      ...(modelSource ? { modelSource, downloadModels: true } : {}),
      ...(selectedProfile
        ? {
            profile: selectedProfile,
            downloadModels: true,
            inferenceMode: 'local',
            modelSource: 'catalog',
          }
        : {}),
    },
    {
      sourceRoot: root,
      nodeExecutable: process.execPath,
      free: () => 1024 ** 4,
      signal: controller.signal,
      emit: (event) => events.push(event),
      execute,
      hardware: gpuName
        ? {
            ...hardware,
            gpus: [{ name: gpuName, vendor: 'amd', memoryKind: 'dedicated', vramMiB: 12282 }],
          }
        : qwen
          ? { ...hardware, gpus: [] }
          : hardware,
      register: false,
      renameRuntime: (from, to) => {
        if (
          failLlamaPromotion &&
          from.startsWith(path.join(target, '.runtime/installer/staging') + path.sep)
        )
          throw new Error('fixture promotion failure');
        renameSync(from, to);
      },
      download: async (selected, _folder, { progress }) => {
        if (selected.sha256 === spec.artifacts.electron.sha256)
          return path.join(target, '.runtime/electron-fixture.zip');
        assert.ok(damagedLlama || llamaState);
        assert.equal(selected.sha256, spec.artifacts.llama.sha256);
        progress({ received: selected.bytes, total: selected.bytes });
        runtimeDownloads++;
        return path.join(target, '.runtime/verified-archive-fixture.zip');
      },
    },
  );
  if (damageAvatar) await assert.rejects(running, /artwork is missing or damaged/);
  else if (missingEmbedding)
    await assert.rejects(running, /A required model is not ready: capri-embed/);
  else if (fail || cancel || cancelModels || failLlamaPromotion) await assert.rejects(running);
  else await running;
  if (routerNativeFailure) {
    assert.ok(speechSetupCalls.includes('router'));
    assert.equal(
      events.find((event) => event.type === 'complete')?.routerNativeLibraryUnavailable,
      true,
    );
    assert.equal(json(path.join(target, 'config/request-router.json')).enabled, false);
  }
  if (selectedProfile) {
    const local = json(path.join(target, 'config/core.local.json'));
    if (cancelModels) assert.deepEqual(local, previousModel);
    else {
      assert.equal(local.resourceProfile, selectedProfile);
      assert.equal(local.gatewayPort, previousModel.gatewayPort);
      assert.equal(local.contextTokens, previousModel.contextTokens);
    }
  }
  assert.equal(readFileSync(canary, 'utf8'), 'private memory canary');
  if (languageUpgrade)
    assert.deepEqual(
      json(languageFile).settings,
      cancelModels ? languageUpgrade.previous : languageUpgrade.expected,
    );
  const state = json(path.join(target, '.runtime/installer/state.json'));
  if (state.status === 'complete' && voiceLanguage && !qwen) {
    const voiceActivities = events.filter(
      (event) => event.type === 'activity' && event.step === 'voice-runtime',
    );
    assert(voiceActivities.some((event) => event.action === 'installDependencies'));
    assert.deepEqual(voiceActivities.at(-1), {
      type: 'activity',
      step: 'voice-runtime',
      action: 'downloadRuntime',
      component: 'PyTorch',
    });
    assert(
      events.some(
        (event) =>
          event.type === 'download' &&
          event.step === 'voice-runtime' &&
          event.file === 'torch.whl' &&
          event.received === 9 &&
          event.total === 30 &&
          event.stageFraction === 0.2,
      ),
    );
  }
  assert.equal(
    state.status,
    cancel || cancelModels
      ? 'cancelled'
      : fail || damageAvatar || missingEmbedding || failLlamaPromotion
        ? 'failed'
        : 'complete',
  );
  assert.equal(existsSync(path.join(target, '.runtime/installer/install.lock.json')), false);
  assert.equal(
    events.some((event) => event.type === 'complete'),
    !(fail || cancel || cancelModels || damageAvatar || missingEmbedding || failLlamaPromotion),
  );
  if (
    !fail &&
    !cancel &&
    !cancelModels &&
    !damageAvatar &&
    !missingEmbedding &&
    !failLlamaPromotion
  ) {
    assert.deepEqual(modelCommands, [selectedProfile ? [] : ['--embedding-only']]);
    assert.equal(state.steps.models.status, 'complete');
    assert.equal(
      events.some((event) => event.type === 'stage' && event.step === 'models'),
      true,
    );
    assert.deepEqual(json(path.join(target, 'data/model-inventory.json')).models, [
      { name: 'capri-embed:latest' },
      ...(selectedProfile
        ? [{ name: json(path.join(target, 'config/core.local.json')).model }]
        : []),
    ]);
    assert.equal(
      json(path.join(target, 'config/request-router.json')).enabled,
      !routerNativeFailure,
    );
    assert.equal(speechSetupCalls[0], 'router');
    if (qwen) {
      assert.deepEqual(speechSetupCalls, ['router', 'qwen-dependencies', 'qwen-weights']);
      assert.deepEqual(json(path.join(target, 'data/speech/voice-selections.json')), {
        schemaVersion: 1,
        languages: {
          [voiceLanguage]:
            voiceMode === 'qwen-ru' ? 'qwen3-tts-1.7b-capri-ru' : 'qwen3-tts-0.6b-base',
        },
      });
      assert.equal(
        json(path.join(target, 'data/desktop/languages.json')).settings.speech,
        'follow',
      );
      if (includedReference) {
        validateVoicePack(
          path.join(target, 'data/speech/bundled-voice'),
          json(path.join(root, 'config/voice-upstream.json')).model,
        );
        const profileDir = json(path.join(target, 'config/companion-voice.json')).profileDir;
        assert.equal(profileDir, 'data/voices/capri/en/exports/capri-en-v1');
        validateVoicePack(
          path.join(target, profileDir),
          json(path.join(root, 'config/voice-upstream.json')).model,
        );
      }
      if (russianAdapter)
        validateRussianVoicePack(path.join(target, 'data/speech/bundled-voice/russian'));
    }
    assert.equal(
      events.find((event) => event.type === 'complete').modelsReady,
      Boolean(selectedProfile),
    );
    const sourceAvatar = requireCapriAvatar(root);
    assert.deepEqual(
      requireCapriAvatar(target).frames.map(({ id }) => id),
      sourceAvatar.frames.map(({ id }) => id),
    );
    if (inferenceMode === 'api') {
      assert.deepEqual(modelCommands, [['--embedding-only']]);
      assert.deepEqual(json(path.join(target, 'data/desktop/inference-api.json')), {
        setupRequired: true,
      });
      assert.equal(existsSync(path.join(target, 'data/secrets/inference-api.json')), false);
    }
    if (modelSource === 'huggingface') {
      assert.deepEqual(modelCommands, [['--embedding-only']]);
      assert.equal(json(path.join(target, 'config/core.local.json')).modelSetupRequired, true);
      assert.equal(events.find((event) => event.type === 'complete').modelSetupRequired, true);
      assert.equal(existsSync(path.join(target, 'data/desktop/inference-api.json')), false);
    }
  }
  if (voiceLanguage && !fail && !cancel && !cancelModels && !missingEmbedding)
    assert.deepEqual(multilingualCalls, qwen ? [] : [['-Language', voiceLanguage]]);
  if (readOnlySource) {
    assert.equal(
      readFileSync(replaced, 'utf8'),
      readFileSync(path.join(root, 'tools/setup/python-runtime.ps1'), 'utf8'),
    );
    const backups = path.join(target, '.runtime/installer/backups');
    assert.ok(
      readdirSync(backups).some((id) => {
        const backup = path.join(backups, id, 'tools/setup/python-runtime.ps1');
        return existsSync(backup) && readFileSync(backup, 'utf8') === 'old managed source fixture';
      }),
    );
  }
  assert.equal(runtimeDownloads, damagedLlama || llamaState ? 1 : 0);
  if (failLlamaPromotion) {
    assert.equal(readFileSync(plugin, 'utf8'), 'corrupt Vulkan backend');
    assert.equal(readFileSync(receiptFile, 'utf8'), previousReceipt);
  } else if (runtimeDownloads) {
    const receipt = json(receiptFile);
    for (const name of LLAMA_VULKAN_FILES)
      assert.equal(receipt.files[name], await fileHash(path.join(bundle, name)));
    assert.equal(existsSync(path.join(bundle, 'stale-backend.dll')), false);
  }
}

test(
  'NVIDIA and Radeon installations use the same pinned llama.cpp distribution',
  { skip: process.platform !== 'win32' },
  async () => {
    await transactionFixture({ gpuName: 'AMD Radeon RX 7900 XTX', damagedLlama: true });
    await transactionFixture({ gpuName: 'AMD Radeon RX 6400', inferenceMode: 'api' });
    await transactionFixture({ damagedLlama: true });
  },
);
test(
  'repair restores a missing llama.cpp Vulkan backend even when the executable receipt is valid',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ damagedLlama: true }),
);
test(
  'installation transaction preserves private data and distinguishes deferred models from readiness',
  { skip: process.platform !== 'win32' },
  () => transactionFixture(),
);

test(
  'deferred local installation cannot complete without its mandatory memory embedding',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ missingEmbedding: true }),
);

test(
  'deferred local embedding cancellation never reports installation success',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ cancelModels: true }),
);
test(
  'API installation downloads only memory embeddings and defers API credentials until first launch',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ inferenceMode: 'api' }),
);
test(
  'Hugging Face installation defers the local model, downloads embeddings and opens model setup',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ modelSource: 'huggingface' }),
);
test(
  'repair replaces a read-only managed script, retaining its backup and private memory',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ readOnlySource: true }),
);
test(
  'installation transaction never reports success after a failed component',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ fail: true }),
);

test(
  'installation verifies artwork even when voice and model downloads are disabled',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ damageAvatar: true }),
);
test(
  'installation transaction persists cancellation without losing private data',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ cancel: true }),
);

test(
  'selected voice language is passed through setup so Russian does not require Chinese resources',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ voiceLanguage: 'ru' }),
);
test(
  'a CPU-only installation provisions Hugging Face speech and enables it only for the chosen language',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ voiceLanguage: 'ru', voiceMode: 'qwen', inferenceMode: 'api' }),
);

test(
  'CPU Qwen setup uses its separately supplied reference without selecting a Chatterbox pack',
  { skip: process.platform !== 'win32' },
  () =>
    transactionFixture({
      voiceLanguage: 'en',
      voiceMode: 'qwen',
      inferenceMode: 'api',
      includedReference: true,
    }),
);
test(
  'Russian LoRA setup provisions Russian assets and persists the correct voice selection',
  { skip: process.platform !== 'win32' || !process.env.CAPRI_VERIFICATION_RUSSIAN_VOICE_PACK },
  () =>
    transactionFixture({
      voiceLanguage: 'ru',
      voiceMode: 'qwen-ru',
      inferenceMode: 'api',
      includedReference: true,
      russianAdapter: process.env.CAPRI_VERIFICATION_RUSSIAN_VOICE_PACK,
    }),
);
test(
  'repair atomically replaces corrupted, empty and stale llama.cpp backend files',
  { skip: process.platform !== 'win32' },
  async () => {
    for (const llamaState of ['empty', 'corrupt', 'stale'])
      await transactionFixture({ llamaState });
  },
);
test(
  'failed llama.cpp promotion restores the previous backend and receipt',
  { skip: process.platform !== 'win32' },
  () => transactionFixture({ llamaState: 'corrupt', failLlamaPromotion: true }),
);
test('a missing included reference is rejected before installing dependencies', async () => {
  const target = folder();
  const context = {
    sourceRoot: root,
    version: json(path.join(root, 'package.json')).version,
    hardware,
  };
  assert.throws(
    () => validateRequest({ ...request(target), bundledVoicePack: 'relative-reference' }, context),
    /included voice reference needs an absolute folder/,
  );
  await assert.rejects(
    install(
      {
        ...request(target),
        voiceMode: 'qwen',
        bundledVoicePack: path.join(target, 'missing-reference'),
      },
      {
        sourceRoot: root,
        nodeExecutable: process.execPath,
        free: () => 1024 ** 4,
        hardware,
        execute: async () => assert.fail('Invalid reference must fail before any runtime command'),
      },
    ),
    /existing exported voice-pack folder/,
  );
  assert.equal(existsSync(path.join(target, '.capri-install.json')), false);
});

test('only one installation transaction can own a folder at a time', () => {
  const cache = folder(),
    release = installationLock(cache);
  assert.throws(() => installationLock(cache), /Another installation/);
  release();
  const second = installationLock(cache);
  second();
});

test(
  'an empty voice folder produces an actionable error and prevents all installation work',
  { skip: process.platform !== 'win32' },
  async () => {
    const source = path.join(folder(), 'пустой голос');
    mkdirSync(source);
    const expected = (code) => (error) => error.code === code && !error.message.includes('ENOENT');
    assert.throws(() => validateVoicePack(source, {}), expected('VOICE_PACK_PROFILE_MISSING'));
    assert.throws(
      () => validateVoicePack(path.join(source, 'missing'), {}),
      expected('VOICE_PACK_FOLDER_MISSING'),
    );
    const target = path.join(folder(), 'install'),
      events = [];
    let commands = 0;
    await assert.rejects(
      install(
        { ...request(target), voicePack: source },
        {
          sourceRoot: root,
          nodeExecutable: process.execPath,
          free: () => 1024 ** 4,
          hardware,
          register: false,
          emit: (event) => events.push(event),
          execute: async () => {
            commands++;
          },
        },
      ),
      expected('VOICE_PACK_PROFILE_MISSING'),
    );
    assert.equal(commands, 0);
    assert.deepEqual(events, []);
    assert.equal(existsSync(target), false);
  },
);

test(
  'a fresh install runs its real postinstall without a preinstalled runtime and configures only a verified owned runtime',
  { skip: process.platform !== 'win32' },
  async () => {
    const target = path.join(folder(), 'новая установка'),
      events = [];
    const llama = path.join(target, '.runtime', spec.artifacts.llama.directory, 'llama-server.exe');
    const inherited = process.env.CAPRI_LLAMA_PATH;
    process.env.CAPRI_LLAMA_PATH = path.join(target, 'inherited-missing.exe');
    let postinstallPassed = false,
      downloaded = false,
      embeddingPrepared = false;
    try {
      await install(request(target), {
        sourceRoot: root,
        nodeExecutable: process.execPath,
        free: () => 1024 ** 4,
        hardware,
        register: false,
        emit: (event) => events.push(event),
        download: async (artifact) => {
          if (artifact.sha256 === spec.artifacts.electron.sha256)
            return path.join(target, 'electron-fixture.zip');
          if (artifact.sha256 === spec.artifacts.uv.sha256)
            return path.join(target, 'uv-fixture.zip');
          assert.equal(artifact.sha256, spec.artifacts.llama.sha256);
          assert.ok(postinstallPassed);
          downloaded = true;
          return path.join(target, 'fixture-archive.zip');
        },
        execute: async (file, args, options) => {
          if (args.includes('ci')) {
            assert.equal(existsSync(llama), false);
            assert.equal(options.env.CAPRI_LLAMA_PATH, undefined);
            // Exercise the actual pinned compatibility patcher, not a mocked
            // lifecycle exit. Only its reviewed dependency files are needed.
            const patches = json(path.join(root, 'integrations/openclaw-compat/patches.json'));
            for (const name of ['package.json', ...patches.patches.map((patch) => patch.file)]) {
              const destination = path.join(target, 'node_modules/openclaw', name);
              mkdirSync(path.dirname(destination), { recursive: true });
              copyFileSync(path.join(root, 'node_modules/openclaw', name), destination);
            }
            const security = json(path.join(root, 'config/dependency-security-patches.json'));
            for (const name of new Set(
              security.targets.flatMap((target) => [target.packageFile, target.file]),
            )) {
              const destination = path.join(target, name);
              mkdirSync(path.dirname(destination), { recursive: true });
              copyFileSync(path.join(root, name), destination);
            }
            writeJsonAtomic(path.join(target, 'node_modules/electron/package.json'), {
              name: 'electron',
              version: spec.artifacts.electron.version,
            });
            const result = spawnSync(
              process.execPath,
              ['packages/runtime/bin/patch-openclaw.mjs'],
              {
                cwd: target,
                env: options.env,
                encoding: 'utf8',
                windowsHide: true,
                timeout: 10000,
              },
            );
            assert.equal(result.status, 0, result.stderr);
            // Even a stray invalid runtime override must not affect this
            // source-only installation hook.
            const standalone = spawnSync(
              process.execPath,
              ['packages/runtime/bin/patch-openclaw.mjs'],
              {
                cwd: target,
                env: { ...options.env, CAPRI_LLAMA_PATH: path.join(target, 'missing.exe') },
                encoding: 'utf8',
                windowsHide: true,
                timeout: 10000,
              },
            );
            assert.equal(standalone.status, 0, standalone.stderr);
            postinstallPassed = true;
          } else if (args.some((arg) => arg.endsWith('archive.ps1'))) {
            if (args[args.indexOf('-Destination') + 1] === path.join(target, '.runtime/uv')) {
              const uv = path.join(target, '.runtime/uv/uv.exe');
              mkdirSync(path.dirname(uv), { recursive: true });
              writeFileSync(uv, 'owned UV fixture');
              return;
            }
            if (
              args[args.indexOf('-Destination') + 1] ===
              path.join(target, 'node_modules/electron/dist')
            ) {
              extractElectronFixture(target);
              return;
            }
            assert.ok(downloaded);
            assert.equal(options.env.CAPRI_LLAMA_PATH, undefined);
            const staged = args[args.indexOf('-Destination') + 1];
            mkdirSync(staged, { recursive: true });
            for (const name of LLAMA_VULKAN_FILES)
              writeFileSync(path.join(staged, name), 'owned backend fixture');
          } else if (args.includes('setup')) {
            assert.equal(options.env.CAPRI_LLAMA_PATH, llama);
            assert.equal(
              json(path.join(target, '.runtime/installer/llama.json')).executableSha256,
              await fileHash(llama),
            );
            writeJsonAtomic(path.join(target, 'config/core.local.json'), {
              model: 'capri-qwen3.5:2b',
              resourceProfile: 'balanced',
            });
          } else if (args.includes('models')) {
            assert.deepEqual(args.slice(args.indexOf('models') + 1), ['--embedding-only']);
            assert.equal(options.env.CAPRI_LLAMA_PATH, llama);
            writeJsonAtomic(path.join(target, 'data/model-inventory.json'), {
              models: [{ name: json(path.join(target, 'config/core.json')).embeddingModel }],
            });
            embeddingPrepared = true;
          }
        },
      });
      assert.ok(postinstallPassed && downloaded);
      assert.equal(embeddingPrepared, true);
      assert.ok(electronBundleReady(path.join(target, 'node_modules/electron')));
      assert.equal(
        readFileSync(path.join(target, 'node_modules/electron/path.txt'), 'utf8'),
        'electron.exe',
      );
      const completed = events
        .filter((event) => event.type === 'stage-complete')
        .map((event) => event.step);
      assert.ok(completed.indexOf('dependencies') < completed.indexOf('ollama'));
      assert.ok(completed.indexOf('ollama') < completed.indexOf('configuration'));
      assert.equal(json(path.join(target, '.runtime/installer/state.json')).status, 'complete');
    } finally {
      if (inherited === undefined) delete process.env.CAPRI_LLAMA_PATH;
      else process.env.CAPRI_LLAMA_PATH = inherited;
    }
  },
);

test('upgrade applies the newly selected model before downloading it and preserves ports and context', async () => {
  await transactionFixture({ selectedProfile: 'quality' });
});

test('a native ONNX loader failure leaves an upgraded installation usable without the optional classifier', async () => {
  await transactionFixture({ routerNativeFailure: true });
});

test('interrupted upgrade model download restores the previously selected model', async () => {
  await transactionFixture({ selectedProfile: 'quality', cancelModels: true });
});

const englishSettings = {
  interface: 'en',
  conversation: 'en',
  customConversation: '',
  recognition: 'auto',
  speech: 'en',
  autoDetect: true,
};
const russianUpgrade = {
  previous: englishSettings,
  conversation: 'ru',
  expected: { ...englishSettings, interface: 'ru', conversation: 'ru', speech: 'follow' },
};

test('upgrade persists Russian conversation and interface selections while keeping automatic recognition', async () => {
  await transactionFixture({ languageUpgrade: russianUpgrade });
});

test('interrupted upgrade leaves the previous conversation and interface languages intact', async () => {
  await transactionFixture({ languageUpgrade: russianUpgrade, cancelModels: true });
});

test('an upgrade can retain a custom conversation language from the app', async () => {
  const previous = {
    ...englishSettings,
    conversation: 'custom',
    customConversation: 'Esperanto',
    speech: 'off',
  };
  await transactionFixture({
    languageUpgrade: {
      previous,
      conversation: 'custom',
      expected: { ...previous, interface: 'ru' },
    },
  });
});

test('installer accepts BETA model choices with finite disk estimates and enforces system RAM', () => {
  for (const id of ['gemma4-e2b', 'ministral-3-3b']) {
    const input = { ...request(folder()), profile: id, downloadModels: true };
    const context = { sourceRoot: root, version: '0.4.5', hardware, freeBytes: 100 * 2 ** 30 };
    const plan = validateRequest(input, context);
    const model = spec.profiles.find((row) => row.id === id);
    assert.equal(model.experimental, true);
    assert.ok(model.recommendedVramGiB > 0);
    assert.equal(plan.profile, id);
    assert.equal(plan.requiredBytes, estimateInstallStorage(input).requiredBytes);
    assert.throws(() => validateRequest(input, { ...context, freeBytes: 1 }), /space/);
    assert.throws(
      () =>
        validateRequest(input, { ...context, hardware: { ...hardware, ramBytes: 8 * 2 ** 30 } }),
      /RAM/,
    );
    assert.equal(
      validateRequest(input, { ...context, hardware: { ...hardware, gpus: [] } }).profile,
      id,
    );
  }
});

test('API selection ignores a local model profile and its RAM and disk requirements', () => {
  const input = { ...request(folder()), profile: 'quality', downloadModels: true };
  const context = {
    sourceRoot: root,
    version: '0.4.6',
    hardware: { ...hardware, ramBytes: 8 * 2 ** 30, gpus: [] },
    freeBytes: 8 * 2 ** 30,
  };
  assert.throws(() => validateRequest(input, context), /RAM/);
  const plan = validateRequest({ ...input, inferenceMode: 'api' }, context);
  assert.equal(plan.downloadModels, false);
  assert.equal(plan.profile, 'minimal');
  assert.throws(() => validateRequest({ ...input, inferenceMode: null }, context), /source/);
});

test('download totals sum selected components independently of the disk-space reserve', () => {
  const base = { inferenceMode: 'api', profile: 'quality', conversationLanguage: 'ru' };
  const text = estimateInstallStorage(base);
  assert.deepEqual(
    text,
    estimateInstallStorage({ ...base, profile: 'minimal', downloadModels: true }),
  );
  const asr = estimateInstallStorage({ ...base, recognition: true });
  const router = estimateInstallStorage({ ...base, router: false });
  const voice = estimateInstallStorage({ ...base, voicePack: true });
  const all = estimateInstallStorage({ ...base, recognition: true, router: true, voicePack: true });
  assert.ok(
    asr.downloadBytes >
      estimateInstallStorage({ ...base, recognition: true, conversationLanguage: 'en' })
        .downloadBytes,
  );
  assert.deepEqual(router, text);
  assert.ok(voice.downloadBytes > text.downloadBytes);
  assert.ok(all.downloadBytes < 14 * 2 ** 30);
  assert.ok(all.requiredBytes > all.downloadBytes);
  assert.equal(all.downloadBytes, asr.downloadBytes + voice.downloadBytes - text.downloadBytes);
});

test('deferred local storage includes the same mandatory memory embedding as API and Hugging Face', () => {
  const base = {
    inferenceMode: 'local',
    profile: 'balanced',
    conversationLanguage: 'en',
    downloadModels: false,
  };
  const deferred = estimateInstallStorage(base);
  assert.deepEqual(deferred, estimateInstallStorage({ ...base, inferenceMode: 'api' }));
  assert.deepEqual(deferred, estimateInstallStorage({ ...base, modelSource: 'huggingface' }));
  const full = estimateInstallStorage({ ...base, downloadModels: true });
  const profile = spec.profiles.find(({ id }) => id === base.profile);
  const textModelBytes = json(path.join(root, 'config/qwen-download-sizes.json')).models[
    profile.model
  ];
  assert.equal(full.downloadBytes - deferred.downloadBytes, textModelBytes);
  assert.equal(full.requiredBytes - deferred.requiredBytes, textModelBytes);
});

test('Hugging Face selection skips the stock model while retaining optional component budgets', () => {
  const input = {
    ...request(folder()),
    inferenceMode: 'local',
    modelSource: 'huggingface',
    profile: 'quality',
    downloadModels: true,
  };
  const context = {
    sourceRoot: root,
    version: '0.4.6',
    hardware: { ...hardware, ramBytes: 8 * 2 ** 30, gpus: [] },
    freeBytes: 8 * 2 ** 30,
  };
  const plan = validateRequest(input, context);
  assert.equal(plan.inferenceMode, 'local');
  assert.equal(plan.modelSource, 'huggingface');
  assert.equal(plan.modelSetupRequired, true);
  assert.equal(plan.downloadModels, false);
  assert.equal(plan.profile, 'minimal');
  assert.equal(plan.router, true);
  const qwen = validateRequest(
    { ...input, voiceMode: 'qwen' },
    { ...context, freeBytes: 32 * 2 ** 30 },
  );
  assert.equal(qwen.voiceMode, 'qwen');
  const russian = { ...input, voiceMode: 'qwen-ru', conversationLanguage: 'ru' };
  assert.equal(
    validateRequest(russian, { ...context, freeBytes: 32 * 2 ** 30 }).voiceMode,
    'qwen-ru',
  );
  assert.throws(
    () => validateRequest({ ...russian, conversationLanguage: 'en' }, context),
    /does not support/,
  );
  assert.ok(
    estimateInstallStorage(russian).downloadBytes >
      estimateInstallStorage({ ...russian, voiceMode: 'qwen' }).downloadBytes,
  );
  assert.throws(
    () => validateRequest({ ...input, voiceMode: 'qwen', conversationLanguage: 'tr' }, context),
    /does not support/,
  );
  const text = estimateInstallStorage(input);
  assert.deepEqual(text, estimateInstallStorage({ ...input, downloadModels: false }));
  assert.deepEqual(text, estimateInstallStorage({ ...input, inferenceMode: 'api' }));
  assert.ok(
    estimateInstallStorage({ ...input, recognition: true }).downloadBytes > text.downloadBytes,
  );
  assert.ok(
    estimateInstallStorage({ ...input, voicePack: true }).downloadBytes > text.downloadBytes,
  );
  assert.throws(
    () => validateRequest({ ...input, modelSource: 'remote-code' }, context),
    /catalog/,
  );
  assert.throws(() => validateRequest({ ...input, modelSource: null }, context), /catalog/);
});
