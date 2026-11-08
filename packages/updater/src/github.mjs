// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPOSITORY } from './releases.mjs';
const execute = promisify(execFile);
const apiRoot = `https://api.github.com/repos/${REPOSITORY}/releases`;
const cdns = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
export function approvedUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !(
      cdns.has(url.hostname) ||
      (url.origin === 'https://api.github.com' &&
        (url.pathname === `/repos/${REPOSITORY}/releases` ||
          new RegExp(`^/repos/${REPOSITORY}/releases/assets/[1-9][0-9]*$`).test(url.pathname)))
    )
  )
    throw new Error('Unapproved update URL');
  return url;
}
/** Tokens stay in the main process. They never enter requests saved on disk or CDN redirects. */
export async function githubCredential(root, env = process.env) {
  const provided = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (provided && !/[\r\n]/.test(provided)) return provided;
  const candidates = ['gh'];
  const runtimes = path.join(root, '.runtime');
  if (existsSync(runtimes))
    for (const name of readdirSync(runtimes))
      if (/^github-cli-[0-9.]+$/.test(name))
        candidates.push(path.join(runtimes, name, 'bin/gh.exe'));
  for (const file of candidates) {
    try {
      const { stdout } = await execute(file, ['auth', 'token', '--hostname', 'github.com'], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 8192,
        env,
      });
      const token = stdout.trim();
      if (token && !/[\r\n]/.test(token)) return token;
    } catch {
      /* Public repositories do not require GitHub CLI or an account. */
    }
  }
  return null;
}
export function githubFetch({ token, fetchImpl = fetch, allowAnonymousFallback = false } = {}) {
  return async (value, options = {}) => {
    const url = approvedUrl(value);
    const headers = { ...options.headers };
    for (const name of Object.keys(headers))
      if (/^(?:authorization|proxy-authorization|cookie)$/i.test(name)) delete headers[name];
    const api = url.origin === 'https://api.github.com';
    const request = (credential) =>
      fetchImpl(url, {
        ...options,
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          'user-agent': 'Capri-Updater',
          ...headers,
          ...(api
            ? {
                'x-github-api-version': '2022-11-28',
                ...(credential ? { authorization: 'Bearer ' + credential } : {}),
              }
            : {}),
        },
      });
    const response = await request(token);
    // Public releases remain available when optional saved access expires or loses permission.
    // Explicit credential verification keeps the default strict behavior.
    if (
      allowAnonymousFallback &&
      token &&
      api &&
      [401, 403, 404].includes(response.status) &&
      response.headers.get('x-ratelimit-remaining') !== '0' &&
      !response.headers.get('retry-after')
    ) {
      await response.body?.cancel();
      options.signal?.throwIfAborted();
      return request(null);
    }
    return response;
  };
}
export async function listReleases({
  token,
  fetchImpl = fetch,
  signal,
  allowAnonymousFallback = false,
} = {}) {
  const request = githubFetch({ token, fetchImpl, allowAnonymousFallback });
  const releases = [];
  for (let page = 1; page <= 5; page++) {
    const response = await request(`${apiRoot}?per_page=100&page=${page}`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]),
    });
    if (!response.ok) {
      const failure = { httpStatus: response.status };
      const requestId = response.headers.get('x-github-request-id');
      if (requestId && /^[A-Z0-9:.-]{1,100}$/i.test(requestId)) failure.requestId = requestId;
      await response.body?.cancel();
      if (response.status === 401)
        throw Object.assign(
          new Error(
            'GitHub rejected this token. It may be expired, revoked or copied incorrectly. Public Capri updates do not require a token.',
          ),
          {
            code:
              token && !allowAnonymousFallback ? 'GITHUB_ACCESS_REQUIRED' : 'GITHUB_REQUEST_DENIED',
            accessReason: 'token_rejected',
            ...failure,
          },
        );
      if (response.status === 404)
        throw Object.assign(
          new Error(`GitHub could not find the public ${REPOSITORY} releases. Try again later.`),
          {
            code:
              token && !allowAnonymousFallback
                ? 'GITHUB_ACCESS_REQUIRED'
                : 'GITHUB_RELEASES_UNAVAILABLE',
            accessReason: 'repository_not_visible',
            ...failure,
          },
        );
      if (
        response.status === 403 &&
        response.headers.get('x-ratelimit-remaining') !== '0' &&
        !response.headers.get('retry-after')
      )
        throw Object.assign(
          new Error(
            'GitHub denied this update request. Public Capri updates do not require a token. Try again later.',
          ),
          {
            code:
              token && !allowAnonymousFallback ? 'GITHUB_ACCESS_REQUIRED' : 'GITHUB_REQUEST_DENIED',
            ...failure,
          },
        );
      if (response.status === 403 || response.status === 429)
        throw Object.assign(
          new Error('GitHub has limited update checks. Try again later.'),
          failure,
        );
      throw Object.assign(new Error('GitHub update check failed. Try again.'), failure);
    }
    // Limit untrusted metadata before parsing; release notes are not executed or rendered as HTML.
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 8 * 1024 ** 2) throw new Error('GitHub release metadata is too large.');
      chunks.push(chunk);
    }
    const items = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(items)) throw new Error('Invalid GitHub release metadata.');
    releases.push(...items);
    if (items.length < 100) break;
  }
  return releases;
}
export const assetUrl = (id) => `${apiRoot}/assets/${id}`;
