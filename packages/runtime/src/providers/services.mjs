import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root, requireExecutable } from '../host/paths.mjs';
import { nodePath, llamaPath, openclawPath } from '../host/executables.mjs';
import { llamaBundleReady } from '../host/llama-bundle.mjs';
import { settings } from '../config/settings.mjs';
import { runtime, initialize, headers } from '../context.mjs';
import { launch, managedProcess, stopProcess, requiresPrivacyRestart } from '../host/processes.mjs';
import { request } from '../http.mjs';
import { applyOpenClawCompatibility } from './openclaw-compat.mjs';
import { waitForOwnedService } from '../host/readiness.mjs';
import { gpuBudget } from '../hardware/gpu-budget.mjs';
import { applyDependencySecurityPatches } from './dependency-security.mjs';
import { migrateLanguageDevice, probeLanguageDevices } from '../hardware/model-devices.mjs';
import { readModelDevices, modelsShareDevice } from '../model-device-settings.mjs';

export async function stopManaged(name) {
  await stopProcess(name);
  if (name === 'llama') await Promise.all(['llama-chat', 'llama-embedding'].map(stopProcess));
}

let startingLlama;
export function startLlama(rt, options) {
  startingLlama ??= startLocalLlama(rt, options).finally(() => {
    startingLlama = null;
  });
  return startingLlama;
}

async function startLocalLlama(
  rt = runtime(),
  { signal, voiceExpected = false, voiceReady = false } = {},
) {
  signal?.throwIfAborted();
  const bundled = path.join(
    root,
    '.runtime',
    `llama-${settings.llamaVersion}-vulkan`,
    'llama-server.exe',
  );
  if (!llamaPath || (llamaPath === bundled && !llamaBundleReady(bundled)))
    throw Object.assign(
      new Error('The llama.cpp runtime is missing or incomplete. Run Capri Setup to repair it.'),
      { code: 'CAPRI_LLAMA_BUNDLE_INCOMPLETE' },
    );
  initialize(rt);
  const preferences = readModelDevices(root);
  const configuration = createHash('sha256')
    .update(
      JSON.stringify([
        settings.model,
        settings.embeddingModel,
        settings.contextTokens,
        settings.keepAlive,
        settings.cpuThreads,
        settings.acceleration,
        settings.generation,
        settings.reasoningBudget,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  // A running service from the previous version may still own this port.
  if (managedProcess('ollama')) await stopProcess('ollama');
  let marker = managedProcess('llama');
  if (
    marker &&
    ((marker.deviceKey ?? 'auto') !== preferences.language || requiresPrivacyRestart(marker))
  ) {
    await stopManaged('llama');
    marker = null;
  }
  const health = async () => {
    const packet = await request(`${rt.ollamaUrl}/api/version`, { timeout: 1500, signal });
    return packet.engine === 'llama.cpp' &&
      packet.version === settings.llamaVersion &&
      packet.configuration === configuration
      ? packet
      : null;
  };
  const current = marker ? await health().catch(() => null) : null;
  signal?.throwIfAborted();
  if (current) return current;
  if (marker) await stopManaged('llama');
  const occupied = await fetch(`${rt.ollamaUrl}/api/version`, {
    redirect: 'error',
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(1500)]),
  }).catch(() => null);
  signal?.throwIfAborted();
  if (occupied) {
    await occupied.body?.cancel();
    throw Object.assign(
      new Error(`Local inference port ${settings.ollamaPort} is already in use.`),
      {
        code: 'CAPRI_SERVICE_PORT_OCCUPIED',
      },
    );
  }
  const id = preferences.language;
  const explicit = id !== 'auto' && id !== 'cpu' && !id.startsWith('npu-');
  const device = explicit
    ? migrateLanguageDevice(id, await probeLanguageDevices(llamaPath)).find(
        (entry) => entry.id === id && entry.available,
      )
    : null;
  signal?.throwIfAborted();
  const budget = gpuBudget({
    ...settings,
    voiceExpected: voiceExpected && modelsShareDevice(preferences.language, preferences.voice),
    voiceReady,
  });
  await launch('llama', nodePath, [path.join(root, 'packages/runtime/bin/llama-host.mjs')], rt, {
    env: {
      CAPRI_LLAMA_PATH: llamaPath,
      CAPRI_LLAMA_DEVICE: device ? `Vulkan${device.ordinal}` : explicit ? 'unavailable' : '',
      CAPRI_LLAMA_FORCE_CPU: id === 'cpu' || id.startsWith('npu-') ? '1' : '0',
      CAPRI_LLAMA_CONFIGURATION: configuration,
      CAPRI_LLAMA_RESERVE_MIB: String(budget.overheadBytes / 1024 ** 2),
    },
    deviceKey: id,
  });
  return waitForOwnedService(health, { name: 'llama', label: 'llama.cpp', signal, timeout: 15000 });
}
export async function startGateway(rt = runtime(), { signal } = {}) {
  signal?.throwIfAborted();
  requireExecutable(nodePath, 'Node.js');
  if (!existsSync(openclawPath))
    throw Object.assign(new Error('OpenClaw is missing. Repair Capri with the installer.'), {
      code: 'CAPRI_GATEWAY_RUNTIME_MISSING',
    });
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
      throw Object.assign(
        new Error(
          `Gateway port ${rt.gatewayPort} is occupied by another installation. Choose a free local port.`,
        ),
        { code: 'CAPRI_SERVICE_PORT_OCCUPIED' },
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
    throw Object.assign(new Error(`Gateway port ${rt.gatewayPort} belongs to another process.`), {
      code: 'CAPRI_SERVICE_PORT_OCCUPIED',
    });
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
