// SPDX-License-Identifier: GPL-3.0-only
import { resumableArtifact } from '../../installer/src/resumable-download.mjs';
import { fileHash } from '../../installer/src/download.mjs';
import { approvedUrl, assetUrl, githubFetch } from './github.mjs';
import { REPOSITORY } from './releases.mjs';
/** GitHub API asset -> approved CDN. Range retries retain verified partial bytes. */
export async function downloadUpdate(
  asset,
  folder,
  { token, repository = REPOSITORY, signal, progress = () => {}, fetchImpl = fetch } = {},
) {
  const request = githubFetch({ token, repository, fetchImpl, allowAnonymousFallback: true });
  return resumableArtifact(
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
}
