// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { DesktopTeleportMenu } from '../../apps/desktop/main/desktop-teleport-menu.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { saveSettings, settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime', 'desktop-verification');
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(path.join(parent, "avatar-detach Капри's-"));
const entry = path.join(fixture, 'test-main.mjs');
writeFileSync(
  entry,
  `
import { Tray } from 'electron';
const on = Tray.prototype.on;
Tray.prototype.on = function (event, handler) {
  if (event === 'right-click') {
    globalThis.testCapriTray = this;
    Tray.prototype.on = on;
  }
  return on.call(this, event, handler);
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
const companionUrl = 'capri://desktop/index.html';
const overlayUrl = 'capri://desktop/avatar-detach.html';
const require = createRequire(import.meta.url);
const prompt = 'Where do you show replies on the desktop?';
const firstReply = 'Here above my head.';
const remainingReply = ' You can still write here.';
const gatewayTurns = [];
const startReply = Promise.withResolvers();
let finishReply;
const gateway = createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  gatewayTurns.push(JSON.parse(body).messages.at(-1).content);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  await startReply.promise;
  response.write(delta(`[avatar:happy]\n${firstReply}`));
  finishReply = () => response.end(delta(remainingReply) + 'data: [DONE]\n\n');
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const port = gateway.address().port;
const rt = runtime({
  stateDir: path.join(fixture, 'openclaw'),
  workspace: path.join(fixture, 'workspace'),
  gatewayPort: port,
});
function extendedWindowStyle(hwnd) {
  // Read the real input-transparency flag without sending mouse/keyboard input.
  assert.match(hwnd, /^\d+$/);
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CapriWindowStyle {
    [DllImport("user32.dll")]
    public static extern int GetWindowLongW(IntPtr hwnd, int index);
}
'@
[CapriWindowStyle]::GetWindowLongW([IntPtr]::new([long]${hwnd}), -20)
`;
  return Number(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  );
}

function assertInside(rect, area) {
  assert.ok(rect.x >= area.x && rect.y >= area.y, 'Overlay starts inside the active work area');
  assert.ok(rect.x + rect.width <= area.x + area.width, 'Overlay stays inside the right edge');
  assert.ok(rect.y + rect.height <= area.y + area.height, 'Overlay stays inside the bottom edge');
}

async function portraitDrag(page) {
  const { start, drop } = await page.evaluate(() => {
    const region = document.getElementById('sprite-region');
    const image = document.getElementById('sprite');
    const { x, y, width, height } = region.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ink = canvas.getContext('2d');
    ink.drawImage(image, 0, 0);
    for (let v = 0.45; v <= 0.65; v += 0.025) {
      for (let u = 0.4; u <= 0.6; u += 0.025) {
        const point = { x: Math.round(x + u * width), y: Math.round(y + v * height) };
        if (!region.contains(document.elementFromPoint(point.x, point.y))) continue;
        const sample = ink.getImageData(u * canvas.width - 12, v * canvas.height - 12, 24, 24);
        if (sample.data.some((value, index) => index % 4 === 3 && value < 230)) continue;
        return {
          start: point,
          drop: { x: point.x, y: -8 },
        };
      }
    }
    throw new Error('Could not find an opaque spot to drag Capri');
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 5 });
  await page.waitForFunction(
    () => document.getElementById('sprite-region').dataset.dragging === 'true',
  );
  await page.mouse.up();
}

