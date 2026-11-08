// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { UpdateService } from '../apps/desktop/update-service.mjs';

const parent = path.join(root, '.runtime/startup-update-check-unit');
mkdirSync(parent, { recursive: true });
const fixtureToken = 'fixture-github-access';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function release(tag = 'v0.5.3', { prerelease = false, draft = false } = {}) {
  const version = tag.replace(/^v/, '').split('-')[0];
  return {
    tag_name: tag,
    prerelease,
    draft,
    assets: ['source', 'installer'].map((kind, index) => ({
      id: index + 1,
      name: kind === 'source' ? `Capri-${version}-source.zip` : `CapriSetup-${version}.exe`,
      state: 'uploaded',
      size: 123,
      digest: 'sha256:' + 'a'.repeat(64),
    })),
  };
}
function fixture({ experimental = false, ...overrides } = {}) {
  const installRoot = mkdtempSync(path.join(parent, 'case-'));
  mkdirSync(path.join(installRoot, 'config'));
  writeFileSync(path.join(installRoot, 'config/release.json'), JSON.stringify({ tag: 'v0.5.2' }));
  const state = path.join(installRoot, 'data/desktop');
  mkdirSync(state, { recursive: true });
  if (experimental)
    writeFileSync(
      path.join(state, 'updates.json'),
      JSON.stringify({ schemaVersion: 1, settings: { experimental: true } }),
    );
  const events = [],
    calls = { credentials: 0, releases: 0, downloads: 0 };
  const options = {
    root: installRoot,
    state,
    node: process.execPath,
    emit: (event) => events.push(event),
    credential: async () => {
      calls.credentials++;
      return fixtureToken;
    },
    releases: async ({ token }) => {
      calls.releases++;
      assert.equal(token, fixtureToken);
      return [release()];
    },
    download: async () => {
      calls.downloads++;
      assert.fail('A startup notice must not download an update.');
    },
    launch: () => assert.fail('A startup notice must not launch an update.'),
    ...overrides,
  };
  return { service: new UpdateService(options), options, state, events, calls };
}

test('startup checks find public releases without a readable usable credential', async (t) => {
  for (const token of [null, '', ' ', 'fixture\ncredential', undefined]) {
    await t.test(String(token), async () => {
      let requests = 0;
      const f = fixture({
        credential: async () => token,
        releases: async ({ token, allowAnonymousFallback }) => {
          requests++;
          assert.equal(token, null);
          assert.equal(allowAnonymousFallback, true);
          return [release()];
        },
      });
      const result = await f.service.checkOnStartup();
      assert.equal(result.phase, 'available');
      assert.deepEqual(result.notification, { tag: 'v0.5.3' });
      assert.equal(f.events.length, 1);
      assert.equal(requests, 1);
      assert.equal(f.calls.downloads, 0);
    });
  }
  let requests = 0;
  const f = fixture({
    credential: async () => {
      throw new Error('Saved access is unreadable');
    },
    releases: async ({ token }) => {
      requests++;
      assert.equal(token, null);
      return [release()];
    },
  });
  assert.equal((await f.service.checkOnStartup()).phase, 'available');
  assert.equal(requests, 1);
});

test('startup checks leave state untouched when no newer allowed release has a verified asset', async () => {
  const invalid = release('v0.9.0');
  invalid.assets.forEach((asset) => delete asset.digest);
  const f = fixture({
    releases: async () => [
      release('v0.5.1'),
      release('v0.5.2'),
      release('v0.6.0', { prerelease: true }),
      release('v0.7.0-beta.1'),
      release('v0.8.0', { draft: true }),
      invalid,
    ],
  });
  const before = f.service.snapshot();
  assert.deepEqual(await f.service.checkOnStartup(), before);
  assert.equal(f.service.selected, null);
  assert.deepEqual(f.events, []);
});

test('a newer stable release produces one notice without leaking credentials or starting downloads', async () => {
  const f = fixture();
  const state = await f.service.checkOnStartup();
  assert.equal(state.phase, 'available');
  assert.deepEqual(state.notification, { tag: 'v0.5.3' });
  assert.deepEqual(state.release, { tag: 'v0.5.3', experimental: false, bytes: 123 });
  assert.equal(state.checkedExperimental, false);
  assert.equal(f.service.selected.tag_name, 'v0.5.3');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].phase, 'available');
  assert.equal(JSON.stringify(f.events).includes(fixtureToken), false);
  assert.deepEqual(readdirSync(f.state), []);
  assert.equal(f.calls.downloads, 0);
  await f.service.checkOnStartup();
  assert.equal(f.calls.credentials, 1);
  assert.equal(f.calls.releases, 1);
  assert.equal(f.events.length, 1);
});

test('startup selection follows the saved experimental channel and selected payload kind', async () => {
  const f = fixture({
    experimental: true,
    releases: async () => [release(), release('v0.6.0-preview.1', { prerelease: true })],
  });
  const state = await f.service.checkOnStartup();
  assert.equal(state.release.tag, 'v0.6.0-preview.1');
  assert.equal(state.release.experimental, true);
  assert.equal(state.checkedExperimental, true);
  const sourceOnly = release();
  sourceOnly.assets = sourceOnly.assets.filter((asset) => asset.name.endsWith('.zip'));
  const managed = fixture({ releases: async () => [sourceOnly] });
  managed.service.mode = 'managed';
  assert.equal((await managed.service.checkOnStartup()).phase, 'available');
  const installer = fixture({ releases: async () => [sourceOnly] });
  assert.equal((await installer.service.checkOnStartup()).notification, null);
});

