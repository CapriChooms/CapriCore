// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { writeJsonAtomic } from '../atomic-json.mjs';

const registry = 'https://registry.ollama.ai/v2/';
export const registryNetworkFile = (dataDir) => path.join(dataDir, 'network/registry-tls.json');
export function classicalRegistryTls(dataDir) {
  try {
    const file = registryNetworkFile(dataDir),
      info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return false;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value.schemaVersion === 1 && value.mode === 'classical' && value.registry === registry;
  } catch {
    return false;
  }
}
export function saveClassicalRegistryTls(dataDir) {
  writeJsonAtomic(registryNetworkFile(dataDir), {
    schemaVersion: 1,
    mode: 'classical',
    registry,
    verifiedAt: new Date().toISOString(),
  });
}
/** Only the managed Ollama process changes; no system TLS/proxy/DNS setting. */
export function ollamaNetworkEnvironment(env, dataDir) {
  if (!classicalRegistryTls(dataDir)) return env;
  const flags = String(env.GODEBUG ?? '')
    .split(',')
    .filter((value) => value && !/^tlsmlkem=/.test(value));
  return { ...env, GODEBUG: [...flags, 'tlsmlkem=0'].join(',') };
}
/** Confirm verified HTTPS works with classical key exchange, retaining TLS 1.3. */
export function probeClassicalRegistryTls({
  signal,
  requestImpl = https.request,
  timeoutMs = 7000,
} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer;
    const req = requestImpl(
      registry,
      {
        method: 'HEAD',
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        ecdhCurve: 'X25519:P-256:P-384',
        signal,
      },
      (response) => {
        clearTimeout(timer);
        const tls = response.socket.getProtocol();
        const ok =
          response.statusCode >= 200 &&
          response.statusCode < 500 &&
          ['TLSv1.2', 'TLSv1.3'].includes(tls);
        response.resume();
        resolve(ok);
      },
    );
    timer = setTimeout(
      () => req.destroy(new Error('Registry TLS compatibility probe timed out')),
      timeoutMs,
    );
    req.once('error', (error) => {
      clearTimeout(timer);
      if (signal?.aborted) reject(signal.reason ?? error);
      else resolve(false);
    });
    req.end();
  });
}
