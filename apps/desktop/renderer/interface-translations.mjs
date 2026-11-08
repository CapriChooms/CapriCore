import bundle from '../../shared/interface-locales.json' with { type: 'json' };
import languages from '../../shared/languages.json' with { type: 'json' };

export const INTERFACE_LOCALES = Object.freeze(
  Object.values(bundle.locales).map(({ messages, ...meta }) => Object.freeze(meta)),
);
export const interfaceLocale = (id) => bundle.locales[id] ?? bundle.locales.en;
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
const templates = Object.keys(bundle.locales.en.messages)
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
export function uiText(text, language = 'en', values) {
  if (typeof text !== 'string') return text;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (
    !Object.hasOwn(bundle.locales.en.messages, text) &&
    Object.hasOwn(bundle.locales.en.messages, normalized)
  )
    text = normalized;
  const messages = interfaceLocale(language).messages;
  if (Object.hasOwn(bundle.locales.en.messages, text))
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

const reverse = new Map();
function canonical(text, language) {
  if (!reverse.has(language)) {
    const index = new Map();
    for (const [source, translated] of Object.entries(interfaceLocale(language).messages))
      if (!index.has(translated)) index.set(translated, source);
    reverse.set(language, index);
  }
  return reverse.get(language).get(text) ?? text;
}
const excluded = 'svg:not([data-ui-text]),output,script,textarea,[data-untranslated]';
/** Only owned UI roots are traversed. Dialogue, filenames and input values stay data. */
export class InterfaceLanguage {
  constructor() {
    this.language = 'en';
    this.originals = new WeakMap();
    this.attributes = new WeakMap();
  }
  text(text, values) {
    return uiText(text, this.language, values);
  }
  languageName(id) {
    return displayLanguage(id, this.language);
  }
  apply(language) {
    const previous = this.language;
    this.language = interfaceLocale(language).id;
    document.documentElement.lang = this.language;
    document.documentElement.dir = interfaceLocale(language).direction;
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
