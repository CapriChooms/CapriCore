// SPDX-License-Identifier: GPL-3.0-only
// Actual desktop UI with a disposable profile and a synthetic loopback gateway.
// No models, microphone, provider credentials, desktop capture or owner files.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/thinking-ui-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
const fixtureIntro = "I'll compare the two routes by travel time and transfers.";
const fixtureApproach =
  '1. List the two routes.\n2. Compare travel time and transfers.\n3. Explain which route fits the fixture constraints.';
const secondIntro = "I'll check this fixture calculation and its units.";
const secondApproach =
  '1. Identify the supplied values.\n2. Calculate the result.\n3. Verify the units.';
writeFileSync(
  entry,
  `
import {ChatService} from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/chat-service.mjs')).href)};
const send=ChatService.prototype.send;
globalThis.__thinkingInputs=[];
ChatService.prototype.send=function(input,...args){
  globalThis.__thinkingInputs.push({thinking:input.thinking});
  this.prepareThinking=async({text})=>{
    if(text.includes('cancellation')){
      globalThis.__secondThinkingStarted=true;
      return new Promise(resolve=>{globalThis.__releaseSecondThinking=()=>resolve(${JSON.stringify({ text: secondIntro, approach: secondApproach })})});
    }
    return ${JSON.stringify({ text: fixtureIntro, approach: fixtureApproach })};
  };
  return send.call(this,input,...args);
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
let pending;
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    for await (const chunk of req) {
      void chunk;
    }
    pending = res;
  } else res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const report = { passed: false, checks: [], errors: [], ownerDataAccessed: false };
let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  application
    .process()
    .stderr.on('data', (chunk) => appendFileSync(path.join(folder, 'process.stderr.log'), chunk));
  application
    .process()
    .stdout.on('data', (chunk) => appendFileSync(path.join(folder, 'process.stdout.log'), chunk));
  const page = await application.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  assert.equal(await page.locator('#thinking-toggle').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => document.getElementById('thinking-toggle').click());
  await page.waitForFunction(
    () =>
      document.getElementById('thinking-toggle').getAttribute('aria-pressed') === 'true' &&
      document.getElementById('thinking-toggle').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(() => window.capri.bootstrap().then((value) => value.thinking.enabled)),
    true,
  );
  report.checks.push(
    'The default-off composer toggle updates the actual session host and exposes its pressed state.',
  );

  const layouts = [];
  for (const [width, height] of [
    [480, 660],
    [320, 360],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()
          .find((view) => view.webContents.getURL().endsWith('/index.html'))
          .setContentSize(...size),
      [width, height],
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    layouts.push(
      ...(await page.evaluate(() => {
        const cases = [];
        const box = (node) =>
          Object.fromEntries(
            ['x', 'y', 'width', 'height', 'left', 'right', 'top', 'bottom'].map((key) => [
              key,
              node.getBoundingClientRect()[key],
            ]),
          );
        const visible = (node) =>
          node.getClientRects().length && getComputedStyle(node).display !== 'none';
        for (const [mode, compact, clock, direction, history, busy] of [
          ['portrait', false, false, 'ltr', false],
          ['core', false, false, 'ltr'],
          ['core', false, true, 'ltr'],
          ['portrait', true, false, 'ltr'],
          ['core', false, false, 'rtl'],
          ['portrait', true, true, 'rtl'],
          ['portrait', false, false, 'ltr', true],
          ['core', false, true, 'rtl', true],
          ['portrait', false, false, 'ltr', false, true],
          ['core', false, false, 'ltr', false, true],
        ]) {
          document.body.dataset.presence = mode;
          document.body.dataset.avatarDock = compact ? 'compact' : '';
          document.documentElement.dir = direction;
          document.getElementById('history-panel').hidden = !history;
          document.getElementById('send').hidden = Boolean(busy);
          document.getElementById('stop').hidden = !busy;
          const stopwatch = document.getElementById('stopwatch-hud');
          stopwatch.hidden = !clock;
          stopwatch.textContent = '01:23:45';
          const bar = document.getElementById('quick-actions').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('#quick-actions button')]
            .filter(
              (button) =>
                button.getClientRects().length && getComputedStyle(button).display !== 'none',
            )
            .map((button) => ({
              id: button.id || button.dataset.quick,
              ...Object.fromEntries(
                ['x', 'y', 'width', 'height', 'left', 'right', 'top', 'bottom'].map((key) => [
                  key,
                  button.getBoundingClientRect()[key],
                ]),
              ),
            }));
          const core = document.getElementById('presence-core').getBoundingClientRect();
          const composer = document.querySelector('.composer');
          const thinking = document.getElementById('thinking-toggle');
          cases.push({
            mode,
            compact,
            clock,
            direction,
            history: Boolean(history),
            busy: Boolean(busy),
            viewport: { width: innerWidth, height: innerHeight },
            bar: { left: bar.left, right: bar.right },
            core: { right: core.right, width: core.width },
            buttons,
            composer: box(composer),
            composerGap: parseFloat(getComputedStyle(composer).columnGap),
            composerButtons: [...composer.querySelectorAll(':scope > button')]
              .filter(visible)
              .map((node) => ({ id: node.id, ...box(node) })),
            message: box(document.getElementById('message')),
            thinkingInComposer: thinking.parentElement === composer,
            thinkingNeighbors: [
              thinking.previousElementSibling?.id,
              thinking.nextElementSibling?.id,
            ],
            musicAfterVoice:
              document.getElementById('voice-toggle').nextElementSibling?.id === 'music-toggle',
          });
        }
        document.body.dataset.presence = 'portrait';
        document.body.dataset.avatarDock = '';
        document.documentElement.dir = 'ltr';
        document.getElementById('history-panel').hidden = true;
        document.getElementById('send').hidden = false;
        document.getElementById('stop').hidden = true;
        document.getElementById('stopwatch-hud').hidden = true;
        return cases;
      })),
    );
  }
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL().endsWith('/index.html'))
      .setContentSize(480, 660),
  );
  await page.waitForFunction(() => innerWidth === 480);
  writeFileSync(path.join(folder, 'layouts.json'), JSON.stringify(layouts, null, 2));
  for (const layout of layouts) {
    assert.ok(!layout.buttons.some((button) => button.id === 'thinking-toggle'));
    assert.equal(layout.thinkingInComposer, true);
    assert.deepEqual(layout.thinkingNeighbors, ['attachment-open', 'input-microphone']);
    assert.equal(layout.musicAfterVoice, true);
    for (const button of layout.buttons) {
      assert.ok(
        button.left >= -0.5 && button.right <= layout.viewport.width + 0.5,
        `Toolbar overflow: ${JSON.stringify({ mode: layout.mode, clock: layout.clock, id: button.id })}`,
      );
      assert.ok(button.width >= 22 && button.height >= 22, JSON.stringify({ layout, button }));
    }
    const ordered = [...layout.buttons].sort((a, b) => a.left - b.left);
    const gaps = [];
    for (let index = 1; index < ordered.length; index++) {
      assert.ok(ordered[index].left >= ordered[index - 1].right - 0.5);
      gaps.push(ordered[index].left - ordered[index - 1].right);
    }
    assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.5, 'Toolbar gaps must be uniform.');
    const composerButtons = [...layout.composerButtons].sort((a, b) => a.left - b.left);
    assert.ok(composerButtons.some((button) => button.id === 'thinking-toggle'));
    for (const [index, button] of composerButtons.entries()) {
      assert.ok(button.width >= 20 && button.height >= 20, JSON.stringify({ layout, button }));
      if (button.id === 'thinking-toggle')
        assert.ok(
          button.width === 28 && button.height === 28,
          'Thinking keeps its standard 28-pixel composer control.',
        );
      assert.ok(
        button.left >= layout.composer.left &&
          button.right <= layout.composer.right + 0.5 &&
          button.top >= 0 &&
          button.bottom <= layout.viewport.height + 0.5,
        JSON.stringify(layout),
      );
      if (index)
        assert.ok(
          Math.abs(button.left - composerButtons[index - 1].right - layout.composerGap) < 0.5,
          'Composer buttons must keep the configured uniform gap.',
        );
    }
    assert.ok(layout.message.width >= 60, 'The input must retain usable typing space.');
    if (layout.mode === 'core' && !layout.compact && !layout.history && layout.core.width > 0)
      assert.ok(
        ordered[0].left >= layout.core.right - 0.5,
        'Core avatar and toolbar must not overlap.',
      );
  }
  report.checks.push(
    '480/320-pixel portrait, core, compact, history, stopwatch and RTL layouts keep Thinking in the composer, Music after Voice, and uniform non-overlapping button gaps.',
  );
  await page.screenshot({ path: path.join(folder, 'full-controls.png') });

  await page
    .locator('#message')
    .fill('Compare the travel time and transfers of two synthetic commuter routes.');
  await page.evaluate(() => document.getElementById('send').click());
  await page.waitForFunction(() => !document.getElementById('thinking-preface').hidden);
  const preface = await page.locator('#thinking-preface').textContent();
  assert.equal(preface, fixtureIntro);
  const approachToggle = page.locator('#thinking-approach-toggle');
  const approach = page.locator('#thinking-approach');
  await approachToggle.waitFor({ state: 'visible' });
  assert.equal(await approachToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await approach.isVisible(), false);
  assert.equal(await approach.textContent(), fixtureApproach.replace(/\n/g, ' '));
  await approachToggle.click();
  assert.equal(await approachToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await approach.isVisible(), true);
  await approachToggle.click();
  assert.equal(await approach.isVisible(), false);
  await approachToggle.click();
  assert.equal((await page.locator('#messages').textContent()).includes(preface), false);
  assert.equal(
    await page.evaluate(
      (text) =>
        window.capri.bootstrap().then((value) => value.messages.some((item) => item.text === text)),
      preface,
    ),
    false,
  );
  const flags = await application.evaluate(() => globalThis.__thinkingInputs);
  assert.equal(flags.at(-1).thinking, true);
  const compact = await page.evaluate(() => {
    document.body.dataset.presence = 'core';
    const progress = document.getElementById('thinking-progress');
    const button = document.getElementById('thinking-approach-toggle');
    const plan = document.getElementById('thinking-approach');
    const message = document.getElementById('message');
    const rectangles = [progress, button, plan, message].map((node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    });
    return { rectangles, viewport: innerWidth };
  });
  const [progressBox, buttonBox, planBox, messageBox] = compact.rectangles;
  for (const box of compact.rectangles)
    assert.ok(box.left >= 0 && box.right <= compact.viewport + 0.5);
  assert.ok(progressBox.width <= 312, 'Core mode must exercise the compact input width.');
  assert.ok(buttonBox.bottom <= planBox.top + 0.5 && planBox.bottom <= messageBox.top + 0.5);
  await page.screenshot({ path: path.join(folder, 'thinking-preface.png') });
  report.checks.push(
    'The task-specific intro is visible; its public approach starts collapsed and expands without overlapping compact input controls.',
  );
  assert.ok(pending, 'The real chat request must reach the synthetic gateway after its preface.');
  pending
    .writeHead(200, { 'content-type': 'text/event-stream' })
    .end(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'Synthetic final answer.' } }] }) +
        '\n\ndata: [DONE]\n\n',
    );
  pending = null;
  await page.waitForFunction(() => document.getElementById('thinking-preface').hidden);
  await page.waitForFunction(() =>
    document.querySelector('#messages')?.textContent.includes('Synthetic final answer.'),
  );
  assert.equal(await approachToggle.isVisible(), true);
  assert.equal(await approach.isVisible(), true);
  await approachToggle.click();
  assert.equal(await approach.isVisible(), false);
  await approachToggle.click();
  assert.equal(await approach.isVisible(), true);
  assert.equal(await approach.textContent(), fixtureApproach.replace(/\n/g, ' '));
  assert.equal(
    (await page.locator('#messages').textContent()).includes('List the two routes.'),
    false,
  );
  report.checks.push(
    'The intro clears on the answer, while the separate public approach remains accessible and absent from chat history.',
  );
  await page.locator('#message').fill('Please check cancellation in this synthetic fixture.');
  await page.waitForFunction(() => !document.getElementById('send').disabled);
  await page.evaluate(() => document.getElementById('send').click());
  await application.evaluate(async () => {
    const until = Date.now() + 5000;
    while (!globalThis.__secondThinkingStarted) {
      if (Date.now() > until) throw new Error('The synthetic second planner did not start.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  assert.equal(await approachToggle.isVisible(), false);
  assert.equal(await approach.isVisible(), false);
  assert.equal(await approach.textContent(), '');
  await application.evaluate(() => globalThis.__releaseSecondThinking());
  await page.waitForFunction(() => !document.getElementById('thinking-preface').hidden);
  assert.equal(await page.locator('#thinking-preface').textContent(), secondIntro);
  assert.equal(await approachToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await approach.isVisible(), false);
  report.checks.push(
    'A new turn clears the previous plan and starts the new task-specific approach collapsed.',
  );
  await page.evaluate(async () => {
    const snapshot = await window.capri.bootstrap();
    if (!snapshot.activeTurnId) throw new Error('The synthetic thinking turn must be active.');
    await window.capri.cancel(snapshot.activeTurnId);
  });
  await page.waitForFunction(() => document.getElementById('thinking-preface').hidden);
  report.checks.push('Cancelling a thinking turn removes its transient preface immediately.');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ ...report, folder }));
} finally {
  await application?.close().catch(() => {});
  pending?.end();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
