// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from './storage.mjs';

const HUB_ORIGIN = 'https://huggingface.co';
const validToken = (value) => typeof value === 'string' && /^hf_[A-Za-z0-9]{20,200}$/u.test(value);
const unreadable = 'Saved Hugging Face access could not be read. Save the token again.';

/** Hub download credentials are independent of API inference profiles. */
export class HuggingFaceCredentials {
  constructor({ root, storage }) {
    this.storage = storage;
    this.file = path.join(root, 'data/secrets/huggingface.json');
    this.generation = 0;
  }

  record() {
    try {
      noLinks(this.file);
      if (!existsSync(this.file)) return null;
      const info = lstatSync(this.file);
      if (!info.isFile() || info.size > 8192) throw new Error();
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (
        saved.schemaVersion !== 1 ||
        saved.origin !== HUB_ORIGIN ||
        typeof saved.ciphertext !== 'string' ||
        !/^[A-Za-z0-9+/]{1,6000}={0,2}$/u.test(saved.ciphertext)
      )
        throw new Error();
      return saved;
    } catch {
      throw new Error(unreadable);
    }
  }

  async status() {
    const secureStorage = Boolean(await this.storage.available());
    try {
      return { hasToken: Boolean(this.record()), secureStorage, error: null };
    } catch {
      return { hasToken: false, secureStorage, error: unreadable };
    }
  }

  async save(token) {
    if (!validToken(token)) throw new Error('Enter a valid Hugging Face read token.');
    const generation = ++this.generation;
    if (!(await this.storage.available()))
      throw new Error(
        'Secure credential storage is unavailable. Hugging Face access was not saved.',
      );
    let ciphertext;
    try {
      ciphertext = Buffer.from(await this.storage.encrypt(token)).toString('base64');
    } catch {
      throw new Error('Hugging Face access could not be saved securely.');
    }
    if (generation !== this.generation) throw new Error('Hugging Face token save was cancelled.');
    if (!/^[A-Za-z0-9+/]{1,6000}={0,2}$/u.test(ciphertext))
      throw new Error('Hugging Face access could not be saved securely.');
    noLinks(this.file);
    writeJsonAtomic(this.file, { schemaVersion: 1, origin: HUB_ORIGIN, ciphertext });
    return this.status();
  }

  async remove() {
    ++this.generation;
    noLinks(this.file);
    if (existsSync(this.file)) unlinkSync(this.file);
    return this.status();
  }

  async tokenFor(url) {
    const destination = URL.parse(String(url));
    if (
      !destination ||
      destination.origin !== HUB_ORIGIN ||
      destination.username ||
      destination.password
    )
      return null;
    const record = this.record();
    if (!record) return null;
    const generation = this.generation;
    try {
      if (!(await this.storage.available())) throw new Error();
      const decoded = await this.storage.decrypt(Buffer.from(record.ciphertext, 'base64'));
      const token = typeof decoded === 'string' ? decoded : decoded?.result;
      if (!validToken(token)) throw new Error();
      return generation === this.generation ? token : null;
    } catch {
      throw new Error(unreadable);
    }
  }
}
