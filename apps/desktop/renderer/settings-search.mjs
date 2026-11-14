// SPDX-License-Identifier: GPL-3.0-only

const controls = 'input:not([type="hidden"]), select, textarea, button, summary, h3, h4';
const decoration = 'svg, output, .beta-badge, [aria-hidden="true"]';
const clean = (text) => text?.replace(/\s+/gu, ' ').trim() ?? '';

function textOf(node) {
  if (!node) return '';
  const copy = node.cloneNode(true);
  for (const ornament of copy.querySelectorAll(decoration)) ornament.remove();
  return clean(copy.textContent);
}

function referencedText(target, attribute) {
  return clean(
    target
      .getAttribute(attribute)
      ?.split(/\s+/u)
      .map((id) => textOf(target.ownerDocument.getElementById(id)))
      .join(' '),
  );
}

/** Capture owned captions before status, profile and device data populate the forms. */
export function indexSettings(scopes) {
  const entries = [];
  for (const { section, sectionLabel, description, roots } of scopes) {
    entries.push({
      section,
      sectionLabel,
      name: sectionLabel,
      descriptions: description ? [description] : [],
    });
    for (const root of roots) {
      let heading;
      for (const target of root.querySelectorAll(controls)) {
        if (target.closest('.settings-heading, [aria-hidden="true"], [data-settings-info]'))
          continue;
        const field = target.matches('input, select, textarea');
        const label = target.labels?.[0];
        const name =
          (field ? textOf(label) : textOf(target)) ||
          referencedText(target, 'aria-labelledby') ||
          target.getAttribute('aria-label') ||
          target.getAttribute('placeholder');
        if (!name) continue;
        if (target.matches('h3, h4')) heading = target;
        const help = (label?.contains(target) ? label : target).nextElementSibling;
        const helpRow = label?.closest('[data-help-id]') ?? target.closest('[data-help-id]');
        const descriptions = [
          referencedText(target, 'aria-describedby'),
          help?.matches('.settings-help:not([role="status"])') && textOf(help),
          helpRow && textOf(target.ownerDocument.getElementById(helpRow.dataset.helpId)),
          target.getAttribute('title'),
          ...Array.from(target.options ?? [], (option) => clean(option.textContent)),
        ].filter(Boolean);
        entries.push({ section, sectionLabel, target, label, heading, root, name, descriptions });
      }
    }
  }
  return entries;
}

const fold = (text, locale) =>
  clean(text.normalize('NFKC').toLocaleLowerCase(locale)).replaceAll('ё', 'е');

export function findSettings(entries, query, ui) {
  query = fold(query, ui.language);
  if (!query) return [];
  const words = query.split(' ');
  const matches = [];
  const sectionsWithControls = new Set();
  for (const entry of entries) {
    const label = ui.text(entry.name);
    const names = [fold(label, ui.language), fold(entry.name, ui.language)];
    let rank = names.includes(query) ? 0 : names.some((name) => name.includes(query)) ? 1 : 2;
    if (rank === 2) {
      const content = names.concat(
        (entry.descriptions ?? []).flatMap((text) => [
          fold(text, ui.language),
          fold(ui.text(text), ui.language),
        ]),
      );
      if (!words.every((word) => content.some((text) => text.includes(word)))) continue;
    }
    if (entry.target) sectionsWithControls.add(entry.section);
    else rank += 3;
    matches.push({ ...entry, displayName: label, rank });
  }
  return matches
    .filter(({ section, target }) => target || !sectionsWithControls.has(section))
    .sort((a, b) => a.rank - b.rank);
}
