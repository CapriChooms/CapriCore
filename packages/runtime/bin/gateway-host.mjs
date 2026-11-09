import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, nodePath, openclawPath } from '../src/index.mjs';

// Closing the supported stdin host lifeline asks OpenClaw to drain and release
// SQLite ownership cleanly. SIGTERM alone force-kills Node on Windows.
const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/i.test(name)) throw new Error('Invalid Gateway host name');
const stopFile = path.join(root, 'data/run', `${name}.stop`);
if (existsSync(stopFile)) unlinkSync(stopFile);
const child = spawn(
  nodePath,
  [
    '--import',
    pathToFileURL(path.join(root, 'packages/runtime/bin/response-timing-preload.mjs')).href,
    openclawPath,
    'gateway',
    'run',
    '--port',
    process.env.CAPRI_GATEWAY_PORT,
    '--bind',
    'loopback',
  ],
  {
    cwd: root,
    env: { ...process.env, OPENCLAW_GATEWAY_HOST_LIFELINE: 'stdin', OPENCLAW_NO_RESPAWN: '1' },
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
child.on('error', (error) => {
  clearInterval(timer);
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearInterval(timer);
  if (existsSync(stopFile)) unlinkSync(stopFile);
  process.exitCode = code ?? 1;
});
