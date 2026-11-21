// SPDX-License-Identifier: GPL-3.0-only
// Generate offline settings-guide catalogs from public, English UI copy.
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { coreGuides } from '../../apps/desktop/renderer/settings-guide-core.mjs';
import { skillGuides } from '../../apps/desktop/renderer/settings-guide-skills.mjs';
import { advancedGuides } from '../../apps/desktop/renderer/settings-guide-advanced.mjs';
import { settingsGuideSteps } from '../../apps/desktop/renderer/settings-guide.mjs';
import { validateLocaleTranslation, placeholders } from './interface-locale-validation.mjs';
import { writeJsonAtomic } from '../../packages/runtime/src/atomic-json.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'apps/desktop/guide-locales');
const throttleFile = path.join(root, '.runtime/settings-guide-translation-throttled');
const config = JSON.parse(await readFile(path.join(root, 'config/interface-locales.json'), 'utf8'));
const guides = { ...coreGuides, ...skillGuides, ...advancedGuides };
const strings = [
  ...new Set([
    ...Object.keys(guides).flatMap((section) =>
      settingsGuideSteps(section, guides).flatMap((step) => step[1]),
    ),
    'Guide for {section}',
    '{title} (guide)',
    'Step {current} of {total}',
    'Close guide',
    'Back',
    'Skip step',
    'Next',
    'Finish',
    'Could not open the guide. Try again.',
    'Guide for this tab',
  ]),
];
const requested = process.argv
  .find((value) => value.startsWith('--locales='))
  ?.slice(10)
  .split(',');
const check = process.argv.includes('--check');
if (!check && !process.argv.includes('--public-ui-only'))
  throw new Error('Pass --public-ui-only to send public guide strings to Google Translate.');
if (!check) await mkdir(destination, { recursive: true });
const locales = config.locales.filter(
  ({ id }) => id !== 'en' && id !== 'ru' && (!requested || requested.includes(id)),
);
if (requested?.some((id) => !locales.some((locale) => locale.id === id)))
  throw new Error('Unknown or source guide locale requested.');
if (requested) locales.sort((a, b) => requested.indexOf(a.id) - requested.indexOf(b.id));
if (check) {
  let failed = false;
  for (const locale of locales) {
    let messages;
    try {
      messages = JSON.parse(await readFile(path.join(destination, `${locale.id}.json`), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.error(`${locale.id}: catalog missing (${strings.length} strings)`);
      failed = true;
      continue;
    }
    const missing = strings.filter((source) => !Object.hasOwn(messages, source));
    const stale = Object.keys(messages).filter((source) => !strings.includes(source));
    const invalid = [];
    for (const source of strings.filter((value) => Object.hasOwn(messages, value))) {
      try {
        const translated = messages[source];
        if (
          JSON.stringify(placeholders(source).sort()) !==
          JSON.stringify(placeholders(String(translated)).sort())
        )
          throw new Error('Changed placeholders');
        validateLocaleTranslation(source, translated, locale.id);
      } catch (error) {
        invalid.push(`${source}: ${error.message}`);
      }
    }
    if (missing.length || stale.length || invalid.length) {
      failed = true;
      console.error(
        `${locale.id}: ${missing.length} missing, ${stale.length} stale, ${invalid.length} invalid`,
      );
      for (const entry of invalid) console.error(`  ${entry}`);
    } else console.log(`${locale.id}: ${strings.length} strings verified`);
  }
  if (failed) process.exitCode = 1;
  process.exit();
}
const protectedText =
  /\{[a-zA-Z]\w*\}|[\w./-]+\.(?:md|json|exe|cmd|mjs|wav)\b|\b(?:Capri|CAPRI|Spotify|YouTube|Discord|GitHub|Windows|OpenClaw|Ollama|Qwen|NVIDIA|AMD|Intel|CUDA|CPU|GPU|RAM|VRAM|GiB|GB|MB|API|FEN|PGN|Stockfish|Chess|OBS|TTS|ASR|MCP)\b|\d+(?:[.,]\d+)*/g;
const provider = process.argv.includes('--provider=bing') ? 'bing' : 'google';
let bingSession;
async function bingTranslate(locale, query) {
  if (!bingSession) {
    const response = await fetch(`https://www.bing.com/translator?cache=${Date.now()}`, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26100; en-US) PowerShell/7.6.0',
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const html = await response.text();
    const ig = /IG:"([^"]+)"/.exec(html)?.[1];
    const credentials = /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"/.exec(html);
    if (!ig || !credentials) throw new Error('Translation session unavailable');
    bingSession = { cookie, ig, key: credentials[1], token: credentials[2] };
  }
  const url = new URL('https://www.bing.com/ttranslatev3');
  url.search = new URLSearchParams({
    isVertical: '1',
    IG: bingSession.ig,
    IID: 'translator.5023.1',
  });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: bingSession.cookie,
      referer: 'https://www.bing.com/translator',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26100; en-US) PowerShell/7.6.0',
    },
    body: new URLSearchParams({
      fromLang: 'en',
      to:
        { zh: 'zh-Hans', no: 'nb', tl: 'fil', sr: 'sr-Cyrl', pt: 'pt-pt', 'pt-BR': 'pt' }[locale] ??
        locale,
      text: query,
      token: bingSession.token,
      key: bingSession.key,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) bingSession = undefined;
    throw new Error(`Translation HTTP ${response.status}`);
  }
  const data = await response.json();
  const text = data?.[0]?.translations?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Translation response unavailable');
  return text;
}

