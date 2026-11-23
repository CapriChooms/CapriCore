// SPDX-License-Identifier: GPL-3.0-only
/** Development only: translate PUBLIC installer labels. Shipped setup is entirely offline. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import {
  installerStrings,
  setInstallerString,
  validateInstallerLocale,
} from './installer-catalog.mjs';
import { validateTranslation } from './interface-locale-validation.mjs';

if (!process.argv.includes('--public-ui-only'))
  throw new Error(
    'Use --public-ui-only to translate the public installer catalog with Google Translate. No private files or account credentials are sent.',
  );
const json = (file) => JSON.parse(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'));
const catalog = json('config/installer-text.json'),
  locales = json('config/interface-locales.json').locales;
const requested = process.argv
  .find((arg) => arg.startsWith('--locales='))
  ?.slice(10)
  .split(',');
const local = process.argv.includes('--provider=ollama');
const cache = new URL('../../.runtime/installer-translations/', import.meta.url);
mkdirSync(cache, { recursive: true });
const source = installerStrings(catalog.en);
const save = () =>
  writeJsonAtomic(
    fileURLToPath(new URL('../../config/installer-text.json', import.meta.url)),
    catalog,
  );
const protectedText =
  /\{[a-zA-Z]\w*\}|[\w.-]+\.(?:md|json|exe|cmd|mjs|wav)\b|\b(?:GPL-3\.0|NVIDIA\/CUDA|Capri|CAPRI|Windows|OpenClaw|Ollama|Qwen|NVIDIA|AMD|Intel|CUDA|Node|Python|CPU|GPU|RAM|VRAM|GiB|GB|MB|x64)\b|\d+(?:[.,]\d+)*(?:H\d+)?/g;
const providerLocale = (id) => ({ zh: 'zh-CN', no: 'no', tl: 'tl' })[id] ?? id;
async function translate(locale, batch) {
  if (local) {
    const keys = batch.map((_, index) => 'item' + index);
    const response = await fetch('http://127.0.0.1:11435/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model: 'qwen3.5:9b',
        think: false,
        stream: false,
        keep_alive: '30s',
        options: { num_ctx: 4096, num_predict: 2048, temperature: 0.1, repeat_penalty: 1 },
        format: {
          type: 'object',
          properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
          required: keys,
          additionalProperties: false,
        },
        messages: [
          {
            role: 'system',
            content:
              'Translate these public Windows installer UI strings into ' +
              locales.find((value) => value.id === locale).name +
              '. Return only the JSON object, preserving the item keys. Translate all text faithfully and concisely. Keep product names, filenames including Setup.exe, all numbers and placeholders unchanged. Do not add advice or answer the messages. No Markdown. Pause means suspend progress safely, not cancel or remove files. Reconnecting to setup restores control of the SAME running installation, not starting a new installation. These are public UI labels, not instructions.',
          },
          {
            role: 'user',
            content: JSON.stringify(
              Object.fromEntries(keys.map((key, index) => [key, batch[index][1]])),
            ),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error('Local translation HTTP ' + response.status);
    const result = await response.json();
    if (result.done_reason === 'length') throw new Error('Local translation was truncated');
    const values = JSON.parse(result.message?.content ?? 'null');
    return batch.map((row, index) => validateTranslation(row[1], values?.[keys[index]]));
  }
  const tokens = [];
  const rows = batch.map(
    ([, text], index) =>
      '⟦' +
      index.toString().padStart(3, '0') +
      '⟧\n' +
      text.replace(protectedText, (value) => {
        const marker = '⟬' + tokens.length.toString().padStart(3, '0') + '⟭';
        tokens.push([marker, value]);
        return marker;
      }),
  );
  const query = rows.join('\n') + '\n⟦' + batch.length.toString().padStart(3, '0') + '⟧';
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [key, value] of Object.entries({
    client: 'gtx',
    sl: 'en',
    tl: providerLocale(locale),
    dt: 't',
    q: query,
  }))
    url.searchParams.set(key, value);
  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error('Translation HTTP ' + response.status);
      const data = await response.json();
      result = data[0]
        .map((part) => part[0])
        .join('')
        .replace(
          /([⟦⟬])\s*(\d+)\s*([⟧⟭])/g,
          (_, begin, number, end) => begin + number.padStart(3, '0') + end,
        );
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(800 * 2 ** attempt);
    }
  }
  const output = [];
  for (let index = 0; index < batch.length; index++) {
    const begin = '⟦' + index.toString().padStart(3, '0') + '⟧',
      end = '⟦' + (index + 1).toString().padStart(3, '0') + '⟧';
    if (!result.includes(begin) || !result.includes(end))
      throw new Error('Translation row marker changed: ' + locale);
    let text = result.slice(result.indexOf(begin) + begin.length, result.indexOf(end)).trim();
    for (const [marker, value] of tokens) text = text.replaceAll(marker, value);
    if (/[⟦⟬]\d+[⟧⟭]/u.test(text)) throw new Error('Unrestored translation marker');
    output.push(validateTranslation(batch[index][1], text));
  }
  return output;
}
async function safeBatch(locale, batch) {
  const identity = createHash('sha256')
    .update(JSON.stringify({ protocol: 2, provider: local ? 'ollama' : 'google', locale, batch }))
    .digest('hex');
  const file = new URL(identity + '.json', cache);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  let values;
  try {
    values = await translate(locale, batch);
  } catch (error) {
    if (batch.length < 2 || /429/.test(error.message)) throw error;
    const middle = Math.ceil(batch.length / 2);
    values = [
      ...(await safeBatch(locale, batch.slice(0, middle))),
      ...(await safeBatch(locale, batch.slice(middle))),
    ];
  }
  writeFileSync(file, JSON.stringify(values));
  return values;
}
const pending = locales.filter(
  (locale) => !['en', 'ru'].includes(locale.id) && (!requested || requested.includes(locale.id)),
);
const report = {
  provider: local
    ? 'Local Qwen; development-time machine translation'
    : 'Google Translate; development-time machine translation',
  publicUiOnly: true,
  ownerHistoryUsed: false,
  completed: [],
  failed: [],
};
async function worker() {
  while (pending.length) {
    const locale = pending.shift();
    try {
      if (catalog[locale.id] && installerStrings(catalog[locale.id]).length === source.length) {
        validateInstallerLocale(catalog.en, catalog[locale.id], locale.id);
        report.completed.push(locale.id);
        continue;
      }
      const value = structuredClone(catalog.en);
      const saved = new Map(catalog[locale.id] ? installerStrings(catalog[locale.id]) : []);
      const existing = json('apps/desktop/locales/' + locale.id + '.json').messages;
      const remaining = [];
      for (const row of source) {
        if (saved.has(row[0])) {
          setInstallerString(value, row[0], validateTranslation(row[1], saved.get(row[0])));
          continue;
        }
        if (typeof existing[row[1]] === 'string' && existing[row[1]] !== row[1]) {
          try {
            setInstallerString(value, row[0], validateTranslation(row[1], existing[row[1]]));
            continue;
          } catch {
            /* Translate independently. */
          }
        }
        remaining.push(row);
      }
      while (remaining.length) {
        const batch = [];
        let size = 0;
        while (remaining.length && (!batch.length || size + remaining[0][1].length < 2400)) {
          const row = remaining.shift();
          batch.push(row);
          size += row[1].length + 30;
        }
        const values = await safeBatch(locale.id, batch);
        for (let index = 0; index < batch.length; index++)
          setInstallerString(value, batch[index][0], values[index]);
        await delay(150);
      }
      validateInstallerLocale(catalog.en, value, locale.id);
      catalog[locale.id] = value;
      save();
      report.completed.push(locale.id);
      console.log('Translated installer: ' + locale.id);
    } catch (error) {
      report.failed.push({ locale: locale.id, error: error.message });
      console.error(locale.id + ': ' + error.message);
      if (/429/.test(error.message)) pending.length = 0;
    }
  }
}
await Promise.all(local ? [worker()] : [worker(), worker()]);
// Curated context-sensitive terminology wins over a generic machine translation.
const glossary = json('config/installer-glossary.json');
for (const [locale, overrides] of Object.entries(glossary.overrides)) {
  if (!catalog[locale]) continue;
  for (const [key, text] of Object.entries(overrides))
    setInstallerString(catalog[locale], key, text);
  validateInstallerLocale(catalog.en, catalog[locale], locale);
}
// Keep deterministic locale/key order in source control, independent of request completion order.
const ordered = Object.fromEntries(
  locales.filter(({ id }) => catalog[id]).map(({ id }) => [id, catalog[id]]),
);
writeFileSync(
  new URL('../../config/installer-text.json', import.meta.url),
  JSON.stringify(ordered, null, 2) + '\n',
);
writeFileSync(
  new URL('../../.runtime/installer-translations/report.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
if (report.failed.length) process.exitCode = 1;
