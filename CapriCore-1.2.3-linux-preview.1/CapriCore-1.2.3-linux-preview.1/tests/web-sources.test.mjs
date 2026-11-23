// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicWebSourceUrl, webSources } from '../apps/desktop/web-sources.mjs';
import { formatWebSearchContext } from '../apps/desktop/web-search.mjs';

test('web source URLs allow public HTTP and HTTPS while retaining valid citation paths', () => {
  for (const url of [
    'https://example.com/article?q=public',
    'http://example.org/reference#details',
    'https://example.com./article',
  ])
    assert.equal(publicWebSourceUrl(url), url);
  assert.equal(publicWebSourceUrl('HTTPS://EXAMPLE.COM:443'), 'https://example.com/');
});

test('web source URLs reject executable schemes, credentials, ports and sensitive query parameters', () => {
  for (const url of [
    'file:///C:/Users/owner/private.txt',
    'javascript:alert(1)',
    'data:text/html,private',
    'https://owner:secret@example.com/',
    'https://example.com:8443/',
    'https://example.com/?api_key=private-value',
    'https://example.com/?access-token=private-value',
    'https://example.com/?%74oken=private-value',
    'https://example.com/?AUTHORIZATION=private-value',
    'https://example.com/?password=private-value',
    'https://example.com/?secret=private-value',
  ])
    assert.equal(publicWebSourceUrl(url), null, url);
});

test('web source URLs reject literal IPs and private host suffixes including final DNS dots', () => {
  for (const url of [
    'https://127.0.0.1/',
    'http://127.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://intranet/',
    ...['localhost', 'local', 'internal', 'home', 'lan', 'invalid', 'test', 'onion'].flatMap(
      (suffix) => ['', '.', '..'].map((ending) => `https://machine.${suffix}${ending}/private`),
    ),
  ])
    assert.equal(publicWebSourceUrl(url), null, url);
});

test('invalid or oversized web source URL values are rejected before use', () => {
  for (const value of [
    undefined,
    null,
    {},
    [],
    1,
    '',
    '/relative',
    'https://example.com/\nprivate',
    'https://example.com/with space',
    'https://example.com/' + 'a'.repeat(2048),
  ])
    assert.equal(publicWebSourceUrl(value), null);
});

test('web source metadata deduplicates canonically, keeps source order and strips non-display fields', () => {
  const values = [
    {
      title: ' First ',
      url: 'HTTPS://EXAMPLE.COM:443',
      snippet: 'Private raw snippet',
      credential: 'PRIVATE',
    },
    { title: 'Duplicate', url: 'https://example.com/' },
    { title: 'Unsafe', url: 'http://127.0.0.1/' },
    {
      title: '<element> & literal source',
      url: 'https://example.org/second',
      ownerHistory: 'PRIVATE',
    },
  ];
  assert.deepEqual(webSources(values), [
    { title: 'First', url: 'https://example.com/' },
    { title: '<element> & literal source', url: 'https://example.org/second' },
  ]);
  assert.equal(JSON.stringify(webSources(values)).includes('PRIVATE'), false);
});

test('web source metadata is limited to five references and bounded safe titles', () => {
  const sources = webSources(
    Array.from({ length: 20 }, (_, index) => ({
      title: '\u202e\u2066\n' + 'Reference '.repeat(40),
      url: 'https://example.com/' + index,
    })),
  );
  assert.equal(sources.length, 5);
  assert.deepEqual(
    sources.map(({ url }) => url),
    [0, 1, 2, 3, 4].map((index) => 'https://example.com/' + index),
  );
  assert.ok(
    sources.every(
      ({ title }) =>
        title.length <= 180 && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(title),
    ),
  );
  assert.deepEqual(webSources(null), []);
  assert.deepEqual(
    webSources(
      Array(10)
        .fill(null)
        .concat({ title: 'Beyond scan limit', url: 'https://example.com/ignored' }),
    ),
    [],
  );
});

test('formatted reference numbering matches the validated displayed source order', () => {
  const sources = webSources([
    { title: 'Unsafe', url: 'https://router.home./' },
    { title: '<element>', url: 'https://example.com/one' },
    { title: 'Second', url: 'https://example.com/two' },
  ]);
  const context = formatWebSearchContext({
    status: 'ok',
    sources: sources.map((source, index) => ({ ...source, snippet: 'Evidence ' + index })),
  });
  const formatted = JSON.parse(context.slice(context.lastIndexOf('\n') + 1)).sources;
  assert.deepEqual(
    formatted.map(({ number, title, url }) => ({ number, title, url })),
    sources.map((source, index) => ({ number: index + 1, ...source })),
  );
});
