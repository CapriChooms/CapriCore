// SPDX-License-Identifier: GPL-3.0-only
const downloadHosts = new Set([
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs.hf.co',
  'cdn-lfs-us-1.hf.co',
  'cdn-lfs-eu-1.hf.co',
  'cas-bridge.xethub.hf.co',
  'cas-server.xethub.hf.co',
  'transfer.xethub.hf.co',
  'us.aws.cdn.hf.co',
  'eu.aws.cdn.hf.co',
]);

export function hubUrl(value, { metadata = false } = {}) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !downloadHosts.has(url.hostname) ||
    (metadata && url.origin !== 'https://huggingface.co')
  )
    throw new Error('Unapproved Hugging Face network destination.');
  return url.href;
}

export async function hubResponse(
  value,
  {
    fetchImpl = fetch,
    token = async () => null,
    signal,
    headers = {},
    metadata = false,
    timeout = 30000,
  } = {},
) {
  let url = hubUrl(value, { metadata });
  const forwarded = new Headers(headers);
  for (const key of ['authorization', 'proxy-authorization', 'cookie', 'host'])
    forwarded.delete(key);
  const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
  for (let redirects = 0; redirects <= 5; redirects++) {
    combined.throwIfAborted();
    const authorization =
      new URL(url).origin === 'https://huggingface.co' ? await token(url) : null;
    let response;
    const connection = new AbortController();
    const timer = setTimeout(() => connection.abort(), Math.min(timeout, 30000));
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.any([combined, connection.signal]),
        headers: {
          accept: metadata ? 'application/json' : 'application/octet-stream',
          'accept-encoding': 'identity',
          ...Object.fromEntries(forwarded),
          ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
        },
      });
    } catch {
      signal?.throwIfAborted();
      throw new Error('Hugging Face connection failed or timed out. Check the network and proxy.');
    } finally {
      clearTimeout(timer);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Hugging Face returned an invalid redirect.');
    url = hubUrl(new URL(location, url).href, { metadata });
  }
  throw new Error('Hugging Face returned too many redirects.');
}

export function httpError(status) {
  if (status === 401)
    return new Error('Hugging Face authentication is required or the token has expired.');
  if (status === 403)
    return new Error('Hugging Face access denied. Check model approval and token permissions.');
  if (status === 404) return new Error('The Hugging Face model, revision or file was not found.');
  if (status === 429) return new Error('Hugging Face rate limit reached. Try again later.');
  return new Error(`Hugging Face request failed (HTTP ${status}).`);
}

export async function hubJson(value, options = {}) {
  const response = await hubResponse(value, { ...options, metadata: true });
  if (!response.ok) {
    await response.body?.cancel();
    throw httpError(response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Hugging Face returned an empty response.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 ** 2) throw new Error('Hugging Face metadata exceeds the size limit.');
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    options.signal?.throwIfAborted();
    throw new Error('Hugging Face metadata could not be read within the size and time limits.');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Hugging Face returned invalid metadata.');
  }
}
