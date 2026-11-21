// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { writeJsonAtomic } from '../../../packages/runtime/src/atomic-json.mjs';

export function softwareRenderingRequested(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))?.softwareRendering === true;
  } catch {
    return false;
  }
}

export function saveSoftwareRendering(file, softwareRendering) {
  writeJsonAtomic(file, { softwareRendering });
}

export function configureWindowGraphics(app, file, platform = process.platform) {
  const windows = platform === 'win32';
  const softwareRendering = windows && softwareRenderingRequested(file);
  // Transparent Chromium surfaces can present as opaque black on Windows. The
  // alternate presentation path keeps accelerated rasterization and WebGL.
  // Disable DirectComposition even in software mode: Chromium can use it there too.
  if (windows) app.commandLine.appendSwitch('disable-direct-composition');
  if (softwareRendering) app.disableHardwareAcceleration();
  return { directCompositionDisabled: windows, softwareRendering };
}
