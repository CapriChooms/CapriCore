// SPDX-License-Identifier: GPL-3.0-only
import {
  MAX_SOURCES,
  MAX_SOURCE_CHARS,
  referenceText,
  sourceUrl,
} from '../../packages/skills/src/web-search/context.mjs';
import { webSearchSettings } from '../../packages/skills/src/web-search/settings.mjs';
export { formatWebSearchContext } from '../../packages/skills/src/web-search/context.mjs';

const PROVIDERS = [
  {
    endpoint: 'https://html.duckduckgo.com/html/',
    linkClass: 'result__a',
    snippetClass: 'result__snippet',
  },
  {
    endpoint: 'https://lite.duckduckgo.com/lite/',
    linkClass: 'result-link',
    snippetClass: 'result-snippet',
  },
];
const MAX_QUERY = 500;
const MAX_RESPONSE = 256 * 1024;
const entities = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  copy: '©',
  reg: '®',
};

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (original, entity) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? original;
    const hexadecimal = entity[1]?.toLowerCase() === 'x';
    const point = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : '';
  });
}

function plainText(value, maximum) {
  return referenceText(
    decodeEntities(
      value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ').replace(/<[^>]*>/gu, ' '),
    ),
    maximum,
  );
}

function sensitiveQuery(value) {
  return (
    /\b(?:sk-[a-z\d_-]{8,}|hf_[a-z\d]{16,}|gsk_[a-z\d]{16,}|gh[pousr]_[a-z\d]{12,}|github_pat_[a-z\d_]{12,}|xox[baprs]-[a-z\d-]{10,}|AIza[a-z\d_-]{20,}|(?:AKIA|ASIA)[A-Z\d]{12,}|eyJ[a-z\d_-]{8,}\.[a-z\d_-]{8,}\.[a-z\d_-]{8,})\b/iu.test(
      value,
    ) ||
    /\b(?:Bearer|Basic)\s+[a-z\d+/_=.-]{8,}/iu.test(value) ||
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(value) ||
    /(?:api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|client[\s_-]*secret|password|secret|token|пароль|ключ[\s_-]*api)\s*["']?\s*[:=]\s*["']?[^\s"']{6,}/iu.test(
      value,
    ) ||
    /https?:\/\/[^\s/@]+:[^\s/@]+@/iu.test(value)
  );
}

function attribute(attributes, name) {
  const match = new RegExp(
    '(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
    'iu',
  ).exec(attributes);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : '';
}

function hasClass(attributes, name) {
  return attribute(attributes, 'class').split(/\s+/u).includes(name);
}

function snippetFrom(html, className) {
  for (const match of html.matchAll(/<(a|div|td)\b([^>]*)>/giu)) {
    if (!hasClass(match[2], className)) continue;
    const start = match.index + match[0].length;
    const end = new RegExp('<\\/' + match[1] + '\\s*>', 'iu').exec(html.slice(start));
    if (end) return plainText(html.slice(start, start + end.index), 600);
  }
  return '';
}

function parseResults(html, provider, accepts) {
  if (
    /\bid\s*=\s*["'](?:challenge-form|anomaly-modal)["']|\/anomaly\.js\b|Unfortunately, bots use DuckDuckGo too/iu.test(
      html,
    )
  )
    return null;
  const links = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)) {
    if (hasClass(match[1], provider.linkClass))
      links.push({
        href: attribute(match[1], 'href'),
        title: match[2],
        start: match.index,
        end: match.index + match[0].length,
      });
  }
  const sources = [];
  const seen = new Set();
  let remaining = MAX_SOURCE_CHARS;
  for (const [index, link] of links.entries()) {
    const url = sourceUrl(link.href);
    const title = plainText(link.title, 180);
    if (!url || !title || seen.has(url) || title.length + url.length > remaining || !accepts(url))
      continue;
    const snippet = snippetFrom(
      html.slice(link.end, links[index + 1]?.start ?? html.length),
      provider.snippetClass,
    ).slice(0, Math.min(600, remaining - title.length - url.length));
    sources.push({ title, url, snippet });
    seen.add(url);
    remaining -= title.length + url.length + snippet.length;
    if (sources.length === MAX_SOURCES) break;
  }
  if (links.length) return sources;
  return /class\s*=\s*["'][^"']*\bno-results\b|No results found for|No more results\./iu.test(html)
    ? []
    : null;
}

