// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { githubFetch, listReleases } from '../packages/updater/src/github.mjs';
import { EXPERIMENTAL_REPOSITORY, REPOSITORY } from '../packages/updater/src/releases.mjs';
import { downloadUpdate } from '../packages/updater/src/download.mjs';
import { UpdateService } from '../apps/desktop/update-service.mjs';

const api = `https://api.github.com/repos/${REPOSITORY}/releases`;
const token = 'synthetic-optional-credential';
const parent = path.join(root, '.runtime/public-update-unit');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'case-'));
const bytes = Buffer.from('synthetic public release artifact');
const asset = {
  id: 42,
  name: 'CapriSetup-1.1.0.exe',
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const release = {
  tag_name: 'v1.1.0',
  draft: false,
  prerelease: false,
  assets: [
    {
      id: asset.id,
      name: asset.name,
      size: asset.bytes,
      digest: 'sha256:' + asset.sha256,
      state: 'uploaded',
    },
  ],
};

test('release history exposes notes and safely separates older versions from in-app updates', async () => {
  const base = folder();
  mkdirSync(path.join(base, 'config'), { recursive: true });
  writeFileSync(path.join(base, 'config/release.json'), '{"tag":"v1.0.0"}');
  let credential = null;
  const calls = [];
  const service = new UpdateService({
    root: base,
    state: base,
    credential: async () => credential,
    releases: async ({ repository }) => {
      calls.push(repository ?? REPOSITORY);
      if (repository)
        return [
          { ...release, tag_name: 'v1.2.0-experimental.2', prerelease: false, assets: [] },
          { ...release, tag_name: 'v1.3.0', prerelease: false, assets: [] },
        ];
      return [
        { ...release, body: 'Public changelog' },
        { ...release, tag_name: 'v0.9.0', assets: [] },
      ];
    },
  });
  const publicHistory = await service.history(true);
  assert.deepEqual(calls, [REPOSITORY]);
  assert.equal(publicHistory.previewUnavailable, true);
  const [newer, older] = publicHistory.releases;
  assert.equal(newer.notes, 'Public changelog');
  assert.equal(older.update, false);
  await assert.rejects(service.chooseHistory(older.id), /not available/);
  assert.equal((await service.chooseHistory(newer.id)).release.tag, 'v1.1.0');
  credential = token;
  const authenticatedHistory = await service.history(true);
  const [preview] = authenticatedHistory.releases;
  assert.equal(preview.experimental, true);
  assert.equal(
    authenticatedHistory.releases.some(({ tag }) => tag === 'v1.3.0'),
    false,
  );
  assert.equal(
    service.historyUrl(preview.id),
    'https://github.com/CapriChooms/Capri/releases/tag/v1.2.0-experimental.2',
  );
  await service.history(false);
  assert.throws(() => service.historyUrl(preview.id), /choose a version/);
});

test('public release metadata uses the fixed public repository without authorization', async () => {
  let requests = 0;
  const items = await listReleases({
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url.pathname, `/repos/${REPOSITORY}/releases`);
      assert.equal(new Headers(options.headers).get('authorization'), null);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.credentials, 'omit');
      return new Response(JSON.stringify([release]));
    },
  });
  assert.deepEqual(items, [release]);
  assert.equal(requests, 1);
});

test('optional access retries a rejected credential once anonymously on the same API URL', async (t) => {
  for (const status of [401, 403, 404]) {
    await t.test(String(status), async () => {
      const calls = [];
      const items = await listReleases({
        token,
        allowAnonymousFallback: true,
        fetchImpl: async (url, options) => {
          calls.push({
            url: url.href,
            authorization: new Headers(options.headers).get('authorization'),
          });
          return calls.length === 1
            ? new Response('untrusted failure body ' + token, { status })
            : new Response(JSON.stringify([release]));
        },
      });
      assert.deepEqual(items, [release]);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, calls[1].url);
      assert.equal(calls[0].authorization, 'Bearer ' + token);
      assert.equal(calls[1].authorization, null);
    });
  }
});

