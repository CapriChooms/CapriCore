// SPDX-License-Identifier: GPL-3.0-only
import { setTimeout as delay } from 'node:timers/promises';
import { managedProcess } from './processes.mjs';

/** Cold imports can take minutes on a fresh Windows install. Wait only for our live process. */
export async function waitForOwnedService(
  check,
  {
    name,
    label,
    timeout = 10 * 60 * 1000,
    interval = 1000,
    ownershipInterval = 5000,
    signal,
    getProcess = managedProcess,
    now = Date.now,
    pause = (ms) => delay(ms, undefined, { signal }),
  } = {},
) {
  const expected = getProcess(name);
  const exited = () =>
    Object.assign(
      new Error(`${label} stopped during startup. Check its local logs and reconnect.`),
      { code: 'CAPRI_SERVICE_EXITED' },
    );
  if (!expected) throw exited();
  const deadline = now() + timeout;
  let checked = -Infinity,
    last;
  for (;;) {
    signal?.throwIfAborted();
    if (now() - checked >= ownershipInterval) {
      const current = getProcess(name);
      if (!current || current.pid !== expected.pid || current.startedAt !== expected.startedAt)
        throw exited();
      checked = now();
    }
    try {
      const ready = await check();
      if (ready) return ready;
    } catch (error) {
      signal?.throwIfAborted();
      last = error;
    }
    if (now() >= deadline) {
      throw Object.assign(
        new Error(
          `${label} is still not ready after ${Math.ceil(timeout / 1000)} seconds. Check its local logs and reconnect.${last ? ' ' + last.message : ''}`,
        ),
        { code: 'CAPRI_SERVICE_STARTUP_TIMEOUT' },
      );
    }
    await pause(Math.min(interval, deadline - now()));
  }
}
