// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'avatar-performances-'));
const entry = path.join(folder, 'test-main.mjs');
writeFileSync(
  entry,
  `
const now = Date.now, random = Math.random;
const clock = globalThis.avatarPerformanceClock = { offset: 0, random: null };
Date.now = () => now() + clock.offset;
Math.random = () => clock.random ?? random();
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
let modelRequests = 0;
const server = createServer((request, response) => {
  if (request.method === 'POST') modelRequests++;
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '0',
};
delete env.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
  });
  const owner = await app.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await owner.waitForFunction(() => Boolean(document.getElementById('sprite').dataset.avatar));
  const send = (text) =>
    owner.evaluate((text) => window.capri.send({ id: crypto.randomUUID(), text }), text);
  const pointerAway = ({ screen }) => {
    const { x, y, height } = screen.getPrimaryDisplay().workArea;
    screen.getCursorScreenPoint = () => ({ x: x + 2, y: y + Math.floor(height / 2) });
  };
  await app.evaluate(pointerAway);
  const snapshot = () => owner.evaluate(() => window.capri.bootstrap());
  assert.equal((await snapshot()).screen.active, false);

  function overlay() {
    const current = app
      .windows()
      .filter((page) => page.url() === 'capri://desktop/avatar-detach.html');
    assert.ok(current.length);
    return current.at(-1);
  }
  const stage = '.avatar-pose-stage';
  async function playing(page, clip) {
    await page.waitForSelector(`${stage}[data-surface-performance="${clip}"]`);
    assert.equal(
      await page.locator(`${stage} canvas.avatar-surface-performance`).isVisible(),
      true,
    );
  }
  const settled = (page) =>
    page.waitForSelector(`${stage}[data-surface-performance]`, { state: 'detached' });
  const advance = (ms) =>
    app.evaluate((_electron, ms) => {
      globalThis.avatarPerformanceClock.offset += ms;
    }, ms);

  await send('Hey Capri, can you show me a pull-up?');
  const hanging = overlay();
  await playing(hanging, 'hang-pullup');
  await settled(hanging);
  await advance(31000);
  const followUp = await hanging.waitForFunction(
    () => document.querySelector('.avatar-pose-stage')?.dataset.surfacePerformance || null,
  );
  assert.ok(
    ['hang-catch', 'hang-wrist-scan', 'ledge-peek-below', 'edge-hang'].includes(
      await followUp.jsonValue(),
    ),
  );
  assert.equal((await snapshot()).companion.avatarRoaming, false);

  await send('Would you catch your data chip?');
  await playing(hanging, 'hang-catch');
  await send('Можешь проверить сканер на запястье?');
  await playing(hanging, 'hang-wrist-scan');
  await send('Поиграй соло на кейтаре, Капри!');
  await playing(overlay(), 'ledge-keytar');
  await send('Come back to your frame');

  await owner.waitForFunction(() => document.body.dataset.avatarDetach === 'attached');
  await app.evaluate(() => {
    globalThis.avatarPerformanceClock.random = 0;
  });
  await owner.evaluate(async () => {
    const { companion } = await window.capri.bootstrap();
    await window.capri.setCompanionSettings({
      ...companion,
      avatarRoaming: true,
      avatarRoamIntervalSeconds: 30,
    });
  });
  await owner.waitForTimeout(900);
  await advance(40000);
  await owner.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
  await playing(overlay(), 'hang-pullup');
  assert.equal((await snapshot()).screen.active, false);
  assert.equal(modelRequests, 0);
  console.log(
    'PASS avatar performs explicit and autonomous clips in the correct pose with screen observation off.',
  );
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