const wikipediaLanguages = new Set([
  'en',
  'ru',
  'de',
  'fr',
  'ja',
  'ko',
  'zh',
  'pt',
  'es',
  'it',
  'uk',
  'pl',
  'tr',
]);
function wikiResults(body, origin, accepts) {
  const value = JSON.parse(body);
  if (!Array.isArray(value.pages)) return null;
  return value.pages
    .slice(0, 20)
    .flatMap(({ key, title, excerpt }) => {
      if (typeof key !== 'string' || typeof title !== 'string' || key.length > 240) return [];
      const url = sourceUrl(origin + '/wiki/' + encodeURIComponent(key));
      if (!url || !accepts(url)) return [];
      return [
        { title: referenceText(title, 180), url, snippet: plainText(String(excerpt ?? ''), 600) },
      ];
    })
    .slice(0, MAX_SOURCES);
}

async function unlessAborted(operation, signal) {
  const pending = Promise.resolve(operation);
  if (signal.aborted) {
    void pending.catch(() => {});
    signal.throwIfAborted();
  }
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function responseText(response, signal) {
  if (!response.body) throw new Error();
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) {
    void response.body.cancel().catch(() => {});
    throw new Error();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await unlessAborted(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE) throw new Error();
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Sends only the current, bounded query to fixed HTTPS search pages; never visits result URLs. */
export class WebSearch {
  constructor({ fetchImpl = fetch, timeoutMs = 12000 } = {}) {
    if (
      typeof fetchImpl !== 'function' ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 30000
    )
      throw new Error('Invalid web search configuration.');
    Object.assign(this, { fetchImpl, timeoutMs });
  }

  async search(value, { signal, language, settings } = {}) {
    if (typeof value !== 'string')
      return { status: 'unavailable', query: '', sources: [], reason: 'invalid_query' };
    if (sensitiveQuery(value))
      return { status: 'unavailable', query: '', sources: [], reason: 'sensitive_query' };
    const query = value
      .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAX_QUERY);
    if (!query) return { status: 'unavailable', query, sources: [], reason: 'invalid_query' };
    const config = webSearchSettings(settings);
    const domains = config.domains ? config.domains.split(', ') : [];
    const accepts = (url) => {
      if (!domains.length) return true;
      const host = new URL(url).hostname;
      const match = domains.some((domain) => host === domain || host.endsWith('.' + domain));
      return config.exclude ? !match : match;
    };
    const wiki = config.engine === 'wikipedia';
    const locale = language?.split?.('-')[0];
    const wikiHost = (wikipediaLanguages.has(locale) ? locale : 'en') + '.wikipedia.org';
    const providers = wiki
      ? [{ endpoint: 'https://' + wikiHost + '/w/rest.php/v1/search/page' }]
      : PROVIDERS;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const timeout = timeoutController.signal;
    try {
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const unavailable = () => ({
        status: 'unavailable',
        query,
        sources: [],
        reason: signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'unavailable',
      });
      if (combined.aborted) return unavailable();
      for (const provider of providers) {
        try {
          combined.throwIfAborted();
          const url = new URL(provider.endpoint);
          url.searchParams.set('q', query);
          if (wiki) url.searchParams.set('limit', '20');
          const response = await unlessAborted(
            this.fetchImpl(url.href, {
              method: 'GET',
              redirect: 'error',
              credentials: 'omit',
              cache: 'no-store',
              referrerPolicy: 'no-referrer',
              signal: combined,
              headers: {
                accept: wiki ? 'application/json' : 'text/html, application/xhtml+xml;q=0.9',
                ...(wiki ? { 'user-agent': 'CapriCore/1.1 (https://capri-core.com)' } : {}),
                ...(typeof language === 'string' &&
                /^[a-z]{2,3}(?:-[a-z\d]{2,8}){0,3}$/iu.test(language)
                  ? { 'accept-language': language }
                  : {}),
              },
            }),
            combined,
          );
          if (
            response.status !== 200 ||
            response.redirected ||
            (response.url && new URL(response.url).origin !== url.origin) ||
            !(
              wiki
                ? /^application\/json(?:;|$)/iu
                : /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu
            ).test(response.headers.get('content-type') ?? '')
          ) {
            void response.body?.cancel().catch(() => {});
            continue;
          }
          const body = await responseText(response, combined);
          const sources = wiki
            ? wikiResults(body, url.origin, accepts)
            : parseResults(body, provider, accepts);
          if (sources && config.sort === 'title')
            sources.sort((left, right) => left.title.localeCompare(right.title));
          if (sources !== null)
            return {
              status: sources.length ? 'ok' : 'empty',
              query,
              sources,
              searchedAt: new Date().toISOString(),
            };
        } catch {
          if (combined.aborted) return unavailable();
        }
      }
      return unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
}
