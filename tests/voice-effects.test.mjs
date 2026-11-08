import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/index.mjs';
import { Preferences } from '../apps/desktop/preferences.mjs';
import {
  VOICE_EFFECT_DEFAULTS,
  VOICE_EFFECT_PRESETS,
  VOICE_EFFECT_LIMITS,
  validateVoiceEffects,
} from '../apps/desktop/renderer/voice-effects-settings.mjs';

test('voice presets validate and stay bounded; malformed IPC cannot activate an arbitrary setting', () => {
  for (const preset of Object.values(VOICE_EFFECT_PRESETS))
    assert.deepEqual(validateVoiceEffects(preset), preset);
  assert.deepEqual(
    validateVoiceEffects({
      ...VOICE_EFFECT_DEFAULTS,
      ...VOICE_EFFECT_LIMITS,
      preset: 'custom',
      enabled: true,
    }),
    { ...VOICE_EFFECT_DEFAULTS, ...VOICE_EFFECT_LIMITS, preset: 'custom', enabled: true },
  );
  for (const bad of [
    { ...VOICE_EFFECT_DEFAULTS, mix: 101 },
    { ...VOICE_EFFECT_DEFAULTS, intensity: NaN },
    { ...VOICE_EFFECT_DEFAULTS, preset: 'remote' },
    { ...VOICE_EFFECT_DEFAULTS, enabled: 'true' },
  ])
    assert.throws(() => validateVoiceEffects(bad));
  assert.equal(VOICE_EFFECT_DEFAULTS.enabled, false);
});
test('effects persist independently and invalid saved preferences are preserved until an explicit edit', () => {
  const parent = path.join(root, '.runtime/test-data');
  mkdirSync(parent, { recursive: true });
  const file = path.join(mkdtempSync(path.join(parent, 'fx-')), 'effects.json');
  let store = new Preferences(file, VOICE_EFFECT_DEFAULTS, validateVoiceEffects);
  assert.deepEqual(store.snapshot(), VOICE_EFFECT_DEFAULTS);
  store.set(VOICE_EFFECT_PRESETS.holographic);
  store = new Preferences(file, VOICE_EFFECT_DEFAULTS, validateVoiceEffects);
  assert.equal(store.snapshot().preset, 'holographic');
  writeFileSync(file, 'broken');
  store = new Preferences(file, VOICE_EFFECT_DEFAULTS, validateVoiceEffects);
  assert.equal(store.snapshot().enabled, false);
  assert.ok(store.warning);
  assert.equal(readFileSync(file, 'utf8'), 'broken');
  assert.throws(() => store.set({ ...VOICE_EFFECT_DEFAULTS, glitch: 201 }));
  assert.equal(readFileSync(file, 'utf8'), 'broken');
  store.set(VOICE_EFFECT_DEFAULTS);
  assert.equal(store.warning, null);
});

test('factory voice presets upgrade while individually edited and muted settings are respected', () => {
  const oldRadio = {
    ...VOICE_EFFECT_DEFAULTS,
    enabled: false,
    preset: 'radio',
    intensity: 45,
    mix: 55,
    filter: 85,
    glitch: 8,
  };
  assert.deepEqual(validateVoiceEffects(oldRadio), {
    ...VOICE_EFFECT_PRESETS.radio,
    enabled: false,
  });
  const custom = { ...oldRadio, preset: 'custom', mix: 56 };
  assert.deepEqual(validateVoiceEffects(custom), custom);
  assert.ok(VOICE_EFFECT_PRESETS.radio.filter > VOICE_EFFECT_PRESETS.cybernetic.filter);
  assert.ok(VOICE_EFFECT_PRESETS.holographic.reverb > VOICE_EFFECT_PRESETS.radio.reverb);
  assert.ok(
    VOICE_EFFECT_PRESETS.synthetic.electronicMix > VOICE_EFFECT_PRESETS.cybernetic.electronicMix,
  );
});
