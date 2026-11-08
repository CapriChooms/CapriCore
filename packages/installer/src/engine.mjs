// SPDX-License-Identifier: GPL-3.0-only
import {
  mkdirSync,
  existsSync,
  readFileSync,
  copyFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sourceFiles } from './payload.mjs';
import { requireCapriAvatar } from '../../../apps/desktop/avatar-catalog.mjs';
import { readVoiceSelections } from '../../../apps/desktop/voice-catalog-service.mjs';
import voiceCatalog from '../../../config/tts-catalog.json' with { type: 'json' };
import { apiSettings } from '../../../apps/desktop/inference-api.mjs';
import { writeJsonAtomic } from '../../runtime/src/atomic-json.mjs';
import { probeHardware } from '../../runtime/src/hardware/probe.mjs';
import { fetchArtifact, fileHash } from './download.mjs';
import { runCommand } from './commands.mjs';
import { installNpmDependencies } from './npm-install.mjs';
import { replaceSourceFile } from './replace-source-file.mjs';
import {
  readJson,
  validateRequest,
  diskFree,
  assertDiskSpace,
  identityFile,
  planFingerprint,
  noLinks,
} from './policy.mjs';
import { nodeBootstrapBytes } from './storage-estimate.mjs';
import { validateVoicePack, importVoicePack, cacheBundledVoicePack } from './voice-pack.mjs';
import { prepareVoiceCatalog } from './voice-catalog-prepare.mjs';
import { findFreePort } from './ports.mjs';
import { installationLock } from './lock.mjs';
import { waitWhilePaused } from './pause.mjs';
import {
  inspectOllamaBundle,
  requireOllamaBundle,
  inspectOllamaRocmBundle,
  OLLAMA_ROCM_DIRECTORY,
} from '../../runtime/src/host/ollama-bundle.mjs';
import { needsOllamaRocm } from '../../runtime/src/hardware/llm-gpu.mjs';
import { electronBundleReady } from '../../runtime/src/host/electron-bundle.mjs';

