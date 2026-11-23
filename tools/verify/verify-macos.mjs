// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { macSupportRoot, prepareMacRuntime } from '../release/macos-runtime.mjs';
import { settingsView } from './settings-view.mjs';

const [target, mode] = process.argv.slice(2);
if (
  process.platform !== 'darwin' ||
  !target?.endsWith('.app') ||
  (mode && !['--local', '--agent'].includes(mode))
)
  throw new Error('Usage: npm run verify:macos -- /absolute/path/to/Capri.app [--local | --agent]');
const app = realpathSync(target);
const root = path.resolve(import.meta.dirname, '../..');
const resources = path.join(app, 'Contents/Resources/capri');
const reports = path.join(root, '.runtime/macos-verification');
mkdirSync(reports, { recursive: true });
const home = mkdtempSync(path.join(reports, 'home-'));
const support = macSupportRoot(home);
prepareMacRuntime(resources, support);
const fixture = path.join(support, '.runtime/fixture');
mkdirSync(fixture);
const real = Boolean(mode);
const node = path.join(app, 'Contents/Helpers/node');
const prompt = mode === '--local' ? 'How are you?' : 'What is seven plus five? Answer in digits.';
const token = 'CAPRI_MACOS_STREAM_OK';
const requests = [];
const gateway = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    return;
  }
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  const body = [];
  for await (const chunk of req) body.push(chunk);
  requests.push(JSON.parse(Buffer.concat(body)));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = JSON.stringify({ choices: [{ delta: { content: token } }] });
  res.end('data: ' + delta + '\n\ndata: [DONE]\n\n');
});

// Exercise the packaged main entry, bundled Node and fresh settings. Only
// published model layers are taken from the source checkout for the real run.
if (real) {
  const pins = JSON.parse(readFileSync(path.join(resources, 'config/llama-models.json')));
  for (const name of ['bge-m3:latest', 'qwen3.5:0.8b']) {
    const [model, tag] = name.split(':');
    const blobs = path.join('data/models/blobs');
    mkdirSync(path.join(support, blobs), { recursive: true });
    for (const { digest } of pins[name].layers) {
      const file = path.join(blobs, digest.replace(':', '-'));
      copyFileSync(path.join(root, file), path.join(support, file), constants.COPYFILE_FICLONE);
    }
    const manifests = path.join(support, 'data/models/manifests/registry.ollama.ai/library', model);
    mkdirSync(manifests, { recursive: true });
    writeFileSync(path.join(manifests, tag), JSON.stringify(pins[name]));
  }
}
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const port = await listen(gateway);
const inference = createServer();
const ollamaPort = await listen(inference);
await new Promise((resolve) => inference.close(resolve));
if (real) await new Promise((resolve) => gateway.close(resolve));
writeFileSync(
  path.join(support, 'config/core.local.json'),
  JSON.stringify({
    gatewayPort: port,
    ollamaPort,
    ...(real ? { model: 'capri-qwen3.5:0.8b', upstreamModel: 'qwen3.5:0.8b' } : {}),
  }),
);
let launched;
try {
  console.log('Isolated test profile:', home);
  launched = await _electron.launch({
    executablePath: path.join(app, 'Contents/MacOS/Capri'),
    args: ['--use-mock-keychain', ...(real ? [] : ['--verification'])],
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home,
      TMPDIR: process.env.TMPDIR || '/private/tmp',
      LANG: 'en_US.UTF-8',
      ...(real
        ? {}
        : {
            CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
            CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
            CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
          }),
    },
    timeout: 60000,
  });
  launched.process().stderr.on('data', (data) => {
    const line = data.toString();
    if (/startup failed|Unable to load preload|Failed to load/i.test(line))
      console.error(line.trim());
  });
  const page = await launched.firstWindow();
  await page.waitForSelector('#message', { state: 'attached' });
  const profile = await launched.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    data: app.getPath('userData'),
  }));
  assert.equal(profile.packaged, true);
  assert.ok(profile.data.startsWith(support + path.sep), profile.data);
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 180000,
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('#sprite');
    return img?.complete && img.naturalWidth > 0;
  });
  if (await page.locator('#guide-close').isVisible()) await page.locator('#guide-close').click();
  await page.locator('#message').fill(prompt);
  await page.locator('#message').press('Enter');
  if (!(await page.locator('#history-panel').isVisible()))
    await page.locator('#history-toggle').click();
  const response = page
    .locator(
      '.message[data-role="assistant"][data-status="complete"], .message[data-role="assistant"][data-status="error"]',
    )
    .last();
  await response.waitFor({ timeout: 240000 });
  assert.equal(await response.getAttribute('data-status'), 'complete', 'Assistant turn failed');
  const reply = response.locator('.message-text');
  assert.match(
    await reply.textContent(),
    mode === '--local' ? /\p{L}/u : real ? /\b(?:12|twelve)\b/i : new RegExp(token),
  );
  if (!real)
    assert.ok(
      requests.some(({ messages }) => messages.some((m) => String(m.content).includes(prompt))),
    );
  console.log(
    'PASS packaged avatar and',
    real ? 'local Qwen reply:' : 'fixture reply:',
    (await reply.textContent()).slice(0, 160),
  );
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.screenshot({ path: path.join(home, 'companion.png'), omitBackground: true });
  const settings = await settingsView(launched, 'updates');
  await settings
    .getByText('To update this macOS build', { exact: false })
    .waitFor({ state: 'visible' });
  assert.equal(await settings.locator('#updates-install').isVisible(), false);
  console.log('PASS native Settings, manual macOS updates and isolated profile');
} finally {
  if (launched) {
    const deadline = setTimeout(() => launched.process().kill(), 45000);
    try {
      await launched.close();
    } finally {
      clearTimeout(deadline);
    }
  }
  if (gateway.listening) await new Promise((resolve) => gateway.close(resolve));
  if (real) {
    execFileSync(node, [path.join(resources, 'packages/runtime/bin/core.mjs'), 'stop'], {
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        CAPRI_MACOS_RUNTIME_ROOT: support,
        CAPRI_NODE_PATH: node,
      },
      timeout: 60000,
      stdio: 'inherit',
    });
    rmSync(path.join(support, 'data/models'), { recursive: true, force: true });
  }
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
console.log('PASS bundle signature after launch and shutdown');
