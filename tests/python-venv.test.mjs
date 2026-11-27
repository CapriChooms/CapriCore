// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { venvPython } from '../apps/desktop/python-venv.mjs';

test('Windows virtual environments use Scripts/python.exe', (t) => {
  t.mock.property(process, 'platform', 'win32');
  assert.equal(
    venvPython('C:/capri/.runtime/asr-venv'),
    path.join('C:/capri/.runtime/asr-venv', 'Scripts/python.exe'),
  );
});

test('Linux virtual environments use bin/python', (t) => {
  t.mock.property(process, 'platform', 'linux');
  assert.equal(
    venvPython('/capri/.runtime/asr-venv'),
    path.join('/capri/.runtime/asr-venv', 'bin/python'),
  );
});

test('macOS virtual environments use bin/python, not the Windows layout', (t) => {
  t.mock.property(process, 'platform', 'darwin');
  const python = venvPython('/capri/.runtime/voice-training-venv');
  assert.equal(python, path.join('/capri/.runtime/voice-training-venv', 'bin/python'));
  assert.ok(!python.includes('Scripts'));
});

test('an empty venv path still resolves to a relative interpreter path', (t) => {
  t.mock.property(process, 'platform', 'linux');
  assert.equal(venvPython(''), path.join('', 'bin/python'));
});
