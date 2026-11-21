// SPDX-License-Identifier: GPL-3.0-only
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createLlamaBridge } from '../src/providers/llama-bridge.mjs';
import { LlamaModelStore } from '../src/providers/llama-model-store.mjs';
import { LlamaWorkers } from '../src/providers/llama-workers.mjs';
import { launch, stopProcess } from '../src/host/processes.mjs';
import { root, paths, requireExecutable } from '../src/host/paths.mjs';
import { llamaPath } from '../src/host/executables.mjs';
import { createLlamaRuntimeView, llamaBundleReady } from '../src/host/llama-bundle.mjs';
import { settings } from '../src/config/settings.mjs';

const executable = requireExecutable(llamaPath, 'llama.cpp');
const port = Number(process.env.CAPRI_OLLAMA_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid managed inference port.');
const device = process.env.CAPRI_LLAMA_DEVICE;
if (device && device !== 'unavailable' && !/^Vulkan\d{1,2}$/.test(device))
  throw new Error('Invalid local Vulkan device.');
const overheadMiB = Number(process.env.CAPRI_LLAMA_RESERVE_MIB) || 768;
if (overheadMiB < 0 || overheadMiB > 8192) throw new Error('Invalid local VRAM reserve.');
const env = {};
for (const key of [
  'SystemRoot',
  'WINDIR',
  'PATH',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
])
  if (process.env[key]) env[key] = process.env[key];
const canIsolate = process.platform === 'win32' && llamaBundleReady(executable);
const views = new Map();

const roleName = (role) => (role === 'chat' ? 'llama-chat' : 'llama-embedding');
// A crash may leave an owned native worker. Validate its saved process identity
// and release it before admitting any new local requests.
await Promise.all(['llama-chat', 'llama-embedding'].map(stopProcess));
const workers = new LlamaWorkers({
  root,
  config:
    process.env.CAPRI_LLAMA_FORCE_CPU === '1' ? { ...settings, acceleration: 'cpu' } : settings,
  device,
  overheadMiB,
  canRetryIllegalInstruction: canIsolate,
  start: async (role, args, extra, { allowGpu, baseline }) => {
    const name = roleName(role);
    let target = executable;
    if (canIsolate && (!allowGpu || baseline)) {
      const key = `${allowGpu}:${baseline}`;
      if (!views.has(key))
        views.set(
          key,
          createLlamaRuntimeView(executable, path.join(paths.cache, 'llama-worker-runtime'), {
            allowGpu,
            baseline,
          }),
        );
      target = views.get(key).executable;
    }
    const directory = path.dirname(target);
    let ended = false;
    const exit = Promise.withResolvers();
    const exitCode = () => Promise.race([exit.promise, wait(200, undefined, { ref: false })]);
    try {
      await launch(name, target, args, undefined, {
        cwd: directory,
        cleanEnv: true,
        env: { ...env, ...extra, PATH: [directory, env.PATH ?? ''].join(path.delimiter) },
        onExit: (code) => {
          ended = true;
          exit.resolve(code);
        },
      });
    } catch (error) {
      error.exitCode = await exitCode();
      throw error;
    }
    return { alive: () => !ended, stop: () => stopProcess(name), exitCode };
  },
});
const store = new LlamaModelStore(root, settings);
const server = createLlamaBridge({
  store,
  workers,
  config: settings,
  version: settings.llamaVersion,
  configuration: process.env.CAPRI_LLAMA_CONFIGURATION,
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});

let closing;
const close = () => {
  if (closing) return closing;
  clearInterval(stopTimer);
  server.close();
  server.closeAllConnections();
  closing = workers.close().then(
    () => {
      for (const view of views.values()) view.remove();
      process.exitCode = 0;
    },
    () => {
      process.exitCode = 1;
    },
  );
  return closing;
};
const stopFile = path.join(paths.data, 'run/llama.stop');
const stopTimer = setInterval(() => {
  if (existsSync(stopFile)) void close();
}, 200);
process.on('SIGTERM', close);
process.on('SIGINT', close);
