// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { createInterfaceTranslator } from './renderer/interface-translations.mjs';

export { INTERFACE_LOCALES, displayLanguage } from './renderer/interface-translations.mjs';

export const { interfaceLocale, uiText } = createInterfaceTranslator(
  (id) =>
    JSON.parse(readFileSync(new URL(`./locales/${id}.json`, import.meta.url), 'utf8')).messages,
);
