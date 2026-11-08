// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'calculator-chat-'));
const desktop = path.join(folder, 'desktop');
mkdirSync(desktop);
writeFileSync(
  path.join(desktop, 'applications.json'),
  JSON.stringify({ schemaVersion: 1, settings: { calculator: true, notepad: false } }),
);
writeFileSync(
  path.join(desktop, 'companion.json'),
  JSON.stringify({ schemaVersion: 1, settings: { glitchEnabled: false } }),
);
const requests = [];
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    return;
  }
  if (request.method === 'POST') {
    requests.push(request.url);
    response.writeHead(503).end('Standalone arithmetic must not reach a model.');
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url);
const failures = [];
const cases = [
  {
    text: 'Calculate 3^4 + 6! - sqrt(949) via calculator',
    expression: '3^4 + 6! - sqrt(949)',
    result: '770.19415639850127395963027903809915957741222136939',
    display: 'Result: 770.1941563985013',
  },
  { text: 'Calculate 6!', expression: '6!', result: '720', display: 'Result: 720' },
];
let app;
async function launch() {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  assert.equal(page.url(), 'capri://desktop/index.html');
  page.on('pageerror', (error) => failures.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'capri://desktop/index.html',
    );
    owner.webContents.setBackgroundThrottling(false);
    owner.showInactive();
  });
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).applications.calculator, true);
  return page;
}

function assertHistory(messages) {
  assert.equal(messages.length, cases.length * 2);
  for (const [index, item] of cases.entries()) {
    const user = messages[index * 2];
    const assistant = messages[index * 2 + 1];
    assert.equal(user.role, 'user');
    assert.equal(user.text, item.text);
    assert.equal(assistant.status, 'complete');
    assert.equal(assistant.text, item.display);
    assert.deepEqual(assistant.localCalculation, {
      expression: item.expression,
      result: item.result,
    });
  }
}

try {
  let page = await launch();
  for (const [index, item] of cases.entries()) {
    await page.locator('#message').fill(item.text);
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    await page.locator('#message').press('Enter');
    await page.waitForFunction(
      async ({ display, expected }) => {
        const { activeTurnId, messages } = await window.capri.bootstrap();
        return (
          !activeTurnId &&
          messages.length === expected &&
          messages.at(-1).status === 'complete' &&
          messages.at(-1).text === display
        );
      },
      { display: item.display, expected: (index + 1) * 2 },
      { timeout: 15000 },
    );
    assert.equal(await page.locator('#subtitle-text').textContent(), item.display);
  }
  assertHistory((await page.evaluate(() => window.capri.bootstrap())).messages);
  assertHistory(JSON.parse(readFileSync(path.join(desktop, 'transcript.json'), 'utf8')).messages);
  assert.deepEqual(requests, []);
  await app.close();
  app = null;
  page = await launch();
  assertHistory((await page.evaluate(() => window.capri.bootstrap())).messages);
  await page.locator('#history-toggle').click({ force: true });
  await page.locator('#history-panel').waitFor({ state: 'visible' });
  const screenshot = path.join(folder, 'calculator-chat-history.png');
  await page.screenshot({ path: screenshot });
  assert.deepEqual(requests, []);
  assert.deepEqual(failures, []);
  console.log(
    'PASS real Electron calculator input, postfix factorial, precise local receipts and history after restart; no model requests.',
  );
  console.log('Calculator screenshot: ' + screenshot);
} finally {
  try {
    if (app) await app.close();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
