// SPDX-License-Identifier: GPL-3.0-only
//
// Left alone for many hours, the first question was several times slower than
// usual at every step (conversation reset, first model token, first speech).
// While Capri is idle this touches each local service every few minutes so
// connections stay open and nothing has to wake from cold, and it records how
// long each touch took so a slow one can be traced to the service at fault.
// Only loopback addresses are ever contacted.

export const KEEP_WARM_INTERVAL_MS = 4 * 60 * 1000;
export const PING_TIMEOUT_MS = 30000;
export const MAX_LOG_BYTES = 256 * 1024;

/** True only for http URLs on this computer. */
export function loopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

const post = async (url, body, { fetchImpl, signal }) => {
  if (!loopbackUrl(url)) throw new Error('not a local address');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error('status ' + response.status);
  await response.arrayBuffer();
};

/** One generated token: keeps the model server and its connection awake. */
export function modelPing(settings, { fetchImpl = fetch, signal } = {}) {
  if (settings?.enabled !== true || !settings.baseUrl || !settings.model)
    return Promise.reject(new Error('not configured'));
  return post(
    settings.baseUrl.replace(/\/+$/u, '') + '/chat/completions',
    { model: settings.model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] },
    { fetchImpl, signal },
  );
}

/** One short word of speech, discarded: keeps the voice server awake. */
export function voicePing(settings, { fetchImpl = fetch, signal } = {}) {
  if (settings?.enabled !== true || !settings.baseUrl || !settings.model || !settings.voice)
    return Promise.reject(new Error('not configured'));
  return post(
    settings.baseUrl.replace(/\/+$/u, '') + '/audio/speech',
    { model: settings.model, voice: settings.voice, input: 'ok', response_format: 'wav' },
    { fetchImpl, signal },
  );
}

/** Runs one ping and reports its duration in ms, or why it failed. Never rejects. */
export async function timedPing(
  run,
  { now = () => performance.now(), timeoutMs = PING_TIMEOUT_MS } = {},
) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timed out')), timeoutMs);
  let result;
  try {
    await Promise.race([
      run(controller.signal),
      new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        }),
      ),
    ]);
    result = { ms: Math.round(now() - started) };
  } catch (error) {
    result = { failed: String(error?.message ?? error).slice(0, 80) };
  }
  clearTimeout(timer);
  return result;
}

/**
 * One keep-warm round. `pings` maps a service name to `(signal) => Promise`.
 * Skipped (returns null) while Capri is busy. Never rejects.
 */
export async function keepWarmOnce({
  idle,
  pings,
  record = () => {},
  now,
  timeoutMs,
  clock = () => new Date(),
}) {
  if (typeof idle !== 'function' || !pings || typeof pings !== 'object')
    throw new TypeError('keepWarmOnce needs idle and pings.');
  if (idle() !== true) return null;
  const names = Object.keys(pings);
  const results = await Promise.all(
    names.map((name) => timedPing(pings[name], { now, timeoutMs })),
  );
  const entry = { time: clock().toISOString() };
  names.forEach((name, index) => {
    entry[name] = results[index].ms ?? results[index].failed;
  });
  try {
    record(entry);
  } catch {
    // A full disk must not stop the pings.
  }
  return entry;
}

/** Appends one line to the keep-warm log, starting it afresh when it grows large. */
export function appendKeepWarmLog(file, entry, { fs, maxBytes = MAX_LOG_BYTES }) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    size = 0;
  }
  const line = JSON.stringify(entry) + '\n';
  if (size + line.length > maxBytes) fs.writeFileSync(file, line);
  else fs.appendFileSync(file, line);
}

/** Starts the repeating round; returns a function that stops it. Rounds never overlap. */
export function startKeepWarm({
  intervalMs = KEEP_WARM_INTERVAL_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  ...round
}) {
  let running = false;
  const timer = setIntervalImpl(async () => {
    if (running) return;
    running = true;
    try {
      await keepWarmOnce(round);
    } catch {
      // Misconfiguration is reported by keepWarmOnce's own tests, never at runtime.
    } finally {
      running = false;
    }
  }, intervalMs);
  timer?.unref?.();
  return () => clearIntervalImpl(timer);
}