let app;
try {
  initialize(rt);
  const env = {
    ...environment(rt),
    CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  assert.equal(page.url(), companionUrl);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }, url) => {
    BrowserWindow.getAllWindows()
      .find((item) => item.webContents.getURL() === url)
      .showInactive();
  }, companionUrl);
  await page.waitForFunction(() => Boolean(document.querySelector('#sprite').dataset.avatar));
  const sliders = [
    ['#teleport-intensity', 'teleportIntensity', 35],
    ['#teleport-jaggedness', 'teleportJaggedness', 93],
    ['#teleport-branches', 'teleportBranches', 0],
  ];
  const appearance = await settingsView(app, 'appearance');
  for (const [id, , value] of sliders) await appearance.locator(id).fill(String(value));
  await appearance.locator('#teleport-reduced-flash').check();
  await saveSettings(appearance);
  await page.waitForFunction(async (sliders) => {
    const { companion } = await window.capri.bootstrap();
    return (
      companion.teleportReducedFlash && sliders.every(([, key, value]) => companion[key] === value)
    );
  }, sliders);
  await appearance.locator('#settings-window-close').evaluate((button) => button.click());
  const reopened = await settingsView(app, 'appearance');
  for (const [id, , value] of sliders)
    assert.equal(await reopened.locator(id).inputValue(), String(value));
  assert.ok(await reopened.locator('#teleport-reduced-flash').isChecked());
  await reopened.locator('#settings-window-close').evaluate((button) => button.click());

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const portrait = document.querySelector('#presence-toggle');
    if (portrait.getAttribute('aria-pressed') !== 'true') portrait.click();
    window.__detachPhases = [];
    window.capri.onEvent((event) => {
      if (event.type !== 'avatar.detach') return;
      window.__detachPhases.push(event.phase);
      if (event.phase === 'returning') {
        window.__returnDock = {
          layout: document.body.dataset.avatarDock,
          frame: getComputedStyle(document.getElementById('portrait-panel')).visibility,
          avatar: getComputedStyle(document.getElementById('avatar-viewport')).visibility,
        };
      }
    });
  });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');

  const action = page.locator('#avatar-detach');
  const mode = (phase) =>
    page.waitForFunction((expected) => window.__detachPhases.at(-1) === expected, phase);
  const waitVisibility = (selector, expected) =>
    page.waitForFunction(
      ({ selector, expected }) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        for (let item = element; item; item = item.parentElement) {
          const style = getComputedStyle(item);
          if (
            style.display === 'none' ||
            style.visibility !== 'visible' ||
            Number(style.opacity) === 0
          )
            return !expected;
        }
        return expected;
      },
      { selector, expected },
    );
  const overlayInfo = () =>
    app.evaluate(
      ({ BrowserWindow, screen }, urls) => {
        const owner = BrowserWindow.getAllWindows().find(
          (item) => item.webContents.getURL() === urls.owner,
        );
        const overlay = BrowserWindow.getAllWindows().find(
          (item) => item.webContents.getURL() === urls.overlay,
        );
        if (!overlay) return null;
        const native = overlay.getNativeWindowHandle();
        const { contextIsolation, nodeIntegration, sandbox, preload } =
          overlay.webContents.getLastWebPreferences();
        return {
          workArea: screen.getDisplayMatching(owner.getBounds()).workArea,
          displayBounds: screen.getDisplayMatching(owner.getBounds()).bounds,
          bounds: overlay.getBounds(),
          ownerVisible: owner.isVisible(),
          overlayVisible: overlay.isVisible(),
          focusable: overlay.isFocusable(),
          focused: overlay.isFocused(),
          parent: Boolean(overlay.getParentWindow()),
          contextIsolation,
          nodeIntegration,
          sandbox,
          preload: Boolean(preload),
          hwnd: String(native.length === 8 ? native.readBigUInt64LE() : native.readUInt32LE()),
        };
      },
      { owner: companionUrl, overlay: overlayUrl },
    );
  const clickAction = async () => {
    await action.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#avatar-detach').disabled);
    await action.click({ force: true });
  };
  const send = async (text) => {
    await page.locator('#message').fill(text);
    await page.waitForFunction(() => !document.querySelector('#send').disabled);
    await page.locator('#message').press('Enter');
  };

  await waitVisibility('#portrait-panel', true);
  assert.equal(await overlayInfo(), null);
  await clickAction();
  await mode('detached');
  const parked = await overlayInfo();
  assert.ok(parked?.ownerVisible && parked.overlayVisible);
  assert.equal(parked.focusable, false);
  assert.equal(parked.focused, false);
  assert.equal(parked.parent, false);
  assert.equal(parked.contextIsolation, true);
  assert.equal(parked.nodeIntegration, false);
  assert.equal(parked.sandbox, true);
  assert.equal(parked.preload, false);
  assertInside(parked.bounds, parked.workArea);
  if (process.platform === 'win32')
    assert.equal(extendedWindowStyle(parked.hwnd) & 0x20, 0x20, 'WS_EX_TRANSPARENT');
  const overlay = app.windows().find((item) => item.url() === overlayUrl);
  assert.ok(overlay);
  await overlay.waitForFunction(() => {
    const avatar = document.querySelector('#parked-avatar img');
    const effect = document.getElementById('teleport-effect');
    return avatar?.naturalWidth > 0 && effect.hidden && effect.width === 1 && effect.height === 1;
  });
  const parkedFrame = await overlay.locator('#parked-avatar img').getAttribute('src');
  await overlay.waitForFunction(
    (previous) => {
      const avatar = document.querySelector('#parked-avatar img');
      return avatar.complete && avatar.naturalWidth > 0 && avatar.src !== previous;
    },
    parkedFrame,
    { timeout: 12_000 },
  );
  await waitVisibility('#portrait-panel', false);
  await waitVisibility('#avatar-viewport', false);
  await waitVisibility('#subtitle-stage', false);
  await waitVisibility('#message', true);
  const waitForSignal = async (state) => {
    await page.waitForFunction((expected) => document.body.dataset.signal === expected, state);
    const signal = await page
      .locator('[data-signal-label]')
      .first()
      .evaluate((label) => ({
        text: label.textContent,
        color: document.body.style.getPropertyValue('--signal'),
      }));
    await overlay.waitForFunction(
      ({ text, color }) => {
        const badge = document.getElementById('avatar-status');
        return (
          !badge.hidden &&
          badge.textContent === text &&
          badge.style.getPropertyValue('--avatar-signal') === color
        );
      },
      signal,
      { timeout: 8_000 },
    );
  };
  await send(prompt);
  await waitForSignal('thinking');
  assert.equal(await overlay.locator('#avatar-reply').isHidden(), true);
  startReply.resolve();
  try {
    await overlay.waitForFunction(
      (expected) =>
        !document.getElementById('avatar-reply').hidden &&
        document.getElementById('avatar-reply-text').textContent.startsWith(expected),
      firstReply.slice(0, -1),
      { timeout: 8_000 },
    );
  } catch (error) {
    const subtitle = await page.evaluate(() => {
      const text = document.getElementById('subtitle-text');
      return { text: text.textContent, width: text.clientWidth };
    });
    const bubble = await overlay.locator('#avatar-reply-text').textContent();
    throw new Error(
      `The streamed reply did not reach the bubble. ${JSON.stringify({ subtitle, bubble, errors })}`,
      {
        cause: error,
      },
    );
  }
  await waitForSignal('replying');
  assert.equal(await page.locator('body').getAttribute('data-replying'), 'true');
  assert.equal(gatewayTurns.length, 1);
  assert.ok(gatewayTurns[0].startsWith(prompt));
  assert.ok(
    await overlay.evaluate(() => {
      const bubble = document.getElementById('avatar-reply');
      const badge = document.getElementById('avatar-status');
      const tail = document.getElementById('avatar-reply-surface');
      const panel = bubble.getBoundingClientRect();
      const label = badge.getBoundingClientRect();
      const sprite = document.querySelector('#parked-avatar img').getBoundingClientRect();
      const matrix = tail.getScreenCTM();
      const base = new DOMPoint(
        Number(tail.dataset.baseX),
        Number(tail.dataset.baseY),
      ).matrixTransform(matrix);
      const tip = new DOMPoint(
        Number(tail.dataset.tipX),
        Number(tail.dataset.tipY),
      ).matrixTransform(matrix);
      const faceX = sprite.left + (642 / 1254) * sprite.width - base.x;
      const faceY = sprite.top + (394 / 1254) * sprite.height - base.y;
      const arrowX = tip.x - base.x;
      const arrowY = tip.y - base.y;
      return (
        !bubble.hidden &&
        panel.left >= 0 &&
        panel.top >= 0 &&
        panel.right <= innerWidth &&
        panel.bottom <= innerHeight &&
        label.left >= 0 &&
        label.top >= 0 &&
        label.right <= innerWidth &&
        label.bottom <= innerHeight &&
        (label.bottom <= panel.top ||
          label.top >= panel.bottom ||
          label.right <= panel.left ||
          label.left >= panel.right) &&
        Math.abs(faceX * arrowY - faceY * arrowX) < 1 &&
        faceX * arrowX + faceY * arrowY > 0 &&
        getComputedStyle(badge).pointerEvents === 'none' &&
        getComputedStyle(bubble).pointerEvents === 'none'
      );
    }),
    'The detached badge and reply should fit without overlapping and let clicks through',
  );
  finishReply();
  await overlay.waitForFunction(
    (expected) => document.getElementById('avatar-reply-text').textContent === expected,
    firstReply + remainingReply,
  );
  await page.waitForFunction(() => document.body.dataset.replying === 'false');
  const replyPalette = () =>
    overlay.locator('#avatar-reply').evaluate((bubble) => {
      const style = getComputedStyle(bubble);
      return [style.backgroundColor, style.borderTopColor];
    });
  const defaultReplyColors = await replyPalette();
  const originalPreferences = await page.evaluate(
    async () => (await window.capri.bootstrap()).companion,
  );
  await page.evaluate(
    (preferences) =>
      window.capri.setCompanionSettings({
        ...preferences,
        interfaceTheme: { ...preferences.interfaceTheme, preset: 'blackwall' },
      }),
    originalPreferences,
  );
  await overlay.waitForFunction(
    () => document.documentElement.dataset.interfaceTheme === 'blackwall',
  );
  const customReplyColors = await replyPalette();
  assert.notEqual(customReplyColors[0], defaultReplyColors[0]);
  assert.notEqual(customReplyColors[1], defaultReplyColors[1]);
  await page.evaluate(
    (preferences) => window.capri.setCompanionSettings(preferences),
    originalPreferences,
  );
  await waitVisibility('#subtitle-stage', false);
  assert.deepEqual(await overlay.evaluate(() => [typeof window.capri, typeof require]), [
    'undefined',
    'undefined',
  ]);
  const detachedToolbar = await page.locator('#handle').boundingBox();
  assert.ok(detachedToolbar.y > 70, 'The detached toolbar should follow the bottom dock');
  await page.waitForFunction(
    () => {
      const shade = document.getElementById('window-shade').getBoundingClientRect();
      const toolbar = document.getElementById('handle').getBoundingClientRect();
      const dock = document.getElementById('input-dock').getBoundingClientRect();
      return shade.top > 0 && shade.top <= toolbar.top && shade.bottom >= dock.bottom - 1;
    },
    null,
    { timeout: 5000 },
  );

  await page.evaluate(() => {
    const captureReturn = (event) => {
      if (event.target !== document.body || event.animationName !== 'avatar-frame-return') return;
      document.body.removeEventListener('animationstart', captureReturn);
      const opening = document.body
        .getAnimations()
        .find((animation) => animation.animationName === 'avatar-frame-return');
      if (!opening) return;
      opening.pause();
      const sample = (time) => {
        opening.currentTime = time;
        const frame = getComputedStyle(document.getElementById('portrait-panel'));
        const avatar = getComputedStyle(document.getElementById('avatar-viewport'));
        return {
          frameProgress: Number(frame.getPropertyValue('--avatar-return-progress')),
          avatarProgress: Number(avatar.getPropertyValue('--avatar-return-progress')),
          frameOpacity: Number(frame.opacity),
          avatarOpacity: Number(avatar.opacity),
          frameClip: frame.clipPath,
          avatarMask: avatar.maskImage,
        };
      };
      window.__returnReveal = [sample(0), sample(85)];
      opening.finish();
    };
    document.body.addEventListener('animationstart', captureReturn);
  });
  await send('Return to your frame');
  await mode('attached');
  assert.equal(await overlayInfo(), null);
  await page.waitForFunction(() =>
    /back in my frame|снова в рамке/u.test(document.querySelector('#subtitle-text').textContent),
  );
  assert.equal(gatewayTurns.length, 1, 'The return command should be handled locally');
  await page.waitForFunction(() => Boolean(window.__returnReveal));
  const { dock, reveal } = await page.evaluate(() => ({
    dock: window.__returnDock,
    reveal: window.__returnReveal,
  }));
  assert.deepEqual(dock, { layout: 'compact', frame: 'hidden', avatar: 'hidden' });
  const [start, midpoint] = reveal;
  for (const sample of reveal) {
    assert.equal(sample.frameProgress, sample.avatarProgress);
    assert.equal(sample.frameOpacity, sample.avatarOpacity);
    assert.notEqual(sample.frameClip, 'none');
    assert.notEqual(sample.avatarMask, 'none');
  }
  assert.equal(start.frameProgress, 0);
  assert.equal(start.frameOpacity, 0);
  assert.equal(start.avatarOpacity, 0);
  assert.ok(midpoint.frameProgress > 0 && midpoint.frameProgress < 1);
  assert.ok(midpoint.frameOpacity > 0 && midpoint.frameOpacity < 1);
  assert.ok(midpoint.avatarOpacity > 0 && midpoint.avatarOpacity < 1);
  await waitVisibility('#portrait-panel', true);
  await waitVisibility('#avatar-viewport', true);
  assert.deepEqual(await page.evaluate(() => window.__detachPhases), [
    'leaving',
    'detached',
    'returning',
    'attached',
  ]);

  // Exercise the real tray menu handlers without opening a native menu.
  const chooseMenu = async (label) => {
    await app.evaluate(async (_electron, text) => {
      const tray = globalThis.testCapriTray;
      const popup = tray.popUpContextMenu;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Tray menu timed out.')), 5000);
          tray.popUpContextMenu = function (menu) {
            clearTimeout(timer);
            const item = menu.items.find((entry) => entry.label === text);
            if (!item?.enabled) {
              reject(new Error('Teleport menu action unavailable: ' + text));
              return;
            }
            item.click(undefined, undefined, undefined);
            resolve();
          };
          tray.emit('right-click');
        });
      } finally {
        tray.popUpContextMenu = popup;
      }
    }, label);
  };
  const catalog = requireCapriAvatar(root);
  const setScreenCursor = async (point) => {
    assert.deepEqual(
      await app.evaluate(({ screen }, point) => {
        screen.getCursorScreenPoint = () => point;
        return screen.getCursorScreenPoint();
      }, point),
      point,
    );
    return point;
  };
  const setCursor = async (x, y) => {
    const { bounds: parkedBounds } = parked;
    const point = {
      x: parkedBounds.x + Math.round(parkedBounds.width * x),
      y: parkedBounds.y + Math.round(parkedBounds.height * y),
    };
    return setScreenCursor(point);
  };
  const assertAtCursor = async (point) => {
    const menuOverlay = app.windows().find((item) => item.url() === overlayUrl);
    assert.ok(menuOverlay);
    const menuAvatar = menuOverlay.locator('#parked-avatar img');
    await menuAvatar.waitFor({ state: 'visible' });
    await menuOverlay.waitForFunction(
      (urls) => {
        const image = document.querySelector('#parked-avatar img');
        return image.complete && image.naturalWidth > 0 && urls.includes(image.src);
      },
      catalog.frames.map(({ url }) => url),
      { timeout: 10000 },
    );
    const spriteUrl = await menuAvatar.getAttribute('src');
    const frame = catalog.frames.find(({ url }) => url === spriteUrl);
    assert.ok(frame?.anchor);
    const bounds = await menuAvatar.boundingBox();
    assert.ok(bounds);
    const { bounds: overlayBounds } = await overlayInfo();
    const x = overlayBounds.x + bounds.x + (bounds.width * frame.anchor.x) / catalog.canvas.width;
    const y = overlayBounds.y + bounds.y + (bounds.height * frame.anchor.y) / catalog.canvas.height;
    assert.ok(
      Math.abs(x - point.x) <= 1 && Math.abs(y - point.y) <= 1,
      `The sprite anchor (${x}, ${y}) should reach the cursor (${point.x}, ${point.y})`,
    );
  };
  const hopCount = () =>
    page.evaluate(() => window.__detachPhases.filter((phase) => phase === 'teleporting').length);
  const waitForHop = (previousCount) =>
    page.waitForFunction(
      (count) =>
        window.__detachPhases.filter((phase) => phase === 'teleporting').length > count &&
        window.__detachPhases.at(-1) === 'detached',
      previousCount,
    );
  if (process.platform === 'win32') {
    const registration = Promise.withResolvers();
    const invocations = [];
    const desktopMenu = new DesktopTeleportMenu(root, (point) => invocations.push(point), {
      run(args) {
        if (args[0] === 'add' && args[1].endsWith('\\command')) registration.resolve(args.at(-2));
        return { status: 0 };
      },
    });
    let timeout;
    try {
      void desktopMenu.show('Teleport Capri');
      const command = await Promise.race([
        registration.promise,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Desktop teleport listener did not start.')),
            20000,
          );
        }),
      ]);
      const [, executable, token] = /^"(.+)" --teleport ([0-9a-f]{32})$/.exec(command) ?? [];
      assert.ok(executable);
      await promisify(execFile)(executable, ['--teleport', token], {
        windowsHide: true,
        timeout: 3000,
      });
      assert.deepEqual(invocations, []);
    } finally {
      clearTimeout(timeout);
      desktopMenu.hide();
    }
  }

  // Menu teleports have no drag offset; they must still use the screen's floor dock.
  const floorFrame = catalog.desktopPoseFrames.find(({ id }) => id === 'pose-sit-floor');
  assert.equal(floorFrame?.anchor.name, 'ground');
  const floor = parked.workArea.y + parked.workArea.height;
  const floorPoint = (fraction, y = floor - 2) => ({
    x: parked.workArea.x + Math.round(parked.workArea.width * fraction),
    y,
  });
  const assertFloorSeat = async (point) => {
    const view = app.windows().find((item) => item.url() === overlayUrl);
    assert.ok(view);
    await view.waitForFunction(
      ({ url, anchor, visible, canvas, workArea, point }) => {
        const parked = document.getElementById('parked-avatar');
        const image = parked.querySelector('img');
        if (
          parked.hidden ||
          parked.dataset.dock !== 'ground' ||
          parked.dataset.poseFrame !== 'pose-sit-floor' ||
          !image.complete ||
          image.naturalWidth === 0 ||
          image.src !== url
        )
          return false;
        const rect = image.getBoundingClientRect();
        const contactX = workArea.x + rect.x + (rect.width * anchor.x) / canvas.width;
        const visibleBottom =
          workArea.y + rect.y + (rect.height * (visible.y + visible.height)) / canvas.height;
        const bottom = workArea.y + workArea.height;
        return (
          Math.abs(contactX - point.x) <= 1 &&
          visibleBottom <= bottom + 1 &&
          visibleBottom >= bottom - 2
        );
      },
      {
        url: floorFrame.url,
        anchor: floorFrame.anchor,
        visible: floorFrame.visibleBounds,
        canvas: catalog.canvas,
        workArea: parked.workArea,
        point,
      },
      { timeout: 3000 },
    );
    return view;
  };
  const firstFloorPoint = await setScreenCursor(floorPoint(0.32));
  await chooseMenu('Teleport Capri');
  await mode('detached');
  const floorScreenshot = path.join(fixture, 'menu-teleport-floor.png');
  let floorOverlay;
  try {
    floorOverlay = await assertFloorSeat(firstFloorPoint);
  } catch (error) {
    const view = app.windows().find((item) => item.url() === overlayUrl);
    if (view) await view.screenshot({ path: floorScreenshot });
    console.log('Floor teleport screenshot: ' + floorScreenshot);
    throw error;
  }
  await floorOverlay.waitForTimeout(1100);
  await assertFloorSeat(firstFloorPoint);
  await floorOverlay.screenshot({ path: floorScreenshot });
  console.log('Floor teleport screenshot: ' + floorScreenshot);

  for (const point of [
    floorPoint(0.68),
    floorPoint(0.46, parked.displayBounds.y + parked.displayBounds.height - 1),
  ]) {
    await setScreenCursor(point);
    const previous = await hopCount();
    await chooseMenu('Teleport Capri');
    await waitForHop(previous);
    floorOverlay = await assertFloorSeat(point);
  }

  const freePoint = await setCursor(0.5, 0.46);
  const beforeFreeHop = await hopCount();
  await chooseMenu('Teleport Capri');
  await waitForHop(beforeFreeHop);
  await floorOverlay.waitForFunction(() => {
    const parked = document.getElementById('parked-avatar');
    const image = parked.querySelector('img');
    return (
      image.complete &&
      image.naturalWidth > 0 &&
      !parked.dataset.poseFrame &&
      !image.src.endsWith('/pose-sit-floor.png')
    );
  });
  await assertAtCursor(freePoint);
  await chooseMenu('Return to frame');
  await mode('attached');
  assert.equal(await overlayInfo(), null);
  await waitVisibility('#portrait-panel', true);
  await page.waitForFunction(() => !document.body.dataset.avatarArriving);

  // Exact cursor geometry requires a stable drawing: autonomous pose changes
  // can change the authored foot anchor by a few pixels after arrival.
  await page.locator('#message').fill('Keep the fixture pose steady for cursor checks');
  await page.waitForFunction(() => document.getElementById('sprite').dataset.framePose === 'idle');
  const cursorFromFrame = await setCursor(0.32, 0.66);
  await chooseMenu('Teleport Capri');
  await mode('detached');
  await waitVisibility('#portrait-panel', false);
  await waitVisibility('#avatar-viewport', false);
  await assertAtCursor(cursorFromFrame);

  const cursorWhileDetached = await setCursor(0.68, 0.71);
  const beforeCursorHop = await hopCount();
  await chooseMenu('Teleport Capri');
  await waitForHop(beforeCursorHop);
  await assertAtCursor(cursorWhileDetached);

  const trayCursor = await setCursor(0.5, 0.46);
  const beforeTrayHop = await hopCount();
  await chooseMenu('Teleport Capri');
  await waitForHop(beforeTrayHop);
  await assertAtCursor(trayCursor);
  await chooseMenu('Return to frame');
  await mode('attached');
  assert.equal(await overlayInfo(), null);
  await waitVisibility('#portrait-panel', true);

  // A point teleport also works when the companion has collapsed to the signal core.
  await page.waitForFunction(() => !document.body.dataset.avatarArriving);
  await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'core');
  await waitVisibility('#portrait-panel', false);
  const cursorFromCore = await setCursor(0.59, 0.54);
  await chooseMenu('Teleport Capri');
  await mode('detached');
  await assertAtCursor(cursorFromCore);
  await chooseMenu('Return to frame');
  await mode('attached');
  await page.waitForFunction(() => !document.body.dataset.avatarArriving);
  await waitVisibility('#portrait-panel', true);

  const beforeDrag = await page.evaluate(async () => ({
    layout: (await window.capri.bootstrap()).avatarLayout,
    phases: window.__detachPhases.length,
  }));
  await portraitDrag(page);
  await page.waitForFunction(
    () => document.getElementById('sprite-region').dataset.dragging === 'false',
  );
  const afterDrag = await page.evaluate(async () => ({
    layout: (await window.capri.bootstrap()).avatarLayout,
    phases: window.__detachPhases.length,
  }));
  assert.ok(afterDrag.layout.y < beforeDrag.layout.y, 'The portrait keeps its new position');
  assert.equal(
    afterDrag.phases,
    beforeDrag.phases,
    'Releasing just past the edge keeps Capri attached',
  );
  assert.equal(await overlayInfo(), null);

  if (process.platform === 'win32') {
    const title = `Capri Perch Fixture ${path.basename(fixture).slice(-6)}`;
    const nativeEntry = path.join(fixture, 'perch-target.mjs');
    writeFileSync(
      nativeEntry,
      `
import { app, BrowserWindow } from 'electron';
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ frame: false, hasShadow: false, focusable: false, skipTaskbar: true, show: false });
  await window.loadURL(${JSON.stringify('data:text/html,' + encodeURIComponent(`<title>${title}</title>`))});
});
`,
    );
    let targetApp = await electron.launch({
      executablePath: require('electron'),
      args: [nativeEntry, '--user-data-dir=' + path.join(fixture, 'perch-profile')],
      env,
      timeout: 20000,
    });
    try {
      await targetApp.firstWindow();
      const area = parked.workArea;
      const targetBounds = {
        x: area.x + Math.round(area.width * 0.14),
        y: area.y + Math.round(area.height * 0.4),
        width: Math.min(380, Math.round(area.width * 0.38)),
        height: Math.min(260, Math.round(area.height * 0.32)),
      };
      const targetPid = await targetApp.evaluate(() => String(process.pid));
      const positionTarget = async (bounds) => {
        await targetApp.evaluate(({ BrowserWindow }, bounds) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.setBounds(bounds);
          window.showInactive();
        }, bounds);
        const native = await callApplicationBridge(root, { action: 'avatar_window', title });
        assert.equal(native.processId, targetPid, 'Only the owned fixture should be selected');
        return app.evaluate(
          ({ screen }, native) =>
            screen.screenToDipPoint({ x: Math.round(native.x + native.width * 0.66), y: native.y }),
          native,
        );
      };
      const firstSeat = await positionTarget(targetBounds);
      await send(`Sit on the ${title} window`);
      await mode('detached');
      const perched = app.windows().find((window) => window.url() === overlayUrl);
      const bounds = (await overlayInfo()).bounds;
      const frame = catalog.desktopPoseFrames.find(({ id }) => id === 'pose-sit-edge');
      const waitForSeat = (point) =>
        perched.waitForFunction(
          ({ point, bounds, anchor, canvas }) => {
            const avatar = document.querySelector('#parked-avatar img');
            if (
              !avatar.complete ||
              !avatar.naturalWidth ||
              !avatar.src.endsWith('/pose-sit-edge.png')
            )
              return false;
            const sprite = avatar.getBoundingClientRect();
            return (
              Math.abs(bounds.x + sprite.x + (sprite.width * anchor.x) / canvas.width - point.x) <=
                1 &&
              Math.abs(
                bounds.y + sprite.y + (sprite.height * anchor.y) / canvas.height - point.y,
              ) <= 1
            );
          },
          { point, bounds, anchor: frame.anchor, canvas: catalog.canvas },
          { timeout: 10_000 },
        );
      await waitForSeat(firstSeat);
      await perched.waitForFunction(() =>
        /perched on the window|на краю окна/u.test(
          document.getElementById('avatar-reply-text').textContent,
        ),
      );
      const secondSeat = await positionTarget({
        ...targetBounds,
        x: targetBounds.x + Math.round(area.width * 0.15),
        y: targetBounds.y + Math.round(area.height * 0.12),
      });
      assert.notDeepEqual(secondSeat, firstSeat);
      await waitForSeat(secondSeat);
      await targetApp.close();
      targetApp = null;
      await perched.waitForFunction(
        () => {
          const avatar = document.querySelector('#parked-avatar img');
          return (
            avatar.complete && avatar.naturalWidth > 0 && !avatar.src.endsWith('/pose-sit-edge.png')
          );
        },
        undefined,
        { timeout: 10_000 },
      );
      assert.equal(gatewayTurns.length, 1, 'The perch command should be handled locally');
      await chooseMenu('Return to frame');
      await mode('attached');
      await page.waitForFunction(() => !document.body.dataset.avatarArriving);
    } finally {
      if (targetApp) await targetApp.close();
    }
  }

  // Native window loss must restore the original portrait even without a response from its renderer.
  await page.locator('#message').fill('Keep the fixture pose steady for window-loss checks');
  await page.waitForFunction(() => document.getElementById('sprite').dataset.framePose === 'idle');
  const trayCursorFromFrame = await setCursor(0.46, 0.62);
  await chooseMenu('Teleport Capri');
  await mode('detached');
  await assertAtCursor(trayCursorFromFrame);
  await app.evaluate(({ BrowserWindow }, url) => {
    BrowserWindow.getAllWindows()
      .find((item) => item.webContents.getURL() === url)
      .destroy();
  }, overlayUrl);
  await mode('attached');
  assert.equal(await overlayInfo(), null);
  await waitVisibility('#portrait-panel', true);

  // Exercise the app's lock hook without locking the real Windows session.
  await clickAction();
  await mode('detached');
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
  await mode('attached');
  assert.equal(await overlayInfo(), null);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'));

  // The real tray-hide path must leave no desktop sprite behind.
  await clickAction();
  await mode('detached');
  await chooseMenu('Hide to tray');
  await mode('attached');
  assert.equal(await overlayInfo(), null);
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }, url) =>
        BrowserWindow.getAllWindows()
          .find((item) => item.webContents.getURL() === url)
          .isVisible(),
      companionUrl,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS Electron teleport settings, native click-through, detached animation and streamed reply, typed return, near-edge portrait drag, desktop and tray teleport, floor seating above the taskbar, window loss, lock and hide.' +
      (process.platform === 'win32'
        ? ' Verified perching on an owned window, tracking movement and standing after it closed.'
        : ''),
  );
} finally {
  startReply.resolve();
  try {
    if (app) await app.close();
  } finally {
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
  }
}