export async function install(
  request,
  {
    sourceRoot,
    nodeExecutable,
    signal,
    pauseFile,
    emit = () => {},
    execute = runCommand,
    download = fetchArtifact,
    hardware: providedHardware,
    free = diskFree,
    register = true,
    renameRuntime = renameSync,
  } = {},
) {
  if (process.platform !== 'win32') throw new Error('The installer currently supports Windows x64');
  const version = readJson(path.join(sourceRoot, 'package.json')).version;
  const hardware = providedHardware ?? (await probeHardware());
  const plan = validateRequest(request, {
    sourceRoot,
    version,
    hardware,
  });
  const needsPython =
    plan.recognition || plan.router || plan.voicePack || plan.voiceMode === 'qwen';
  const needsVoice = plan.voicePack || plan.voiceMode === 'qwen';
  const needsRocm = needsOllamaRocm({ ...plan, gpus: hardware.gpus });
  const stages = [
    'node',
    'source',
    'dependencies',
    'ollama',
    'configuration',
    ...(needsPython ? ['python'] : []),
    ...(plan.recognition ? ['recognition'] : []),
    ...(plan.router ? ['router'] : []),
    ...(needsVoice ? ['voice-runtime', 'voice-pack'] : []),
    'models',
    'verify',
    ...(register ? ['shortcuts'] : []),
    'finalize',
  ];
  const manifest = readJson(path.join(sourceRoot, 'config/installer.json'));
  // Setup.exe already reserved this space and bootstrapped its owned Node before invoking us.
  const ownedNode = path.join(
    plan.target,
    '.runtime',
    manifest.artifacts.node.directory,
    'node.exe',
  );
  const bootstrapBytes =
    path.resolve(nodeExecutable).toLowerCase() === ownedNode.toLowerCase() ? nodeBootstrapBytes : 0;
  assertDiskSpace(plan.target, free(plan.target), plan.requiredBytes - bootstrapBytes);
  if (plan.voicePack)
    validateVoicePack(
      plan.voicePack,
      readJson(path.join(sourceRoot, 'config/voice-upstream.json')).model,
    );
  const includedReference = plan.bundledVoicePack || path.join(sourceRoot, '.bundled-voice');
  const hasIncludedReference = Boolean(plan.bundledVoicePack || existsSync(includedReference));
  if (
    hasIncludedReference &&
    validateVoicePack(
      includedReference,
      readJson(path.join(sourceRoot, 'config/voice-upstream.json')).model,
    ).profile.id !== 'capri-en-v1'
  )
    throw new Error('The included Capri voice reference is incompatible with this Setup.');
  const root = plan.target,
    cache = path.join(root, '.runtime/installer'),
    journalFile = path.join(cache, 'state.json');
  for (const name of [
    '.runtime/installer',
    '.runtime/tmp',
    'node_modules',
    'config',
    'logs',
    'data/models',
    'data/workspace',
    'data/openclaw',
    'data/desktop',
    'data/speech',
    'data/voices',
  ])
    noLinks(path.join(root, name));
  const inferenceFile = path.join(root, 'data/desktop/inference-api.json');
  for (const name of ['desktop', 'capri', 'ollama', 'companion-voice']) {
    const marker = path.join(root, 'data/run', name + '.json');
    if (!existsSync(marker)) continue;
    const saved = readJson(marker);
    if (Number.isInteger(saved.pid) && saved.pid > 0) {
      try {
        process.kill(saved.pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') continue;
        throw new Error('Unable to verify running installation; stop it before repair');
      }
      throw Object.assign(
        new Error(
          'Capri is still running from this installation folder. In Capri, choose Quit and unload models. Keep this Setup window open, then click Retry here. Your settings, history and downloaded models will be preserved.',
        ),
        { code: 'CAPRI_INSTALL_RUNNING' },
      );
    }
  }
  mkdirSync(cache, { recursive: true });
  const releaseLock = installationLock(cache);
  const identity = existsSync(identityFile(root))
    ? readJson(identityFile(root))
    : { schemaVersion: 1, productId: 'capri.desktop', installId: randomUUID(), root, version };
  writeJsonAtomic(identityFile(root), identity);
  const journal = {
    schemaVersion: 1,
    fingerprint: planFingerprint(plan, readFileSync(path.join(sourceRoot, 'package-lock.json'))),
    status: 'installing',
    steps: {},
    plan,
    updatedAt: new Date().toISOString(),
  };
  const save = () => {
    journal.updatedAt = new Date().toISOString();
    writeJsonAtomic(journalFile, journal);
  };
  save();
  const env = {
    ...process.env,
    ...(pauseFile ? { CAPRI_INSTALL_PAUSE_FILE: pauseFile } : {}),
    CAPRI_NODE_PATH: nodeExecutable,
    PATH: [
      path.dirname(nodeExecutable),
      path.join(root, '.runtime/uv'),
      path.join(root, '.runtime/git/cmd'),
      process.env.PATH ?? process.env.Path ?? '',
    ].join(path.delimiter),
    UV_PYTHON_INSTALL_DIR: path.join(root, '.runtime/python'),
    UV_PYTHON_BIN_DIR: path.join(root, '.runtime/python-bin'),
    UV_PYTHON_INSTALL_BIN: '0',
    UV_PYTHON_INSTALL_REGISTRY: '0',
    UV_PYTHON_NO_REGISTRY: '1',
    UV_NO_CONFIG: '1',
    UV_CACHE_DIR: path.join(root, '.runtime/uv-cache'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    npm_config_cache: path.join(root, '.runtime/npm-cache'),
    TEMP: path.join(root, '.runtime/tmp'),
    TMP: path.join(root, '.runtime/tmp'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  for (const inherited of [
    'OPENCLAW_STATE_DIR',
    'OPENCLAW_CONFIG_PATH',
    'OPENCLAW_HOME',
    'OPENCLAW_GATEWAY_TOKEN',
    'OPENCLAW_WORKSPACE_DIR',
    'CAPRI_PROJECT_ROOT',
    'CAPRI_OLLAMA_PATH',
    'CAPRI_DESKTOP_VERIFICATION_DIR',
    'NODE_OPTIONS',
    'NODE_PATH',
    'PYTHONPATH',
  ])
    delete env[inherited];
  mkdirSync(env.TEMP, { recursive: true });
  let currentStep = '';
  const activity = (action, component) =>
    emit({ type: 'activity', step: currentStep, action, component });
  // Multi-GB speech/model downloads can legitimately exceed one hour. Their
  // network clients still bound stalled connections; this is the total active
  // component budget, excluding user pauses. Local work keeps the shorter cap.
  const downloadSteps = new Set([
    'dependencies',
    'recognition',
    'router',
    'voice-runtime',
    'voice-pack',
    'models',
  ]);
  const command = async (file, args, options = {}) => {
    await waitWhilePaused(pauseFile, { signal, emit });
    return execute(file, args, {
      cwd: root,
      env,
      signal,
      timeoutMs: (downloadSteps.has(currentStep) ? 8 : 1) * 60 * 60 * 1000,
      output: (message) => {
        if (currentStep === 'voice-pack' && message.startsWith('{"stage"')) {
          try {
            const { stage, progress } = JSON.parse(message);
            if (
              ['models', 'ready'].includes(stage) &&
              Number.isFinite(progress) &&
              progress >= 0 &&
              progress <= 100
            ) {
              emit({ type: 'percent', step: currentStep, percent: progress });
              return;
            }
          } catch {
            // Keep ordinary output visible; only structured model updates change the bar.
          }
        }
        emit({ type: 'log', step: currentStep, message });
        const match = message.match(/\b(\d{1,3})%/);
        if (match && Number(match[1]) <= 100)
          emit({ type: 'percent', step: currentStep, percent: Number(match[1]), message });
      },
      ...options,
    });
  };
  const node = (file, args = []) => command(nodeExecutable, [path.join(root, file), ...args]);
  const ps = (file, args = []) =>
    command('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, file),
      ...args,
    ]);
  async function step(id, task) {
    signal?.throwIfAborted();
    await waitWhilePaused(pauseFile, { signal, emit });
    currentStep = id;
    journal.steps[id] = { status: 'running' };
    save();
    emit({ type: 'stage', step: id });
    try {
      await task();
      signal?.throwIfAborted();
      journal.steps[id] = { status: 'complete' };
      save();
      emit({ type: 'stage-complete', step: id });
    } catch (error) {
      journal.steps[id] = {
        status: signal?.aborted ? 'cancelled' : 'failed',
        message: error.message.slice(0, 2000),
      };
      save();
      throw error;
    }
  }
  async function runtime(name, executable, destinationOverride) {
    const stamp = path.join(cache, name + '.json'),
      spec = manifest.artifacts[name];
    const component = name === 'ollamaRocm' ? 'ollama' : name;
    const totalOllamaBytes =
      manifest.artifacts.ollama.bytes + (manifest.artifacts.ollamaRocm?.bytes ?? 0);
    const stageFraction = (received, total) => {
      const partial =
        Number.isFinite(received) && Number.isFinite(total) && total > 0
          ? Math.max(0, Math.min(1, received / total))
          : 0;
      return name === 'ollamaRocm'
        ? (manifest.artifacts.ollama.bytes + partial * spec.bytes) / totalOllamaBytes
        : (partial * spec.bytes) / totalOllamaBytes;
    };
    activity('checkRuntime', component);
    let receipt = null;
    try {
      if (existsSync(stamp)) receipt = readJson(stamp, name === 'ollamaRocm' ? 1024 ** 2 : 65536);
    } catch {
      /* A damaged installation receipt is repaired from the pinned archive. */
    }
    let backendReady = true;
    if (name === 'ollamaRocm') {
      const backend = inspectOllamaRocmBundle(executable);
      const hashes = receipt?.backendHashes;
      backendReady =
        backend.ready &&
        hashes &&
        Object.keys(hashes).length === backend.files.length &&
        backend.files.every((file) => /^[a-f0-9]{64}$/.test(hashes[file] ?? ''));
      if (backendReady) {
        // All kernel/data files matter, not just ggml-hip.dll. Streaming hashes
        // are bounded and run only during Setup verification/repair.
        for (const file of backend.files) {
          signal?.throwIfAborted();
          if ((await fileHash(path.join(backend.folder, file))) !== hashes[file]) {
            backendReady = false;
            break;
          }
        }
      }
    }
    if (
      receipt?.sha256 === spec.sha256 &&
      existsSync(executable) &&
      backendReady &&
      (name !== 'ollama' || inspectOllamaBundle(executable, { bundled: true }).ready) &&
      (name !== 'electron' ||
        electronBundleReady(path.dirname(path.dirname(executable)), spec.version)) &&
      receipt.executableSha256 === (await fileHash(executable))
    ) {
      emit({
        type: 'log',
        step: currentStep,
        message: 'Verified installation receipt found for ' + name,
      });
      if (needsRocm && ['ollama', 'ollamaRocm'].includes(name))
        emit({
          type: 'fraction',
          step: currentStep,
          fraction: stageFraction(spec.bytes, spec.bytes),
        });
      return;
    }
    activity('fetchRuntime', component);
    let sourceHost = new URL(spec.url).hostname;
    let archive;
    try {
      archive = await download(spec, path.join(cache, 'downloads'), {
        signal,
        pauseFile,
        onSource: ({ host, index }) => {
          sourceHost = host;
          emit({
            type: 'log',
            step: currentStep,
            message: `${name} ${spec.version}: ${index ? 'Trying download mirror' : 'Connecting to download source'} (${host}).`,
          });
        },
        progress: (value) =>
          emit({
            type: 'download',
            step: currentStep,
            ...value,
            ...(needsRocm && ['ollama', 'ollamaRocm'].includes(name)
              ? { stageFraction: stageFraction(value.received, value.total) }
              : {}),
          }),
      });
    } catch (error) {
      signal?.throwIfAborted();
      const failure = new Error(`${name} ${spec.version}: ${error.message} (${sourceHost}).`, {
        cause: error,
      });
      if (typeof error.code === 'string') failure.code = error.code;
      throw failure;
    }
    const stagedRocm =
      name === 'ollamaRocm' ? path.join(cache, 'staging', 'ollama-rocm-' + randomUUID()) : null;
    const destination =
      stagedRocm ?? destinationOverride ?? path.join(root, '.runtime', spec.directory);
    noLinks(destination);
    if (stagedRocm && existsSync(stagedRocm))
      throw new Error('AMD runtime staging folder is occupied.');
    activity('extractRuntime', component);
    try {
      await ps('packages/installer/windows/archive.ps1', [
        '-Archive',
        archive,
        '-Destination',
        destination,
      ]);
      activity('verifyRuntime', component);
      if (!existsSync(executable)) throw new Error(name + ' executable was not installed');
      if (name === 'ollama') requireOllamaBundle(executable, { bundled: true });
      let backendHashes;
      if (name === 'ollamaRocm') {
        const backend = inspectOllamaRocmBundle(path.join(stagedRocm, 'ollama.exe'));
        if (!backend.ready)
          throw new Error('The AMD LLM runtime is incomplete. Retry Setup to repair its download.');
        backendHashes = {};
        for (const file of backend.files) {
          signal?.throwIfAborted();
          backendHashes[file] = await fileHash(path.join(backend.folder, file));
        }
        const live = path.join(path.dirname(executable), 'lib/ollama', OLLAMA_ROCM_DIRECTORY);
        const backup = path.join(cache, 'backups', 'ollama-rocm-' + randomUUID());
        const withinInstall = (file) =>
          path
            .resolve(file)
            .toLowerCase()
            .startsWith(path.resolve(root).toLowerCase() + path.sep);
        if (![backend.folder, live, backup].every(withinInstall))
          throw new Error('AMD runtime paths leave the installation.');
        for (const file of [backend.folder, live, backup]) noLinks(file);
        const replacing = existsSync(live);
        if (replacing && !inspectOllamaRocmBundle(executable, { requireFiles: false }).ready)
          throw new Error(
            'The AMD runtime contains filesystem links. Its existing files were preserved.',
          );
        mkdirSync(path.dirname(live), { recursive: true });
        mkdirSync(path.dirname(backup), { recursive: true });
        if (replacing) renameRuntime(live, backup);
        try {
          renameRuntime(backend.folder, live);
        } catch (error) {
          if (replacing && !existsSync(live)) renameRuntime(backup, live);
          throw error;
        }
      }
      if (name === 'electron' && !electronBundleReady(path.dirname(destination), spec.version))
        throw new Error('The desktop runtime is incomplete. Retry Setup to repair its download.');
      writeJsonAtomic(stamp, {
        sha256: spec.sha256,
        version: spec.version,
        executableSha256: await fileHash(executable),
        ...(backendHashes ? { backendHashes } : {}),
      });
    } finally {
      // This nonce directory was created by this archive extraction only. Its
      // validated absolute target stays inside our staging root; models and
      // previous backends are outside it. Node removes links without following.
      if (stagedRocm && existsSync(stagedRocm)) {
        const stagingRoot = path.resolve(cache, 'staging') + path.sep;
        if (!path.resolve(stagedRocm).startsWith(stagingRoot))
          throw new Error('Invalid AMD staging cleanup target.');
        noLinks(stagedRocm);
        rmSync(stagedRocm, { recursive: true, force: false });
      }
    }
  }
  try {
    let savedInference;
    if (request.inferenceMode !== undefined) {
      noLinks(inferenceFile);
      if (existsSync(inferenceFile)) {
        try {
          savedInference = apiSettings(readJson(inferenceFile, 8192));
        } catch {
          if (plan.inferenceMode === 'api')
            throw new Error(
              'Existing API settings are unreadable. Repair them in Capri before selecting API mode.',
            );
        }
      }
    }
    emit({ type: 'stage-plan', stages });
    await step('source', async () => {
      activity('checkSource');
      requireCapriAvatar(sourceRoot, { source: true });
      const files = sourceFiles(sourceRoot).map((name) => {
        const file = path.join(sourceRoot, name),
          info = statSync(file);
        if (!info.isFile() || info.size > 20 * 1024 ** 2)
          throw new Error('Invalid source payload file: ' + name);
        return {
          path: name,
          bytes: info.size,
          sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        };
      });
      if (existsSync(path.join(sourceRoot, 'SOURCE_MANIFEST.json'))) {
        const pinned = readJson(path.join(sourceRoot, 'SOURCE_MANIFEST.json'), 2 * 1024 ** 2).files;
        const expected = new Map(pinned.map((item) => [item.path, item.sha256]));
        if (expected.size !== files.length)
          throw new Error('Source payload file list differs from its manifest');
        for (const file of files)
          if (expected.get(file.path) !== file.sha256)
            throw new Error('Source payload checksum mismatch: ' + file.path);
      }
      activity('copySource');
      let processed = 0;
      for (const file of files) {
        signal?.throwIfAborted();
        if (processed % 100 === 0)
          emit({ type: 'fraction', step: currentStep, fraction: processed / files.length });
        processed++;
        const target = path.join(root, file.path);
        noLinks(target);
        mkdirSync(path.dirname(target), { recursive: true });
        if (existsSync(target)) {
          if (
            [
              'config/companion-voice.json',
              'config/companion-asr.json',
              'config/voice-training.json',
              'config/request-router.json',
            ].includes(file.path)
          )
            continue;
          const old = createHash('sha256').update(readFileSync(target)).digest('hex');
          if (old === file.sha256) continue;
          const backup = path.join(cache, 'backups', Date.now().toString(), file.path);
          mkdirSync(path.dirname(backup), { recursive: true });
          copyFileSync(target, backup);
        }
        await replaceSourceFile(path.join(sourceRoot, file.path), target, { root, signal });
      }
      writeJsonAtomic(path.join(cache, 'source-files.json'), { files });
      requireCapriAvatar(root);
      // Retain the small included profile even in text mode, so adding speech
      // later never asks the user to find a ZIP or authenticate to GitHub.
      if (hasIncludedReference)
        cacheBundledVoicePack(
          includedReference,
          root,
          readJson(path.join(root, 'config/voice-upstream.json')).model,
        );
    });
    await step('dependencies', async () => {
      activity('installDependencies');
      await installNpmDependencies({
        nodeExecutable,
        command,
        signal,
        root,
        pauseFile,
        progress: (value) => emit({ type: 'download', step: currentStep, ...value }),
        onRecovery: (message) => emit({ type: 'log', step: currentStep, message }),
        onRetry: ({ attempt, attempts, delayMs, code }) =>
          emit({
            type: 'log',
            step: currentStep,
            message: `npm connection interrupted (${code}). Retrying dependencies ${attempt}/${attempts} in ${delayMs / 1000}s; verified cached packages will be reused.`,
          }),
      });
      // Electron 45 no longer downloads its executable during npm ci. Do it
      // inside Setup, with the same pinned checksums, progress, pause and resume.
      const electronPackage = path.join(root, 'node_modules/electron');
      if (
        readJson(path.join(electronPackage, 'package.json')).version !==
        manifest.artifacts.electron.version
      )
        throw new Error('The desktop runtime version differs from the pinned installer manifest.');
      await runtime(
        'electron',
        path.join(electronPackage, 'dist/electron.exe'),
        path.join(electronPackage, 'dist'),
      );
      noLinks(path.join(electronPackage, 'path.txt'));
      writeFileSync(path.join(electronPackage, 'path.txt'), 'electron.exe');
    });
    const ollamaExecutable = path.join(root, '.runtime/ollama/ollama.exe');
    await step('ollama', async () => {
      await runtime('ollama', ollamaExecutable);
      if (needsRocm) await runtime('ollamaRocm', ollamaExecutable);
    });
    // Explicit paths are strict at runtime. Publish this override only after
    // the owned Ollama binary and its installation receipt have been verified.
    env.CAPRI_OLLAMA_PATH = ollamaExecutable;
    await step('configuration', async () => {
      if (!existsSync(path.join(root, 'config/core.local.json'))) {
        const reserved = new Set(),
          base = readJson(path.join(root, 'config/core.json'));
        writeJsonAtomic(path.join(root, 'config/core.local.json'), {
          gatewayPort: await findFreePort(base.gatewayPort, reserved),
          ollamaPort: await findFreePort(base.ollamaPort, reserved),
        });
        await node('packages/runtime/bin/capri.mjs', [
          'setup',
          '--profile=' + plan.profile,
          '--yes',
          '--replace',
        ]);
        const voice = readJson(path.join(root, 'config/companion-voice.json'));
        voice.port = await findFreePort(voice.port, reserved);
        writeJsonAtomic(path.join(root, 'config/companion-voice.json'), voice);
      }
      const languageFile = path.join(root, 'data/desktop/languages.json');
      if (!existsSync(languageFile))
        writeJsonAtomic(languageFile, { schemaVersion: 1, settings: plan.languages });
      const router = readJson(path.join(root, 'config/request-router.json'));
      router.enabled = plan.router;
      writeJsonAtomic(path.join(root, 'config/request-router.json'), router);
    });
    if (needsPython)
      await step('python', () => runtime('uv', path.join(root, '.runtime/uv/uv.exe')));
    if (plan.recognition)
      await step('recognition', () =>
        ps(
          'tools/setup/' +
            (plan.languages.conversation === 'en'
              ? 'setup-streaming-asr.ps1'
              : 'setup-multilingual-asr.ps1'),
        ),
      );
    if (plan.router) await step('router', () => ps('tools/setup/setup-request-router.ps1'));
    if (plan.voiceMode === 'qwen') {
      await step('voice-runtime', async () => {
        if (plan.voicePack) {
          const relative = importVoicePack(
            plan.voicePack,
            root,
            readJson(path.join(root, 'config/voice-upstream.json')).model,
          );
          const config = readJson(path.join(root, 'config/companion-voice.json'));
          writeJsonAtomic(path.join(root, 'config/companion-voice.json'), {
            ...config,
            profileDir: relative,
          });
        }
        await prepareVoiceCatalog({ root, env, signal, download, execute });
        await ps('tools/setup/setup-qwen-tts.ps1', ['-DependenciesOnly']);
      });
      await step('voice-pack', () =>
        command(
          path.join(root, '.runtime/qwen-tts-venv/Scripts/python.exe'),
          ['-m', 'integrations.voice_runtime.qwen_provision'],
          { timeoutMs: 8 * 60 * 60 * 1000 },
        ),
      );
    } else if (plan.voicePack) {
      await step('voice-runtime', async () => {
        await runtime('git', path.join(root, '.runtime/git/cmd/git.exe'));
        await ps(
          'tools/setup/setup-voice-training.ps1',
          plan.languages.conversation === 'en' ? [] : ['-DependenciesOnly'],
        );
      });
      await step('voice-pack', async () => {
        const relative = importVoicePack(
          plan.voicePack,
          root,
          readJson(path.join(root, 'config/voice-upstream.json')).model,
        );
        const config = readJson(path.join(root, 'config/companion-voice.json'));
        config.profileDir = relative;
        writeJsonAtomic(path.join(root, 'config/companion-voice.json'), config);
        if (plan.languages.conversation !== 'en')
          await ps('tools/setup/setup-multilingual-voice.ps1', [
            '-Language',
            plan.languages.conversation,
          ]);
      });
    }
    // Memory retrieval always needs its small local embedding model, even when
    // the user defers the text model or chooses an external provider.
    await step('models', () =>
      node('packages/runtime/bin/capri.mjs', [
        'models',
        ...(!plan.downloadModels ? ['--embedding-only'] : []),
      ]),
    );
    await step('verify', async () => {
      requireCapriAvatar(root);
      await node('packages/runtime/bin/capri.mjs', ['doctor']);
      for (const name of ['electron', 'openclaw'])
        if (!existsSync(path.join(root, 'node_modules', name, 'package.json')))
          throw new Error('Missing installed dependency: ' + name);
      if (
        !electronBundleReady(
          path.join(root, 'node_modules/electron'),
          manifest.artifacts.electron.version,
        )
      )
        throw new Error('The desktop runtime is incomplete. Retry Setup to repair its download.');
      {
        const models =
          readJson(path.join(root, 'data/model-inventory.json'), 2 * 1024 ** 2).models ?? [];
        const local = readJson(path.join(root, 'config/core.local.json')),
          base = readJson(path.join(root, 'config/core.json'));
        for (const model of [
          ...(plan.downloadModels ? [local.model ?? base.model] : []),
          local.embeddingModel ?? base.embeddingModel,
        ])
          if (!models.some((item) => item.name === model))
            throw new Error('A required model is not ready: ' + model);
      }
    });
    identity.version = version;
    if (existsSync(path.join(sourceRoot, 'config/release.json')))
      identity.releaseTag = readJson(path.join(sourceRoot, 'config/release.json')).tag;
    writeJsonAtomic(identityFile(root), identity);
    if (register)
      await step('shortcuts', () =>
        ps('packages/installer/windows/register.ps1', [
          '-InstallRoot',
          root,
          ...(plan.desktopShortcut ? ['-DesktopShortcut'] : []),
          ...(plan.startMenuShortcut ? ['-StartMenuShortcut'] : []),
        ]),
      );
    await step('finalize', async () => {
      if (needsVoice) {
        const language = plan.languages.conversation;
        const selections = readVoiceSelections(root, voiceCatalog.models);
        const languageFile = path.join(root, 'data/desktop/languages.json');
        noLinks(languageFile);
        const languages = readJson(languageFile);
        if (plan.voiceMode === 'qwen') selections[language] = 'qwen3-tts-0.6b-base';
        else delete selections[language]; // Use the bundled Chatterbox default for this language.
        writeJsonAtomic(path.join(root, 'data/speech/voice-selections.json'), {
          schemaVersion: 1,
          languages: selections,
        });
        languages.settings.speech = 'follow';
        writeJsonAtomic(languageFile, languages);
      }
      // A completed full repair supersedes an interrupted source-only update.
      const pendingUpdate = path.join(root, '.runtime/updates/active.json');
      noLinks(pendingUpdate);
      if (existsSync(pendingUpdate)) {
        const pending = readJson(pendingUpdate);
        if (pending.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(pending.id ?? ''))
          throw new Error('Invalid interrupted update receipt');
        unlinkSync(pendingUpdate);
      }
      // Stage first-run setup only after the installation is verified. Selecting
      // API here never collects a key or grants permission to send data.
      if (request.inferenceMode !== undefined) {
        noLinks(inferenceFile);
        if (plan.inferenceMode === 'api' && !savedInference?.enabled)
          writeJsonAtomic(inferenceFile, { ...savedInference, setupRequired: true });
        else if (
          plan.inferenceMode === 'local' &&
          (savedInference?.enabled || savedInference?.setupRequired)
        )
          writeJsonAtomic(inferenceFile, {
            ...savedInference,
            enabled: false,
            setupRequired: false,
          });
      }
      if (request.modelSource !== undefined) {
        const localFile = path.join(root, 'config/core.local.json');
        noLinks(localFile);
        const local = readJson(localFile);
        writeJsonAtomic(localFile, { ...local, modelSetupRequired: plan.modelSetupRequired });
      }
    });
    journal.status = 'complete';
    save();
    emit({
      type: 'complete',
      target: root,
      modelsReady: plan.downloadModels,
      inferenceMode: plan.inferenceMode,
      modelSource: plan.modelSource,
      modelSetupRequired: plan.modelSetupRequired,
      voiceInstalled: Boolean(needsVoice),
    });
    return { target: root, modelsReady: plan.downloadModels };
  } catch (error) {
    journal.status = signal?.aborted ? 'cancelled' : 'failed';
    save();
    emit({ type: journal.status, step: currentStep, message: error.message.slice(0, 2500) });
    throw error;
  } finally {
    if (existsSync(path.join(root, 'packages/runtime/bin/core.mjs')))
      await command(nodeExecutable, [path.join(root, 'packages/runtime/bin/core.mjs'), 'stop'], {
        signal: undefined,
        timeoutMs: 120000,
      }).catch(() => {});
    releaseLock();
  }
}