test('strict token validation and rate-limit responses never retry anonymously', async (t) => {
  for (const [status, headers, allowAnonymousFallback] of [
    [401, {}, false],
    [403, { 'x-ratelimit-remaining': '0' }, true],
    [403, { 'retry-after': '60' }, true],
    [429, {}, true],
  ]) {
    await t.test(`${status} ${JSON.stringify(headers)}`, async () => {
      let requests = 0;
      await assert.rejects(
        listReleases({
          token,
          allowAnonymousFallback,
          fetchImpl: async () => {
            requests++;
            return new Response(token, { status, headers });
          },
        }),
        (error) => error.httpStatus === status && !error.message.includes(token),
      );
      assert.equal(requests, 1);
    });
  }
});

test('public downloads and stale credentials retain fixed URLs, SHA-256 and credential-free CDN redirects', async (t) => {
  for (const credential of [undefined, token]) {
    await t.test(credential ? 'rejected optional credential' : 'anonymous', async () => {
      const calls = [];
      const file = await downloadUpdate(asset, folder(), {
        token: credential,
        fetchImpl: async (url, options) => {
          const authorization = new Headers(options.headers).get('authorization');
          calls.push({ url: url.href, authorization });
          assert.equal(options.redirect, 'manual');
          assert.equal(options.credentials, 'omit');
          if (authorization) return new Response(null, { status: 401 });
          if (url.origin === 'https://api.github.com') {
            assert.equal(url.href, api + '/assets/' + asset.id);
            return new Response(null, {
              status: 302,
              headers: { location: 'https://release-assets.githubusercontent.com/public/file.zip' },
            });
          }
          assert.equal(url.hostname, 'release-assets.githubusercontent.com');
          return new Response(bytes);
        },
      });
      assert.deepEqual(readFileSync(file), bytes);
      assert.equal(calls.length, credential ? 3 : 2);
      assert.equal(calls.at(-1).authorization, null);
    });
  }
});

test('anonymous fallback never permits old repositories, arbitrary hosts, insecure redirects or bad hashes', async () => {
  let requests = 0;
  const request = githubFetch({
    token,
    allowAnonymousFallback: true,
    fetchImpl: async () => {
      requests++;
      return new Response('');
    },
  });
  for (const url of [
    'https://api.github.com/repos/CapriChooms/Capri/releases',
    'https://api.github.com/repos/attacker/repo/releases',
    'https://untrusted.example/file.zip',
    'http://release-assets.githubusercontent.com/file.zip',
    `https://api.github.com:444/repos/${REPOSITORY}/releases`,
  ])
    await assert.rejects(request(url), /Unapproved/);
  assert.equal(requests, 0);
  await assert.rejects(
    downloadUpdate(asset, folder(), {
      token,
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://untrusted.example/file.zip' },
        }),
    }),
    /Unapproved/,
  );
  await assert.rejects(
    downloadUpdate({ ...asset, sha256: '0'.repeat(64) }, folder(), {
      fetchImpl: async () => new Response(bytes),
    }),
    /checksum/,
  );
  let tlsRequests = 0;
  await assert.rejects(
    downloadUpdate(asset, folder(), {
      token,
      fetchImpl: async () => {
        tlsRequests++;
        throw Object.assign(new Error('Synthetic TLS validation failure'), {
          code: 'CERT_HAS_EXPIRED',
        });
      },
    }),
    /TLS/,
  );
  assert.equal(tlsRequests, 1);
});

