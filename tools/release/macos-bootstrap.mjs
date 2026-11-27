// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog } from 'electron';
import { macProfileRoot, macSupportRoot, prepareMacRuntime } from './macos-runtime.mjs';

// Set paths before importing the desktop host: its ESM dependencies resolve
// executable and state locations at module initialization.
async function launch() {
  const resources = process.resourcesPath;
  const source = path.join(resources, 'capri');
  const support = macSupportRoot();
  if (!process.argv.includes('--verification')) {
    // Claim the same profile as the desktop host before switching resource
    // links. Opening a second copy cannot retarget the already running host.
    app.setPath('userData', macProfileRoot(support));
    if (!app.requestSingleInstanceLock()) {
      app.exit(0);
      return;
    }
  }
  prepareMacRuntime(source, support);
  process.env.CAPRI_MACOS_RUNTIME_ROOT = support;
  process.env.CAPRI_PROJECT_ROOT = support;
  process.env.CAPRI_NODE_PATH = path.resolve(resources, '../Helpers/node');
  const { llamaVersion } = JSON.parse(readFileSync(path.join(source, 'config/core.json'), 'utf8'));
  process.env.CAPRI_LLAMA_PATH = path.join(
    source,
    '.runtime',
    'llama-' + llamaVersion + '-metal',
    'llama-server',
  );
  await import(pathToFileURL(path.join(source, 'apps/desktop/main.mjs')).href);
}

try {
  await launch();
} catch (error) {
  console.error('CAPRI_MACOS_STARTUP', error);
  dialog.showErrorBox('Capri could not start', String(error.message || error));
  app.exit(1);
}
