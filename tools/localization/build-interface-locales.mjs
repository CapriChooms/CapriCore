/** Validate editable locale files and build the one offline runtime bundle. */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';
import { validateLocaleTranslation } from './interface-locale-validation.mjs';

const directory = path.join(root, 'apps/desktop/locales');
const config = JSON.parse(readFileSync(path.join(root, 'config/interface-locales.json'), 'utf8'));
const source = JSON.parse(readFileSync(path.join(directory, 'en.json'), 'utf8')).messages;
const placeholders = (text) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
const catalogFile = path.join(root, 'apps/shared/languages.json');
const languageCatalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
const bundle = { schemaVersion: 1, source: 'en', locales: {}, languageNames: {} },
  missing = [];
for (const meta of config.locales) {
  if (
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(meta.id) ||
    !['ltr', 'rtl'].includes(meta.direction) ||
    typeof meta.nativeName !== 'string'
  )
    throw new Error('Invalid interface locale metadata');
  const file = path.join(directory, meta.id + '.json');
  if (!existsSync(file)) {
    missing.push(meta.id);
    continue;
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const complete = Object.keys(source).every(
    (key) =>
      typeof data.messages[key] === 'string' &&
      data.messages[key].trim() &&
      placeholders(data.messages[key]) === placeholders(key),
  );
  if (!complete) {
    missing.push(meta.id);
    continue;
  }
  for (const key of Object.keys(source)) {
    try {
      validateLocaleTranslation(key, data.messages[key], meta.id);
    } catch (error) {
      throw new Error(meta.id + ': ' + key + ': ' + error.message);
    }
  }
  const nativeName = meta.nativeName[0].toLocaleUpperCase(meta.id) + meta.nativeName.slice(1);
  bundle.locales[meta.id] = {
    ...meta,
    nativeName,
    review: data.review,
    messages: Object.fromEntries(Object.keys(source).map((key) => [key, data.messages[key]])),
  };
  // Chromium omits some ICU language-name tables even when Node supports them.
  // Ship the build runtime's complete names so the UI never falls back to the
  // Windows language or raw language codes for an advertised locale.
  const names = new Intl.DisplayNames([meta.id], { type: 'language' });
  bundle.languageNames[meta.id] = Object.fromEntries(
    languageCatalog.map((item) => [item.id, names.of(item.id) ?? item.name]),
  );
}
if (missing.length && !process.argv.includes('--completed-only'))
  throw new Error('Incomplete locale files: ' + missing.join(', '));
if (!bundle.locales.en) throw new Error('English source locale is required');
writeJsonAtomic(path.join(root, 'apps/shared/interface-locales.json'), bundle);
const catalog = languageCatalog.map((item) => ({
  ...item,
  interface: Boolean(bundle.locales[item.id]),
}));
writeJsonAtomic(catalogFile, catalog);
console.log(
  JSON.stringify({
    locales: Object.keys(bundle.locales).length,
    messages: Object.keys(source).length,
    pending: missing,
  }),
);
