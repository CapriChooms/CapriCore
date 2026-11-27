import { voiceRuntimeEnvironment } from '../../../integrations/voice_runtime/environment.mjs';
// SPDX-License-Identifier: GPL-3.0-only
import { open, realpath, lstat, readdir, stat, statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { probeHardware } from '../../../packages/runtime/src/hardware/probe.mjs';
import { redactor } from './redact.mjs';
import { diagnosticZip } from './archive.mjs';
import { ACTIVE_AVATAR_CATALOG } from '../avatar-catalog.mjs';
import { loadBreezeProfile } from '../breeze-voice.mjs';
import {
  selectedVoiceModel,
  voiceDataPath,
  voiceRuntime,
  voiceRuntimeKind,
} from '../voice-catalog-service.mjs';
import { diagnosticState, isDiagnosticControlValue } from './state.mjs';
import { diagnosticModelId } from '../../../packages/runtime/src/privacy-log.mjs';
import { readModelDevices } from '../../../packages/runtime/src/model-device-settings.mjs';
import { installedBreezeTts } from '../../../packages/installer/src/breeze-tts-install.mjs';

const run = promisify(execFile),
  KB = 1024;
const categories = ['voice', 'recognition', 'model', 'startup', 'interface', 'installer', 'other'];
const chessLogs = new Set(['chess.jsonl', 'chess.jsonl.1']);
export function validateReport(input) {
  if (typeof input === 'string') input = { description: input };
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid bug report');
  const limits = { title: 160, description: 4000, steps: 3000, expected: 1500, actual: 1500 };
  if (
    Object.keys(input).some(
      (key) => ![...Object.keys(limits), 'category', 'includeLogs'].includes(key),
    )
  )
    throw new Error('Unknown report field');
  const result = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > limit))
      throw new Error(`Invalid report ${key}`);
    result[key] = (input[key] ?? '').trim();
  }
  result.category = input.category ?? 'other';
  if (
    !categories.includes(result.category) ||
    (input.includeLogs !== undefined && typeof input.includeLogs !== 'boolean')
  )
    throw new Error('Invalid report options');
  result.includeLogs = input.includeLogs !== false;
  return result;
}

/** Fixed-source, bounded reader. A linked file/directory cannot add arbitrary files. */
async function tail(base, relative, limit = 256 * KB, binary = false) {
  const file = path.resolve(base, relative),
    boundary = path.resolve(base);
  if (!file.startsWith(boundary + path.sep)) throw new Error('Diagnostic path escaped its source');
  const [info, actual, parent] = await Promise.all([
    lstat(file),
    realpath(file),
    realpath(boundary),
  ]);
  const normalized = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  if (
    normalized(parent) !== normalized(boundary) ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    !normalized(actual).startsWith(normalized(parent + path.sep))
  )
    throw new Error('Linked or invalid diagnostic source');
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size,
      bytes = Buffer.alloc(Math.min(size, limit));
    const { bytesRead } = await handle.read(
      bytes,
      0,
      bytes.length,
      Math.max(0, size - bytes.length),
    );
    return {
      text: binary ? undefined : bytes.subarray(0, bytesRead).toString('utf8'),
      buffer: binary ? bytes.subarray(0, bytesRead) : undefined,
      sourceBytes: size,
      capturedBytes: bytesRead,
      truncated: size > limit,
    };
  } finally {
    await handle.close();
  }
}
async function json(base, relative) {
  const item = await tail(base, relative, 512 * KB);
  if (item.truncated) throw new Error('Diagnostic metadata exceeds the size limit');
  try {
    return JSON.parse(item.text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Invalid JSON metadata: ' + relative);
  }
}
const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]),
  );
const failure = (error) => ({
  available: false,
  code: error.code ?? error.name,
  error: error.message,
});

