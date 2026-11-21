// SPDX-License-Identifier: GPL-3.0-only
import { parseVersion, releaseAsset } from './releases.mjs';

export const GITLAB_REPOSITORY = 'capricore1/CapriCore';
const origin = 'https://gitlab.com';
const projectApi = `${origin}/api/v4/projects/${encodeURIComponent(GITLAB_REPOSITORY)}`;
const packageName = 'capri';

function stableVersion(tag) {
  try {
    const { version, pre } = parseVersion(tag);
    return pre.length ? null : version;
  } catch {
    return null;
  }
}

export function gitlabAssetUrl(tag, name) {
  const version = stableVersion(tag);
  if (!version || ![`Capri-${version}-source.zip`, `CapriSetup-${version}.exe`].includes(name))
    throw new Error('Unapproved GitLab update asset');
  return new URL(`${projectApi}/packages/generic/${packageName}/${version}/${name}`);
}

export function gitlabReleaseUrl(tag) {
  return `${origin}/${GITLAB_REPOSITORY}/-/releases/${encodeURIComponent(tag)}`;
}

async function list(path, { fetchImpl, signal }) {
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const url = new URL(`${projectApi}/${path}`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const response = await fetchImpl(url, {
      redirect: 'manual',
      credentials: 'omit',
      headers: { accept: 'application/json', 'user-agent': 'Capri-Updater' },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404 && path.endsWith('/package_files')) return [];
      throw new Error(`GitLab update check failed (HTTP ${response.status}).`);
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 8 * 1024 ** 2) throw new Error('GitLab update metadata is too large.');
      chunks.push(chunk);
    }
    const values = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(values)) throw new Error('Invalid GitLab update metadata.');
    items.push(...values);
    if (values.length < 100) break;
  }
  return items;
}

export async function listGitLabReleases({ fetchImpl = fetch, signal } = {}) {
  const options = {
    fetchImpl,
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(6500)]),
  };
  const [releases, packages] = await Promise.all([
    list('releases', options),
    list(`packages?package_type=generic&package_name=${packageName}&status=default`, options),
  ]);
  const packagesByVersion = new Map();
  for (const item of packages) {
    if (
      item?.name !== packageName ||
      item.package_type !== 'generic' ||
      (item.status !== undefined && item.status !== 'default') ||
      stableVersion(item.version) !== item.version ||
      !Number.isSafeInteger(item.id) ||
      item.id <= 0
    )
      continue;
    // The registry URL identifies a version, so ambiguous package identities are unusable.
    packagesByVersion.set(item.version, packagesByVersion.has(item.version) ? null : item.id);
  }
  const published = releases.filter(
    (item) =>
      !item?.upcoming_release &&
      !(Date.parse(item?.released_at) > Date.now()) &&
      packagesByVersion.get(stableVersion(item?.tag_name)),
  );
  const available = [];
  for (let start = 0; start < published.length; start += 4) {
    const batch = await Promise.all(
      published.slice(start, start + 4).map(async (item) => {
        const version = stableVersion(item.tag_name);
        const id = packagesByVersion.get(version);
        const files = await list(`packages/${id}/package_files`, options);
        const assets = [`Capri-${version}-source.zip`, `CapriSetup-${version}.exe`].flatMap(
          (name) => {
            const matching = files.filter((file) => file?.file_name === name);
            if (matching.length !== 1) return [];
            const file = matching[0];
            return [
              {
                id: file.id,
                name,
                size: file.size,
                digest: `sha256:${file.file_sha256}`,
                state: 'uploaded',
              },
            ];
          },
        );
        const release = {
          tag_name: item.tag_name,
          body: typeof item.description === 'string' ? item.description.slice(0, 12000) : '',
          assets,
          downloadSource: 'gitlab',
        };
        return releaseAsset(release) && releaseAsset(release, 'installer') ? release : null;
      }),
    );
    available.push(...batch.filter(Boolean));
  }
  return available;
}
