/** Bounded local service requests; callers may supply cancellation. */
export async function request(
  url,
  { timeout = 10000, maxBytes = 16 * 1024 * 1024, signal, onHttpError, ...options } = {},
) {
  const timer = AbortSignal.timeout(timeout),
    combined = signal ? AbortSignal.any([timer, signal]) : timer;
  const response = await fetch(url, { ...options, redirect: 'error', signal: combined });
  if (!response.ok) {
    await response.body?.cancel();
    const error = onHttpError?.(response);
    if (error) throw error;
    throw new Error(`HTTP ${response.status} from ${new URL(url).origin}`);
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Service response exceeds limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}
export async function waitFor(
  check,
  { timeout = 90000, interval = 1000, label = 'Service', signal } = {},
) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    signal?.throwIfAborted();
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve, reject) => {
      const done = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(done, Math.min(interval, deadline - Date.now()));
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  } while (Date.now() < deadline);
  throw new Error(`${label} did not become ready. ${last?.message ?? ''}`);
}
