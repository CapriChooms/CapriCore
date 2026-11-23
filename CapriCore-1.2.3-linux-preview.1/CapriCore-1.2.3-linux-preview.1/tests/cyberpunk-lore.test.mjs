import test from 'node:test';
import assert from 'node:assert/strict';
import lore from '../config/cyberpunk-lore.json' with { type: 'json' };
import portraits from '../config/cyberpunk-portraits.json' with { type: 'json' };
import { cyberpunkLoreContext, portraitEvidence } from '../apps/desktop/cyberpunk-lore.mjs';
import {
  matchCharacterPortrait,
  portraitGrid,
  portraitSignature,
} from '../apps/desktop/character-portraits.mjs';

test('fictional lore is retrieved on demand, in any chat, without owner memory', () => {
  assert.equal(cyberpunkLoreContext('Привет, Капри!'), '');
  assert.equal(cyberpunkLoreContext('Summarize the calendar for 2020.'), '');
  assert.match(cyberpunkLoreContext('Капри, кто ты?'), /Capricorn.*Soulkiller/);
  assert.match(cyberpunkLoreContext('Расскажи про Талию из Бегущих по краю 2'), /Talia.*Maelstrom/);
  assert.match(cyberpunkLoreContext('What happened in Cyberpunk RED?'), /2045/);
  assert.match(
    cyberpunkLoreContext('Who is V in Cyberpunk 2077?'),
    /V \(Cyberpunk 2077\).*customizable protagonist/,
  );
  assert.match(cyberpunkLoreContext('ルーシーは誰？'), /Lucy.*Moon/);
});

test('portrait evidence uses known names and counts only actual images', () => {
  assert.equal(
    portraitEvidence([1], () => 'FAKE EVIDENCE'),
    '',
  );
  const evidence = portraitEvidence(
    [1, 2, 3],
    (image) =>
      ({
        1: 'Rebecca',
        3: 'D',
      })[image],
  );
  assert.match(evidence, /Image 1 matches a reference portrait of Rebecca/);
  assert.match(evidence, /Image 3 matches a reference portrait of D \(Edgerunners 2\)/);
  assert.doesNotMatch(evidence, /Image 2/);
});

test('portrait signatures are bounded and catalogue covers each franchise source', () => {
  const bitmap = Buffer.alloc(portraitGrid ** 2 * 4, 255);
  const [hash, color] = portraitSignature(bitmap);
  assert.equal(hash, '00'.repeat(26));
  assert.deepEqual(color, [255, 255, 255]);
  assert.equal(
    matchCharacterPortrait({
      isEmpty: () => false,
      getSize: () => ({ width: 256, height: 256 }),
      resize: () => ({ toBitmap: () => bitmap }),
    }),
    undefined,
  );
  assert.ok(
    portraits.every(
      ({ name, ratio, signature }) =>
        lore.characters.some((character) => character.name === name) &&
        ratio > 0 &&
        /^[0-9a-f]{52}$/.test(signature[0]),
    ),
  );
  for (const source of [lore.sources.game, lore.sources.edgerunners, lore.sources.edgerunners2]) {
    assert.ok(portraits.some((portrait) => portrait.source === source));
  }
});
