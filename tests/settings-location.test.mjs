import test from 'node:test';
import assert from 'node:assert/strict';
import { SettingsLocation } from '../apps/desktop/renderer/settings-location.mjs';

const sections = ['general', 'appearance', 'models', 'api'];
function fixture(value = null) {
  const storage = {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
  return () => storage;
}
test('reopening and a new renderer restore the last tab and independent scroll positions', () => {
  const storage = fixture();
  const view = new SettingsLocation(sections, storage);
  assert.equal(view.section, 'general');
  view.remember('appearance', 740, 81);
  view.remember('models', 210, 140);
  const reopened = new SettingsLocation(sections, storage);
  assert.equal(reopened.section, 'models');
  assert.equal(reopened.top('appearance'), 740);
  assert.equal(reopened.top('models'), 210);
  assert.equal(reopened.navigation, 140);
  assert.equal(reopened.top('api'), 0);
});
test('stored preferences admit only known section names and bounded numeric scroll offsets', () => {
  const storage = fixture(
    JSON.stringify({
      schemaVersion: 1,
      section: 'removed-tab',
      navigation: -9,
      scrolls: { general: 30, appearance: 'secret text', models: 1e12, unknown: 123 },
      apiKey: 'never retained',
    }),
  );
  const view = new SettingsLocation(sections, storage);
  assert.equal(view.section, 'general');
  assert.deepEqual(view.scrolls, { general: 30 });
  assert.equal(view.navigation, 0);
  view.remember('api', 12, 9);
  const saved = JSON.parse(storage().getItem());
  assert.deepEqual(Object.keys(saved).sort(), [
    'navigation',
    'schemaVersion',
    'scrolls',
    'section',
  ]);
  assert.equal('apiKey' in saved, false);
  view.remember('unknown', 1, 2);
  view.remember('general', NaN, 0);
  assert.equal(view.section, 'api');
});
test('corrupt or oversized preferences and unavailable storage never block Settings', () => {
  for (const raw of ['{', 'x'.repeat(8193), 'null', '{"schemaVersion":2}'])
    assert.equal(new SettingsLocation(sections, fixture(raw)).section, 'general');
  const view = new SettingsLocation(sections, () => {
    throw new Error('Storage denied');
  });
  assert.doesNotThrow(() => view.remember('models', 35, 1));
  assert.equal(view.top('models'), 35);
});
