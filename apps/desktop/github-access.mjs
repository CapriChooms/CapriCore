// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { githubCredential, listReleases } from '../../packages/updater/src/github.mjs';
import { EXPERIMENTAL_REPOSITORY } from '../../packages/updater/src/releases.mjs';

export const GITHUB_ACCESS_URL =
  'https://github.com/settings/personal-access-tokens/new?name=Capri%20updates&description=Read%20Capri%20releases&target_name=CapriChooms&expires_in=90&contents=read';
export const GITHUB_CLASSIC_ACCESS_URL =
  'https://github.com/settings/tokens/new?description=Capri%20updates&scopes=repo';
export function githubTokenUrl(kind = 'fine-grained') {
  if (kind === 'fine-grained') return GITHUB_ACCESS_URL;
  if (kind === 'classic') return GITHUB_CLASSIC_ACCESS_URL;
  throw new Error('Unknown GitHub token page.');
}
const validToken = (value) =>
  typeof value === 'string' && /^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,240}$/.test(value);

export function credentialStorage(safeStorage, platform = process.platform) {
  return {
    available: async () => {
      const available = safeStorage.isAsyncEncryptionAvailable
        ? await safeStorage.isAsyncEncryptionAvailable()
        : safeStorage.isEncryptionAvailable();
      return (
        available &&
        !(platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')
      );
    },
    encrypt: (value) =>
      safeStorage.encryptStringAsync
        ? safeStorage.encryptStringAsync(value)
        : Promise.resolve(safeStorage.encryptString(value)),
    decrypt: (value) =>
      safeStorage.decryptStringAsync
        ? safeStorage.decryptStringAsync(value)
        : Promise.resolve(safeStorage.decryptString(value)),
  };
}

/** Main-process only. The renderer receives status, never a token or ciphertext. */
export class GitHubAccess {
  constructor({ root, storage, verify = listReleases, fallback = githubCredential }) {
    Object.assign(this, { root, storage, verify, fallback });
    this.file = path.join(root, 'data/secrets/github-updates.json');
    this.controller = null;
  }
  async saved() {
    noLinks(this.file);
    if (!existsSync(this.file)) return null;
    try {
      const info = lstatSync(this.file);
      if (!info.isFile() || info.size > 8192) throw new Error('Invalid credential file');
      const record = JSON.parse(readFileSync(this.file, 'utf8'));
      if (
        record.schemaVersion !== 1 ||
        typeof record.ciphertext !== 'string' ||
        !(await this.storage.available())
      )
        throw new Error('Secure storage unavailable');
      const decoded = await this.storage.decrypt(Buffer.from(record.ciphertext, 'base64'));
      const token = typeof decoded === 'string' ? decoded : decoded?.result;
      if (!validToken(token)) throw new Error('Invalid stored credential');
      if (decoded?.shouldReEncrypt) {
        const encrypted = await this.storage.encrypt(token);
        noLinks(this.file);
        writeJsonAtomic(this.file, {
          schemaVersion: 1,
          ciphertext: Buffer.from(encrypted).toString('base64'),
        });
      }
      return token;
    } catch {
      throw new Error(
        'Saved GitHub access could not be read. Reconnect GitHub or remove the saved access.',
      );
    }
  }
  async credential() {
    return (await this.saved()) ?? (await this.fallback(this.root));
  }
  async status() {
    let connected = false,
      error = null;
    try {
      connected = Boolean(await this.saved());
    } catch (failure) {
      error = failure.message;
    }
    return {
      connected,
      secureStorage: await this.storage.available(),
      checking: Boolean(this.controller),
      repository: EXPERIMENTAL_REPOSITORY,
      error,
    };
  }
  diagnostics() {
    return {
      checking: Boolean(this.controller),
      hasSavedAccess: existsSync(this.file),
      lastFailure: this.lastFailure ?? null,
    };
  }
  recordFailure(error, phase) {
    this.lastFailure = {
      at: new Date().toISOString(),
      phase,
      code: [
        'GITHUB_ACCESS_REQUIRED',
        'GITHUB_TOKEN_FORMAT',
        'GITHUB_STORAGE_UNAVAILABLE',
      ].includes(error.code)
        ? error.code
        : 'GITHUB_REQUEST_FAILED',
      ...(Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}),
      ...(['token_rejected', 'repository_not_visible'].includes(error.accessReason)
        ? { accessReason: error.accessReason }
        : {}),
      ...(typeof error.requestId === 'string' && /^[A-Z0-9:.-]{1,100}$/i.test(error.requestId)
        ? { requestId: error.requestId }
        : {}),
    };
  }
  async connect(value) {
    if (this.controller) throw new Error('GitHub access is already being checked.');
    const token = typeof value === 'string' ? value.trim() : value;
    if (!validToken(token)) {
      const error = Object.assign(
        new Error('Paste a GitHub personal access token, not your password.'),
        { code: 'GITHUB_TOKEN_FORMAT' },
      );
      this.recordFailure(error, 'validation');
      throw error;
    }
    if (!(await this.storage.available())) {
      const error = Object.assign(
        new Error('Secure credential storage is unavailable. GitHub access was not saved.'),
        { code: 'GITHUB_STORAGE_UNAVAILABLE' },
      );
      this.recordFailure(error, 'storage');
      throw error;
    }
    const controller = (this.controller = new AbortController());
    try {
      // Validates read access to this fixed repository, never arbitrary account URLs.
      await this.verify({ token, signal: controller.signal, repository: EXPERIMENTAL_REPOSITORY });
      controller.signal.throwIfAborted();
      const encrypted = await this.storage.encrypt(token);
      controller.signal.throwIfAborted();
      noLinks(this.file);
      writeJsonAtomic(this.file, {
        schemaVersion: 1,
        ciphertext: Buffer.from(encrypted).toString('base64'),
      });
      this.lastFailure = null;
    } catch (error) {
      this.recordFailure(error, 'connect');
      throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
    return this.status();
  }
  async remove() {
    if (this.controller) throw new Error('Wait for the GitHub access check to finish.');
    noLinks(this.file);
    if (existsSync(this.file)) unlinkSync(this.file);
    this.lastFailure = null;
    return this.status();
  }
  close() {
    this.controller?.abort(new Error('GitHub access check cancelled'));
  }
}
