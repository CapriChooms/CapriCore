import bundle from '../../shared/interface-locales.json' with { type: 'json' };
import languages from '../../shared/languages.json' with { type: 'json' };
import english from '../locales/en.json' with { type: 'json' };
import { SKILL_TEXT_RU } from '../../../packages/skills/src/settings-catalog.mjs';

export const INTERFACE_LOCALES = Object.freeze(Object.values(bundle.locales).map(Object.freeze));
const metadata = (id) =>
  Object.hasOwn(bundle.locales, id) ? bundle.locales[id] : bundle.locales.en;
const recentLocales = new Map();
const pendingLocales = new Map();
const source = english.messages;

function rememberLocale(id, messages) {
  recentLocales.delete(id);
  recentLocales.set(id, messages);
  if (recentLocales.size > 4) recentLocales.delete(recentLocales.keys().next().value);
  return messages;
}

function localeMessages(id, load) {
  if (id === 'en') return source;
  if (recentLocales.has(id)) return rememberLocale(id, recentLocales.get(id));
  return load ? rememberLocale(id, load(id)) : source;
}

export function createInterfaceTranslator(load) {
  return {
    interfaceLocale(id) {
      const locale = metadata(id);
      return { ...locale, messages: localeMessages(locale.id, load) };
    },
    uiText(text, language = 'en', values) {
      return translate(text, language, values, localeMessages(metadata(language).id, load));
    },
  };
}
export const { interfaceLocale, uiText } = createInterfaceTranslator();

export async function prepareInterfaceLocale(id) {
  const locale = metadata(id).id;
  if (locale === 'en') return;
  if (recentLocales.has(locale)) {
    localeMessages(locale);
    return;
  }
  if (!pendingLocales.has(locale)) {
    const loading = fetch(`/locales/${locale}.json`)
      .then((response) => {
        if (!response.ok) throw Error('The interface translation could not be loaded.');
        return response.json();
      })
      .then(({ messages }) => rememberLocale(locale, messages))
      .finally(() => pendingLocales.delete(locale));
    pendingLocales.set(locale, loading);
  }
  await pendingLocales.get(locale);
}
const displayNames = new Map();
export function displayLanguage(id, locale = 'en') {
  if (!languages.some((item) => item.id === id)) return id;
  const bundled = bundle.languageNames?.[locale] ?? bundle.languageNames?.en;
  if (bundled?.[id]) return bundled[id];
  try {
    if (!displayNames.has(locale))
      displayNames.set(locale, new Intl.DisplayNames([locale], { type: 'language' }));
    return displayNames.get(locale).of(id);
  } catch {
    return languages.find((item) => item.id === id)?.label ?? id;
  }
}
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.keys(source)
  .filter((key) => /\{\w+\}/.test(key))
  .map((key) => {
    const names = [];
    let pattern = '',
      start = 0;
    for (const match of key.matchAll(/\{(\w+)\}/g)) {
      pattern += escape(key.slice(start, match.index)) + '(.+?)';
      names.push(match[1]);
      start = match.index + match[0].length;
    }
    return { key, names, pattern: new RegExp('^' + pattern + escape(key.slice(start)) + '$', 'u') };
  });
function interpolate(text, values) {
  return text.replace(/\{(\w+)\}/g, (token, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : token,
  );
}
function translate(text, language, values, messages) {
  if (typeof text !== 'string') return text;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (language === 'ru' && Object.hasOwn(SKILL_TEXT_RU, normalized))
    return SKILL_TEXT_RU[normalized];
  if (
    !Object.hasOwn(messages, text) &&
    !Object.hasOwn(source, text) &&
    (Object.hasOwn(messages, normalized) || Object.hasOwn(source, normalized))
  )
    text = normalized;
  if (Object.hasOwn(messages, text) || Object.hasOwn(source, text))
    return values ? interpolate(messages[text] ?? text, values) : (messages[text] ?? text);
  for (const template of templates) {
    const match = text.match(template.pattern);
    if (!match) continue;
    const variables = Object.fromEntries(
      template.names.map((name, index) => [name, match[index + 1]]),
    );
    if (variables.language) {
      const found = languages.find(
        (item) => item.name === variables.language || item.id === variables.language,
      );
      if (found) variables.language = displayLanguage(found.id, language);
      else if (variables.language === 'automatically detected language')
        variables.language = messages.Automatic ?? 'Automatic';
    }
    return interpolate(messages[template.key] ?? template.key, variables);
  }
  return values ? interpolate(text, values) : text;
}

const reverse = new WeakMap();
function canonical(text, messages) {
  if (!reverse.has(messages)) {
    const index = new Map();
    for (const [source, translated] of Object.entries(messages))
      if (!index.has(translated)) index.set(translated, source);
    reverse.set(messages, index);
  }
  return reverse.get(messages).get(text) ?? text;
}
const excluded = 'svg:not([data-ui-text]),output,script,textarea,[data-untranslated]';
/** Only owned UI roots are traversed. Dialogue, filenames and input values stay data. */
export class InterfaceLanguage {
  #messages = source;

  constructor() {
    this.language = 'en';
    this.originals = new WeakMap();
    this.attributes = new WeakMap();
  }
  text(text, values) {
    return translate(text, this.language, values, this.#messages);
  }
  languageName(id) {
    return displayLanguage(id, this.language);
  }
  apply(language) {
    const previous = this.#messages;
    this.language = metadata(language).id;
    this.#messages = localeMessages(this.language);
    document.documentElement.lang = this.language;
    document.documentElement.dir = metadata(language).direction;
    if (document.body.classList.contains('settings-window'))
      document.title = this.text('Capri Settings');
    const roots = [
      ...document.querySelectorAll(
        '#handle,#quick-actions,#portrait-panel,#presence-core,.dock-telemetry,#call-audio-dock,.composer label[for="message"],#wake-feedback,#reconnect,#notice,#clip-result,#action-approval,#time-alert,#computer-control-stop,#history-panel .history-heading,#history-empty,#dimming-panel,.preferences-panel,#welcome,#subtitle-controls,.packet-title,#settings-header,#confirmation-dialog,#stopwatch-controls',
      ),
    ];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest(excluded)) continue;
        const current = node.textContent,
          original = current.trim(),
          clean = original.replace(/\s+/g, ' ');
        if (!clean) continue;
        const old = this.originals.get(node);
        const source = old && old.rendered === current ? old.source : canonical(clean, previous);
        const rendered = current.replace(original, this.text(source));
        node.textContent = rendered;
        this.originals.set(node, { source, rendered });
      }
    }
    for (const element of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')) {
      if (element.closest('[data-untranslated]')) continue;
      let records = this.attributes.get(element);
      if (!records) {
        records = new Map();
        this.attributes.set(element, records);
      }
      for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
        const current = element.getAttribute(attribute);
        if (!current) continue;
        const old = records.get(attribute),
          source = old && old.rendered === current ? old.source : canonical(current, previous);
        const rendered = this.text(source);
        element.setAttribute(attribute, rendered);
        records.set(attribute, { source, rendered });
      }
    }
  }
}
