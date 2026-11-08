// SPDX-License-Identifier: GPL-3.0-only
import { scrypt, randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './storage.mjs';
const derive = promisify(scrypt),
  maxBytes = 512 * 1024;
const passwordValid = (value) =>
  typeof value === 'string' && value.length >= 8 && value.length <= 256;
const safe = (file) => {
  if (!existsSync(file)) return;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes)
    throw new Error('Private memory file is unsafe or too large.');
};
function envelope(file) {
  safe(file);
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (
    value?.version !== 1 ||
    !['salt', 'iv', 'tag', 'data'].every(
      (key) => typeof value[key] === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value[key]),
    )
  )
    throw new Error('Invalid private memory file.');
  const result = Object.fromEntries(
    ['salt', 'iv', 'tag', 'data'].map((key) => [key, Buffer.from(value[key], 'base64')]),
  );
  if (
    result.salt.length !== 16 ||
    result.iv.length !== 12 ||
    result.tag.length !== 16 ||
    !result.data.length ||
    result.data.length > maxBytes / 2
  )
    throw new Error('Invalid private memory file.');
  return result;
}
/** Password key and unlocked records never enter preferences, transcript, diagnostics or the gateway. */
export class PrivateMemory {
  constructor({ file, changed = () => {}, now = Date.now, idleMs = 5 * 60_000 }) {
    Object.assign(this, { file, changed, now, idleMs });
    this.generation = 0;
    this.failures = 0;
    this.nextTry = 0;
  }
  snapshot() {
    return {
      exists: existsSync(this.file),
      unlocked: Boolean(this.key),
      count: this.key ? this.notes.length : 0,
      busy: Boolean(this.pending),
    };
  }
  touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lock(), this.idleMs);
    this.timer.unref?.();
  }
  lock() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    clearTimeout(this.timer);
    this.key?.fill(0);
    this.key = null;
    this.salt = null;
    this.notes = [];
    this.history = [];
    this.changed(this.snapshot());
  }
  async exclusive(work) {
    if (this.pending) throw new Error('Wait for the current private-memory operation.');
    this.pending = true;
    try {
      return await work();
    } finally {
      this.pending = false;
      this.changed(this.snapshot());
    }
  }
  async unlock(password, { create = false } = {}) {
    if (!passwordValid(password)) throw new Error('Use a password of 8–256 characters.');
    if (this.now() < this.nextTry) throw new Error('Too many attempts. Wait before trying again.');
    return this.exclusive(async () => {
      if (this.key) throw new Error('Lock private memory first.');
      if (create && existsSync(this.file))
        throw new Error('Private memory already exists. Unlock it instead.');
      const generation = this.generation;
      let key, data;
      const sealed = create ? { salt: randomBytes(16) } : envelope(this.file);
      try {
        key = await derive(password, sealed.salt, 32, {
          N: 32768,
          r: 8,
          p: 3,
          maxmem: 64 * 1024 * 1024,
        });
        if (create) data = { notes: [] };
        else {
          const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
          decipher.setAAD(Buffer.from('Capri private memory v1'));
          decipher.setAuthTag(sealed.tag);
          const plaintext = Buffer.concat([decipher.update(sealed.data), decipher.final()]);
          try {
            data = JSON.parse(plaintext.toString('utf8'));
          } finally {
            plaintext.fill(0);
          }
        }
        if (generation !== this.generation) throw new Error('Private memory was locked.');
        if (
          !Array.isArray(data.notes) ||
          data.notes.length > 200 ||
          data.notes.some(
            (note) =>
              !note ||
              typeof note.id !== 'string' ||
              typeof note.text !== 'string' ||
              note.text.length > 1200,
          )
        )
          throw new Error('Invalid private memory content.');
        this.key = key;
        key = null;
        this.salt = sealed.salt;
        this.notes = data.notes;
        this.history = [];
        if (create) this.persist();
        this.failures = 0;
        this.nextTry = 0;
        this.touch();
        return this.snapshot();
      } catch {
        key?.fill(0);
        if (this.key && generation === this.generation) this.lock();
        this.failures++;
        this.nextTry = this.now() + Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5));
        throw new Error('Private memory could not be unlocked. Check the password and file.');
      }
    });
  }
  assertUnlocked() {
    if (!this.key) throw new Error('Unlock private memory first.');
    this.touch();
  }
  persist() {
    this.assertUnlocked();
    safe(this.file);
    safe(this.file + '.bak');
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('Capri private memory v1'));
    const plain = Buffer.from(JSON.stringify({ notes: this.notes }));
    if (plain.length > maxBytes / 2) {
      plain.fill(0);
      throw new Error('Private memory is full. Remove a note first.');
    }
    let encrypted;
    try {
      encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    } finally {
      plain.fill(0);
    }
    const sealed = {
      version: 1,
      salt: this.salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
    writeJsonAtomic(this.file + '.bak', sealed);
    writeJsonAtomic(this.file, sealed);
  }
  list() {
    this.assertUnlocked();
    return structuredClone(this.notes);
  }
  add(text) {
    this.assertUnlocked();
    if (typeof text !== 'string' || !text.trim() || text.length > 1200 || this.notes.length >= 200)
      throw new Error('Enter a private note of up to 1,200 characters (maximum 200 notes).');
    const note = { id: randomUUID(), text: text.trim() };
    this.notes.push(note);
    try {
      this.persist();
    } catch (error) {
      this.notes.pop();
      throw error;
    }
    this.changed(this.snapshot());
    return this.list();
  }
  remove(id) {
    this.assertUnlocked();
    const previous = this.notes;
    this.notes = this.notes.filter((note) => note.id !== id);
    try {
      this.persist();
    } catch (error) {
      this.notes = previous;
      throw error;
    }
    return this.list();
  }
  async changePassword(oldPassword, newPassword) {
    if (!passwordValid(newPassword)) throw new Error('Use a password of 8–256 characters.');
    // Re-authenticate from disk rather than accepting an unlocked UI as authorization.
    this.lock();
    await this.unlock(oldPassword);
    return this.exclusive(async () => {
      const generation = this.generation,
        salt = randomBytes(16);
      const key = await derive(newPassword, salt, 32, {
        N: 32768,
        r: 8,
        p: 3,
        maxmem: 64 * 1024 * 1024,
      });
      if (generation !== this.generation) {
        key.fill(0);
        throw new Error('Private memory was locked.');
      }
      const previousKey = this.key,
        previousSalt = this.salt;
      this.key = key;
      this.salt = salt;
      try {
        this.persist();
        previousKey.fill(0);
        return this.snapshot();
      } catch (error) {
        key.fill(0);
        this.key = previousKey;
        this.salt = previousSalt;
        throw error;
      }
    });
  }
  async chat(text, respond, { allowApi = false } = {}) {
    this.assertUnlocked();
    if (this.controller) throw new Error('Wait for the private reply.');
    if (typeof text !== 'string' || !text.trim() || text.length > 2000)
      throw new Error('Enter a private message of up to 2,000 characters.');
    const generation = this.generation,
      controller = (this.controller = new AbortController());
    const timer = setTimeout(() => controller.abort(), 90000);
    timer.unref?.();
    try {
      const answer = await respond({
        text,
        notes: this.list(),
        history: structuredClone(this.history),
        signal: controller.signal,
        allowApi,
      });
      if (generation !== this.generation || controller.signal.aborted)
        throw new Error('Private memory was locked.');
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 12000)
        throw new Error('No valid private reply was returned.');
      this.history = [
        ...this.history,
        { role: 'user', content: text },
        { role: 'assistant', content: answer },
      ].slice(-8);
      this.touch();
      return { text: answer };
    } catch {
      throw new Error('The private reply did not finish. No conversation was saved.');
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }
  close() {
    this.lock();
  }
}
