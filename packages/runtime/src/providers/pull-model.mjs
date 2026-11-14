// SPDX-License-Identifier: GPL-3.0-only
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
class PullPaused extends Error {}
/** Upstream errors can contain temporary signed CDN URLs. Keep the host/path only. */
export function modelPullMessage(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (text) => {
      try {
        const url = new URL(text);
        return url.origin + url.pathname + (url.search ? '?[redacted]' : '');
      } catch {
        return '[download URL]';
      }
    })
    .slice(0, 1800);
}
function networkCodes(error, depth = 0) {
  if (!error || depth > 4) return [];
  return [
    error.code,
    ...networkCodes(error.cause, depth + 1),
    ...(Array.isArray(error.errors)
      ? error.errors.flatMap((item) => networkCodes(item, depth + 1))
      : []),
  ].filter(Boolean);
}
export function transientModelPull(error) {
  if (error?.retryable !== undefined) return error.retryable;
  const codes = networkCodes(error);
  return (
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
      'ECONNREFUSED',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ].some((code) => codes.includes(code)) ||
    /(?:lookup\s+\S+[^\n]*(?:i\/o timeout|no such host)|connection reset|unexpected EOF|TLS handshake timeout|temporary failure in name resolution|(?:dial|read|write) tcp[^\n]*(?:connectex|wsarecv|wsasend|i\/o timeout|connection timed out|network is unreachable)|tls handshake eof)/i.test(
      error?.message ?? '',
    )
  );
}
/** Verified layers and partial blobs are retained when the request is cancelled. */
export async function pullModel(
  rt,
  model,
  {
    pauseFile = process.env.CAPRI_INSTALL_PAUSE_FILE,
    fetchImpl = fetch,
    emit = console.log,
    signal,
    onProgress = () => {},
    pollMs = 200,
    sleep = (ms) => delay(ms, undefined, { signal }),
    recoverTls,
    recoverConnection,
  } = {},
) {
  const paused = () => Boolean(pauseFile && existsSync(pauseFile));
  let failures = 0;
  let tlsRecoveryAttempted = false;
  for (;;) {
    signal?.throwIfAborted();
    if (paused()) {
      emit('Model download paused. Progress is retained.');
      while (paused()) await delay(pollMs, undefined, { signal });
      emit('Resuming model download.');
    }
    const controller = new AbortController();
    const timer = pauseFile
      ? setInterval(() => {
          if (paused()) controller.abort(new PullPaused());
        }, pollMs)
      : null;
    let reader,
      retryMs = 0;
    let tlsFailure = false;
    let connectionFailure = false;
    try {
      const response = await fetchImpl(`${rt.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        redirect: 'error',
        signal: AbortSignal.any([
          controller.signal,
          ...(signal ? [signal] : []),
          AbortSignal.timeout(2 * 60 * 60 * 1000),
        ]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`Model pull returned HTTP ${response.status}`), {
          retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
        });
      }
      reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '',
        previousStatus = '',
        previousStep = -1,
        complete = false;
      const consume = (line) => {
        if (!line.trim()) return;
        const item = JSON.parse(line);
        if (item.error) throw new Error(modelPullMessage(item.error));
        onProgress({
          status: String(item.status ?? '').slice(0, 160),
          total: Number.isSafeInteger(item.total) && item.total > 0 ? item.total : null,
          completed:
            Number.isSafeInteger(item.completed) && item.completed >= 0 ? item.completed : null,
          ...(typeof item.file === 'string' &&
          /^[\w.+-]{1,160}$/.test(item.file) &&
          Number.isSafeInteger(item.fileCompleted) &&
          Number.isSafeInteger(item.fileTotal) &&
          item.fileCompleted >= 0 &&
          item.fileCompleted <= item.fileTotal &&
          item.fileTotal > 0
            ? { file: item.file, fileCompleted: item.fileCompleted, fileTotal: item.fileTotal }
            : {}),
        });
        const step =
          item.total && typeof item.completed === 'number'
            ? Math.floor((10 * item.completed) / item.total)
            : -1;
        if (item.status !== previousStatus || step > previousStep) {
          emit(`${model}: ${item.status}${step >= 0 ? ` ${Math.min(step * 10, 100)}%` : ''}`);
          previousStatus = item.status;
          previousStep = step;
        }
        complete ||= item.status === 'success';
      };
      for (;;) {
        signal?.throwIfAborted();
        controller.signal.throwIfAborted();
        const { value, done } = await reader.read();
        buffer += value ?? '';
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) consume(line);
        if (buffer.length > 65536) throw new Error('Model pull metadata exceeds limit');
        if (done) {
          consume(buffer);
          break;
        }
      }
      if (!complete)
        throw Object.assign(new Error('Model pull ended before verification completed'), {
          retryable: true,
        });
      return;
    } catch (error) {
      signal?.throwIfAborted();
      if (!(controller.signal.reason instanceof PullPaused)) {
        if (!transientModelPull(error)) throw error;
        if (failures >= 3) {
          const codes = networkCodes(error);
          if (codes.length)
            throw Object.assign(
              new Error(
                `The local model download connection failed (${[...new Set(codes)].join(', ')}). Downloaded layers are retained. Retry setup and use Save report (ZIP) if it continues.`,
                { cause: error },
              ),
              { code: 'CAPRI_MODEL_PULL_CONNECTION_FAILED' },
            );
          throw error;
        }
        connectionFailure = networkCodes(error).some((code) =>
          ['ECONNREFUSED', 'UND_ERR_SOCKET', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'].includes(
            code,
          ),
        );
        tlsFailure =
          /TLS handshake timeout/i.test(error.message) &&
          !tlsRecoveryAttempted &&
          Boolean(recoverTls);
        retryMs = 2000 * 2 ** failures++;
        emit(
          `Model download connection interrupted: ${modelPullMessage(error.message)}${networkCodes(error).length ? ' [' + [...new Set(networkCodes(error))].join(', ') + ']' : ''}. Retrying ${failures + 1}/4 in ${retryMs / 1000}s. Verified layers and partial downloads are retained.`,
        );
      }
    } finally {
      clearInterval(timer);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
    if (tlsFailure) {
      tlsRecoveryAttempted = true;
      try {
        if (await recoverTls({ signal })) retryMs = 0;
      } catch (error) {
        signal?.throwIfAborted();
        emit(
          `Registry TLS compatibility recovery could not finish: ${modelPullMessage(error.message)}`,
        );
      }
    }
    if (connectionFailure && recoverConnection) {
      try {
        await recoverConnection({ signal });
      } catch (error) {
        signal?.throwIfAborted();
        emit(`Local model service recovery could not finish: ${modelPullMessage(error.message)}`);
      }
    }
    if (retryMs) await sleep(retryMs);
  }
}
