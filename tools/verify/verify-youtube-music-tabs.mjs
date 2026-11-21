// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { prepareNativeHelper } from '../../apps/desktop/native-helper.mjs';
import { youtubeMusicRequest } from '../../apps/desktop/youtube-music-request.mjs';
import { YouTubeMusicService } from '../../integrations/youtube-music/service.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const browserPaths = [
  process.env.CAPRI_YOUTUBE_MUSIC_TEST_BROWSER,
  ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((directory) => path.join(directory, 'Google/Chrome/Application/chrome.exe')),
];
const executable = browserPaths.find((candidate) => candidate && existsSync(candidate));
assert(
  executable && process.platform === 'win32',
  'The native verifier requires Windows and a Chromium browser. Set CAPRI_YOUTUBE_MUSIC_TEST_BROWSER to select another browser.',
);

const parent = path.resolve(root, '.runtime/youtube-music-verification');
mkdirSync(parent, { recursive: true });
using fixture = mkdtempDisposableSync(path.join(parent, 'tabs-'));
assert.equal(path.dirname(path.resolve(fixture.path)), parent);
const profile = path.join(fixture.path, 'profile');
const child = spawn(
  executable,
  [
    '--user-data-dir=' + profile,
    '--remote-debugging-port=0',
    '--force-renderer-accessibility',
    '--disable-background-networking',
    '--disable-background-mode',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: false },
);
const exited = once(child, 'close');
exited.catch(() => {});

const sourceFile = 'apps/desktop/native/youtube-music.cs';
const musicUrl = 'https://music.youtube.com/';
const unrelatedUrl = 'https://example.com/';
const inactiveUrl = 'https://example.org/';
let browser;
let service;

async function waitForFocus(page, focused) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await page.evaluate(() => document.hasFocus())) === focused) return;
    await delay(100);
  }
  assert.fail(`Expected ${page.url()} focus=${focused}.`);
}

async function hideTab(page, selected) {
  const state = (tab) => tab.evaluate(() => document.hasFocus());
  for (let attempt = 0; attempt < 12; attempt++) {
    await selected.bringToFront();
    await delay(150);
    if ((await state(selected)) && !(await state(page))) {
      await delay(350);
      return;
    }
  }
  assert.fail(`Expected ${page.url()} to become a background tab.`);
}

async function verifyReceipt(page, receipt, expected) {
  if (receipt.status === expected) return;
  const state = await page.evaluate(() => ({
    url: location.href,
    query: document.querySelector('input')?.value,
    focus: document.activeElement?.id,
    track: document.querySelector('#title')?.textContent,
    transport: document.querySelector('#play-pause-button button')?.getAttribute('aria-label'),
  }));
  assert.equal(receipt.status, expected, JSON.stringify({ receipt, state }));
}

