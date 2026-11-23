// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';

/** Routing hints only. The native bridge verifies executable branding and identity. */
export function browserExecutableCandidate(app, { explicit = false } = {}) {
  const name = path.basename(app.executable ?? '').toLowerCase();
  if (['chrome.exe', 'msedge.exe', 'opera.exe'].includes(name)) return true;
  if (name !== 'launcher.exe') return false;
  // A manually selected Opera launcher may have only its basename as a label.
  // Such a file can reach native validation only through an explicit app choice.
  return explicit || /^(?:opera|opera\s*gx)(?:\s+(?:internet\s+)?browser)?$/iu.test(app.name ?? '');
}

export function operaNameKey(value) {
  const key = String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
  if (['operagx', 'operagxbrowser', 'operagxinternetbrowser'].includes(key)) return 'operagx';
  return ['operabrowser', 'operainternetbrowser'].includes(key) ? 'opera' : key;
}
