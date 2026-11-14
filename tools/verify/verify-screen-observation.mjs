/** Local capture verification with isolated chat and no physical audio. */
import assert from 'node:assert/strict';
import { saveSettings, settingsView } from './settings-view.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { skillPreferences } from '../../packages/skills/src/settings-catalog.mjs';

const real = process.argv.includes('--real'),
  unsupported = process.argv.includes('--unsupported'),
  monitor = process.argv.includes('--monitor'),
  slowEnumeration = process.argv.includes('--slow-enumeration'),
  locale = process.argv.includes('--locale=ru') ? 'ru' : 'en',
  parent = path.join(root, '.runtime/screen-observation-verification');
assert(!(real && unsupported), 'The unsupported fixture cannot contact a real model.');
assert(!monitor || (!real && !unsupported), 'Monitor verification must use the loopback fixture.');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
let application,
  analyses = 0,
  rejectForegroundFrame = false;
const requests = [],
  screenFrames = [],
  errors = [];
const processLog = [];
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.end('{"data":[]}');
    return;
  }
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  if (req.url === '/api/chat') {
    analyses++;
    if (!monitor) screenFrames.push(body.messages.at(-1).images[0]);
    assert.deepEqual(body.tools, []);
    assert.ok(body.messages.at(-1).images.length === 1);
    if (unsupported) {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            code: 'model_images_unsupported',
            message: 'private detail must not show',
          },
        }),
      );
      return;
    }
    if (rejectForegroundFrame && body.options.num_predict > 192) {
      res.writeHead(502).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        done: true,
        message: {
          content: JSON.stringify({
            summary:
              analyses === 1
                ? 'A red square and a blue circle on a white background.'
                : 'A fresh green screen with FRESH 030 text.',
          }),
        },
      }),
    );
    return;
  }
  requests.push(body);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(
    'data: ' +
      JSON.stringify({
        choices: [{ delta: { content: '[avatar:neutral] A red square and a blue circle.' } }],
      }) +
      '\n\ndata: [DONE]\n\n',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port,
  rt = runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    gatewayPort: port,
  });