try {
  assert(Number.isInteger(child.pid), 'The fixture browser did not start.');
  const original = readFileSync(path.join(root, sourceFile), 'utf8');
  const entry = /static bool Browser\(IntPtr window\)\s*\{/u;
  const trackLoop = /foreach \(AutomationElement link in links\)\s*\{/u;
  assert.match(original, entry, 'The native discovery gate must be available to scope this test.');
  assert.match(original, trackLoop, 'The track loop must be available to simulate stale results.');
  // Keep discovery inside the disposable browser without modifying the production helper.
  const gated = original
    .replace(
      entry,
      (match) => `static bool fixtureResultReplaced;
    ${match}
        uint fixtureProcess;
        if (GetWindowThreadProcessId(window, out fixtureProcess) == 0 || fixtureProcess != ${child.pid}u)
            return false;`,
    )
    .replace(
      trackLoop,
      (match) => `${match}
                if (!home && !fixtureResultReplaced) {
                    fixtureResultReplaced = true;
                    throw new ElementNotAvailableException();
                }`,
    );
  const source = path.join(fixture.path, sourceFile);
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, gated);

  const devtools = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100 && !existsSync(devtools); attempt++) await delay(100);
  const port = Number(readFileSync(devtools, 'utf8').split(/\r?\n/u)[0]);
  assert(
    Number.isInteger(port) && port > 0,
    'The scoped browser did not publish its debugging port.',
  );
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  const [context] = browser.contexts();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.href === unrelatedUrl)
      return route.fulfill({ contentType: 'text/html', body: '<title>YouTube Music</title>' });
    if (url.href === inactiveUrl)
      return route.fulfill({ contentType: 'text/html', body: '<title>Other tab</title>' });
    if (url.origin !== new URL(musicUrl).origin) return route.abort();
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>YouTube Music</title>
        <form action="/search">
          <input id="input" class="style-scope ytmusic-search-box" aria-label="Search" name="q">
        </form>
        <div id="play-pause-button" class="ytmusic-player-bar" role="group" aria-label="Player">
          <button id="button" aria-label="Pause">Pause</button>
        </div>
        <div id="title" class="title style-scope ytmusic-player-bar" role="group"><span>Previous song</span></div>
        <input type="range" id="volume-slider" class="ytmusic-player-bar"
          aria-label="Volume" min="0" max="100" value="36">
        <div class="ytmusic-responsive-list-item-renderer" role="group" aria-label="Results" hidden>
          <a class="yt-simple-endpoint" href="/watch?v=abcdefghijk">C418</a>
        </div>
        <div id="playlist" class="ytmusic-card-shelf-renderer" role="group" aria-label="Playlist: Lofi Loft" hidden>
          <button id="play-button" aria-label="Play Lofi Loft">Play</button>
        </div>
        <script>
          const player = document.querySelector('#play-pause-button button');
          const result = document.querySelector('a');
          const playlist = document.querySelector('#playlist');
          document.querySelector('form').addEventListener('submit', (event) => {
            event.preventDefault();
            const query = document.querySelector('input').value;
            history.pushState(null, '', '/search?' + new URLSearchParams({ q: query }));
            playlist.hidden = !query.startsWith('lo-fi');
            result.parentElement.hidden = !playlist.hidden;
          });
          playlist.querySelector('button').addEventListener('click', () => {
            document.querySelector('#title').textContent = 'First song from Lofi Loft';
            player.setAttribute('aria-label', 'Pause');
          });
          player.addEventListener('click', () => player.setAttribute('aria-label', 'Play'));
          result.addEventListener('click', (event) => {
            event.preventDefault();
            history.pushState(null, '', result.href);
            player.setAttribute('aria-label', 'Pause');
          });
        </script>`,
    });
  });
  const helper = await prepareNativeHelper(fixture.path, 'youtube-music', [
    'WPF/UIAutomationClient.dll',
    'WPF/UIAutomationTypes.dll',
    'WPF/WindowsBase.dll',
    'System.Web.dll',
  ]);
  const launched = [];
  const makeService = () =>
    new YouTubeMusicService({
      root: fixture.path,
      prepare: async () => helper,
      openExternal: (url) => launched.push(url),
    });

  service = makeService();
  const music = await context.newPage();
  for (const page of context.pages()) if (page !== music) await page.close();
  await music.goto(musicUrl);
  await waitForFocus(music, true);
  let visible;
  for (let attempt = 0; attempt < 8; attempt++) {
    visible = await service.execute(`visible-status-${attempt}`, { action: 'status' });
    if (visible.status !== 'tab_not_found') break;
    await delay(100);
  }
  assert.equal(visible.status, 'ready', JSON.stringify(visible));
  const inactive = await context.newPage();
  await inactive.goto(inactiveUrl);
  const windowSession = await context.newCDPSession(music);
  const musicWindow = await windowSession.send('Browser.getWindowForTarget');
  const inactiveWindow = await (
    await context.newCDPSession(inactive)
  ).send('Browser.getWindowForTarget');
  assert.equal(
    musicWindow.windowId,
    inactiveWindow.windowId,
    'Fixture tabs must share a browser window.',
  );
  await hideTab(music, inactive);

  const volume = music.locator('#volume-slider');
  const raised = await service.execute('volume-up-open-tab', { action: 'volume', delta: 10 });
  await verifyReceipt(music, raised, 'volume_set');
  assert.equal(raised.volume, 46);
  assert.equal(await volume.inputValue(), '46');

  const spokenVolume = youtubeMusicRequest(
    'Increased YouTube music volume by one hundred percent.',
  );
  assert.deepEqual(spokenVolume?.command, { action: 'volume', delta: 100 });
  const maximum = await service.execute('volume-max-open-tab', spokenVolume.command);
  await verifyReceipt(music, maximum, 'volume_set');
  assert.equal(maximum.volume, 100);
  assert.equal(await volume.inputValue(), '100');
  assert.equal(context.pages().length, 2);
  assert.deepEqual(launched, [], 'Volume controls must reuse the existing music tab.');
  console.log('PASS volume changed from 36% to 46% and then to 100% on the existing music tab');

  await hideTab(music, inactive);
  // A clean service must discover the background tab without a saved binding.
  service.close();
  service = makeService();
  await service.execute('hidden-status', { action: 'status' });
  assert.equal(await inactive.evaluate(() => document.hasFocus()), true);
  const opened = await service.execute('cold-open', { action: 'open' });
  assert.deepEqual(launched, [], 'The open action must not launch a duplicate tab.');
  assert.equal(opened.ok, true, JSON.stringify(opened));
  await waitForFocus(inactive, false);
  assert.equal(context.pages().length, 2);

  await hideTab(music, inactive);
  const searched = await service.execute('search-open-tab', { action: 'search', query: 'C418' });
  assert.deepEqual(launched, [], 'The search action must not launch a duplicate tab.');
  await verifyReceipt(music, searched, 'search_opened');
  assert.equal(new URL(music.url()).searchParams.get('q'), 'C418');
  assert.equal(context.pages().length, 2);

  await hideTab(music, inactive);
  const paused = await service.execute('pause-open-tab', { action: 'pause' });
  assert.equal(paused.status, 'paused', JSON.stringify(paused));
  assert.equal(await music.locator('#play-pause-button button').getAttribute('aria-label'), 'Play');
  assert.equal(context.pages().length, 2);
  assert.deepEqual(launched, [], 'Transport controls must not open any tabs.');

  await hideTab(music, inactive);
  const spoken = youtubeMusicRequest('play c four one eight drayton', {
    youtubeMusic: { enabled: true, preferred: true },
  });
  assert.deepEqual(spoken?.command, { action: 'play', query: 'C418 Dreiton' });
  const played = await service.execute('play-open-tab', spoken.command);
  await verifyReceipt(music, played, 'playing');
  assert.equal(new URL(music.url()).searchParams.get('v'), 'abcdefghijk');
  assert.equal(
    await music.locator('#play-pause-button button').getAttribute('aria-label'),
    'Pause',
  );
  assert.equal(context.pages().length, 2);
  assert.deepEqual(launched, [], 'Playing a named track must reuse the existing tab.');

  async function showPrompt(message, { toast = false, withWarning = false } = {}) {
    await music.goto(musicUrl);
    await music.bringToFront();
    await music.evaluate(
      ({ message, toast, withWarning }) => {
        const form = document.querySelector('form');
        form.inert = !toast;
        document.querySelector('#play-pause-button button').setAttribute('aria-label', 'Play');
        function addPrompt(id, text, warning) {
          const prompt = document.createElement('section');
          prompt.id = id;
          prompt.className = warning
            ? 'ytmusic-notification-action-renderer'
            : 'ytmusic-you-there-renderer';
          prompt.setAttribute('role', warning ? 'group' : 'dialog');
          prompt.setAttribute('aria-labelledby', id + '-title');
          const heading = document.createElement('h2');
          heading.id = id + '-title';
          heading.textContent = text;
          const yes = document.createElement('button');
          yes.textContent = 'Yes';
          yes.onclick = () => {
            if (!warning) form.inert = false;
            document.body.dataset.confirmations = String(
              Number(document.body.dataset.confirmations ?? 0) + 1,
            );
            prompt.remove();
          };
          prompt.append(heading, yes);
          document.body.append(prompt);
        }
        if (withWarning)
          addPrompt('fixture-warning', 'Still watching? Video will pause soon', true);
        addPrompt('fixture-prompt', message, toast);
      },
      { message, toast, withWarning },
    );
  }

  await showPrompt('Video paused. Continue watching?', { withWarning: true });
  const readOnly = await service.execute('read-paused-player', { action: 'status' });
  assert.equal(readOnly.ok, true, JSON.stringify(readOnly));
  assert.equal(await music.locator('#fixture-prompt').count(), 1);
  const recovered = await service.execute('play-after-idle-pause', {
    action: 'play',
    query: 'lo-fi',
  });
  await verifyReceipt(music, recovered, 'playing');
  assert.equal(await music.locator('body').getAttribute('data-confirmations'), '1');
  assert.equal(await music.locator('#fixture-warning').count(), 1);
  assert.equal(recovered.track, 'First song from Lofi Loft');
  assert.equal(new URL(music.url()).pathname, '/search', 'The card can start playback in place.');

  await showPrompt('Still watching? Video will pause soon', { toast: true });
  const afterWarning = await service.execute('play-after-warning', {
    action: 'play',
    query: 'lo-fi music',
  });
  await verifyReceipt(music, afterWarning, 'playing');
  assert.equal(await music.locator('body').getAttribute('data-confirmations'), '1');

  await showPrompt('Video paused. Continue watching?');
  await music.getByRole('button', { name: 'Yes', exact: true }).click();
  const searchOnly = await service.execute('find-playlist', { action: 'search', query: 'lo-fi' });
  await verifyReceipt(music, searchOnly, 'search_opened');
  assert.equal(await music.locator('#title').textContent(), 'Previous song');
  const existingResults = await service.execute('play-existing-results', {
    action: 'play',
    query: 'lo-fi',
  });
  await verifyReceipt(music, existingResults, 'playing');
  assert.equal(existingResults.track, 'First song from Lofi Loft');

  await showPrompt('Sign in to continue?');
  const blocked = await service.execute('reject-other-modal', { action: 'play', query: 'lo-fi' });
  assert.equal(blocked.ok, false);
  assert.equal(await music.locator('#fixture-prompt').count(), 1);
  assert.equal(await music.locator('body').getAttribute('data-confirmations'), null);
  assert.deepEqual(launched, [], 'Dialog recovery and featured results must reuse the music tab.');
  console.log(
    'PASS playback recovered from the idle dialog and toast, used the featured card, and left unrelated dialogs alone',
  );

  const duplicate = await context.newPage();
  await duplicate.goto(musicUrl);
  await hideTab(duplicate, inactive);
  await waitForFocus(music, false);
  service.close();
  service = makeService();
  const picked = await service.execute('pick-existing-tab', { action: 'open' });
  assert.equal(picked.ok, true, JSON.stringify(picked));
  assert.equal(await inactive.evaluate(() => document.hasFocus()), false);
  assert.equal(context.pages().length, 3);
  assert.deepEqual(launched, [], 'Multiple existing music tabs must not create another tab.');

  await duplicate.close();
  await music.bringToFront();
  await waitForFocus(music, true);
  const windowId = musicWindow.windowId;
  await windowSession.send('Browser.setWindowBounds', {
    windowId,
    bounds: { windowState: 'minimized' },
  });
  assert.equal(
    (await windowSession.send('Browser.getWindowBounds', { windowId })).bounds.windowState,
    'minimized',
  );
  service.close();
  service = makeService();
  const restored = await service.execute('restore-existing-tab', { action: 'open' });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.deepEqual(launched, [], 'A minimized music tab must be restored without opening another.');
  assert.equal(context.pages().length, 2);

  await music.close();
  const lookalike = await context.newPage();
  await lookalike.goto(unrelatedUrl);
  await hideTab(lookalike, inactive);
  service.close();
  service = makeService();
  const rejected = await service.execute('reject-lookalike', { action: 'open' });
  assert.equal(rejected.ok, false, JSON.stringify(rejected));
  assert.equal(await inactive.evaluate(() => document.hasFocus()), true);
  assert.equal(lookalike.url(), unrelatedUrl);
  assert.deepEqual(launched, [], 'A matching title cannot verify an unrelated site.');

  await lookalike.close();
  const first = await service.execute('open-when-none-exists', { action: 'open' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(launched, [musicUrl]);
  console.log(
    `PASS ${path.basename(executable)} handled existing, duplicate, minimized and absent music tabs, plus volume changes`,
  );
} finally {
  service?.close();
  await browser?.close();
  if (child.exitCode == null && child.signalCode == null) child.kill();
  await exited.catch(() => {});
}
