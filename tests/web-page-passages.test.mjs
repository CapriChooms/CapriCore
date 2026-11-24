// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PASSAGE_CHARS,
  bestPassage,
  pageParagraphs,
  passageFromPage,
  queryTerms,
} from '../packages/skills/src/web-search/passages.mjs';
import {
  MAX_PAGE_BYTES,
  fetchPage,
  privateAddress,
  withPagePassages,
} from '../apps/desktop/web-page-reader.mjs';
import { WebSearch } from '../apps/desktop/web-search.mjs';
import { formatWebSearchContext } from '../packages/skills/src/web-search/context.mjs';
import { prepareInternetSearch } from '../packages/skills/src/web-search/index.mjs';

const NL = String.fromCharCode(10);
const article = [
  '<html><head><title>News</title><style>p{color:red}</style>',
  '<script>var secret = "Nvidia CEO script text";</script></head><body>',
  '<nav><a href="/">Home</a> <a href="/ceo">Nvidia CEO menu entry that should vanish</a></nav>',
  '<h1>Chip maker update</h1>',
  '<p>The company opened a new office in Austin this spring &amp; hired 200 people.</p>',
  '<p>Jensen Huang remains chief executive of Nvidia, the board confirmed on Tuesday.</p>',
  '<p>Shares closed at $182.40, up 2.1% on the day.</p>',
  '<div>Sign up</div><footer>Copyright Nvidia CEO footer text</footer>',
  '<!-- Nvidia CEO comment --></body></html>',
].join(NL);

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const page = (body, init = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });

test('question words drop filler and repeats', () => {
  assert.deepEqual(queryTerms('Is Jensen Huang the CEO of Nvidia? Nvidia CEO'), [
    'jensen',
    'huang',
    'ceo',
    'nvidia',
  ]);
  assert.deepEqual(queryTerms('what is the'), []);
  assert.deepEqual(queryTerms(42), []);
  assert.equal(queryTerms('a b c d e f g h i j k l m n o p q r s t').length <= 12, true);
});

test('pages become paragraphs without scripts, menus, comments or markup', () => {
  const paragraphs = pageParagraphs(article);
  assert.deepEqual(paragraphs, [
    'The company opened a new office in Austin this spring & hired 200 people.',
    'Jensen Huang remains chief executive of Nvidia, the board confirmed on Tuesday.',
    'Shares closed at $182.40, up 2.1% on the day.',
  ]);
  assert.deepEqual(pageParagraphs(''), []);
  assert.deepEqual(pageParagraphs(null), []);
  assert.deepEqual(
    pageParagraphs('<p>same long enough paragraph here</p><p>same long enough paragraph here</p>'),
    ['same long enough paragraph here'],
  );
  assert.deepEqual(pageParagraphs('<p>before the unterminated block here</p><script>var x = 1;'), [
    'before the unterminated block here',
  ]);
  assert.deepEqual(pageParagraphs('<table><tr><td>Price</td><td>182.40 USD</td></tr></table>'), [
    'Price | 182.40 USD',
  ]);
});

test('the best matching paragraph comes back with its neighbours', () => {
  const passage = passageFromPage(article, 'is Jensen Huang still Nvidia CEO');
  const lines = passage.split(NL);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /Jensen Huang remains chief executive/);
  assert.match(lines[2], /Shares closed/);
  assert.doesNotMatch(passage, /script|menu|footer|comment/);
});

test('a page with nothing relevant gives no passage', () => {
  assert.equal(passageFromPage(article, 'banana bread recipe'), '');
  assert.equal(passageFromPage(article, 'the of and'), '');
  assert.equal(bestPassage([], 'nvidia'), '');
  assert.equal(
    bestPassage(['only nvidia is mentioned in this menu line'], 'nvidia stock price'),
    '',
  );
  assert.match(bestPassage(['nvidia stock closed at 182'], 'nvidia stock price'), /182/);
});

test('passages stay within the size limit', () => {
  const long = Array.from(
    { length: 50 },
    (_, i) => 'Nvidia paragraph ' + i + ' ' + 'word '.repeat(150),
  );
  const passage = bestPassage(long, 'nvidia paragraph');
  assert.ok(passage.length <= MAX_PASSAGE_CHARS);
  assert.ok(bestPassage(long, 'nvidia paragraph', 100).length <= 100);
});

test('private, loopback and reserved addresses are recognised', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.216',
    '192.168.1.1',
    '172.16.5.5',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:10.0.0.1',
    'not-an-address',
  ])
    assert.equal(privateAddress(address), true, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])
    assert.equal(privateAddress(address), false, address);
});