const chatterboxPython = '.runtime/voice-training-venv/Scripts/python.exe';
const chatterboxEngines = new Set(['turbo', 'multilingual-v3', 'tts-pt-br']);
const localVoiceEngines = new Set([
  ...chatterboxEngines,
  'breeze-tts',
  'qwen3-tts',
  'qwen3-tts-ru-lora',
]);

function reportVoiceSelection(root, snapshot, config, health) {
  const language = snapshot.voice?.configuredLanguage ?? snapshot.voice?.language;
  if (language === 'off') return { engine: 'off' };
  if (snapshot.voiceApi?.enabled === true || snapshot.voice?.source === 'api')
    return { engine: 'external-api' };

  const active = health?.activeEngine;
  // A prepared process can lag behind the per-language preference after a model switch.
  if (language && (snapshot.voice?.configuredLanguage || !localVoiceEngines.has(active))) {
    try {
      const model = selectedVoiceModel(root, language);
      const engine = voiceRuntimeKind(model);
      if (localVoiceEngines.has(engine)) return { engine, model };
    } catch {
      // The report can still include the observed engine if its selection is unreadable.
    }
  }
  if (localVoiceEngines.has(active)) return { engine: active };
  return { engine: config.engine === 'chatterbox-turbo' ? 'turbo' : 'unknown' };
}

export async function probeVoiceEnvironment(root, { runtime, checkChatterbox = true } = {}) {
  try {
    const executable = voiceDataPath(
      root,
      runtime ? path.relative(root, runtime.python) : chatterboxPython,
    );
    if (!(await lstat(executable)).isFile())
      return { available: false, error: 'Voice Python is missing' };
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/(?:TOKEN|SECRET|PASSWORD|API_KEY)/i.test(key),
      ),
    );
    const { stdout, stderr } = await run(
      executable,
      [
        '-I',
        voiceDataPath(root, 'tools/diagnostics/voice-environment.py'),
        ...(checkChatterbox ? [] : ['--no-chatterbox']),
      ],
      {
        cwd: root,
        env: { ...env, ...(runtime?.env ?? voiceRuntimeEnvironment(root)), PYTHONUTF8: '1' },
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 512 * KB,
      },
    );
    return {
      available: true,
      stderr: stderr.slice(-8000),
      ...JSON.parse(stdout.trim().split(/\r?\n/).at(-1)),
    };
  } catch (error) {
    return failure(error);
  }
}

