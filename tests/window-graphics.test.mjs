// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  configureWindowGraphics,
  saveSoftwareRendering,
} from '../apps/desktop/main/window-graphics.mjs';
import { temporaryFolders } from './temporary-folders.mjs';

const temp = temporaryFolders('capri-window-graphics-');

function startup(file, platform) {
  const calls = [];
  const app = {
    commandLine: { appendSwitch: (value) => calls.push(value) },
    disableHardwareAcceleration: () => calls.push('software'),
  };
  return { options: configureWindowGraphics(app, file, platform), calls };
}

test('Windows uses the alternate presentation path even with missing or corrupt preferences', () => {
  const file = path.join(temp(), 'window-graphics.json');
  const expected = {
    options: { directCompositionDisabled: true, softwareRendering: false },
    calls: ['disable-direct-composition'],
  };
  assert.deepEqual(startup(file, 'win32'), expected);
  writeFileSync(file, '{');
  assert.deepEqual(startup(file, 'win32'), expected);
});

test('software rendering is reversible and scoped to Windows UI startup', () => {
  const file = path.join(temp(), 'desktop', 'window-graphics.json');
  saveSoftwareRendering(file, true);
  assert.deepEqual(startup(file, 'win32'), {
    options: { directCompositionDisabled: true, softwareRendering: true },
    calls: ['disable-direct-composition', 'software'],
  });
  assert.deepEqual(startup(file, 'linux'), {
    options: { directCompositionDisabled: false, softwareRendering: false },
    calls: [],
  });
  saveSoftwareRendering(file, false);
  assert.deepEqual(startup(file, 'win32').calls, ['disable-direct-composition']);
});
