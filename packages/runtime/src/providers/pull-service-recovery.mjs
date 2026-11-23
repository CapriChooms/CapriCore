// SPDX-License-Identifier: GPL-3.0-only
import { managedProcess } from '../host/processes.mjs';
import { request } from '../http.mjs';
import { startLlama } from './services.mjs';

/** Recreate a dead installer-owned service; never kill a living or foreign process. */
export async function recoverPullService(
  rt,
  {
    signal,
    requestImpl = request,
    owned = () => Boolean(managedProcess('ollama')),
    start = startLlama,
  } = {},
) {
  signal?.throwIfAborted();
  try {
    if (await requestImpl(`${rt.ollamaUrl}/api/version`, { timeout: 1500, signal })) return false;
  } catch {
    signal?.throwIfAborted();
  }
  if (owned()) return false;
  await start(rt, { signal });
  return true;
}
