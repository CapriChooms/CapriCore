// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { operaNameKey } from './browser-identity.mjs';
/** Names are lookup hints, never executable commands or permission grants. */
const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
const appNames = (app) => {
  const name = normalize(app.name),
    file = normalize(path.basename(app.executable ?? ''));
  // Both Opera editions use opera.exe; the GX label must not become plain Opera.
  return [name, ...(operaNameKey(name) === 'operagx' && file === 'opera' ? [] : [file])].filter(
    Boolean,
  );
};
const appIdentity = (value) => {
  const key = value.replaceAll(' ', '');
  if (key === 'googlechrome') return 'chrome';
  if (key === 'microsoftedge' || key === 'msedge') return 'edge';
  return operaNameKey(key);
};
export function exactApplications(apps, query) {
  const wanted = appIdentity(normalize(query));
  return wanted
    ? apps.filter((app) => appNames(app).some((name) => appIdentity(name) === wanted))
    : [];
}
export function matchingApplications(apps, query) {
  const wanted = normalize(query);
  if (!wanted) return [];
  const exact = exactApplications(apps, query);
  if (exact.length) return exact;
  if (operaNameKey(wanted) === 'operagx' || wanted === 'opera') return [];
  const tokens = new Set(wanted.split(' '));
  return apps.filter((app) => appNames(app).some((name) => name.length >= 3 && tokens.has(name)));
}
