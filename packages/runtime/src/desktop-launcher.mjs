import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { root, paths } from './host/paths.mjs';
import { initialize } from './context.mjs';
import { launch, managedProcess } from './host/processes.mjs';
import { ensureDesktopIdentity } from './host/desktop-identity.mjs';
import { runtime } from './context.mjs';
import { electronBundleReady } from './host/electron-bundle.mjs';

export async function startDesktop({ wait = false } = {}) {
  if (existsSync(path.join(root, '.runtime/updates/active.json')))
    throw new Error(
      'An update is in progress or was interrupted. Wait for it to finish, or repair this folder with the full installer.',
    );
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error(
      'This desktop preview currently targets Windows x64. Runtime unit tests also run on Linux.',
    );
  if (!existsSync(path.join(root, 'config/core.local.json')))
    throw new Error('Run npm run setup first to choose a hardware profile.');
  const existing = managedProcess('desktop');
  if (existing) {
    writeFileSync(
      path.join(paths.data, 'run/desktop.show'),
      JSON.stringify({ show: true, launchNonce: process.env.CAPRI_LAUNCH_NONCE ?? null }),
    );
    return { ...existing, alreadyRunning: true };
  }
  if (!electronBundleReady(path.join(root, 'node_modules/electron')))
    throw new Error(
      'The Capri desktop download is incomplete. Open Capri Setup again, select this installation folder and choose Retry or Repair. Keep Setup open until it finishes; microphone and voice are optional.',
    );
  const rt = runtime();
  initialize(rt);
  let executable = path.join(root, 'node_modules/electron/dist/electron.exe');
  executable = await ensureDesktopIdentity(executable);
  for (const action of ['stop', 'show'])
    try {
      unlinkSync(path.join(paths.data, 'run', `desktop.${action}`));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  // Electron interprets even an empty value as RUN_AS_NODE.
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    let ended;
    const exit = new Promise((resolve) => {
      ended = resolve;
    });
    const marker = await launch(
      'desktop',
      executable,
      [path.join(root, 'apps/desktop/main.mjs')],
      rt,
      wait ? { onExit: ended } : {},
    );
    if (wait) await exit;
    return marker;
  } finally {
    if (previous !== undefined) process.env.ELECTRON_RUN_AS_NODE = previous;
  }
}
