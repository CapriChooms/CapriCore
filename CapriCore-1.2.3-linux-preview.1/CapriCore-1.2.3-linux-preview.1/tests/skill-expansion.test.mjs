// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSearch } from '../apps/desktop/web-search.mjs';
import {
  automaticFactCandidate,
  changeOwnerFact,
  listOwnerFacts,
  saveOwnerFact,
} from '../apps/desktop/owner-notes.mjs';
import { ScreenObservation } from '../apps/desktop/screen-observation.mjs';
import { SAMPLE_BYTES } from '../apps/desktop/renderer/screen-change.mjs';
import { explicitSteamGame } from '../apps/desktop/steam-task-state.mjs';
import { showComposerSkill, skillPreferences } from '../packages/skills/src/settings-catalog.mjs';

test('composer buttons are independent of toolbar buttons', () => {
  const id = 'capri.reasoning';
  const preferences = skillPreferences({
    [id]: { enabled: true, showComposer: false, showButton: true, effort: 'high' },
  });
  assert.equal(preferences[id].showButton, true);
  assert.equal(showComposerSkill(preferences, id), false);
  assert.equal(preferences[id].effort, 'high');
  assert.equal(showComposerSkill(skillPreferences({ [id]: { enabled: true } }), id), true);
});

test('Wikipedia search sends only the query to the selected language and filters actual hostnames', async () => {
  const service = new WebSearch({
    fetchImpl: async (url) => {
      assert.equal(new URL(url).origin, 'https://ru.wikipedia.org');
      assert.equal(new URL(url).searchParams.get('q'), 'Synthetic query');
      return Response.json({
        pages: [
          { key: 'Beta', title: 'Beta', excerpt: '<span>Evidence</span>' },
          { key: 'Alpha', title: 'Alpha', excerpt: 'More evidence' },
        ],
      });
    },
  });
  const settings = { engine: 'wikipedia', sort: 'title', domains: 'wikipedia.org' };
  const result = await service.search('Synthetic query', { language: 'ru-RU', settings });
  assert.deepEqual(
    result.sources.map(({ title }) => title),
    ['Alpha', 'Beta'],
  );
  assert.equal(result.sources[1].snippet, 'Evidence');
  const blocked = await service.search('Synthetic query', {
    language: 'ru',
    settings: { ...settings, exclude: true },
  });
  assert.equal(blocked.status, 'empty');
});

test('managed facts are editable and removed from recall, with no service metadata', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'capri-skill-facts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  saveOwnerFact(root, 'My favourite sport is tennis.');
  const [fact] = listOwnerFacts(root).items;
  assert.deepEqual(Object.keys(fact).sort(), ['id', 'text']);
  const updated = changeOwnerFact(root, { id: fact.id, text: 'I prefer badminton.' });
  assert.equal(updated.items[0].text, 'I prefer badminton.');
  assert.throws(() => changeOwnerFact(root, { id: fact.id }));
  assert.equal(changeOwnerFact(root, { id: updated.items[0].id }).items.length, 0);
  assert.equal(automaticFactCandidate('I like making cakes.'), 'I like making cakes.');
  assert.equal(automaticFactCandidate('I like this song right now.'), null);
  assert.equal(automaticFactCandidate('I prefer my API key be public.'), null);
});

test('background observation samples quiet screens once a minute and prioritizes a changed scene', async () => {
  let now = 0;
  const observation = new ScreenObservation({
    infer: async () => 'Fixture scene',
    state: () => ({}),
    now: () => now,
  });
  observation.start({
    id: 'fixture',
    source: { label: 'Fixture' },
    expiresAt: 120000,
    intervalMs: 30000,
  });
  const packet = (sequence, fill = 0) => ({
    captureId: 'fixture',
    sequence,
    signature: new Uint8Array(SAMPLE_BYTES).fill(fill),
    png: Buffer.of(0),
  });
  assert.equal(observation.sample(packet(0)).analyse, true);
  assert.equal((await observation.frame(packet(0))).accepted, true);
  now = 4001;
  assert.equal(observation.sample(packet(1, 250)).analyse, true);
  assert.equal((await observation.frame(packet(1, 250))).accepted, true);
  now = 64000;
  assert.equal(observation.sample(packet(2, 250)).analyse, false);
  now++;
  assert.equal(observation.sample(packet(2, 250)).analyse, true);
});

test('specific launch intent stays scoped to Steam without capturing multi-app requests', () => {
  assert.equal(
    explicitSteamGame('Use full computer access, launch Portal 2 in Steam.'),
    'Portal 2',
  );
  assert.equal(explicitSteamGame('Запусти Portal 2 в Стиме'), 'Portal 2');
  assert.equal(explicitSteamGame('Launch Portal 2 in Steam and open Discord'), null);
});
