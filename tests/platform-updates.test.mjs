// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempDisposableSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { UpdateService } from '../apps/desktop/update-service.mjs';
import { REPOSITORY, releaseAsset, selectRelease } from '../packages/updater/src/releases.mjs';

const previewTag = 'v1.3.0-experimental.1';
const asset = (name, size = 123) => ({
  id: 1,
  name,
  size,
  state: 'uploaded',
  digest: 'sha256:' + 'a'.repeat(64),
});
const release = (tag_name, assets) => ({ tag_name, assets, prerelease: true, draft: false });
const linux = asset('Capri-1.3.0-linux-x86_64.tar.gz');
const mac = asset('Capri-1.3.0-macOS-arm64.zip', 550 * 1024 ** 2);
const combined = release(previewTag, [linux, mac]);

test('public platform previews are invisible to both Windows update paths', () => {
  for (const kind of ['installer', 'source']) {
    assert.equal(releaseAsset(combined, kind), null);
    assert.equal(selectRelease([combined], { current: 'v1.2.2', experimental: true, kind }), null);
  }
});

for (const [platform, arch, current, matchingAsset, newerForeign] of [
  ['linux', 'x64', 'v1.2.3-linux-preview.1', linux, asset('Capri-1.3.1-macOS-arm64.zip')],
  ['darwin', 'arm64', 'v1.2.2-macos-preview.1', mac, asset('Capri-1.3.1-linux-x86_64.tar.gz')],
]) {
  test(
    platform + ' notifies for its archive only, without credentials or local installation',
    async () => {
      using dir = mkdtempDisposableSync(
        path.join(realpathSync(tmpdir()), 'capri-platform-updates-'),
      );
      mkdirSync(path.join(dir.path, 'config'));
      mkdirSync(path.join(dir.path, 'state'));
      writeFileSync(path.join(dir.path, 'config/release.json'), JSON.stringify({ tag: current }));
      const updates = new UpdateService({
        root: dir.path,
        state: path.join(dir.path, 'state'),
        node: process.execPath,
        platform,
        arch,
        installSupported: false,
        credential: () => assert.fail('Platform archive checks do not use credentials'),
        download: () => assert.fail('Platform archives open their release page'),
        releases: async ({ token }) => {
          assert.equal(token, null);
          return [release('v1.3.1-experimental.1', [newerForeign]), combined];
        },
      });
      try {
        const result = await updates.checkOnStartup();
        assert.deepEqual(result.notification, { tag: previewTag });
        assert.equal(result.release.bytes, matchingAsset.size);
        assert.equal(
          updates.archiveReleaseUrl(),
          'https://github.com/' + REPOSITORY + '/releases/tag/' + previewTag,
        );
        assert.deepEqual(
          (await updates.history(true)).releases.map(({ tag }) => tag),
          [previewTag],
        );
      } finally {
        updates.close();
      }
    },
  );
}