test('a page on a private address is never requested', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return page(article);
  };
  const local = async () => [{ address: '10.0.0.216', family: 4 }];
  assert.equal(await fetchPage('https://intranet.example.com/', { fetchImpl, resolve: local }), '');
  const mixed = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  assert.equal(await fetchPage('https://rebind.example.com/', { fetchImpl, resolve: mixed }), '');
  const failing = async () => {
    throw new Error('ENOTFOUND');
  };
  assert.equal(await fetchPage('https://gone.example.com/', { fetchImpl, resolve: failing }), '');
  for (const bad of [
    'http://127.0.0.1/',
    'https://localhost/x',
    'file:///c:/x',
    'https://u:p@example.com/',
  ])
    assert.equal(await fetchPage(bad, { fetchImpl, resolve: publicLookup }), '', bad);
  assert.equal(calls.length, 0);
});

test('redirects are followed only to public hosts and only a few times', async () => {
  const hops = [];
  const resolve = async (host) => [
    { address: host === 'inside.example.com' ? '192.168.0.5' : '93.184.216.34', family: 4 },
  ];
  const fetchImpl = async (url, options) => {
    hops.push(url);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    if (url === 'https://a.example.com/')
      return new Response(null, { status: 302, headers: { location: '/moved' } });
    if (url === 'https://a.example.com/moved') return page(article);
    if (url === 'https://b.example.com/')
      return new Response(null, {
        status: 301,
        headers: { location: 'https://inside.example.com/admin' },
      });
    if (url.startsWith('https://loop.example.com/'))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://loop.example.com/' + hops.length },
      });
    return new Response(null, { status: 302 });
  };
  assert.match(await fetchPage('https://a.example.com/', { fetchImpl, resolve }), /Jensen Huang/);
  assert.equal(await fetchPage('https://b.example.com/', { fetchImpl, resolve }), '');
  assert.ok(!hops.includes('https://inside.example.com/admin'));
  const before = hops.length;
  assert.equal(await fetchPage('https://loop.example.com/', { fetchImpl, resolve }), '');
  assert.equal(hops.length - before, 4);
  assert.equal(await fetchPage('https://nolocation.example.com/', { fetchImpl, resolve }), '');
});

test('non-pages, errors and oversized pages are handled', async () => {
  const options = { resolve: publicLookup };
  const pdf = async () =>
    new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
  assert.equal(await fetchPage('https://example.com/a.pdf', { ...options, fetchImpl: pdf }), '');
  const missing = async () => page('gone', { status: 404 });
  assert.equal(await fetchPage('https://example.com/x', { ...options, fetchImpl: missing }), '');
  const broken = async () => {
    throw new Error('socket hang up');
  };
  assert.equal(await fetchPage('https://example.com/x', { ...options, fetchImpl: broken }), '');
  const huge = async () => page('x'.repeat(MAX_PAGE_BYTES + 5000));
  const text = await fetchPage('https://example.com/big', { ...options, fetchImpl: huge });
  assert.equal(text.length, MAX_PAGE_BYTES);
});

test('only the first pages are opened and unreadable ones keep their snippet', async () => {
  const sources = ['one', 'two', 'three', 'four'].map((name) => ({
    title: name,
    url: 'https://' + name + '.example.com/',
    snippet: 'snippet ' + name,
  }));
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.includes('one')) return page(article);
    if (url.includes('two')) return page('<p>Nothing relevant on this page at all, sorry.</p>');
    throw new Error('down');
  };
  const result = await withPagePassages(sources, 'Jensen Huang Nvidia CEO', {
    fetchImpl,
    resolve: publicLookup,
  });
  assert.equal(asked.length, 3);
  assert.match(result[0].snippet, /Jensen Huang remains chief executive/);
  assert.equal(result[0].page, true);
  assert.deepEqual(result.slice(1), sources.slice(1));
  assert.deepEqual(await withPagePassages([], 'x'), []);
});

test('a thin or boilerplate passage never replaces the search snippet', async () => {
  const junk =
    '<h1>NVIDIA Corporation (NVDA) Stock Price, News, Quote</h1>' +
    '<p>Oops, something went wrong with the NVIDIA stock price</p>' +
    '<p>Skip to main content about the NVIDIA stock price</p>' +
    '<p>Please enable JavaScript to see the NVIDIA stock price today</p>';
  assert.deepEqual(pageParagraphs(junk), ['NVIDIA Corporation (NVDA) Stock Price, News, Quote']);
  const fetchImpl = async () => page(junk);
  const sources = [
    { title: 'Quote', url: 'https://finance.example.com/nvda', snippet: 'NVDA 182.40 USD' },
  ];
  const options = { fetchImpl, resolve: publicLookup };
  assert.deepEqual(await withPagePassages(sources, 'nvidia stock price', options), sources);
  // A real passage shorter than a long snippet is not used either.
  const long = [{ ...sources[0], snippet: 'detail '.repeat(60) }];
  const real = async () => page(article);
  const kept = await withPagePassages(long, 'Jensen Huang Nvidia CEO', {
    ...options,
    fetchImpl: real,
  });
  assert.deepEqual(kept, long);
});

