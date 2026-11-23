// SPDX-License-Identifier: GPL-3.0-only
/** Repeated startup/show/model callbacks share the same observer, never cancel it. */
export async function syncAwareness({ observer, enabled, prepare }) {
  if (!enabled) {
    observer.stop();
    return;
  }
  if (observer.status === 'active') return observer.snapshot();
  if (observer.child && observer.starting) return observer.starting;
  prepare();
  return observer.start();
}
