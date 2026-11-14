// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsCompatibility as policy } from '../packages/runtime/src/host/windows-compatibility.mjs';
test('older Windows permits app/API/coding while reporting per-runtime limitations', () => {
  for (const build of [17763, 18363, 19041, 19044]) {
    const value = policy({ platform: 'win32', version: `10.0.${build}` });
    assert.equal(value.supported, true);
    assert.equal(value.legacy, true);
    assert.equal(value.features.api, true);
    assert.equal(value.features.ollamaVendorSupported, false);
    assert.equal(value.features.npu, false);
  }
  assert.equal(policy({ platform: 'win32', version: '10.0.19045' }).legacy, false);
  assert.equal(policy({ platform: 'win32', version: '10.0.26200' }).features.npu, true);
  for (const version of ['6.3.9600', '10.0.14393', 'unknown'])
    assert.equal(policy({ platform: 'win32', version }).supported, false);
});
