// SPDX-License-Identifier: GPL-3.0-only
import { validateTranslation, validateLocaleTranslation } from './interface-locale-validation.mjs';

/** Stable paths keep nested stage names and page order independent of translated text. */
export function installerStrings(value, prefix = '') {
  if (typeof value === 'string') return [[prefix, value]];
  return Object.entries(value).flatMap(([key, entry]) =>
    installerStrings(entry, prefix ? prefix + '.' + key : key),
  );
}
export function setInstallerString(value, key, text) {
  const parts = key.split('.'),
    last = parts.pop();
  const target = parts.reduce((current, part) => current[part], value);
  target[last] = text;
}
export function validateInstallerLocale(source, value, locale) {
  const expected = installerStrings(source),
    actual = installerStrings(value);
  if (
    JSON.stringify(actual.map(([key]) => key).sort()) !==
    JSON.stringify(expected.map(([key]) => key).sort())
  )
    throw new Error('Installer translation keys do not match the English catalog');
  if (!Array.isArray(value.pages) || value.pages.length !== source.pages.length)
    throw new Error('Installer page order is invalid');
  for (const [key, text] of expected) {
    const translated = actual.find(([path]) => path === key)?.[1];
    try {
      if (locale) validateLocaleTranslation(text, translated, locale);
      else validateTranslation(text, translated);
    } catch (error) {
      throw new Error(key + ': ' + error.message);
    }
  }
  return value;
}
export function validateInstallerCatalog(catalog, locales) {
  const ids = locales.map(({ id }) => id);
  if (JSON.stringify(Object.keys(catalog).sort()) !== JSON.stringify([...ids].sort()))
    throw new Error('Installer languages must match the supported Capri interface languages');
  for (const id of ids) {
    validateInstallerLocale(catalog.en, catalog[id], id);
    if (id !== 'en' && catalog[id].intro === catalog.en.intro)
      throw new Error('Installer introductory help has no translation: ' + id);
  }
  return ids;
}
/** Windows culture names vary (for example fil-PH/nb-NO); unsupported ones fall back to English. */
export function installerCulture(culture, supported) {
  const base = String(culture).toLowerCase().split('-')[0];
  const id = { fil: 'tl', nb: 'no', nn: 'no', iw: 'he' }[base] ?? base;
  return supported.includes(id) ? id : 'en';
}
