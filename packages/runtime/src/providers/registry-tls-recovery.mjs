// SPDX-License-Identifier: GPL-3.0-only
import { paths } from '../host/paths.mjs';
import { managedProcess } from '../host/processes.mjs';
import { request } from '../http.mjs';
import { startOllama, stopManaged } from './services.mjs';
import {
  classicalRegistryTls,
  saveClassicalRegistryTls,
  probeClassicalRegistryTls,
} from '../host/registry-network.mjs';

/** Installer pull only: never restart an unowned server or unload an active model. */
export async function recoverRegistryTls(
  rt,
  {
    signal,
    emit = console.log,
    dataDir = paths.data,
    owned = () => Boolean(managedProcess('ollama')),
    inventory = () => request(`${rt.ollamaUrl}/api/ps`, { timeout: 3000, signal }),
    probe = () => probeClassicalRegistryTls({ signal }),
    stop = () => stopManaged('ollama'),
    start = () => startOllama(rt, { signal }),
  } = {},
) {
  signal?.throwIfAborted();
  if (classicalRegistryTls(dataDir) || !owned()) return false;
  if ((await inventory()).models?.length !== 0) return false;
  if (!(await probe())) return false;
  signal?.throwIfAborted();
  if (!owned() || (await inventory()).models?.length !== 0) return false;
  signal?.throwIfAborted();
  saveClassicalRegistryTls(dataDir);
  emit(
    'Registry TLS handshake compatibility confirmed. Restarting the idle owned Ollama with classical key exchange; TLS and certificate validation remain enabled.',
  );
  await stop();
  signal?.throwIfAborted();
  await start();
  return true;
}
