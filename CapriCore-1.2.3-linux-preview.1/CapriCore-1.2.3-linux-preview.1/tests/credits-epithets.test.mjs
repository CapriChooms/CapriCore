// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import configured from '../config/hall-of-fame.json' with { type: 'json' };
import {
  assignEpithets,
  EPITHET_ADJECTIVES,
  EPITHET_CAPACITY,
  EPITHET_NOUNS,
  normalizeCreditNames,
  validateEpithet,
} from '../apps/desktop/credits-epithets.mjs';

test('curated English callsigns have at least 4096 distinct two-word combinations', () => {
  for (const words of [EPITHET_ADJECTIVES, EPITHET_NOUNS]) {
    assert(words.length >= 64);
    assert.equal(new Set(words).size, words.length);
    assert(Object.isFrozen(words));
    for (const word of words) assert.match(word, /^[A-Z][a-z]+$/);
  }
  assert.equal(EPITHET_CAPACITY, EPITHET_ADJECTIVES.length * EPITHET_NOUNS.length);
  assert(EPITHET_CAPACITY >= 4096);
  assert(validateEpithet('Neon Voyager'));
  for (const value of [
    null,
    1,
    {},
    'neon Voyager',
    'Neon voyager',
    'Neon  Voyager',
    ' Neon Voyager',
    'Neon Voyager ',
    'Neon\nVoyager',
    'Neon Voyager Extra',
    'Unknown Voyager',
    'Neon Unknown',
    '<img src=x>',
    'Neon <script>',
  ])
    assert.equal(validateEpithet(value), false);
});

test('assignment draws once per new identity and deduplicates names without altering inputs', () => {
  const names = ['Alice', 'ALICE', 'Bob', 'alice'];
  const previous = { alice: 'Neon Voyager' };
  const calls = [];
  const assigned = assignEpithets(names, previous, (maximum) => {
    calls.push(maximum);
    return 0;
  });
  assert.equal(Object.getPrototypeOf(assigned), null);
  assert.deepEqual(Object.keys(assigned), ['alice', 'bob']);
  assert.equal(assigned.alice, 'Neon Voyager');
  assert.notEqual(assigned.bob, assigned.alice);
  assert(validateEpithet(assigned.bob));
  assert.deepEqual(calls, [EPITHET_CAPACITY - 1]);
  assert.deepEqual(names, ['Alice', 'ALICE', 'Bob', 'alice']);
  assert.deepEqual(previous, { alice: 'Neon Voyager' });
});

test('existing callsigns survive reordered and recased rosters without reading randomness', () => {
  const initial = assignEpithets(['Alice', 'Bob'], {}, () => 0);
  const saved = JSON.parse(JSON.stringify(initial));
  const reopened = assignEpithets(['BOB', 'alice', 'Alice'], saved, () => {
    assert.fail('Saved callsigns must never be reassigned.');
  });
  assert.deepEqual(reopened, initial);
});

test('curated display names retain their spelling and reject ambiguous or malformed entries', () => {
  const names = ['  Major Supporter  ', 'Helper_Name', 'Друг'];
  assert.deepEqual(normalizeCreditNames(names), ['Major Supporter', 'Helper_Name', 'Друг']);
  assert.deepEqual(names, ['  Major Supporter  ', 'Helper_Name', 'Друг']);
  assert.deepEqual(normalizeCreditNames(), []);
  for (const invalid of [
    null,
    {},
    'Helper_Name',
    [''],
    ['   '],
    [1],
    ['Major Supporter', ' major supporter '],
    ['Helper\nName'],
    ['Helper\u0000Name'],
    ['Helper\u007fName'],
    ['a'.repeat(81)],
    Array.from({ length: 1001 }, (_, index) => `Helper ${index}`),
  ])
    assert.throws(() => normalizeCreditNames(invalid), /acknowledgements|display name/);
});

test('curated names share saved callsigns across tiers and require explicit acknowledgement', () => {
  const displayNames = ['Major Supporter', 'Helper_Name', 'ALICE'];
  const names = ['Alice', ...displayNames, 'major supporter', 'Helper_Name'];
  let draws = 0;
  const assigned = assignEpithets(
    names,
    {},
    () => {
      draws++;
      return 0;
    },
    displayNames,
  );
  assert.equal(draws, 3);
  assert.deepEqual(Object.keys(assigned), ['alice', 'major supporter', 'helper_name']);
  assert.equal(new Set(Object.values(assigned)).size, 3);
  const reopened = assignEpithets(
    [...names].reverse(),
    JSON.parse(JSON.stringify(assigned)),
    () => assert.fail('Shared identities must retain their saved callsigns.'),
    displayNames,
  );
  assert.deepEqual(reopened, assigned);
  for (const name of ['Major Supporter', 'Helper_Name'])
    assert.throws(() => assignEpithets([name]), /username/);
});