test('private assets use their own repository and send credentials only to the GitHub API', async () => {
  const repository = EXPERIMENTAL_REPOSITORY;
  const privateAssetUrl = `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url.href, new Headers(options.headers).get('authorization')]);
    if (url.href === privateAssetUrl)
      return new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/preview/file.zip' },
      });
    return new Response(bytes);
  };
  await assert.rejects(listReleases({ repository, fetchImpl }), { code: 'GITHUB_ACCESS_REQUIRED' });
  assert.deepEqual(calls, []);
  const file = await downloadUpdate(asset, folder(), { token, repository, fetchImpl });
  assert.deepEqual(readFileSync(file), bytes);
  assert.deepEqual(calls, [
    [privateAssetUrl, 'Bearer ' + token],
    ['https://release-assets.githubusercontent.com/preview/file.zip', null],
  ]);
  const privateFetch = githubFetch({ token, repository, allowAnonymousFallback: true, fetchImpl });
  await assert.rejects(privateFetch(api + '/assets/' + asset.id), /Unapproved/);
  let attempts = 0;
  await assert.rejects(
    listReleases({
      token,
      repository,
      allowAnonymousFallback: true,
      fetchImpl: async () => {
        attempts++;
        return new Response(null, { status: 404 });
      },
    }),
    { code: 'GITHUB_ACCESS_REQUIRED' },
  );
  assert.equal(attempts, 1);
});

test('startup and manual checks gate private releases on experimental access and keep public fallback', async (t) => {
  const preview = {
    ...release,
    tag_name: 'v1.2.0',
    prerelease: true,
    assets: [{ ...release.assets[0], name: 'CapriSetup-1.2.0.exe' }],
  };
  for (const scenario of [
    { name: 'stable', experimental: false, credential: token },
    { name: 'anonymous', experimental: true, credential: null },
    { name: 'private access denied', experimental: true, credential: token, denied: true },
    { name: 'public stable tie', experimental: true, credential: token, tie: true },
    { name: 'private preview', experimental: true, credential: token, privateSelected: true },
    {
      name: 'private Latest by tag',
      experimental: true,
      credential: token,
      privateSelected: true,
      taggedPreview: true,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const installRoot = folder();
      mkdirSync(path.join(installRoot, 'config'));
      writeFileSync(
        path.join(installRoot, 'config/release.json'),
        JSON.stringify({ tag: 'v1.0.0' }),
      );
      const state = path.join(installRoot, 'data/desktop');
      mkdirSync(state, { recursive: true });
      writeFileSync(
        path.join(state, 'updates.json'),
        JSON.stringify({ schemaVersion: 1, settings: { experimental: scenario.experimental } }),
      );
      const calls = [];
      const service = new UpdateService({
        root: installRoot,
        state,
        node: process.execPath,
        credential: async () => scenario.credential,
        releases: async ({ repository = REPOSITORY }) => {
          calls.push(repository);
          if (repository === EXPERIMENTAL_REPOSITORY) {
            if (scenario.denied) throw new Error('Private access denied');
            return scenario.taggedPreview
              ? [
                  { ...preview, tag_name: 'v1.2.0-experimental.2', prerelease: false },
                  {
                    ...preview,
                    tag_name: 'v1.3.0',
                    prerelease: false,
                    assets: [{ ...preview.assets[0], name: 'CapriSetup-1.3.0.exe' }],
                  },
                ]
              : [preview];
          }
          return [scenario.tie ? { ...preview, prerelease: false } : release];
        },
        download: async (selected, directory, options) => {
          assert.equal(
            options.repository,
            scenario.privateSelected ? EXPERIMENTAL_REPOSITORY : REPOSITORY,
          );
          assert.equal(selected.sha256, asset.sha256);
          mkdirSync(directory, { recursive: true });
          const file = path.join(directory, asset.sha256 + '.zip');
          writeFileSync(file, bytes);
          return file;
        },
      });
      const expected = scenario.taggedPreview
        ? 'v1.2.0-experimental.2'
        : scenario.privateSelected || scenario.tie
          ? preview.tag_name
          : release.tag_name;
      assert.deepEqual((await service.checkOnStartup()).notification, { tag: expected });
      const manual = await service.check();
      assert.equal(manual.release.tag, expected);
      if (scenario.taggedPreview) assert.equal(manual.release.experimental, true);
      assert.equal(
        manual.release.repository,
        scenario.privateSelected ? EXPERIMENTAL_REPOSITORY : undefined,
      );
      assert.deepEqual(
        calls,
        scenario.experimental && scenario.credential
          ? [REPOSITORY, EXPERIMENTAL_REPOSITORY, REPOSITORY, EXPERIMENTAL_REPOSITORY]
          : [REPOSITORY, REPOSITORY],
      );
      assert.equal((await service.prepare()).phase, 'ready');
      service.close();
    });
  }
});

test('manual preview checks distinguish missing access, temporary failure and a current release', async (t) => {
  for (const [name, credential, failure, phase, needsAccess] of [
    ['missing token', null, null, 'error', true],
    ['expired token', token, 'GITHUB_ACCESS_REQUIRED', 'error', true],
    ['network error', token, 'ECONNRESET', 'error', false],
    ['verified access', token, null, 'current', false],
  ]) {
    await t.test(name, async () => {
      const base = folder();
      mkdirSync(path.join(base, 'config'));
      writeFileSync(path.join(base, 'config/release.json'), '{"tag":"v1.1.0-experimental.3"}');
      writeFileSync(
        path.join(base, 'updates.json'),
        '{"schemaVersion":1,"settings":{"experimental":true}}',
      );
      const service = new UpdateService({
        root: base,
        state: base,
        credential: async () => credential,
        releases: async ({ repository }) => {
          if (repository !== EXPERIMENTAL_REPOSITORY) return [];
          if (failure)
            throw Object.assign(
              new Error(
                failure === 'GITHUB_ACCESS_REQUIRED'
                  ? 'Check your GitHub access.'
                  : 'private details',
              ),
              { code: failure },
            );
          return [{ ...release, tag_name: 'v1.1.0-experimental.3' }];
        },
      });
      assert.equal((await service.checkOnStartup()).phase, 'idle');
      const manual = await service.check();
      assert.equal(manual.phase, phase);
      assert.equal(manual.needsAccess, needsAccess);
      assert.doesNotMatch(manual.error ?? '', /private details/u);
      service.close();
    });
  }
});

test('explicit checks and downloads ignore unreadable saved credentials without changing encrypted storage', async () => {
  const installRoot = folder();
  mkdirSync(path.join(installRoot, 'config'));
  writeFileSync(path.join(installRoot, 'config/release.json'), JSON.stringify({ tag: 'v1.0.0' }));
  const secret = path.join(installRoot, 'data/secrets/github-updates.json');
  mkdirSync(path.dirname(secret), { recursive: true });
  const encrypted = JSON.stringify({
    schemaVersion: 1,
    ciphertext: 'synthetic-unreadable-ciphertext',
  });
  writeFileSync(secret, encrypted);
  let checks = 0,
    downloads = 0;
  const service = new UpdateService({
    root: installRoot,
    state: path.join(installRoot, 'data/desktop'),
    node: process.execPath,
    credential: async () => {
      throw new Error('Saved access is unreadable');
    },
    releases: async (options) => {
      checks++;
      assert.equal(options.token, null);
      assert.equal(options.allowAnonymousFallback, true);
      return [release];
    },
    download: async (selected, directory, options) => {
      downloads++;
      assert.equal(options.token, null);
      assert.equal(selected.sha256, asset.sha256);
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, asset.sha256 + '.zip');
      writeFileSync(file, bytes);
      return file;
    },
  });
  assert.equal((await service.check()).phase, 'available');
  assert.equal((await service.prepare()).phase, 'ready');
  assert.equal(checks, 1);
  assert.equal(downloads, 1);
  assert.equal(readFileSync(secret, 'utf8'), encrypted);
  service.close();
});