test('startup network, access and malformed metadata failures never publish errors', async (t) => {
  for (const error of [
    new Error('Network unavailable'),
    Object.assign(new Error('Access denied: ' + fixtureToken), { code: 'GITHUB_ACCESS_REQUIRED' }),
  ]) {
    await t.test(error.code ?? 'network', async () => {
      const f = fixture({
        releases: async () => {
          throw error;
        },
      });
      const before = f.service.snapshot();
      assert.deepEqual(await f.service.checkOnStartup(), before);
      assert.deepEqual(f.events, []);
    });
  }
  const f = fixture({ releases: async () => ({ invalid: true }) });
  const before = f.service.snapshot();
  assert.deepEqual(await f.service.checkOnStartup(), before);
  assert.deepEqual(f.events, []);
});

test('remind later keeps the update downloadable and defers only this app instance', async () => {
  const f = fixture();
  const available = await f.service.checkOnStartup();
  const selected = f.service.selected;
  const deferredState = f.service.remindLater();
  assert.equal(deferredState.notification, null);
  assert.equal(deferredState.phase, 'available');
  assert.deepEqual(deferredState.release, available.release);
  assert.equal(f.service.selected, selected);
  assert.deepEqual(readdirSync(f.state), []);
  assert.equal((await f.service.check()).notification, null);
  assert.equal((await f.service.checkOnStartup()).notification, null);
  assert.equal(f.calls.releases, 2);
  const nextInstance = new UpdateService(f.options);
  assert.deepEqual((await nextInstance.checkOnStartup()).notification, { tag: 'v0.5.3' });
  assert.deepEqual(readdirSync(f.state), []);
});

test('an explicit check supersedes a pending startup request even when its transport ignores abort', async () => {
  const started = deferred(),
    pending = deferred();
  let requests = 0,
    startupSignal;
  const f = fixture({
    releases: ({ signal }) => {
      if (++requests === 1) {
        startupSignal = signal;
        started.resolve();
        return pending.promise;
      }
      return Promise.resolve([release('v0.5.4')]);
    },
  });
  const startup = f.service.checkOnStartup();
  await started.promise;
  const manual = await f.service.check();
  assert.equal(startupSignal.aborted, true);
  assert.equal(manual.release.tag, 'v0.5.4');
  assert.equal(manual.notification, null);
  const events = structuredClone(f.events);
  pending.resolve([release('v0.9.0')]);
  await startup;
  await delay(0);
  assert.equal(f.service.selected.tag_name, 'v0.5.4');
  assert.deepEqual(f.service.snapshot(), manual);
  assert.deepEqual(f.events, events);
});

test('settings changes supersede an in-flight credential read before any startup network request', async () => {
  const pending = deferred();
  const f = fixture({ credential: () => pending.promise });
  const startup = f.service.checkOnStartup();
  const manual = f.service.setSettings({ experimental: true });
  await startup;
  pending.resolve(fixtureToken);
  await delay(0);
  assert.equal(f.calls.releases, 0);
  assert.deepEqual(f.service.snapshot(), manual);
  assert.equal(f.events.length, 1);
  assert.equal(manual.notification, null);
});

test('an explicit download request cancels startup without letting its late result change state', async () => {
  const started = deferred(),
    pending = deferred();
  let signal;
  const f = fixture({
    releases: (options) => {
      signal = options.signal;
      started.resolve();
      return pending.promise;
    },
  });
  const startup = f.service.checkOnStartup();
  await started.promise;
  await assert.rejects(f.service.prepare(), /Check for updates first/);
  assert.equal(signal.aborted, true);
  await startup;
  pending.resolve([release()]);
  await delay(0);
  assert.equal(f.service.snapshot().phase, 'idle');
  assert.equal(f.service.selected, null);
  assert.deepEqual(f.events, []);
});

test('close aborts startup and prevents a late request from publishing a notice', async () => {
  const started = deferred(),
    pending = deferred();
  let signal;
  const f = fixture({
    releases: (options) => {
      signal = options.signal;
      started.resolve();
      return pending.promise;
    },
  });
  const before = f.service.snapshot();
  const startup = f.service.checkOnStartup();
  await started.promise;
  f.service.close();
  assert.equal(signal.aborted, true);
  assert.deepEqual(await startup, before);
  pending.resolve([release()]);
  await delay(0);
  assert.deepEqual(f.service.snapshot(), before);
  assert.deepEqual(f.events, []);
  assert.deepEqual(await f.service.checkOnStartup(), before);
  const notStarted = fixture();
  notStarted.service.close();
  await notStarted.service.checkOnStartup();
  assert.equal(notStarted.calls.credentials, 0);
});

test('the startup deadline bounds a stuck credential read and prevents later requests', async () => {
  const pending = deferred();
  const f = fixture({ startupTimeoutMs: 10, credential: () => pending.promise });
  const before = f.service.snapshot();
  const [result] = await Promise.all([f.service.checkOnStartup(), delay(25)]);
  assert.deepEqual(result, before);
  pending.resolve(fixtureToken);
  await delay(0);
  assert.equal(f.calls.releases, 0);
  assert.deepEqual(f.events, []);
});

test('a manual operation before UI readiness prevents a duplicate startup check', async () => {
  const f = fixture();
  const manual = await f.service.check();
  assert.equal(manual.phase, 'available');
  assert.deepEqual(await f.service.checkOnStartup(), manual);
  assert.equal(f.calls.releases, 1);
});
