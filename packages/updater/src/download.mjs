// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { canRetry, resumableArtifact } from '../../installer/src/resumable-download.mjs';
import { fileHash } from '../../installer/src/download.mjs';
import { approvedUrl, assetUrl, githubFetch } from './github.mjs';
import { gitlabAssetUrl } from './gitlab.mjs';
import { parseVersion, REPOSITORY } from './releases.mjs';

function downloadMirror(asset, folder, { tag, signal, progress, fetchImpl }) {
  const expected = gitlabAssetUrl(tag, asset.name);
  return resumableArtifact(
    { url: expected.href, sha256: asset.sha256, bytes: asset.bytes },
    path.join(folder, 'gitlab'),
    { signal, progress, fetchImpl },
    {
      artifactUrl(value) {
        const url = new URL(value);
        if (url.href !== expected.href) throw new Error('Unapproved GitLab update URL');
        return url;
      },
      fileHash,
    },
  );
}

export async function downloadUpdate(
  asset,
  folder,
  {
    token,
    repository = REPOSITORY,
    tag,
    source,
    signal,
    progress = () => {},
    fetchImpl = fetch,
  } = {},
) {
  const mirrorOptions = { tag, signal, progress, fetchImpl };
  if (source === 'gitlab') {
    if (repository !== REPOSITORY) throw new Error('Unapproved GitLab update repository');
    return downloadMirror(asset, folder, mirrorOptions);
  }
  const request = githubFetch({ token, repository, fetchImpl, allowAnonymousFallback: true });
  try {
    return await resumableArtifact(
      { url: assetUrl(asset.id, repository), sha256: asset.sha256, bytes: asset.bytes },
      folder,
      {
        signal,
        progress,
        fetchImpl: (url, options) =>
          request(url, {
            ...options,
            signal: AbortSignal.any([
              ...(options.signal ? [options.signal] : []),
              AbortSignal.timeout(120000),
            ]),
            headers: { ...options.headers, accept: 'application/octet-stream' },
          }),
      },
      { artifactUrl: (url) => approvedUrl(url, repository), fileHash },
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (
      repository !== REPOSITORY ||
      !tag ||
      parseVersion(tag).pre.length ||
      !([401, 403, 404].includes(error.httpStatus) || canRetry(error))
    )
      throw error;
    // Keep GitHub's size and checksum if its metadata already selected this artifact.
    return downloadMirror(asset, folder, mirrorOptions);
  }
}