initialize(rt);
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
writeFileSync(
  path.join(folder, 'desktop/skills.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: skillPreferences({ 'capri.screen': { enabled: true, showButton: true } }),
  }),
);
if (unsupported) {
  writeFileSync(
    path.join(folder, 'desktop/languages.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: {
        interface: locale,
        conversation: 'en',
        customConversation: '',
        recognition: 'follow',
        speech: 'follow',
        autoDetect: false,
      },
    }),
  );
}
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
if (!real) env.CAPRI_DESKTOP_VERIFICATION_OBSERVATION_URL = `http://127.0.0.1:${port}`;
delete env.ELECTRON_RUN_AS_NODE;
const report = {
  passed: false,
  realVision: real,
  folder,
  capturedSource: monitor ? 'Monitor, loopback only' : 'Owned generated fixture only',
  physicalAudioMuted: true,
  userHistoryUsed: false,
  ...(unsupported ? { unsupportedFixture: true, locale } : {}),
};
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.process().stderr?.on('data', (chunk) => processLog.push(String(chunk)));
  application.process().stdout?.on('data', (chunk) => processLog.push(String(chunk)));
  const companion = await application.firstWindow();
  let page = companion;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.text().startsWith('Capri screen startup failed:'))
      processLog.push(message.text() + '\n');
  });
  const waitState = async (predicate, timeout = 30000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const state = await page.evaluate(() => window.capri.bootstrap());
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Observation state did not become ready');
  };
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(async ({ BrowserWindow }) => {
    const fixture = new BrowserWindow({
      width: 440,
      height: 320,
      show: false,
      title: 'CAPRI OBSERVATION FIXTURE',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await fixture.loadURL(
      'data:text/html,<title>CAPRI OBSERVATION FIXTURE</title><body style="margin:0;background:white"><div style="position:absolute;left:40px;top:65px;width:110px;height:110px;background:red"></div><div style="position:absolute;left:245px;top:65px;width:110px;height:110px;border-radius:50%;background:blue"></div>',
    );
    fixture.showInactive();
    const main = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    main.webContents.setAudioMuted(true);
    main.webContents.setBackgroundThrottling(false);
    main.showInactive();
    main.webContents.send('capri:event', { type: 'open-screen' });
  });
  page = await settingsView(application, 'screen');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#screen-source option')].some((o) =>
      o.textContent.includes('CAPRI OBSERVATION FIXTURE'),
    ),
  );
  const source = await page
    .locator('#screen-source option')
    .filter({ hasText: monitor ? /^Monitor:/ : 'CAPRI OBSERVATION FIXTURE' })
    .first()
    .getAttribute('value');
  await page.locator('#screen-source').selectOption(source);
  await page.locator('#screen-refresh').click({ force: true });
  await page.waitForFunction(
    (selected) => document.getElementById('screen-source').value === selected,
    source,
  );
  report.refreshRetainsSelectedSource = true;
  await page.locator('.screen-watch-settings summary').click({ force: true });
  await page.locator('#screen-watch-interval').fill('15');
  await saveSettings(page);
  await page.locator('#settings-draft-actions').waitFor({ state: 'hidden' });
  if (slowEnumeration)
    await application.evaluate(({ desktopCapturer }, monitor) => {
      const original = desktopCapturer.getSources;
      desktopCapturer.getSources = async (options) => {
        if (options.types.length === 1 && options.types[0] === (monitor ? 'screen' : 'window')) {
          desktopCapturer.getSources = original;
          await new Promise((resolve) => setTimeout(resolve, 5500));
        }
        return original.call(desktopCapturer, options);
      };
    }, monitor);
  const observationStarted = performance.now();
  await page.locator('#screen-watch-start').click({ force: true });
  if (monitor) {
    await waitState((state) => Boolean(state.screenObservation.lastAnalysedAt), 15000);
    assert.equal(analyses, 1);
    report.firstDescriptionMs = Math.round(performance.now() - observationStarted);
    await page.locator('#screen-watch-stop').click({ force: true });
    await waitState((state) => !state.screenObservation.active);
    assert.deepEqual(errors, []);
    report.passed = true;
  } else if (unsupported) {
    const expected =
      locale === 'en'
        ? 'The active model cannot read images or video frames.'
        : JSON.parse(readFileSync(path.join(root, 'apps/desktop/locales/ru.json'), 'utf8'))
            .messages['The active model cannot read images or video frames.'];
    const state = await waitState((value) => Boolean(value.screenObservation.warning), 10000);
    assert.equal(state.screenObservation.error, null);
    assert.equal(state.screenObservation.canAnalyse, false);
    assert.equal(state.screenObservation.lastAnalysedAt, null);
    await companion.waitForFunction((text) => {
      const notice = document.getElementById('notice');
      return (
        !notice.hidden &&
        notice.dataset.severity === 'warning' &&
        document.getElementById('notice-message').textContent === text &&
        document.getElementById('notice-report').hidden
      );
    }, expected);
    await page.waitForFunction((text) => {
      const status = document.getElementById('screen-watch-status');
      return status.dataset.severity === 'warning' && status.textContent === text;
    }, expected);
    assert.equal(analyses, 1);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle() === 'CAPRI OBSERVATION FIXTURE')
        .webContents.executeJavaScript("document.body.style.background='green'"),
    );
    await page.waitForTimeout(650);
    assert.equal(analyses, 1, 'Unsupported images must stop repeated image analysis attempts.');
    const finalState = (await page.evaluate(() => window.capri.bootstrap())).screenObservation;
    assert.equal(finalState.error, null);
    assert.equal(finalState.canAnalyse, false);
    assert.equal(await page.locator('#screen-watch-status').textContent(), expected);
    const text = await Promise.all([
      companion.locator('#notice').textContent(),
      page.locator('#screen-panel').textContent(),
    ]);
    assert.doesNotMatch(
      text.join('\n'),
      /private detail|screen update was skipped|Retrying later/i,
    );
    assert.deepEqual(errors, []);
    report.warningSeverity = true;
    report.reportBugHidden = true;
    report.localizedMessage = expected;
    report.warningRetainedInSettings = true;
    report.providerDetailsHidden = true;
    report.noRepeatedImageAnalyses = analyses === 1;
    report.passed = true;
  } else {
    await waitState((state) => state.screenObservation.active);
    await companion.waitForSelector('#screen-indicator:not([hidden])');
    assert.equal(await companion.locator('#screen-indicator').getAttribute('aria-pressed'), 'true');
    assert.equal(await companion.locator('#screen-indicator').isVisible(), true);
    await waitState((state) => Boolean(state.screenObservation.lastAnalysedAt));
    report.firstDescriptionMs = Math.round(performance.now() - observationStarted);
    assert.equal(
      await page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    report.cameraDenied = true;
    await page.screenshot({ path: path.join(folder, 'observation.png') });
    assert.equal(await page.locator('#screen-watch-interval').isDisabled(), true);
    assert.equal(await page.locator('#screen-watch-duration').isDisabled(), true);
    assert.equal(await page.locator('#screen-watch-locked').isVisible(), true);
    report.intervalLockExplained = true;
    await page.locator('#settings-window-close').click();
    assert.equal(
      (await page.evaluate(() => window.capri.bootstrap())).screenObservation.active,
      true,
      'Panel closing must not secretly stop explicitly enabled observation',
    );
    await page.waitForTimeout(2200);
    if (!real) assert.equal(analyses, 1, 'Unchanged source must not be analysed repeatedly');
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'CAPRI OBSERVATION FIXTURE')
        .webContents.executeJavaScript(
          "document.body.style.background='green'; document.body.innerHTML='<h1>FRESH 030</h1>';",
        ),
    );
    await companion.locator('#message').fill('What can you see in the selected window?');
    await companion.locator('#message').press('Enter');
    await companion.waitForSelector('.message[data-role="assistant"][data-status="complete"]', {
      state: 'attached',
    });
    assert.equal(requests.length, 1);
    assert.match(requests[0].messages.at(-1).content, /Read-only screen observation/);
    if (!real) {
      assert.match(requests[0].messages.at(-1).content, /fresh green/i);
      assert.equal(analyses, 2, 'Every ordinary foreground request needs a new screen analysis');
      assert.notEqual(
        screenFrames[0],
        screenFrames[1],
        'Foreground capture must include changed pixels',
      );
    }
    assert.equal(JSON.stringify(requests).includes('iVBORw0KGgo'), false);
    report.sharedTextContext = true;
    assert.equal(
      (await companion.evaluate(() => window.capri.bootstrap())).screenObservation.active,
      true,
      'Answering a screen question must preserve the current observation grant',
    );
    assert.match(requests[0].messages[0].content, /speak in the first person/);
    report.screenQuestionPreservesObservation = true;
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'CAPRI OBSERVATION FIXTURE')
        .webContents.executeJavaScript(
          "document.body.style.background='purple'; document.body.innerHTML='<h1>FRESH SECOND QUESTION</h1>';",
        ),
    );
    await companion.locator('#message').fill('Look at my screen again. What changed?');
    await companion.locator('#message').press('Enter');
    await companion.waitForFunction(
      () =>
        document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
          .length >= 2,
    );
    assert.equal(requests.length, 2);
    if (!real) {
      assert.equal(analyses, 3, 'A second question must bypass the background interval');
      assert.notEqual(screenFrames[1], screenFrames[2], 'Every question must capture new pixels');
    }
    report.consecutiveQuestionsCaptureFreshPixels = true;
    if (!real) {
      rejectForegroundFrame = true;
      await companion.locator('#message').fill('Can we keep chatting?');
      await companion.locator('#message').press('Enter');
      await companion.waitForFunction(
        () =>
          document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
            .length >= 3,
      );
      assert.equal(requests.length, 3);
      assert.match(requests[2].messages.at(-1).content, /Data: null/);
      assert.doesNotMatch(requests[2].messages.at(-1).content, /fresh green/i);
      assert.equal(
        (await companion.evaluate(() => window.capri.bootstrap())).screenObservation.active,
        true,
      );
      rejectForegroundFrame = false;
      report.providerFailureFallsBackToText = true;
    }
    await companion.locator('#screen-indicator').click({ force: true });
    await waitState((state) => !state.screenObservation.active);
    assert.equal(
      await companion.evaluate(
        () => document.getElementById('screen-live-preview').srcObject === null,
      ),
      true,
    );
    report.stopReleasesStream = true;
    assert.equal(
      await companion.locator('#screen-indicator').getAttribute('aria-pressed'),
      'false',
    );
    await companion.locator('#screen-indicator').click({ force: true });
    await waitState((state) => state.screenObservation.active);
    assert.equal(await companion.locator('#screen-panel').isVisible(), false);
    await companion.locator('#screen-indicator').click({ force: true });
    await waitState((state) => !state.screenObservation.active);
    report.quickToggleRestartsSelectedSource = true;
    // Re-arm, then hide. Never resume on show; a new source choice/gesture is required.
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
        .webContents.send('capri:event', { type: 'open-screen' }),
    );
    page = await settingsView(application, 'screen');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#screen-source option')].some((o) =>
        o.textContent.includes('CAPRI OBSERVATION FIXTURE'),
      ),
    );
    const again = await page
      .locator('#screen-source option')
      .filter({ hasText: 'CAPRI OBSERVATION FIXTURE' })
      .getAttribute('value');
    await page.locator('#screen-source').selectOption(again);
    // Selection crosses IPC into the companion. Wait for the enabled control as
    // a user would; a forced click can be dropped while the previous state arrives.
    await page.locator('#screen-watch-start').click();
    await waitState((state) => state.screenObservation.active);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
        .hide(),
    );
    await waitState((state) => !state.screenObservation.active);
    assert.equal(
      await companion.evaluate(
        () => document.getElementById('screen-live-preview').srcObject === null,
      ),
      true,
    );
    report.hideRevokes = true;
    await application.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(
        (w) => w.webContents.getURL() === 'capri://desktop/index.html',
      );
      main.showInactive();
      main.webContents.send('capri:event', { type: 'open-screen' });
    });
    page = await settingsView(application, 'screen');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#screen-source option')].some((o) =>
        o.textContent.includes('CAPRI OBSERVATION FIXTURE'),
      ),
    );
    const closing = await page
      .locator('#screen-source option')
      .filter({ hasText: 'CAPRI OBSERVATION FIXTURE' })
      .getAttribute('value');
    await page.locator('#screen-source').selectOption(closing);
    await page.locator('#screen-watch-start').click();
    await waitState((state) => state.screenObservation.active);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'CAPRI OBSERVATION FIXTURE')
        .destroy(),
    );
    await waitState((state) => !state.screenObservation.active, 10000);
    assert.equal(
      await companion.evaluate(
        () => document.getElementById('screen-live-preview').srcObject === null,
      ),
      true,
    );
    report.sourceDisappearanceRevokes = true;
    assert.deepEqual(errors, []);
    report.passed = true;
  }
} catch (error) {
  report.error = error.stack;
  report.processLog = processLog.join('').slice(-8000);
  const settingsPage = application?.windows().find((p) => p.url().endsWith('/settings.html'));
  report.screenForm = await settingsPage
    ?.evaluate(() => ({
      text: document.getElementById('screen-panel')?.innerText,
      startDisabled: document.getElementById('screen-watch-start')?.disabled,
      source: document.getElementById('screen-source')?.value,
    }))
    .catch(() => null);
  const page = application?.windows()[0];
  if (page && !monitor) {
    report.ui = await page
      .evaluate(async () => ({
        snapshot: await window.capri.bootstrap(),
        notice: document.getElementById('notice').textContent,
      }))
      .catch(() => null);
    await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    unsupported || monitor
      ? path.join(folder, 'report.json')
      : path.join(
          root,
          real ? 'logs/screen-observation-real.json' : 'logs/screen-observation-verification.json',
        ),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
