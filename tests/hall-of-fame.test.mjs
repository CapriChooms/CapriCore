// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import configured from '../config/hall-of-fame.json' with { type: 'json' };
import { assignEpithets, validateEpithet } from '../apps/desktop/credits-epithets.mjs';
import {
  collaboratorArguments,
  collectSupporters,
  normalizeSupporters,
  refreshHallOfFame,
  validateRepository,
} from '../tools/community/update-hall-of-fame.mjs';

test('the shipped roster is a static public snapshot with only approved fields', () => {
  assert.deepEqual(Object.keys(configured).sort(), [
    'communityHelpers',
    'epithets',
    'majorSupporters',
    'schemaVersion',
    'snapshotDate',
    'source',
    'supporters',
    'team',
  ]);
  assert.equal(configured.schemaVersion, 1);
  assert.equal(configured.source, 'CapriChooms/Capri');
  assert.match(configured.snapshotDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(
    new Date(configured.snapshotDate).toISOString().slice(0, 10),
    configured.snapshotDate,
  );
  assert(configured.supporters.length > 0);
  assert.deepEqual(configured.supporters, normalizeSupporters(configured.supporters));
  assert.deepEqual(configured.team, [
    { name: 'Overyx', role: 'Developer' },
    { name: 'v1rch', role: 'Discord developer' },
    { name: 'Leberrr', role: 'Discord moderator' },
  ]);
});

test('public usernames are case-insensitively deduplicated and naturally sorted', () => {
  assert.deepEqual(normalizeSupporters(['User10', 'alice', 'User2', 'ALICE', 'user10']), [
    'alice',
    'User2',
    'User10',
  ]);
  for (const value of [
    null,
    ['Full Name'],
    ['person@example.invalid'],
    ['<img>'],
    ['-leading'],
    ['trailing-'],
    ['a'.repeat(40)],
    [{ login: 'user', email: 'private@example.invalid', permissions: { admin: true } }],
  ])
    assert.throws(() => normalizeSupporters(value), /username|usernames/);
});

test('repository arguments cannot change the endpoint, host, or command', () => {
  for (const repository of [
    '',
    '--verbose',
    'https://github.com/owner/repo',
    '../repo',
    'owner/../repo',
    'owner/repo?permission=admin',
    'owner/repo;whoami',
    'owner/repo\n--verbose',
  ])
    assert.throws(() => validateRepository(repository));
  const args = collaboratorArguments('CapriChooms/Capri', 2);
  assert(args.includes('github.com'));
  assert(args.includes('GET'));
  assert(
    args.includes('repos/CapriChooms/Capri/collaborators?affiliation=all&per_page=100&page=2'),
  );
  assert.equal(args.at(-1), 'map(.login)');
  assert.throws(() => collaboratorArguments('CapriChooms/Capri', 0));
});

test('pagination includes all pages and handles an exact multiple of page size', () => {
  const pages = [];
  const supporters = collectSupporters('CapriChooms/Capri', (_repository, page) => {
    pages.push(page);
    return page <= 2 ? Array.from({ length: 100 }, (_, i) => `User${(page - 1) * 100 + i}`) : [];
  });
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(supporters.length, 200);
  assert.equal(supporters.at(-1), 'User199');
});

test('overlapping collaborator pages credit each canonical nickname once', () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => `User${index}`);
  const pages = [];
  const supporters = collectSupporters('CapriChooms/Capri', (_repository, page) => {
    pages.push(page);
    return page === 1 ? firstPage : ['USER0', 'user99', 'NewSupporter'];
  });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(supporters.length, 101);
  assert(supporters.includes('User0'));
  assert(supporters.includes('User99'));
  assert(supporters.includes('NewSupporter'));
  assert.equal(new Set(supporters.map((name) => name.toLowerCase())).size, supporters.length);
});