/** Only called by the explicit Save report action. Nothing is uploaded. */
export async function createDiagnosticReport({
  root,
  state,
  rt,
  input,
  snapshot = {},
  versions = process.versions,
  hardware = probeHardware,
  pythonProbe = probeVoiceEnvironment,
  installerDirectory = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Capri/Installer')
    : null,
  health = async () => ({ available: false, error: 'Health check not provided' }),
  resourceProbe = async () => ({ available: false }),
}) {
  snapshot = diagnosticState(snapshot);
  const problem = validateReport(input),
    id = randomUUID(),
    createdAt = new Date().toISOString();
  const secrets = Object.entries(process.env)
    .filter(([key]) => /(?:TOKEN|SECRET|PASSWORD|API_KEY)/i.test(key))
    .map(([, value]) => value);
  for (const relative of ['data/speech/companion-voice-token', 'data/openclaw/gateway-token']) {
    try {
      secrets.push((await tail(root, relative, 4096)).text.trim());
    } catch {
      /* May not exist before first startup. */
    }
  }
  const clean = redactor({ root, home: os.homedir(), secrets }),
    files = [],
    inventory = [],
    warnings = [];
  const add = (name, value) =>
    files.push({
      name,
      bytes: Buffer.from(
        typeof value === 'string' ? clean.text(value) : JSON.stringify(clean.value(value), null, 2),
        'utf8',
      ),
    });
  const meta = async (name) => {
    try {
      return await json(root, name);
    } catch (e) {
      return failure(e);
    }
  };
  const [pkg, release, voiceConfig, hardwareInfo, healthInfo, resources] = await Promise.all([
    meta('package.json'),
    meta('config/release.json'),
    meta('config/companion-voice.json'),
    Promise.resolve().then(hardware).catch(failure),
    Promise.resolve().then(health).catch(failure),
    Promise.resolve()
      .then(resourceProbe)
      .catch(() => ({ available: false })),
  ]);
  const { engine, model } = reportVoiceSelection(root, snapshot, voiceConfig, healthInfo);
  const turbo = engine === 'turbo';
  const usesChatterbox = chatterboxEngines.has(engine);
  const breeze =
    engine === 'breeze-tts'
      ? {
          runtimeInstalled: Boolean(installedBreezeTts(root)),
          profileValid: Boolean(loadBreezeProfile(root)),
        }
      : null;
  const pythonCheck = Promise.resolve()
    .then(() => {
      if (usesChatterbox) return pythonProbe(root);
      if (model?.backend === 'qwen3-tts') {
        const runtime = voiceRuntime(root, model, readModelDevices(root).voice);
        return pythonProbe(root, { runtime, checkChatterbox: false });
      }
      return null;
    })
    .catch(failure);
  const fileInfo = async (relative) => {
    try {
      if (typeof relative !== 'string' || path.isAbsolute(relative))
        throw new Error('Invalid model path');
      const full = path.resolve(root, relative);
      if (!full.startsWith(root + path.sep)) throw new Error('Model path escaped installation');
      const actual = await realpath(full);
      if (!actual.startsWith((await realpath(root)) + path.sep))
        throw new Error('Linked model source');
      const info = await lstat(full);
      return { file: relative, exists: info.isFile(), bytes: info.size };
    } catch (e) {
      return { file: relative, exists: false, code: e.code ?? e.name };
    }
  };
  const avatarManifest = await meta(ACTIVE_AVATAR_CATALOG);
  const avatarFiles = await Promise.all(
    [
      ACTIVE_AVATAR_CATALOG,
      ...(Array.isArray(avatarManifest.sprites) && avatarManifest.sprites.length <= 128
        ? avatarManifest.sprites
            .filter((sprite) => /^[a-z0-9_-]+\.png$/i.test(sprite?.file))
            .map((sprite) =>
              path.posix.join(path.posix.dirname(ACTIVE_AVATAR_CATALOG), sprite.file),
            )
        : []),
    ].map(fileInfo),
  );
  const artwork = {
    runtime: snapshot.artwork ?? null,
    expectedManifest: ACTIVE_AVATAR_CATALOG,
    manifest: pick(avatarManifest, ['schemaVersion', 'canvas', 'defaultSprite']),
    ...(avatarManifest.available === false ? { failure: avatarManifest } : {}),
    files: avatarFiles,
  };
  let profile = null;
  if (turbo && typeof voiceConfig.profileDir === 'string') {
    try {
      profile = await json(root, path.join(voiceConfig.profileDir, 'voice-profile.json'));
    } catch (e) {
      warnings.push('Voice profile: ' + e.message);
    }
  }
  let voicePaths = usesChatterbox ? [chatterboxPython] : [];
  if (turbo) {
    const [training, upstream] = await Promise.all([
      meta('config/voice-training.json'),
      meta('config/voice-upstream.json'),
    ]);
    if (typeof voiceConfig.profileDir === 'string') {
      const references = Object.values(profile?.references ?? {})
        .map((reference) => reference?.file)
        .filter((file) => typeof file === 'string');
      voicePaths = voicePaths.concat(
        ['voice-profile.json', 'adapter.json', 'adapter.safetensors', ...references].map((file) =>
          path.join(voiceConfig.profileDir, file),
        ),
      );
    }
    if (typeof training.modelDir === 'string' && Array.isArray(upstream.model?.files)) {
      voicePaths = voicePaths.concat(
        [
          ...upstream.model.files.filter((file) => typeof file === 'string'),
          'model-receipt.json',
        ].map((file) => path.join(training.modelDir, file)),
      );
    }
  }
  const voiceFiles = await Promise.all(voicePaths.slice(0, 40).map(fileInfo));
  let adapterChecksum = 'not checked';
  if (turbo && typeof voiceConfig.profileDir === 'string') {
    try {
      const name = path.join(voiceConfig.profileDir, 'adapter.safetensors'),
        info = voiceFiles.find((f) => f.file === name);
      if (info?.exists && info.bytes <= 32 * 1024 ** 2) {
        const data = await tail(root, name, 32 * 1024 ** 2, true);
        const digest = createHash('sha256').update(data.buffer).digest('hex');
        adapterChecksum = digest === profile?.adapterSha256 ? 'matches profile' : 'MISMATCH';
      }
    } catch {
      adapterChecksum = 'not checked';
    }
  }
  const installation = await meta('.capri-install.json'),
    journal = await meta('.runtime/installer/state.json');
  const processInfo = {};
  for (const name of [
    'desktop',
    'capri',
    'llama',
    'llama-chat',
    'llama-embedding',
    'companion-voice',
  ]) {
    try {
      const marker = await json(root, `data/run/${name}.json`);
      if (path.resolve(marker.projectRoot ?? '') !== root) {
        processInfo[name] = { owned: false };
        continue;
      }
      let pidSeen = false;
      if (Number.isInteger(marker.pid) && marker.pid > 0)
        try {
          process.kill(marker.pid, 0);
          pidSeen = true;
        } catch {
          /* Exited process. */
        }
      processInfo[name] = {
        pid: marker.pid,
        pidSeen,
        savedCreationTime: marker.startedAt,
        ownership: 'installation marker; PID existence does not verify creation time',
      };
    } catch {
      processInfo[name] = { marker: 'missing or unreadable' };
    }
  }
  let disk;
  try {
    const fs = await statfs(root);
    disk = { availableBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize };
  } catch (e) {
    disk = failure(e);
  }
  const system = {
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model ?? 'Unknown',
    cpuThreads: os.availableParallelism(),
    ramBytes: os.totalmem(),
    availableRamBytes: os.freemem(),
    ...hardwareInfo,
    osVersion: os.version(),
    runtimeArchitecture: process.arch,
    node: versions.node,
    electron: versions.electron,
    chromium: versions.chrome,
    disk,
    installationPath: {
      hasSpaces: /\s/.test(root),
      hasNonAscii: /[^\x00-\x7f]/.test(root),
      length: root.length,
    },
  };
  const python = await pythonCheck;
  const voice = {
    config: {
      engine: turbo ? 'chatterbox-turbo' : engine,
      ...pick(turbo ? voiceConfig : null, [
        'enabled',
        'port',
        'precision',
        'decoderDevice',
        'mergeAdapter',
        'cudaGraph',
        'cpuThreads',
      ]),
    },
    profile: pick(profile, ['engine', 'language']),
    files: voiceFiles.map((item, index) => ({
      ...item,
      file: item.file === chatterboxPython ? item.file : `voice-component-${index}`,
    })),
    adapterChecksum,
    python,
    ...(breeze ? { breeze } : {}),
    health: diagnosticState(healthInfo),
  };
  if (problem.includeLogs) {
    const collect = async (base, label, maximum, eligible = () => true) => {
      try {
        const actual = await realpath(base);
        if (
          (process.platform === 'win32' ? actual.toLowerCase() : actual) !==
          (process.platform === 'win32' ? path.resolve(base).toLowerCase() : path.resolve(base))
        )
          throw new Error('Linked diagnostic directory');
        const list = await readdir(base, { withFileTypes: true }),
          candidates = [];
        for (const item of list)
          if (
            item.isFile() &&
            (/\.(?:log|jsonl|txt)$/.test(item.name) ||
              (label === 'runtime' && chessLogs.has(item.name))) &&
            (/^llama-chat\.(stdout|stderr)\.log$/.test(item.name) ||
              !/history|transcript|memory|prompt|screenshot|recording|token|secret|verification|dataset|audition|chat|dialog/i.test(
                item.name,
              )) &&
            eligible(item.name)
          ) {
            const info = await stat(path.join(base, item.name));
            candidates.push({
              name: item.name,
              modified: info.mtimeMs,
              pinned: label === 'runtime' && chessLogs.has(item.name),
            });
          }
        candidates.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modified - a.modified);
        for (const item of candidates.slice(0, maximum)) {
          try {
            const data = await tail(base, item.name),
              name = item.pinned
                ? `logs/${item.name}`
                : `logs/${label}-${inventory.length + 1}-${item.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
            files.push({ name, bytes: Buffer.from(clean.log(data.text)) });
            inventory.push({
              file: name,
              sourceBytes: data.sourceBytes,
              capturedBytes: data.capturedBytes,
              truncated: data.truncated,
            });
          } catch (e) {
            warnings.push(`${label}/${item.name}: ${e.message}`);
          }
        }
        if (candidates.length > maximum)
          warnings.push(`${label}: included ${maximum} newest files of ${candidates.length}`);
      } catch (e) {
        warnings.push(`${label}: ${e.message}`);
      }
    };
    await collect(path.join(root, 'logs'), 'runtime', 24);
    if (installerDirectory) {
      await collect(path.join(installerDirectory, 'logs'), 'installer-ui', 4);
      try {
        const sessionNames = (
          await readdir(path.join(installerDirectory, 'sessions'), { withFileTypes: true })
        ).filter((d) => d.isDirectory() && /^[a-f0-9]{32}$/.test(d.name));
        const sessions = (
          await Promise.all(
            sessionNames.map(async (d) => ({
              name: d.name,
              modified: (await stat(path.join(installerDirectory, 'sessions', d.name))).mtimeMs,
            })),
          )
        ).sort((a, b) => b.modified - a.modified);
        let matching = 0;
        for (const session of sessions.slice(0, 100)) {
          const base = path.join(installerDirectory, 'sessions', session.name);
          try {
            const request = await json(base, 'request.json');
            if (
              typeof request.target !== 'string' ||
              path.resolve(request.target).toLowerCase() !== root.toLowerCase()
            )
              continue;
            await collect(base, 'installer-worker', 3, (n) =>
              /^(?:events\.jsonl|worker.*\.log|worker-guard\.jsonl|ui-events\.jsonl)$/.test(n),
            );
            if (++matching === 2) break;
          } catch {
            /* Skip unreadable or unrelated sessions. */
          }
        }
      } catch (e) {
        warnings.push('Installer sessions: ' + e.message);
      }
    }
  }
  const findings = [];
  const computerOutcome = snapshot.computerTask?.lastOutcome;
  if (
    computerOutcome &&
    ['needs_user', 'incomplete', 'cancelled', 'stalled', 'limit'].includes(computerOutcome.status)
  ) {
    const steps = Number.isSafeInteger(computerOutcome.steps) ? computerOutcome.steps : 'unknown';
    const reason = isDiagnosticControlValue('reason', computerOutcome.reason)
      ? `; ${computerOutcome.reason}`
      : '';
    findings.push(
      `The last computer task ended with ${computerOutcome.status} after ${steps} input steps${reason}. See session.json for its technical action trace.`,
    );
  }
  if (snapshot.response?.lastFailure) {
    const last = snapshot.response.lastFailure;
    findings.push(
      `The last reply failed during ${last.phase ?? 'unknown'} after ${last.elapsedMs ?? 'unknown'} ms (${last.errorName ?? 'Error'}); see session.json for response budgets.`,
    );
  }
  const watchStartCode = snapshot.screenCapture?.lastWatchStart?.code;
  if (
    typeof watchStartCode === 'string' &&
    watchStartCode.startsWith('CAPRI_SCREEN_WATCH_') &&
    watchStartCode !== 'CAPRI_SCREEN_WATCH_ARMED'
  )
    findings.push(`The last screen observation request failed before capture (${watchStartCode}).`);
  if (snapshot.artwork?.mode === 'fallback')
    findings.push('The desktop is displaying the procedural fallback instead of Capri artwork.');
  for (const item of avatarFiles.filter((f) => !f.exists))
    findings.push('Missing avatar component: ' + item.file);
  if (artwork.failure && avatarFiles[0].exists)
    findings.push('The Capri avatar catalog could not be read; see avatar.json.');
  if (snapshot.voice?.enabled === false)
    findings.push('Voice is disabled in the current desktop session.');
  if (engine === 'off') findings.push('The selected language resolves to text-only speech.');
  const selectedResidency = resources.localModels?.models?.find((model) => model.selected);
  if (selectedResidency?.offload === 'cpu')
    findings.push('The selected local model is resident on CPU. See resources.json.');
  if (selectedResidency?.offload === 'partial')
    findings.push('The selected local model reports partial GPU offload. See resources.json.');
  if (system.ramBytes > 0 && system.availableRamBytes / system.ramBytes <= 0.1)
    findings.push(
      'System RAM is nearly full across all processes. This does not attribute all memory use to Capri. Compare resources.json with system.json.',
    );
  for (const item of voice.files.filter((f) => !f.exists))
    findings.push('Missing voice component: ' + item.file);
  if (breeze && !(healthInfo?.activeEngine === 'breeze-tts' && healthInfo.ready === true)) {
    if (!breeze.runtimeInstalled)
      findings.push('The Breeze TTS runtime or model files are missing or invalid.');
    if (!breeze.profileValid)
      findings.push('The imported Breeze TTS voice profile is missing or invalid.');
  }
  if (model?.backend === 'qwen3-tts' && python?.available === false)
    findings.push('The selected Qwen3-TTS Python runtime could not be verified. See voice.json.');
  if (usesChatterbox && python?.cuda?.available === false)
    findings.push(
      'The installed voice Python reports CUDA unavailable. Local voice also supports CPU inference.',
    );
  if (turbo && python?.chatterbox?.turboModulePresent === false)
    findings.push('The installed Chatterbox Turbo Python module is missing.');
  if (adapterChecksum === 'MISMATCH')
    findings.push('The voice adapter checksum differs from its profile.');
  if (snapshot.lastVoiceFailure)
    findings.push('The last voice startup attempt failed; see session.json and voice stderr logs.');
  if (snapshot.voice?.lastFailure?.code === 'CAPRI_VOICE_LANGUAGE_MISMATCH')
    findings.push(
      'The local English voice skipped text in an unsupported script before synthesis.',
    );
  else if (snapshot.voice?.lastFailure)
    findings.push(
      `Voice ${snapshot.voice.lastFailure.phase ?? 'request'} failed; see session.json and voice stderr logs.`,
    );
  const diagnosticText =
    files.map((f) => f.bytes.toString('utf8')).join('\n') + JSON.stringify(clean.value(python));
  for (const [pattern, message] of [
    [/CUDA out of memory|CUDA_OUT_OF_MEMORY/i, 'A log contains CUDA out of memory.'],
    [
      /no kernel image|not compatible with the current PyTorch|CUDA_ARCH_UNSUPPORTED/i,
      'A log indicates a GPU/PyTorch architecture compatibility problem.',
    ],
    [
      /DLL load failed|VCRUNTIME|WinError 126|NATIVE_LIBRARY_LOAD_FAILED/i,
      'A log indicates a missing or unloadable native DLL.',
    ],
    [/ModuleNotFoundError/i, 'A log indicates a missing Python module.'],
  ])
    if (pattern.test(diagnosticText)) findings.push(message);
  const manifest = {
    schemaVersion: 1,
    id,
    createdAt,
    version: pkg.version,
    release: release.tag,
    includedLogs: problem.includeLogs,
    inventory,
    warnings,
    exclusions: [
      'chat-history files',
      'long-term memory',
      'personality',
      'recordings',
      'screenshots',
      'model weights',
      'credentials',
      'environment dump',
    ],
    limits: {
      bytesPerLog: 256 * KB,
      maxRuntimeLogs: 24,
      maxArchiveUncompressedBytes: 16 * 1024 ** 2,
    },
  };
  add('system.json', system);
  add('resources.json', resources);
  add('voice.json', voice);
  add('avatar.json', artwork);
  add('session.json', { ...snapshot, processes: processInfo });
  add('installation.json', {
    identity: pick(installation, ['schemaVersion', 'productId', 'version']),
    journal: diagnosticState(
      pick(journal, [
        'schemaVersion',
        'version',
        'status',
        'phase',
        'updatedAt',
        'failure',
        'completed',
        'steps',
      ]),
    ),
  });
  add('problem.json', problem);
  add('manifest.json', manifest);
  const show = (value) => value || 'Not provided';
  add(
    'REPORT.md',
    `# Capri diagnostic report\n\nReport ID: ${id}\nCreated (UTC): ${createdAt}\nVersion: ${pkg.version ?? 'unknown'} / ${release.tag ?? 'unknown'}\nCategory: ${problem.category}\nModel ID: ${diagnosticModelId(snapshot.inference?.model) ?? 'unknown'}\n\n## Problem\n\n${show(problem.title)}\n\n${show(problem.description)}\n\n## Steps to reproduce\n\n${show(problem.steps)}\n\n## Expected\n\n${show(problem.expected)}\n\n## Actual\n\n${show(problem.actual)}\n\n## Automatic findings\n\n${findings.length ? findings.map((v) => '- ' + v).join('\n') : 'No definitive cause identified. Inspect the captured state and logs.'}\n\n## System\n\nOS: ${system.osVersion} (${system.osRelease})\nCPU: ${system.cpu} / ${system.cpuThreads} threads\nRAM: ${Math.round((system.ramBytes ?? 0) / 1024 ** 3)} GiB\nGPU: ${(system.gpus ?? []).map((g) => `${g.name}, VRAM ${g.vramMiB ?? 'unknown'} MiB, driver ${g.driver ?? 'unknown'}`).join('; ') || 'Unknown'}\nElectron: ${versions.electron ?? 'unknown'} / Node: ${versions.node ?? 'unknown'}\n\n## Included files\n\n- system.json: hardware, drivers, memory, disk and runtime versions.\n- resources.json: local model offload counters and owned process working sets; no model startup or prompts.\n- avatar.json: selected artwork catalog, installed frame sizes and missing files (no images).\n- voice.json: voice components, adapter verification, Python packages, CUDA and service health.\n- session.json: selected settings, startup stages and latest technical errors.\n- installation.json: installer state without credentials or its raw request.\n- problem.json: user-entered reproduction details.\n- manifest.json: captured log sizes, truncation, collection warnings and exclusions.\n- logs/: ${inventory.length} recent log tails, up to 256 KiB each.\n\n## Privacy and limits\n\nNothing was uploaded. Chat-history files, memory, personality, recordings, screenshots, weights and credential files are excluded. Unknown log prose and textual session fields are omitted; technical error classes, stages and resource counters remain. Your own problem description and steps are included, so review them before sharing. Missing components or failed probes are reported instead of preventing report creation. The archive describes a point in time and does not restart models or reproduce the failure automatically.\n`,
  );
  return {
    id,
    bytes: await diagnosticZip(files),
    fileCount: files.length,
    manifest: clean.value(manifest),
  };
}
