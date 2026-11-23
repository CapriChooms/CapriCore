// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { browserExecutableCandidate } from '../apps/desktop/browser-identity.mjs';
import { exactApplications, matchingApplications } from '../apps/desktop/application-target.mjs';

const app = (name, file) => ({
  name,
  executable: path.resolve('.runtime/browser-identity-fixture', file),
});
test('Opera routing admits its browser and explicitly selected launcher, never an unrelated automatic launcher', () => {
  for (const file of ['chrome.exe', 'msedge.exe', 'opera.exe'])
    assert(browserExecutableCandidate(app('Browser', file)));
  assert(browserExecutableCandidate(app('Opera GX Browser', 'launcher.exe')));
  assert(!browserExecutableCandidate(app('launcher', 'launcher.exe')));
  assert(browserExecutableCandidate(app('launcher', 'launcher.exe'), { explicit: true }));
  assert(!browserExecutableCandidate(app('Opera GX', 'unrelated.exe'), { explicit: true }));
  assert(!browserExecutableCandidate(app('Opera updater', 'launcher.exe')));
});

test('Opera GX aliases keep the two Opera editions and ambiguous installations separate', () => {
  const normal = app('Opera Browser', 'stable/opera.exe'),
    gx = app('Opera GX Browser', 'gx/opera.exe');
  for (const query of ['Opera GX', 'Opera GX Browser', 'Opera-GX Internet Browser']) {
    assert.deepEqual(exactApplications([normal, gx], query), [gx]);
    assert.deepEqual(matchingApplications([normal], query), []);
  }
  assert.deepEqual(exactApplications([normal, gx], 'Opera'), [normal]);
  assert.deepEqual(matchingApplications([gx], 'Opera'), []);
  const other = app('Opera GX', 'other-gx/launcher.exe');
  assert.deepEqual(exactApplications([gx, other], 'Opera GX'), [gx, other]);
});
