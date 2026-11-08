// SPDX-License-Identifier: GPL-3.0-only
/** Provider usage describes the last evaluated request, not the size of saved
 * history. Never replace missing/stale measurements with a character estimate
 * or an older pre-compaction budget, which can falsely suggest a full window.
 */
export function contextUsage(session, { model, contextTokens }) {
  const totalTokens =
    Number.isSafeInteger(contextTokens) && contextTokens > 0 ? contextTokens : null;
  const valid =
    totalTokens !== null &&
    session?.model === model &&
    session.totalTokensFresh === true &&
    Number.isSafeInteger(session.totalTokens) &&
    session.totalTokens >= 0 &&
    (!session.contextTokens || session.contextTokens === totalTokens);
  return {
    usedTokens: valid ? session.totalTokens : null,
    totalTokens,
    source: valid ? 'last-request' : 'unavailable',
  };
}

/** A shared read-only probe. It never wakes Qwen, runs inference or reads chat
 * content. Failures are bounded and backed off independently of RAM/VRAM reads.
 */
export class ContextSampler {
  constructor({ rpc, sessionKey, model, contextTokens, now = Date.now, timeoutMs = 800 }) {
    Object.assign(this, { rpc, sessionKey, model, contextTokens, now, timeoutMs });
    this.generation = 0;
    this.invalidate();
  }
  invalidate() {
    this.generation++;
    this.nextAt = 0;
    this.value = contextUsage(null, this);
  }
  async sample({ available = true } = {}) {
    if (!available) {
      this.invalidate();
      return { ...this.value };
    }
    if (!this.pending && this.now() >= this.nextAt) {
      const generation = this.generation;
      this.pending = this.read()
        .then(({ session, failed }) => {
          if (generation === this.generation) {
            this.value = contextUsage(session, this);
            this.nextAt = this.now() + (failed ? 10000 : 2000);
          }
        })
        .finally(() => {
          this.pending = null;
        });
    }
    await this.pending;
    return { ...this.value };
  }
  async read() {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let abort;
    try {
      const result = await Promise.race([
        this.rpc.call('sessions.describe', { key: this.sessionKey }, { signal }),
        new Promise((_resolve, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
      return { session: result?.session, failed: false };
    } catch {
      return { session: null, failed: true };
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  }
}
