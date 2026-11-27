import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root, paths } from './host/paths.mjs';
import { initialize } from './context.mjs';
import { launch, managedProcess } from './host/processes.mjs';
import { ensureDesktopIdentity } from './host/desktop-identity.mjs';
import { runtime } from './context.mjs';
import { electronBundleReady } from './host/electron-bundle.mjs';
import { updateBlocksStartup } from './host/update-state.mjs';

export async function startDesktop({ wait = false } = {}) {
  if (updateBlocksStartup(root))
    throw new Error(
      'An update is in progress or was interrupted. Wait for it to finish, or repair this folder with the full installer.',
    );
  const linux = process.platform === 'linux';
  const mac = process.platform === 'darwin' && process.arch === 'arm64';
  if (!mac && ((!linux && process.platform !== 'win32') || process.arch !== 'x64'))
    throw new Error('Capri desktop requires Windows or Linux on x86-64, or an Apple Silicon Mac.');
  if (linux && !process.env.DISPLAY)
    throw new Error('Start Capri in a desktop session with X11 or XWayland.');
  if (!linux && !mac && !existsSync(path.join(root, 'config/core.local.json')))
    throw new Error('Run npm run setup first to choose a hardware profile.');
  const existing = managedProcess('desktop');
  if (existing) {
    writeFileSync(
      path.join(paths.data, 'run/desktop.show'),
      JSON.stringify({ show: true, launchNonce: process.env.CAPRI_LAUNCH_NONCE ?? null }),
    );
    return { ...existing, alreadyRunning: true };
  }
  const electronPackage = path.join(root, 'node_modules/electron');
  if (linux && !electronBundleReady(electronPackage, undefined, 'linux')) {
    try {
      createRequire(path.join(root, 'package.json'))('electron');
    } catch (cause) {
      throw new Error('Could not prepare Electron for Linux. Run npm ci and try again.', { cause });
    }
  }
  if (!electronBundleReady(electronPackage, undefined, process.platform)) {
    if (mac)
      throw new Error(
        'The Apple Silicon Electron runtime is incomplete. Run npm ci and try again.',
      );
    throw new Error(
      linux
        ? 'The Capri desktop download is incomplete. Run npm ci and try again.'
        : 'The Capri desktop download is incomplete. Open Capri Setup again, select this installation folder and choose Retry or Repair. Keep Setup open until it finishes; microphone and voice are optional.',
    );
  }
  const rt = runtime();
  initialize(rt);
  const executable = mac
    ? path.join(electronPackage, 'dist/Electron.app/Contents/MacOS/Electron')
    : await ensureDesktopIdentity(
        path.join(electronPackage, 'dist', linux ? 'electron' : 'electron.exe'),
      );
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
      [...(linux ? ['--ozone-platform=x11'] : []), path.join(root, 'apps/desktop/main.mjs')],
      rt,
      wait ? { onExit: ended } : {},
    );
    if (wait) await exit;
    return marker;
  } finally {
    if (previous !== undefined) process.env.ELECTRON_RUN_AS_NODE = previous;
  }
}