async function translate(locale, batch) {
  if (existsSync(throttleFile)) throw new Error('Translation paused by shared rate limit');
  const tokens = [];
  const lines = batch.map((text, index) => {
    const marker = `⟦${String(index).padStart(3, '0')}⟧`;
    return (
      marker +
      '\n' +
      text.replace(protectedText, (part) => {
        const token = `⟬${String(tokens.length).padStart(3, '0')}⟭`;
        tokens.push([token, part]);
        return token;
      })
    );
  });
  lines.push(`⟦${String(batch.length).padStart(3, '0')}⟧`);
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [key, value] of Object.entries({
    client: 'gtx',
    sl: 'en',
    tl: locale === 'zh' ? 'zh-CN' : locale,
    dt: 't',
    q: lines.join('\n'),
  }))
    url.searchParams.set(key, value);
  let data;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (provider === 'bing') data = await bingTranslate(locale, lines.join('\n'));
      else {
        const response = await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(25000),
        });
        if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
        const json = await response.json();
        data = json[0].map((part) => part[0]).join('');
      }
      break;
    } catch (error) {
      if (/HTTP (?:403|429)/.test(error.message)) {
        mkdirSync(path.dirname(throttleFile), { recursive: true });
        writeFileSync(throttleFile, `${new Date().toISOString()} ${error.message}\n`);
      }
      if (existsSync(throttleFile)) throw new Error('Translation paused by shared rate limit');
      if (attempt === 3) throw error;
      await delay(800 * 2 ** attempt);
    }
  }
  const joined = data.replace(
    /([⟦⟬])\s*(\d+)\s*([⟧⟭])/g,
    (_, begin, number, end) => begin + number.padStart(3, '0') + end,
  );
  return batch.map((source, index) => {
    const begin = `⟦${String(index).padStart(3, '0')}⟧`;
    const end = `⟦${String(index + 1).padStart(3, '0')}⟧`;
    if (!joined.includes(begin) || !joined.includes(end))
      throw new Error(`Translation row marker changed [source: ${source}]`);
    let result = joined.slice(joined.indexOf(begin) + begin.length, joined.indexOf(end)).trim();
    for (const [token, value] of tokens) result = result.replaceAll(token, value);
    if (/[⟦⟬]\d+[⟧⟭]/u.test(result)) throw new Error('Unrestored translation marker');
    try {
      return validateLocaleTranslation(source, result, locale);
    } catch (error) {
      throw new Error(`${error.message} [source: ${source}]`, { cause: error });
    }
  });
}
async function safeBatch(locale, batch) {
  try {
    return await translate(locale, batch);
  } catch (error) {
    if (
      batch.length < 2 ||
      /HTTP (?:401|403|429)|fetch failed|timed out|shared rate limit/i.test(error.message)
    )
      throw error;
    const middle = Math.ceil(batch.length / 2);
    return [
      ...(await safeBatch(locale, batch.slice(0, middle))),
      ...(await safeBatch(locale, batch.slice(middle))),
    ];
  }
}
let failed = false;
for (const locale of locales) {
  const file = path.join(destination, `${locale.id}.json`);
  let current = {};
  try {
    current = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const pending = strings.filter((text) => !current[text]);
  console.log(`${locale.id}: ${pending.length} of ${strings.length} strings pending`);
  try {
    while (pending.length) {
      const batch = [];
      let length = 0;
      while (pending.length && batch.length < 20 && length + pending[0].length < 1100) {
        const value = pending.shift();
        batch.push(value);
        length += value.length;
      }
      if (!batch.length) batch.push(pending.shift());
      const translations = await safeBatch(locale.id, batch);
      batch.forEach((text, index) => {
        current[text] = translations[index];
      });
      const ordered = Object.fromEntries(
        strings.filter((text) => current[text]).map((text) => [text, current[text]]),
      );
      writeJsonAtomic(file, ordered);
    }
  } catch (error) {
    console.error(`${locale.id}: ${error.message}`);
    failed = true;
    if (/HTTP (?:401|403|429)|fetch failed|timed out|shared rate limit/i.test(error.message)) break;
  }
}
if (failed) process.exitCode = 1;