test('snapshot contains only the public contract and the specified team roles', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'capri-hall-of-fame-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'hall-of-fame.json');
  refreshHallOfFame({
    output,
    queryPage: () => ['Supporter2', 'Supporter1'],
    now: new Date('2026-11-07T00:00:00Z'),
    randomIndex: () => 0,
  });
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), {
    schemaVersion: 1,
    team: [
      { name: 'Overyx', role: 'Developer' },
      { name: 'v1rch', role: 'Discord developer' },
      { name: 'Leberrr', role: 'Discord moderator' },
    ],
    supporters: ['Supporter1', 'Supporter2'],
    epithets: {
      ...assignEpithets(['Overyx', 'v1rch', 'Leberrr', 'Supporter1', 'Supporter2'], {}, () => 0),
    },
    snapshotDate: '2026-11-07',
    source: 'CapriChooms/Capri',
  });
  assert.deepEqual(readdirSync(directory), ['hall-of-fame.json']);
});

test('failed or malformed later pages preserve the previous snapshot byte for byte', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'capri-hall-of-fame-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'hall-of-fame.json');
  const previous = '{"previous":"snapshot"}\n';
  writeFileSync(output, previous);
  const firstPage = Array.from({ length: 100 }, (_, i) => `User${i}`);
  for (const queryPage of [
    (_repository, page) => {
      if (page === 1) return firstPage;
      throw new Error('Access unavailable');
    },
    (_repository, page) => (page === 1 ? firstPage : [{ login: 'user', privateMetadata: true }]),
    () => Array.from({ length: 101 }, (_, i) => `User${i}`),
  ]) {
    assert.throws(() => refreshHallOfFame({ output, queryPage }));
    assert.equal(readFileSync(output, 'utf8'), previous);
    assert.deepEqual(readdirSync(directory), ['hall-of-fame.json']);
  }
});

test('successful refresh retains permanent credits and updates current login capitalization', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'capri-hall-of-fame-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'hall-of-fame.json');
  writeFileSync(
    output,
    JSON.stringify({
      schemaVersion: 1,
      source: 'CapriChooms/Capri',
      supporters: ['FormerSupporter', 'currentuser'],
      epithets: {
        overyx: 'Neon Voyager',
        formersupporter: 'Quantum Explorer',
        currentuser: 'Cosmic Wanderer',
      },
      privateMetadata: 'must-not-be-forwarded',
    }),
  );
  const manifest = refreshHallOfFame({
    output,
    queryPage: () => ['CurrentUser', 'NewSupporter'],
    randomIndex: () => 0,
  });
  assert.deepEqual(manifest.supporters, ['CurrentUser', 'FormerSupporter', 'NewSupporter']);
  assert.equal(manifest.epithets.overyx, 'Neon Voyager');
  assert.equal(manifest.epithets.formersupporter, 'Quantum Explorer');
  assert.equal(manifest.epithets.currentuser, 'Cosmic Wanderer');
  for (const login of ['v1rch', 'leberrr', 'newsupporter'])
    assert(validateEpithet(manifest.epithets[login]));
  assert.equal(new Set(Object.values(manifest.epithets)).size, 6);
  assert(!readFileSync(output, 'utf8').includes('must-not-be-forwarded'));
});

