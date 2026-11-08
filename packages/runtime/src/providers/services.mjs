import { existsSync } from 'node:fs';
import path from 'node:path';
import { root, requireExecutable } from '../host/paths.mjs';
import { nodePath, ollamaPath, openclawPath } from '../host/executables.mjs';
import { settings } from '../config/settings.mjs';
import { runtime, initialize, headers } from '../context.mjs';
import { launch, managedProcess, stopProcess, requiresPrivacyRestart } from '../host/processes.mjs';
import { request, waitFor } from '../http.mjs';
import { applyOpenClawCompatibility } from './openclaw-compat.mjs';
import { waitForOwnedService } from '../host/readiness.mjs';
import { requireOllamaBundle } from '../host/ollama-bundle.mjs';
import { memorySampler } from '../hardware/memory.mjs';
import { gpuBudget } from '../hardware/gpu-budget.mjs';
import { applyDependencySecurityPatches } from './dependency-security.mjs';

export async function stopManaged(name) {
  if (name === 'ollama' && managedProcess(name)) {
    const inventory = await request(`${runtime().ollamaUrl}/api/ps`, { timeout: 3000 }).catch(
      () => ({ models: [] }),
    );
    await Promise.all(
      (inventory.models ?? []).map((model) =>
        request(`${runtime().ollamaUrl}/api/generate`, {
          method: 'POST',
          timeout: 30000,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: model.name, keep_alive: 0, stream: false }),
        }),
      ),
    );
  }
  return stopProcess(name);
}
export async function startOllama(
  rt = runtime(),
  { signal, voiceExpected = false, voiceReady = false } = {},
) {
  signal?.throwIfAborted();
  requireExecutable(ollamaPath, 'Ollama');
  requireOllamaBundle(ollamaPath);
  initialize(rt);
  // A previous build may still own raw stdout/stderr file descriptors. Adopt
  // only services started with the current privacy log policy.
  if (requiresPrivacyRestart(managedProcess('ollama'))) await stopManaged('ollama');
  const current = await request(`${rt.ollamaUrl}/api/version`, { timeout: 1500, signal }).catch(
    () => null,
  );
  signal?.throwIfAborted();
  if (current && !managedProcess('ollama'))
    throw new Error(
      `Ollama port ${settings.ollamaPort} is already in use. Select a free managed port in config/core.local.json.`,
    );
  if (!current) {
    const memory = await memorySampler.sample({ fresh: true });
    signal?.throwIfAborted();
    const budget = gpuBudget({ ...settings, voiceExpected, voiceReady, gpus: memory.gpus });
    console.info('Qwen GPU budget:', JSON.stringify(budget));
    // No guessed layer count: Ollama sizes weights + KV cache against free VRAM
    // and this reserve. The same policy applies to warmup and real requests.
    await launch('ollama', ollamaPath, ['serve'], rt, {
      env: { OLLAMA_GPU_OVERHEAD: String(budget.overheadBytes) },
    });
  }
  const version = await waitFor(() => request(`${rt.ollamaUrl}/api/version`, { signal }), {
    label: 'Ollama',
    signal,
  });
  const actual = String(version.version).match(/^(\d+)\.(\d+)\.(\d+)/),
    minimum = settings.ollamaVersion.split('.').map(Number);
  if (
    !actual ||
    actual
      .slice(1)
      .map(Number)
      .reduce((order, part, index) => order || Math.sign(part - minimum[index]), 0) < 0
  )
    throw new Error(
      `This build needs Ollama ${settings.ollamaVersion} or newer; found ${version.version}. Update the selected Ollama executable.`,
    );
  return version;
}
export async function startGateway(rt = runtime(), { signal } = {}) {
  signal?.throwIfAborted();
  requireExecutable(nodePath, 'Node.js');
  if (!existsSync(openclawPath)) throw new Error('OpenClaw is missing. Run npm ci.');
  initialize(rt);
  const security = applyDependencySecurityPatches(root);
  if (security.changed && managedProcess(rt.logPrefix)) await stopProcess(rt.logPrefix);
  if (requiresPrivacyRestart(managedProcess(rt.logPrefix))) await stopProcess(rt.logPrefix);
  if (applyOpenClawCompatibility(root) && managedProcess(rt.logPrefix))
    await stopProcess(rt.logPrefix);
  // Probe occupancy without credentials. Never send a new installation's token
  // to an unrelated process that happens to own the default port.
  if (!managedProcess(rt.logPrefix)) {
    const occupied = await fetch(`${rt.gatewayUrl}/readyz`, {
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(1500)])
        : AbortSignal.timeout(1500),
    }).catch(() => null);
    if (occupied) {
      await occupied.body?.cancel();
      throw new Error(
        `Gateway port ${rt.gatewayPort} is occupied by another installation. Choose a free local port.`,
      );
    }
  }
  const current = await request(`${rt.gatewayUrl}/v1/models`, {
    headers: headers(rt),
    timeout: 1500,
    signal,
  }).catch(() => null);
  signal?.throwIfAborted();
  if (current && !managedProcess(rt.logPrefix))
    throw new Error(`Gateway port ${rt.gatewayPort} belongs to another process.`);
  if (!current)
    await launch(
      rt.logPrefix,
      nodePath,
      [path.join(root, 'packages/runtime/bin/gateway-host.mjs'), rt.logPrefix],
      rt,
      rt.remote?.enabled ? { env: { CAPRI_REMOTE_PROXY_TOKEN: rt.remoteProxyToken } } : {},
    );
  await waitForOwnedService(
    async () => {
      await request(`${rt.gatewayUrl}/startupz`, { timeout: 3000, signal });
      await request(`${rt.gatewayUrl}/readyz`, { timeout: 3000, signal });
      return request(`${rt.gatewayUrl}/v1/models`, { headers: headers(rt), timeout: 3000, signal });
    },
    { name: rt.logPrefix, label: 'OpenClaw', signal },
  );
  await waitForOwnedService(
    async () => {
      const value = await request(`${rt.gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers: headers(rt),
        timeout: 10000,
        signal,
        body: JSON.stringify({ tool: 'session_status', args: {}, sessionKey: settings.sessionKey }),
      });
      return value?.ok && value.result?.details?.agentId === settings.agentId;
    },
    { name: rt.logPrefix, timeout: 180000, label: 'Capri agent admission', signal },
  );
  return request(`${rt.gatewayUrl}/v1/models`, { headers: headers(rt) });
}
