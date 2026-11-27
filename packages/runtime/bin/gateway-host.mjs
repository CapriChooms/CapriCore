import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, resourceRoot } from '../src/host/paths.mjs';
import { watchParentLifeline } from '../src/host/lifeline.mjs';

// Closing the supported stdin host lifeline asks OpenClaw to drain and release
// SQLite ownership cleanly. SIGTERM alone force-kills Node on Windows.
const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/i.test(name)) throw new Error('Invalid Gateway host name');
const stopFile = path.join(root, 'data/run', `${name}.stop`);
// The launcher cleared the previous instance's stop request before spawning us.
if (existsSync(stopFile)) process.exit(0);
const child = spawn(
  process.execPath,
  [
    '--optimize-for-size',
    '--max-semi-space-size=8',
    '--import',
    pathToFileURL(path.join(root, 'packages/runtime/bin/response-timing-preload.mjs')).href,
    path.join(root, 'node_modules/openclaw/openclaw.mjs'),
    'gateway',
    'run',
    '--port',
    process.env.CAPRI_GATEWAY_PORT,
    '--bind',
    'loopback',
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      // Node retains serialized module code in the long-lived gateway and its workers.
      NODE_DISABLE_COMPILE_CACHE: '1',
      OPENCLAW_GATEWAY_HOST_LIFELINE: 'stdin',
      OPENCLAW_NO_RESPAWN: '1',
      // OpenClaw enables Bonjour by default on Mac, even for a loopback-only gateway.
      ...(process.platform === 'darwin' &&
        root !== resourceRoot && { OPENCLAW_DISABLE_BONJOUR: '1' }),
    },
    windowsHide: true,
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  child.stdin.end();
}
const timer = setInterval(() => {
  if (existsSync(stopFile)) stop();
}, 250);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// If Capri dies without signalling, its stdin closes and the gateway drains too.
watchParentLifeline(stop);
child.on('error', (error) => {
  clearInterval(timer);
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearInterval(timer);
  process.exitCode = code ?? 1;
});
