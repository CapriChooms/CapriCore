// SPDX-License-Identifier: GPL-3.0-only
export const REPOSITORY = 'CapriChooms/CapriCore';
export function parseVersion(tag) {
  const match =
    typeof tag === 'string' &&
    tag.match(
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
    );
  if (!match || tag.length > 100) throw new Error('Invalid release version');
  const numbers = match.slice(1, 4).map(Number);
  if (numbers.some((n) => !Number.isSafeInteger(n))) throw new Error('Invalid release version');
  const pre = match[4]?.split('.') ?? [];
  if (pre.some((n) => /^\d+$/.test(n) && (n.length > 15 || (n.length > 1 && n[0] === '0'))))
    throw new Error('Invalid release version');
  return { numbers, pre, version: numbers.join('.') };
}
export function compareVersions(a, b) {
  a = parseVersion(a);
  b = parseVersion(b);
  for (let i = 0; i < 3; i++)
    if (a.numbers[i] !== b.numbers[i]) return Math.sign(a.numbers[i] - b.numbers[i]);
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    if (a.pre[i] === b.pre[i]) continue;
    const an = /^\d+$/.test(a.pre[i]),
      bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) return Math.sign(Number(a.pre[i]) - Number(b.pre[i]));
    if (an !== bn) return an ? -1 : 1;
    return a.pre[i] < b.pre[i] ? -1 : 1;
  }
  return 0;
}
export function releaseAsset(release, kind = 'source') {
  const { version } = parseVersion(release.tag_name);
  const name = kind === 'source' ? `Capri-${version}-source.zip` : `CapriSetup-${version}.exe`;
  const asset = release.assets?.find((item) => item.name === name && item.state === 'uploaded');
  if (
    !asset ||
    !Number.isSafeInteger(asset.id) ||
    asset.id <= 0 ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > 512 * 1024 ** 2 ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')
  )
    return null;
  return { id: asset.id, name, bytes: asset.size, sha256: asset.digest.slice(7) };
}
export function selectRelease(releases, { current, experimental = false, kind = 'source' }) {
  parseVersion(current);
  return (
    releases
      .filter((release) => {
        try {
          const version = parseVersion(release.tag_name);
          return (
            !release.draft &&
            (experimental || (!release.prerelease && !version.pre.length)) &&
            compareVersions(release.tag_name, current) > 0 &&
            releaseAsset(release, kind)
          );
        } catch {
          return false;
        }
      })
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null
  );
}
