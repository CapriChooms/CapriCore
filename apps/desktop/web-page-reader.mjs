// SPDX-License-Identifier: GPL-3.0-only
//
// Opens a few search result pages and keeps only the passage that matches the
// question. Guards: public http(s) hosts only, the address is checked before
// connecting and after every redirect, no cookies or credentials are sent,
// and a page is cut off at a fixed size and time.
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import {
  MIN_PASSAGE_CHARS,
  passageFromPage,
} from '../../packages/skills/src/web-search/passages.mjs';
import { publicWebSourceUrl } from '../../packages/skills/src/web-search/sources.mjs';

export const MAX_PAGES = 3;
export const MAX_PAGE_BYTES = 768 * 1024;
export const PAGE_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local, carrier NAT, multicast and reserved addresses. */
export function privateAddress(address) {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && (b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && address.startsWith('198.51.100.')) ||
      (a === 203 && b === 0 && address.startsWith('203.0.113.')) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(lower);
    if (mapped) return privateAddress(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('::ffff:') ||
      /^f[cd]/u.test(lower) ||
      /^fe[89ab]/u.test(lower) ||
      lower.startsWith('ff') ||
      lower.startsWith('64:ff9b:') ||
      lower.startsWith('2001:db8:')
    );
  }
  return true;
}

async function publicAddresses(hostname, resolve) {
  try {
    const host = hostname.replace(/^\[|\]$/gu, '');
    const kind = isIP(host);
    const answers = kind ? [{ address: host, family: kind }] : await resolve(host, { all: true });
    return answers.every(({ address }) => !privateAddress(address)) ? answers : [];
  } catch {
    return [];
  }
}

function requestPublicPage(target, addresses, { signal, headers }) {
  // Retain the original authority for Host and TLS verification. Use only the
  // addresses approved for this hop, including on networks that retry IPv4/IPv6.
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const pending = request(
      target,
      {
        agent: false,
        signal,
        headers,
        lookup: (_host, options, done) => {
          if (options.all) done(null, addresses);
          else done(null, addresses[0].address, addresses[0].family);
        },
      },
      (response) => {
        resolve({
          status: response.statusCode,
          headers: new Headers(response.headers),
          body: Readable.toWeb(response),
        });
      },
    );
    pending.once('error', reject);
    pending.end();
  });
}

async function boundedText(response, signal) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < MAX_PAGE_BYTES) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value).subarray(0, MAX_PAGE_BYTES - size);
      size += chunk.length;
      chunks.push(chunk);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Fetches one public page as text, or returns '' when it cannot be read safely. */
export async function fetchPage(
  address,
  { fetchImpl, resolve = lookup, signal = AbortSignal.timeout(PAGE_TIMEOUT_MS), language } = {},
) {
  let url = publicWebSourceUrl(address);
  try {
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop += 1) {
      const target = new URL(url);
      const addresses = await publicAddresses(target.hostname, resolve);
      if (!addresses.length) return '';
      signal.throwIfAborted();
      const options = {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal,
        headers: {
          accept: 'text/html, application/xhtml+xml;q=0.9, text/plain;q=0.5',
          ...(typeof language === 'string' && /^[a-z]{2,3}(?:-[a-z\d]{2,8}){0,3}$/iu.test(language)
            ? { 'accept-language': language }
            : {}),
        },
      };
      const response = fetchImpl
        ? await fetchImpl(target.href, options)
        : await requestPublicPage(target, addresses, options);
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        const next = response.headers.get('location');
        url = next ? publicWebSourceUrl(new URL(next, target).href) : null;
        continue;
      }
      if (
        response.status !== 200 ||
        !/^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/iu.test(
          response.headers.get('content-type') ?? '',
        )
      ) {
        void response.body?.cancel().catch(() => {});
        return '';
      }
      return await boundedText(response, signal);
    }
  } catch {
    // An unreadable page only means its search snippet is kept.
  }
  return '';
}

/**
 * Replaces the snippet of the first few sources with the passage of their page
 * that matches the question. A page that cannot be read, or has nothing
 * relevant, keeps its original snippet. Never rejects.
 */
export async function withPagePassages(sources, query, options = {}) {
  if (!Array.isArray(sources) || !sources.length) return sources;
  const { signal, timeoutMs = PAGE_TIMEOUT_MS, pages = MAX_PAGES } = options;
  const budget = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, budget]) : budget;
  const read = async (source) => {
    const html = await Promise.race([
      fetchPage(source.url, { ...options, signal: combined }),
      new Promise((done) => {
        combined.addEventListener('abort', () => done(''), { once: true });
      }),
    ]);
    const passage = html ? passageFromPage(html, query) : '';
    // A thin passage (a title, a cookie notice) must not replace a better snippet.
    const snippet = typeof source.snippet === 'string' ? source.snippet : '';
    return passage.length >= MIN_PASSAGE_CHARS && passage.length >= snippet.length
      ? { ...source, snippet: passage, page: true }
      : source;
  };
  const head = await Promise.all(sources.slice(0, pages).map((source) => read(source)));
  return [...head, ...sources.slice(pages)];
}
