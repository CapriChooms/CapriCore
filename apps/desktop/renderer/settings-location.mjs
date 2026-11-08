// SPDX-License-Identifier: GPL-3.0-only
const key = 'capri.settings.location.v1';
const validOffset = (value) => Number.isFinite(value) && value >= 0 && value <= 1e7;

/** Only section IDs and scroll offsets are stored; no form values or search text. */
export class SettingsLocation {
  constructor(sections, storage = () => globalThis.localStorage) {
    this.sections = new Set(sections);
    this.storage = storage;
    this.section = 'general';
    this.scrolls = {};
    this.navigation = 0;
    try {
      const encoded = storage().getItem(key);
      if (!encoded || encoded.length > 8192) return;
      const value = JSON.parse(encoded);
      if (value.schemaVersion !== 1) return;
      if (this.sections.has(value.section)) this.section = value.section;
      if (validOffset(value.navigation)) this.navigation = value.navigation;
      for (const id of this.sections)
        if (validOffset(value.scrolls?.[id])) this.scrolls[id] = value.scrolls[id];
    } catch {
      // Unavailable browser storage must never stop Settings from opening.
    }
  }
  remember(section, top, navigation) {
    if (!this.sections.has(section) || !validOffset(top) || !validOffset(navigation)) return;
    this.section = section;
    this.scrolls[section] = top;
    this.navigation = navigation;
    try {
      this.storage().setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          section,
          scrolls: this.scrolls,
          navigation,
        }),
      );
    } catch {}
  }
  top(section) {
    return this.scrolls[section] ?? 0;
  }
}