test('refresh preserves curated tiers, display names and callsigns shared across groups', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'capri-hall-of-fame-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'hall-of-fame.json');
  const majorSupporters = ['Major Supporter', 'CurrentUser'];
  const communityHelpers = ['Helper_Name', 'Overyx'];
  const previous = {
    schemaVersion: 1,
    source: 'CapriChooms/Capri',
    majorSupporters,
    communityHelpers,
    supporters: ['FormerSupporter', 'currentuser'],
    epithets: {
      overyx: 'Neon Voyager',
      'major supporter': 'Quantum Explorer',
      helper_name: 'Cosmic Wanderer',
      currentuser: 'Stellar Wayfarer',
      formersupporter: 'Prismatic Trailblazer',
    },
  };
  writeFileSync(output, JSON.stringify(previous));
  let draws = 0;
  const manifest = refreshHallOfFame({
    output,
    queryPage: () => ['CURRENTUSER', 'NewSupporter'],
    randomIndex: () => {
      draws++;
      return 0;
    },
  });
  assert.deepEqual(manifest.majorSupporters, majorSupporters);
  assert.deepEqual(manifest.communityHelpers, communityHelpers);
  assert.deepEqual(manifest.supporters, ['CURRENTUSER', 'FormerSupporter', 'NewSupporter']);
  assert.equal(draws, 3);
  for (const [name, epithet] of Object.entries(previous.epithets))
    assert.equal(manifest.epithets[name], epithet);
  assert.equal(Object.keys(manifest.epithets).length, 8);
  assert.equal(new Set(Object.values(manifest.epithets)).size, 8);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), {
    ...manifest,
    epithets: { ...manifest.epithets },
  });
  assert.deepEqual(readdirSync(directory), ['hall-of-fame.json']);
});

test('legacy schema 1 snapshots receive missing callsigns once and preserve them on later refresh', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'capri-hall-of-fame-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'hall-of-fame.json');
  writeFileSync(
    output,
    JSON.stringify({
      schemaVersion: 1,
      source: 'CapriChooms/Capri',
      supporters: ['FormerSupporter', 'currentuser', 'Overyx'],
    }),
  );
  let draws = 0;
  const first = refreshHallOfFame({
    output,
    queryPage: () => ['CurrentUser'],
    randomIndex: () => {
      draws++;
      return 0;
    },
  });
  assert.equal(draws, 5);
  assert.equal(Object.keys(first.epithets).length, 5);
  const reopened = refreshHallOfFame({
    output,
    queryPage: () => ['CURRENTUSER', 'OVERYX'],
    randomIndex: () => assert.fail('Existing users must retain their saved callsigns.'),
  });
  assert.deepEqual(reopened.epithets, first.epithets);
  assert.deepEqual(reopened.supporters, ['CURRENTUSER', 'FormerSupporter', 'OVERYX']);
  assert.deepEqual(readdirSync(directory), ['hall-of-fame.json']);
});

test('an invalid or incompatible existing snapshot is preserved on refresh', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'capri-hall-of-fame-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'hall-of-fame.json');
  for (const previous of [
    '{broken',
    JSON.stringify({ schemaVersion: 2, source: 'CapriChooms/Capri', supporters: ['OldUser'] }),
    JSON.stringify({ schemaVersion: 1, source: 'Different/Repo', supporters: ['OldUser'] }),
    JSON.stringify({ schemaVersion: 1, source: 'CapriChooms/Capri', supporters: ['Full Name'] }),
    ...[
      { majorSupporters: null },
      { majorSupporters: ['Major Supporter', ' major supporter '] },
      { communityHelpers: ['Helper\nName'] },
      { communityHelpers: [{ name: 'Helper', email: 'private@example.invalid' }] },
    ].map((acknowledgements) =>
      JSON.stringify({
        schemaVersion: 1,
        source: 'CapriChooms/Capri',
        supporters: ['OldUser'],
        ...acknowledgements,
      }),
    ),
    ...[
      null,
      [],
      { OldUser: 'Neon Voyager' },
      { olduser: 'Unknown Voyager' },
      { olduser: 'Neon Voyager', overyx: 'Neon Voyager' },
      { stranger: 'Neon Voyager' },
      JSON.parse('{"__proto__":"Neon Voyager"}'),
    ].map((epithets) =>
      JSON.stringify({
        schemaVersion: 1,
        source: 'CapriChooms/Capri',
        supporters: ['OldUser'],
        epithets,
      }),
    ),
  ]) {
    writeFileSync(output, previous);
    assert.throws(() => refreshHallOfFame({ output, queryPage: () => ['NewUser'] }));
    assert.equal(readFileSync(output, 'utf8'), previous);
    assert.deepEqual(readdirSync(directory), ['hall-of-fame.json']);
  }
});
