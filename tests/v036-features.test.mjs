// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { personaPrompt } from '../packages/runtime/src/context.mjs';
import {
  readCommunicationStyle,
  saveCommunicationStyle,
  COMMUNICATION_STYLES,
} from '../packages/runtime/src/communication.mjs';
import {
  savePersonality,
  initializePersonality,
  defaultPersonality,
} from '../packages/runtime/src/personality.mjs';
import { GitHubAccess, GITHUB_ACCESS_URL, githubTokenUrl } from '../apps/desktop/github-access.mjs';
import { EXPERIMENTAL_REPOSITORY } from '../packages/updater/src/releases.mjs';
import { listReleases } from '../packages/updater/src/github.mjs';
import { visuallySleeping } from '../apps/desktop/sleep-service.mjs';
import { PresenceModel } from '../apps/desktop/renderer/presence-model.mjs';

const parent = path.join(root, '.runtime/v036-unit');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'fixture-'));
function cryptoStorage() {
  const key = randomBytes(32);
  return {
    available: async () => true,
    encrypt: async (value) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), payload]);
    },
    decrypt: async (bytes) => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return {
        result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
          'utf8',
        ),
        shouldReEncrypt: false,
      };
    },
  };
}
test('each saved communication style reaches the next shared persona without rewriting the custom character', () => {
  const workspace = folder();
  savePersonality(workspace, 'My custom character stays editable.');
  assert.equal(readCommunicationStyle(workspace), 'neutral');
  for (const style of Object.keys(COMMUNICATION_STYLES)) {
    saveCommunicationStyle(workspace, style);
    const prompt = personaPrompt({ workspace });
    assert.ok(prompt.includes('COMMUNICATION STYLE: ' + style));
    assert.ok(prompt.includes('one or two short sentences'));
    assert.ok(prompt.includes('My custom character stays editable.'));
    assert.equal(
      readFileSync(path.join(workspace, 'PERSONALITY.md'), 'utf8'),
      'My custom character stays editable.',
    );
  }
  assert.throws(() => saveCommunicationStyle(workspace, 'invented instructions'));
});
test('desktop prompt previews use unsaved text and style without touching the workspace', () => {
  const workspace = folder();
  savePersonality(workspace, 'Saved personality.');
  saveCommunicationStyle(workspace, 'business');
  const preview = personaPrompt(
    { workspace },
    { personality: 'Preview personality.', style: 'wild' },
  );
  assert.match(preview, /Preview personality\./);
  assert.match(preview, /COMMUNICATION STYLE: wild/);
  const persisted = personaPrompt({ workspace });
  assert.match(persisted, /Saved personality\./);
  assert.match(persisted, /COMMUNICATION STYLE: business/);
});
test('only a reviewed stock personality is refreshed and its previous file is backed up', () => {
  const workspace = folder(),
    backupDirectory = folder(),
    old = 'An older stock default.';
  const digest = createHash('sha256').update(old).digest('hex');
  writeFileSync(path.join(workspace, 'PERSONALITY.md'), old);
  const result = initializePersonality(workspace, { backupDirectory, previousDefaults: [digest] });
  assert.equal(readFileSync(path.join(result.backup, 'PERSONALITY.md'), 'utf8'), old);
  assert.equal(readFileSync(path.join(workspace, 'PERSONALITY.md'), 'utf8'), defaultPersonality());
  savePersonality(workspace, 'Keep this custom character.');
  initializePersonality(workspace, { backupDirectory, previousDefaults: [digest] });
  assert.equal(
    readFileSync(path.join(workspace, 'PERSONALITY.md'), 'utf8'),
    'Keep this custom character.',
  );
});
test('disconnect uses resting artwork without reporting that models were unloaded', () => {
  for (const phase of ['offline', 'stopping']) {
    assert.equal(visuallySleeping('awake', phase), true);
    const presence = new PresenceModel();
    presence.phase = phase;
    presence.setSleeping(true);
    assert.equal(presence.snapshot().state, phase);
    assert.equal(presence.snapshot().expanded, true);
  }
  assert.equal(visuallySleeping('awake', 'ready'), false);
  assert.equal(visuallySleeping('awake', 'starting'), true);
  assert.equal(visuallySleeping('asleep', 'ready'), true);
});
test('private GitHub access is validated, encrypted and reused without GitHub CLI or token exposure', async () => {
  const destination = folder(),
    storage = cryptoStorage(),
    token = 'github_pat_' + 'a'.repeat(60),
    seen = [];
  const access = new GitHubAccess({
    root: destination,
    storage,
    verify: async (value) => {
      assert.equal(value.repository, EXPERIMENTAL_REPOSITORY);
      seen.push(value.token);
      return [];
    },
    fallback: () => {
      throw new Error('Saved access must not invoke GitHub CLI');
    },
  });
  const status = await access.connect(token);
  assert.equal(status.connected, true);
  assert.equal(status.repository, EXPERIMENTAL_REPOSITORY);
  assert.deepEqual(seen, [token]);
  const disk = readFileSync(access.file, 'utf8');
  assert.ok(!disk.includes(token));
  assert.ok(!JSON.stringify(status).includes(token));
  assert.ok(!JSON.stringify(status).includes('ciphertext'));
  const reopened = new GitHubAccess({ root: destination, storage });
  assert.equal(await reopened.credential(), token);
  await access.remove();
  assert.equal(existsSync(access.file), false);
  const url = new URL(GITHUB_ACCESS_URL);
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.searchParams.get('contents'), 'read');
  assert.equal(url.searchParams.get('target_name'), 'CapriChooms');
});
test('invalid access and failed replacement never overwrite a previously working encrypted credential', async () => {
  const destination = folder(),
    storage = cryptoStorage(),
    token = 'ghp_' + 'b'.repeat(36);
  let deny = false;
  const access = new GitHubAccess({
    root: destination,
    storage,
    verify: async () => {
      if (deny) throw new Error('Access denied');
    },
  });
  await access.connect(token);
  const original = readFileSync(access.file);
  await assert.rejects(access.connect('not a token'), /token/);
  deny = true;
  await assert.rejects(access.connect('github_pat_' + 'c'.repeat(60)), /denied/);
  assert.deepEqual(readFileSync(access.file), original);
  assert.equal(await access.credential(), token);
  const unavailable = new GitHubAccess({
    root: folder(),
    storage: { available: async () => false },
  });
  await assert.rejects(unavailable.connect(token), /Secure/);
  assert.equal(existsSync(unavailable.file), false);
});
test('closing during GitHub access validation cancels without saving a credential', async () => {
  const access = new GitHubAccess({
    root: folder(),
    storage: cryptoStorage(),
    verify: async ({ signal }) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  const pending = access.connect('github_pat_' + 'd'.repeat(60));
  await new Promise((resolve) => setImmediate(resolve));
  access.close();
  await assert.rejects(pending, /cancelled/);
  assert.equal(existsSync(access.file), false);
});
test('public release failures are distinguished from GitHub rate limits and never quote response bodies', async () => {
  for (const [status, headers, expected] of [
    [404, {}, /public CapriChooms\/CapriCore releases/],
    [403, { 'x-ratelimit-remaining': '4999' }, /Public Capri updates do not require a token/],
    [403, { 'x-ratelimit-remaining': '0' }, /limited/],
    [429, {}, /limited/],
  ]) {
    await assert.rejects(
      listReleases({
        fetchImpl: async () => new Response('untrusted response body', { status, headers }),
      }),
      expected,
    );
  }
});

test('GitHub token pages are fixed and classic access is a separate explicit choice', () => {
  assert.equal(githubTokenUrl(), GITHUB_ACCESS_URL);
  const url = new URL(githubTokenUrl('classic'));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/settings/tokens/new');
  assert.equal(url.searchParams.get('scopes'), 'repo');
  for (const value of ['https://untrusted.test', {}, 'Classic'])
    assert.throws(() => githubTokenUrl(value));
});

test('strict GitHub access verification rejects invalid tokens and inaccessible repositories', async () => {
  for (const [status, token, pattern, reason] of [
    [401, 'github_pat_' + 'a'.repeat(30), /expired, revoked/, 'token_rejected'],
    [
      404,
      'github_pat_' + 'a'.repeat(30),
      /public CapriChooms\/CapriCore releases/,
      'repository_not_visible',
    ],
    [
      404,
      'ghp_' + 'a'.repeat(30),
      /public CapriChooms\/CapriCore releases/,
      'repository_not_visible',
    ],
  ]) {
    await assert.rejects(
      listReleases({ token, fetchImpl: async () => new Response(token, { status }) }),
      (error) => {
        assert.match(error.message, pattern);
        assert.equal(error.accessReason, reason);
        assert(!JSON.stringify(error).includes(token));
        assert(!error.message.includes(token));
        return true;
      },
    );
  }
});

test('GitHub access diagnostics keep status/request ID while never storing failed tokens or bodies', async () => {
  const token = 'github_pat_' + 'q'.repeat(60);
  const access = new GitHubAccess({
    root: folder(),
    storage: cryptoStorage(),
    verify: (options) =>
      listReleases({
        ...options,
        fetchImpl: async () =>
          new Response('private response body ' + token, {
            status: 404,
            headers: { 'x-github-request-id': 'ABCD:1234' },
          }),
      }),
  });
  await assert.rejects(access.connect(token), (error) => error.httpStatus === 404);
  const details = access.diagnostics();
  assert.equal(details.lastFailure.httpStatus, 404);
  assert.equal(details.lastFailure.code, 'GITHUB_ACCESS_REQUIRED');
  assert.equal(details.lastFailure.requestId, 'ABCD:1234');
  assert.equal(details.hasSavedAccess, false);
  assert(!JSON.stringify(details).includes(token));
  assert(!JSON.stringify(details).includes('private response body'));
  await assert.rejects(access.connect('not a token'));
  assert.equal(access.diagnostics().lastFailure.code, 'GITHUB_TOKEN_FORMAT');
});
