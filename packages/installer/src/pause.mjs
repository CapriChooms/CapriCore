// SPDX-License-Identifier: GPL-3.0-only
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
export async function waitWhilePaused(file, { signal, emit = () => {} } = {}) {
  if (!file || !existsSync(file)) return;
  emit({ type: 'paused' });
  while (existsSync(file)) {
    signal?.throwIfAborted();
    await delay(200, undefined, { signal });
  }
  emit({ type: 'resumed' });
}
