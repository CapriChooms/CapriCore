import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTERFACE_LOCALES,
  interfaceLocale,
  uiText,
  displayLanguage,
} from '../apps/desktop/renderer/interface-translations.mjs';
import {
  LANGUAGE_DEFAULTS,
  validateLanguages,
  languageBehaviorChanged,
} from '../apps/desktop/renderer/language-settings.mjs';
import {
  validateTranslation,
  validateLocaleTranslation,
} from '../tools/localization/interface-locale-validation.mjs';

const config = JSON.parse(
  readFileSync(new URL('../config/interface-locales.json', import.meta.url), 'utf8'),
);
const glossary = JSON.parse(
  readFileSync(new URL('../config/interface-glossary.json', import.meta.url), 'utf8'),
);
const source = interfaceLocale('en').messages;
const slots = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
test('every advertised UI locale contains the full source catalog and curated core labels', () => {
  assert.deepEqual(
    INTERFACE_LOCALES.map((l) => l.id),
    config.locales.map((l) => l.id),
  );
  for (const locale of INTERFACE_LOCALES) {
    assert.equal(
      validateLanguages({ ...LANGUAGE_DEFAULTS, interface: locale.id }).interface,
      locale.id,
    );
    const messages = interfaceLocale(locale.id).messages;
    assert.deepEqual(Object.keys(messages), Object.keys(source));
    for (const key of Object.keys(source)) {
      assert.ok(messages[key].trim(), locale.id + ': ' + key);
      assert.deepEqual(slots(messages[key]), slots(key), locale.id + ': ' + key);
    }
    for (let i = 0; i < glossary.keys.length; i++)
      assert.equal(messages[glossary.keys[i]], glossary.locales[locale.id][i]);
    for (const [key, value] of Object.entries(glossary.overrides?.[locale.id] ?? {}))
      assert.equal(messages[key], value);
  }
});
test('UI language changes do not imply dialogue, recognition, voice or capture changes', () => {
  for (const locale of INTERFACE_LOCALES)
    assert.equal(
      languageBehaviorChanged(LANGUAGE_DEFAULTS, { ...LANGUAGE_DEFAULTS, interface: locale.id }),
      false,
    );
  assert.equal(
    languageBehaviorChanged(LANGUAGE_DEFAULTS, { ...LANGUAGE_DEFAULTS, conversation: 'ru' }),
    true,
  );
  assert.equal(
    languageBehaviorChanged(LANGUAGE_DEFAULTS, {
      ...LANGUAGE_DEFAULTS,
      recognition: 'auto',
      autoDetect: true,
    }),
    true,
  );
  assert.equal(
    languageBehaviorChanged(LANGUAGE_DEFAULTS, { ...LANGUAGE_DEFAULTS, speech: 'off' }),
    true,
  );
});

test('editable locale catalogs match the shipped bundle and contain no foreign-language fragments', () => {
  for (const { id } of INTERFACE_LOCALES) {
    const editable = JSON.parse(
      readFileSync(new URL(`../apps/desktop/locales/${id}.json`, import.meta.url), 'utf8'),
    ).messages;
    const bundled = interfaceLocale(id).messages;
    for (const key of Object.keys(source)) {
      assert.equal(editable[key], bundled[key], `${id}: rebuild bundle after editing ${key}`);
      assert.equal(
        validateLocaleTranslation(key, editable[key], id),
        editable[key],
        `${id}: ${key}`,
      );
      if (
        id !== 'en' &&
        key.length > 22 &&
        !key.startsWith('{') &&
        !(id === 'fr' && key === 'Microphone ({language})')
      )
        assert.notEqual(editable[key], source[key], `${id}: untranslated help or status: ${key}`);
    }
    // These meanings were confused with RAM savings, geographical knowledge,
    // noun phrases and a speaking state in the first generated translations.
    for (const key of ['Save memory', 'VOICE PENDING', 'Use local knowledge', 'Test tool'])
      assert.equal(bundled[key], glossary.overrides[id][key], `${id}: editorial ${key}`);
  }
});