test('a slow page is abandoned at the time limit', async () => {
  const fetchImpl = (_url, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  const sources = [{ title: 't', url: 'https://slow.example.com/', snippet: 'kept' }];
  const started = Date.now();
  const result = await withPagePassages(sources, 'nvidia', {
    fetchImpl,
    resolve: publicLookup,
    timeoutMs: 200,
  });
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(result, sources);
});

const results =
  '<a class="result__a" href="https://news.example.com/nvidia">Nvidia leadership</a>' +
  '<a class="result__snippet">Short search snippet.</a>';

test('search with page reading puts the passage into the model context', async () => {
  const fetchImpl = async (url) =>
    url.startsWith('https://html.duckduckgo.com/') ? page(results) : page(article);
  const search = new WebSearch({ fetchImpl, readPages: true, resolve: publicLookup });
  const result = await search.search('is Jensen Huang still Nvidia CEO');
  assert.equal(result.status, 'ok');
  assert.match(result.sources[0].snippet, /Jensen Huang remains chief executive/);
  const context = formatWebSearchContext(result);
  assert.match(context, /Jensen Huang remains chief executive/);
  assert.match(context, /Shares closed at \$182\.40/);
  assert.ok(context.length <= 6000);
});

test('search without page reading still never opens result pages', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return page(results);
  };
  const result = await new WebSearch({ fetchImpl }).search('nvidia ceo');
  assert.equal(result.sources[0].snippet, 'Short search snippet.');
  assert.equal(asked.length, 1);
});

test('five long passages still fit the context limit', () => {
  const sources = Array.from({ length: 5 }, (_, i) => ({
    title: 'Source ' + i,
    url: 'https://s' + i + '.example.com/page',
    snippet: 'word '.repeat(400),
    page: true,
  }));
  const at = { status: 'ok', searchedAt: '2026-11-23T10:00:00.000Z' };
  const context = formatWebSearchContext({ ...at, sources });
  assert.ok(context.length > 4500 && context.length <= 6000);
  assert.match(context, /Answer from these passages/);
  // Without page passages the original limits and wording still apply.
  const plain = formatWebSearchContext({
    ...at,
    sources: sources.map(({ page: _page, ...source }) => source),
  });
  assert.ok(plain.length < context.length);
  assert.match(plain, /only search snippets were retrieved/);
  assert.ok(
    JSON.parse(plain.slice(plain.indexOf('{'))).sources.every((s) => s.snippet.length <= 600),
  );
});

// A body whose cancel() rejects, to exercise the swallowed cancel errors.
const rejectingBody = (chunks = []) => ({
  getReader() {
    let next = 0;
    return {
      read: async () =>
        next < chunks.length ? { done: false, value: chunks[next++] } : { done: true },
      cancel: () => Promise.reject(new Error('already closed')),
    };
  },
  cancel: () => Promise.reject(new Error('already closed')),
});
const fakeResponse = (status, headers, body) => ({ status, headers: new Headers(headers), body });

test('numeric and unknown character references decode or stay as written', () => {
  assert.deepEqual(
    pageParagraphs(
      '<p>Rock &amp; roll &#65;&#x42;&#X43; &#0; &#xD800; &#1114112; &#x1F600; &zzzzz; ends here</p>',
    ),
    ['Rock & roll ABC 😀 &zzzzz; ends here'],
  );
});

test('a query with no words or with many words yields only the usable terms', () => {
  assert.deepEqual(queryTerms('!!! ???'), []);
  const terms = queryTerms(
    'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi',
  );
  assert.equal(terms.length, 12);
  assert.equal(terms[0], 'alpha');
});

test('a page keeps at most 400 paragraphs', () => {
  const html = Array.from(
    { length: 450 },
    (_, index) => `<p>Paragraph number ${index} carries enough words for the reader.</p>`,
  ).join('');
  assert.equal(pageParagraphs(html).length, 400);
});

test('private-range edges are recognised at their boundaries', () => {
  assert.equal(privateAddress('192.0.0.8'), true);
  assert.equal(privateAddress('192.1.1.1'), false);
  assert.equal(privateAddress('198.19.0.1'), true);
  assert.equal(privateAddress('198.20.0.1'), false);
  assert.equal(privateAddress('224.0.0.1'), true);
});

