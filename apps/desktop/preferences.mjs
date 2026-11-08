import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './storage.mjs';

/** Validated private preferences. Bad files remain intact until an explicit edit. */
export class Preferences {
  constructor(file, defaults, validate) {
    Object.assign(this, { file, validate });
    this.value = structuredClone(defaults);
    this.warning = null;
    if (!existsSync(file)) return;
    try {
      const bytes = readFileSync(file);
      if (bytes.length > 16384) throw new Error('Preferences too large');
      const saved = JSON.parse(bytes.toString('utf8'));
      if (saved.schemaVersion !== 1) throw new Error('Unknown preferences version');
      this.value = validate(saved.settings);
    } catch {
      this.warning = 'Saved settings could not be restored. Defaults are in use.';
    }
  }
  snapshot() {
    return structuredClone(this.value);
  }
  set(value) {
    const next = this.validate(value);
    writeJsonAtomic(this.file, { schemaVersion: 1, settings: next });
    this.value = next;
    this.warning = null;
    return this.snapshot();
  }
}