test('locale-aware validation rejects cross-language contamination but preserves source examples', () => {
  assert.throws(
    () => validateLocaleTranslation('VOICE PENDING', 'ОЖИДАНИЕ ГОЛОСА', 'hi'),
    /Unexpected Cyrillic/,
  );
  assert.throws(
    () => validateLocaleTranslation('Microphone input', 'Ulaz mikroфона', 'hr'),
    /Unexpected Cyrillic/,
  );
  assert.throws(() => validateLocaleTranslation('Circles', 'K올á', 'sk'), /Unexpected Hangul/);
  assert.throws(
    () => validateLocaleTranslation('Still preparing.', 'Προετοιμασία仍在继续。', 'el'),
    /Unexpected Han/,
  );
  assert.equal(
    validateLocaleTranslation(
      'Русский / speech pack pending',
      'Русский / voice pack pending',
      'en',
    ),
    'Русский / voice pack pending',
  );
  assert.equal(
    validateLocaleTranslation('Unavailable — {device}', 'उपलब्ध नहीं — {device}', 'hi'),
    'उपलब्ध नहीं — {device}',
  );
});
test('recent desktop controls have localized labels instead of English source copies', () => {
  const labels = [
    'Save changes',
    'Keep editing',
    'Attach files',
    'Saved API connections',
    'Test all connections',
    'Reset settings to defaults',
    'Avatar attachment zones',
    'Allow Capri to choose where to speak',
    'Image preview unavailable',
    'Fit to screen',
    'Actual size',
    'Attachments',
    'Approach',
    'Automatically match the track BPM',
    'Send replies to call',
    'While enabled, Capri’s spoken replies are shared with the call. Voice previews stay local.',
    'Skip local language model when using an API',
    'Recommended for API users. Frees the local language model at startup and skips its warmup. Local mode, voice and speech recognition keep their own settings.',
    'Applies on next startup or reconnect.',
    'Set up virtual microphone',
    'Click Set up automatically to combine your microphone and Capri’s voice.',
    'In Discord, Zoom or your call app, select the virtual microphone shown below.',
    'Keep the call’s speakers set to your headphones or speakers.',
    'Microphone to select in your call app',
    'Set up automatically',
    'VB-CABLE by VB-Audio creates the virtual microphone. It is donationware; you can support its author. Windows will ask permission to install its driver.',
    'About VB-CABLE / Donate',
    'License terms',
    'I agree to install VB-CABLE under its license terms.',
    'Install VB-CABLE and connect',
    'Advanced: choose a cable manually',
    'Use this if you already have a different virtual audio cable.',
    'Optional: hear the call and system audio',
    'With wake and automatic sending enabled, requests addressed to Capri are sent automatically. Otherwise, review the text before sending. Use headphones to avoid feedback.',
    'Turn on Capri’s microphone first, then include system audio. Capri can hear you and people in the call, and wake when either says her name.',
    'Hours',
    'Seconds',
    'Set up once, then choose the virtual microphone in your call app.',
    'Looking for a virtual audio cable…',
    'A virtual audio cable is needed. Install VB-CABLE to continue.',
    'Downloading the official VB-CABLE driver…',
    'Connecting your microphone and Capri’s voice…',
    'Installing VB-CABLE. Approve the Windows permission request if it appears.',
    'Restart Windows to finish installing VB-CABLE, then click Set up automatically.',
    'Connected. Your microphone and Capri can now share the call.',
    'Setup could not finish. You can try again.',
    'Check Windows sound settings: keep your usual microphone and speakers as the defaults.',
    'VB-Audio recommends restarting Windows after driver installation.',
    'Check again',
    'Virtual microphone setup is already running.',
    'The virtual microphone did not connect. Try again.',
    'Open Voice calls in Settings to finish connecting.',
    'Type text',
    'Keyboard shortcut',
  ];
  for (const { id } of INTERFACE_LOCALES) {
    if (id === 'en') continue;
    for (const label of labels) assert.notEqual(uiText(label, id), label, id + ': ' + label);
    assert.notEqual(
      uiText('Full computer access is enabled.', id),
      uiText('Full computer access is off.', id),
      id + ': computer access states',
    );
    assert.notEqual(
      uiText('Files are shared with the active API when sent.', id),
      uiText('Preparing attachments…', id),
      id + ': attachment disclosure and progress',
    );
  }
});
test('formatting preserves data slots and unknown text while localizing owned labels', () => {
  assert.equal(uiText('Open', 'en'), 'Open');
  assert.equal(uiText('Open', 'ru'), 'Открыть');
  assert.equal(uiText('  Apply\n languages  ', 'ru'), uiText('Apply languages', 'ru'));
  assert.equal(uiText('  Private\n owner text  ', 'ru'), '  Private\n owner text  ');
  const text = 'An arbitrary message from the owner, not a UI key.';
  for (const locale of INTERFACE_LOCALES) {
    assert.equal(uiText(text, locale.id), text);
    assert.ok(uiText('Unavailable — {device}', locale.id, { device: 'Menu' }).includes('Menu'));
    assert.ok(uiText('{value} px', locale.id, { value: '142' }).includes('142'));
  }
  const translated = uiText('Microphone (Japanese)', 'de');
  assert.ok(translated.includes(displayLanguage('ja', 'de')));
});

