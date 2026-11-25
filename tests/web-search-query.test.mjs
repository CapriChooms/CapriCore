// SPDX-License-Identifier: GPL-3.0-only
// Run: node --test tests/web-search-query.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchQuery } from '../packages/skills/src/web-search/query.mjs';
import { prepareInternetSearch } from '../packages/skills/src/web-search/index.mjs';

const cases = [
  // the owner's real requests that DuckDuckGo answered with a bot challenge
  ['Can you look up the NVIDIA stock price right now?', 'the NVIDIA stock price right now?'],
  [
    'Go on to Google and just Google whatever the NVIDIA stock price is and tell me what it what you find.',
    'the NVIDIA stock price is',
  ],
  [
    'Capri, uh, could you please search the web for cheap flights to Denver for me',
    'cheap flights to Denver',
  ],
  [
    'Hey Capri, look up who won the Super Bowl last year, thanks!',
    'who won the Super Bowl last year',
  ],
  ['I want you to do a quick google search for rust async traits', 'rust async traits'],
  ['search for best pizza in Atlanta on Google', 'best pizza in Atlanta'],
  ['um find out when the next SpaceX launch is and let me know', 'when the next SpaceX launch is'],
  // plain questions and keyword queries pass through
  ['who won the super bowl last year?', 'who won the super bowl last year?'],
  ['what is the weather in Atlanta today', 'what is the weather in Atlanta today'],
  ['nvidia stock price', 'nvidia stock price'],
  ['  spaced\n  out   query  ', 'spaced out query'],
  // words that are only commands after an opener stay when they lead the message
  ['Google stock price', 'Google stock price'],
  ['For Whom the Bell Tolls summary', 'For Whom the Bell Tolls summary'],
  ['find my iphone', 'find my iphone'],
  ['check engine light meaning', 'check engine light meaning'],
];

for (const [input, expected] of cases)
  test('searchQuery: ' + input.trim().slice(0, 50), () =>
    assert.equal(searchQuery(input), expected),
  );

test('searchQuery keeps the original when nothing useful is left', () => {
  assert.equal(searchQuery('Can you search for it please?'), 'Can you search for it please?');
  assert.equal(searchQuery('search'), 'search');
  assert.equal(searchQuery(''), '');
});

test('searchQuery leaves non-strings alone and is stable when applied twice', () => {
  assert.equal(searchQuery(undefined), undefined);
  for (const [input] of cases) assert.equal(searchQuery(searchQuery(input)), searchQuery(input));
});

test('prepareInternetSearch sends the cleaned query to the search port', async () => {
  const seen = [];
  const result = await prepareInternetSearch({
    query: 'Can you look up the NVIDIA stock price right now?',
    language: 'en',
    signal: new AbortController().signal,
    search: async (query) => {
      seen.push(query);
      return {
        status: 'ok',
        query,
        searchedAt: new Date().toISOString(),
        sources: [{ title: 'NVDA', url: 'https://example.com/nvda', snippet: 'Price.' }],
      };
    },
  });
  assert.deepEqual(seen, ['the NVIDIA stock price right now?']);
  assert.equal(result.status, 'ok');
  assert.equal(result.sources.length, 1);
});