test('a response without a body or a content type gives no page text', async () => {
  const noBody = await fetchPage('https://example.com/a', {
    fetchImpl: async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }),
    resolve: publicLookup,
  });
  assert.equal(noBody, '');
  const noType = await fetchPage('https://example.com/a', {
    fetchImpl: async () => fakeResponse(200, {}, rejectingBody([Buffer.from('<p>text</p>')])),
    resolve: publicLookup,
  });
  assert.equal(noType, '');
});

test('a page body is read even when cancelling it fails', async () => {
  const text = await fetchPage('https://example.com/a', {
    fetchImpl: async () =>
      fakeResponse(200, { 'content-type': 'text/html' }, rejectingBody([Buffer.from('<p>Hi</p>')])),
    resolve: publicLookup,
  });
  assert.equal(text, '<p>Hi</p>');
});

test('redirects without a body or without a location end the fetch', async () => {
  const hops = [];
  const text = await fetchPage('https://example.com/a', {
    fetchImpl: async (url) => {
      hops.push(url);
      // The second hop redirects without a location, which ends the fetch.
      return hops.length === 1
        ? new Response(null, { status: 302, headers: { location: '/next' } })
        : new Response(null, { status: 302 });
    },
    resolve: publicLookup,
  });
  assert.equal(text, '');
  assert.deepEqual(hops, ['https://example.com/a', 'https://example.com/next']);
  const noLocation = await fetchPage('https://example.com/b', {
    fetchImpl: async () => fakeResponse(302, {}, rejectingBody()),
    resolve: publicLookup,
  });
  assert.equal(noLocation, '');
});

test('a redirect whose body cannot be cancelled still follows the location', async () => {
  const hops = [];
  const text = await fetchPage('https://example.com/a', {
    fetchImpl: async (url) => {
      hops.push(url);
      return hops.length === 1
        ? fakeResponse(301, { location: 'https://example.com/final' }, rejectingBody())
        : fakeResponse(200, { 'content-type': 'text/plain' }, rejectingBody([Buffer.from('ok')]));
    },
    resolve: publicLookup,
  });
  assert.equal(text, 'ok');
  assert.equal(hops[1], 'https://example.com/final');
});

test('an error page with an unreadable body gives no text', async () => {
  const text = await fetchPage('https://example.com/a', {
    fetchImpl: async () => fakeResponse(404, { 'content-type': 'text/html' }, rejectingBody()),
    resolve: publicLookup,
  });
  assert.equal(text, '');
});

test('the language header is sent only when it is a well-formed language tag', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers['accept-language']);
    return page('<p>empty</p>');
  };
  for (const language of ['en-US', 'bad value!', undefined]) {
    await fetchPage('https://example.com/a', { fetchImpl, resolve: publicLookup, language });
  }
  assert.deepEqual(seen, ['en-US', undefined, undefined]);
});

test('a source without a snippet still takes the page passage', async () => {
  const result = await withPagePassages(
    [{ title: 'News', url: 'https://example.com/news' }],
    'Jensen Huang Nvidia CEO',
    { fetchImpl: async () => page(article), resolve: publicLookup },
  );
  assert.equal(result[0].page, true);
  assert.match(result[0].snippet, /Jensen Huang/u);
});

test('the page flag switches the model context to passage wording', async () => {
  const search = (sources) => async () => ({
    status: 'ok',
    query: 'Jensen Huang Nvidia CEO',
    sources,
  });
  const passage = {
    title: 'Passage page',
    url: 'https://news.example.com/nvidia',
    snippet: 'Jensen Huang remains chief executive of Nvidia.',
    page: true,
  };
  const snippet = {
    title: 'Snippet page',
    url: 'https://other.example.com/nvidia',
    snippet: 'Only a search snippet.',
  };
  const signal = new AbortController().signal;
  const withPassage = await prepareInternetSearch({
    query: 'Jensen Huang Nvidia CEO',
    signal,
    search: search([passage, snippet]),
  });
  assert.match(withPassage.context, /Jensen Huang remains chief executive/u);
  assert.match(withPassage.context, /A longer entry is the passage of that page/u);
  assert.doesNotMatch(withPassage.context, /only search snippets were retrieved/u);

  const snippetsOnly = await prepareInternetSearch({
    query: 'Jensen Huang Nvidia CEO',
    signal,
    search: search([snippet]),
  });
  assert.match(snippetsOnly.context, /only search snippets were retrieved/u);
  assert.doesNotMatch(snippetsOnly.context, /A longer entry/u);
});