test('navigation headings describe settings rather than unrelated service names or save errors', () => {
  for (const { id } of INTERFACE_LOCALES) {
    assert.notEqual(
      uiText('Microphone settings', id),
      uiText('Microphone settings could not be saved.', id),
      id + ': microphone heading must not be a failure message',
    );
    assert.notEqual(uiText('Microphone settings', id), 'Spotify', id);
  }
  assert.equal(uiText('Microphone settings', 'da'), 'Mikrofonindstillinger');
  assert.equal(uiText('Microphone settings', 'pt'), 'Configurações do microfone');
  assert.equal(uiText('Hide to tray', 'fr'), 'Réduire dans la zone de notification');
});
test('RTL metadata is scoped to the appropriate interface languages and has an English fallback', () => {
  for (const id of ['ar', 'he', 'fa', 'ur']) assert.equal(interfaceLocale(id).direction, 'rtl');
  for (const id of ['en', 'ru', 'de', 'ja', 'hi'])
    assert.equal(interfaceLocale(id).direction, 'ltr');
  assert.equal(interfaceLocale('unknown').id, 'en');
});

test('all language names stay localized without the browser ICU tables', () => {
  const NativeDisplayNames = Intl.DisplayNames;
  let calls = 0;
  Intl.DisplayNames = class {
    constructor() {
      calls++;
      throw new Error('Simulated missing Chromium language tables');
    }
  };
  try {
    for (const { id } of INTERFACE_LOCALES) {
      assert.ok(displayLanguage('en', id).trim());
      assert.notEqual(displayLanguage('en', id), 'en', id);
      assert.ok(displayLanguage('ru', id).trim());
    }
    assert.equal(calls, 0);
    assert.equal(displayLanguage('en', 'is'), 'enska');
    assert.notEqual(displayLanguage('en', 'pa'), 'English');
  } finally {
    Intl.DisplayNames = NativeDisplayNames;
  }
});
test('locale preparation preserves numeric settings, product names and data slots', () => {
  assert.equal(
    validateTranslation('Reset to 1.8 s', 'بازنشانی به ۱٫۸ ثانیه'),
    'بازنشانی به ۱٫۸ ثانیه',
  );
  assert.equal(validateTranslation('10 minutes', '১০ মিনিট'), '১০ মিনিট');
  assert.throws(() => validateTranslation('Conversational / up to 12 per hour', 'Off'), /numeric/);
  assert.throws(() => validateTranslation('Microphone ({language})', 'Mikrofon'), /placeholders/);
  assert.throws(() => validateTranslation('More information', 'Aide</th>'), /markup/);
  assert.throws(
    () => validateTranslation('Read SECURITY.md for details.', 'См. БЕЗОПАСНОСТЬ.md.'),
    /filename/,
  );
  assert.throws(
    () => validateTranslation('Talk to Capri…', 'Talk to someone else'),
    /product name/,
  );
});
