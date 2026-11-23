// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformPreviewSource } from '../tools/preview/build-installer-cyberpunk.mjs';

test('the preview changes only reversible visual constructors and the three theme hooks', () => {
  for (const [file, wizard] of [
    ['wizard-ui.ps1', true],
    ['memory-budget-ui.ps1', false],
  ]) {
    const original = readFileSync(
      new URL('../packages/installer/windows/' + file, import.meta.url),
      'utf8',
    );
    const result = transformPreviewSource(original, { wizard, budget: !wizard });
    assert.equal(result.normalized, original);
    assert.notEqual(result.text, original);
    assert.ok(
      result.patches.every(
        ({ name }) =>
          name.startsWith('constructor:') ||
          name.startsWith('palette:') ||
          ['theme import', 'theme initialization', 'theme refresh'].includes(name),
      ),
    );
    assert.equal(
      result.patches.filter(({ name }) => !name.startsWith('constructor:')).length,
      wizard ? 3 : original.includes('New-Object Capri.Setup.Cyberpunk.') ? 0 : 4,
    );
    for (const expression of [
      'Start-CapriInstall',
      'Save-CapriPage',
      '$script:uiLease',
      'New-CapriSession',
    ])
      assert.equal(result.text.split(expression).length, original.split(expression).length);
  }
});

test('ambiguous or absent wizard hook anchors refuse a preview instead of guessing', () => {
  const original = readFileSync(
    new URL('../packages/installer/windows/wizard-ui.ps1', import.meta.url),
    'utf8',
  );
  assert.throws(
    () =>
      transformPreviewSource(
        original.replace('Initialize-CapriCyberpunkTheme', 'Missing-ThemeInitialization'),
        {
          wizard: true,
        },
      ),
    /theme initialization anchor/,
  );
  assert.throws(
    () =>
      transformPreviewSource(
        original +
          '\nInitialize-CapriCyberpunkTheme $form $sidebar $body $footer $brand $releaseLabel $steps $back $next $cancel $pause',
        {
          wizard: true,
        },
      ),
    /theme initialization anchor/,
  );
});