test('new identities use secure random draws and reject the biased remainder', (t) => {
  let draws = 0;
  t.mock.method(globalThis.crypto, 'getRandomValues', (sample) => {
    sample[0] = draws++ === 0 ? 0xffff_ffff : 7;
    return sample;
  });
  const assigned = assignEpithets(['Alice']);
  assert.equal(draws, 2);
  assert.equal(assigned.alice, `${EPITHET_ADJECTIVES[0]} ${EPITHET_NOUNS[7]}`);
});

test('a broken secure random source fails within a fixed number of attempts', (t) => {
  let draws = 0;
  t.mock.method(globalThis.crypto, 'getRandomValues', (sample) => {
    draws++;
    sample[0] = 0xffff_ffff;
    return sample;
  });
  assert.throws(() => assignEpithets(['Alice']), /Secure randomness/);
  assert.equal(draws, 64);
});

test('the complete shipped roster has one saved unique callsign per canonical identity', () => {
  const displayNames = [...configured.majorSupporters, ...configured.communityHelpers];
  const names = [
    ...configured.team.map(({ name }) => name),
    ...configured.supporters,
    ...displayNames,
  ];
  const identities = new Set(names.map((name) => name.toLowerCase()));
  assert(configured.supporters.length > 0);
  assert.equal(Object.keys(configured.epithets).length, identities.size);
  assert.equal(new Set(Object.values(configured.epithets)).size, identities.size);
  for (const [login, epithet] of Object.entries(configured.epithets)) {
    assert(identities.has(login));
    assert.equal(login, login.toLowerCase());
    assert(validateEpithet(epithet));
  }
  const restored = assignEpithets(
    names,
    configured.epithets,
    () => {
      assert.fail('Reopening the shipped roster must not read randomness.');
    },
    displayNames,
  );
  assert.deepEqual({ ...restored }, configured.epithets);

  let draws = 0;
  const generated = assignEpithets(
    names,
    {},
    (maximum) => {
      assert.equal(maximum, EPITHET_CAPACITY - draws);
      draws++;
      return maximum - 1;
    },
    displayNames,
  );
  assert.equal(draws, identities.size);
  assert.equal(new Set(Object.values(generated)).size, identities.size);
});

test('all combinations can be filled without retries and exhaustion fails before drawing', () => {
  const names = Array.from({ length: EPITHET_CAPACITY }, (_, index) => `user${index}`);
  let draws = 0;
  const filled = assignEpithets(names, {}, (maximum) => {
    assert.equal(maximum, EPITHET_CAPACITY - draws);
    draws++;
    return 0;
  });
  assert.equal(draws, EPITHET_CAPACITY);
  assert.equal(new Set(Object.values(filled)).size, EPITHET_CAPACITY);
  assert.throws(
    () => assignEpithets([...names, 'OneMore'], filled, () => assert.fail('No room remains.')),
    /exhausted/,
  );
});

test('malformed saved entries and invalid random selections are rejected', () => {
  const names = ['Alice', 'Bob'];
  const malformed = [
    null,
    [],
    'Neon Voyager',
    { Alice: 'Neon Voyager' },
    { 'bad login': 'Neon Voyager' },
    { unknown: 'Neon Voyager' },
    { alice: 'Unknown Voyager' },
    { alice: 'Neon Voyager', bob: 'Neon Voyager' },
    { alice: '<img src=x>' },
    JSON.parse('{"__proto__":"Neon Voyager"}'),
    Object.create({ alice: 'Neon Voyager' }),
    { [Symbol('alice')]: 'Neon Voyager' },
    Object.defineProperty({}, 'alice', { enumerable: false, value: 'Neon Voyager' }),
    Object.defineProperty({}, 'alice', {
      enumerable: true,
      get() {
        assert.fail('Saved mapping getters must not run.');
      },
    }),
  ];
  for (const previous of malformed) assert.throws(() => assignEpithets(names, previous), /saved/);
  for (const choice of [-1, EPITHET_CAPACITY, 0.5, NaN, Infinity, '0', undefined])
    assert.throws(() => assignEpithets(['Alice'], {}, () => choice), /random selection/);
  for (const invalid of [null, ['Full Name'], ['<img>'], [1], ['a'.repeat(40)]])
    assert.throws(() => assignEpithets(invalid), /username/);
  assert.throws(() => assignEpithets(['Alice'], {}, 0), /random source/);
});

test('valid usernames that resemble object properties remain ordinary own map entries', () => {
  const names = ['constructor', 'toString', 'hasOwnProperty'];
  const assigned = assignEpithets(names, {}, () => 0);
  assert.equal(Object.getPrototypeOf(assigned), null);
  assert.deepEqual(Object.keys(assigned), ['constructor', 'tostring', 'hasownproperty']);
  assert.equal(new Set(Object.values(assigned)).size, 3);
  const restored = assignEpithets(names, JSON.parse(JSON.stringify(assigned)), () => {
    assert.fail('Saved entries must be read as data.');
  });
  assert.deepEqual(restored, assigned);
});
