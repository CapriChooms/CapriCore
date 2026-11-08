// SPDX-License-Identifier: GPL-3.0-only
// Explicitly opt-in: moves the real OS cursor and sends real Windows LMB input.
// All button-down input is guarded by owned HWND/PID identity and native hit routing.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

assert.equal(process.platform, 'win32', 'This verification requires Windows.');
assert(
  process.argv.includes('--native-input'),
  'Coordinate exclusive PC input, then opt in with --native-input.',
);
const sourceRoot = path.resolve(
  process.argv.find((arg, index) => index > 1 && !arg.startsWith('--')) ?? root,
);
const parent = path.join(sourceRoot, '.runtime/perch-restore-native-drag');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const matchLivePresentation = process.argv.includes('--match-live-presentation');
const overlapHome = matchLivePresentation || process.argv.includes('--overlap-home');
const pinMini = matchLivePresentation || process.argv.includes('--pin-mini');
const grabRegion =
  process.argv
    .find((value) => value.startsWith('--grab-region='))
    ?.slice('--grab-region='.length) ?? 'any';
assert(['any', 'host-overlap'].includes(grabRegion), 'Use --grab-region=any or host-overlap.');
const targetTopmost = process.argv.includes('--target-topmost');
const restoreGeometry =
  process.argv
    .find((value) => value.startsWith('--restore-geometry='))
    ?.slice('--restore-geometry='.length) ?? 'unchanged';
assert(
  ['unchanged', 'move-resize', 'maximize'].includes(restoreGeometry),
  'Use --restore-geometry=unchanged, move-resize or maximize.',
);
const homePresentation =
  process.argv.find((value) => value.startsWith('--home-presentation='))?.split('=')[1] ??
  'expanded';
assert(
  ['expanded', 'core'].includes(homePresentation),
  'Use --home-presentation=expanded or core.',
);
const inputWindowMs = Number(
  process.argv
    .find((value) => value.startsWith('--input-window-ms='))
    ?.slice('--input-window-ms='.length) ?? 30000,
);
assert(
  Number.isInteger(inputWindowMs) && inputWindowMs > 0 && inputWindowMs <= 30000,
  'Input window must be between 1 and 30000ms.',
);
const inputDeadline = Date.now() + inputWindowMs;
let presentationSeed;
if (matchLivePresentation) {
  const presentationFrom =
    process.env.CAPRI_VERIFY_PRESENTATION_FROM ||
    process.argv
      .find((value) => value.startsWith('--presentation-from='))
      ?.slice('--presentation-from='.length);
  assert(
    presentationFrom && path.isAbsolute(presentationFrom),
    'Set CAPRI_VERIFY_PRESENTATION_FROM or --presentation-from to an explicit installation root.',
  );
  const selected = (name) => {
    const bytes = readFileSync(path.join(presentationFrom, 'data/desktop', name + '.json'));
    assert(bytes.length <= 4096, 'Presentation fixture source exceeds limits.');
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, ''));
  };
  const presence = selected('presence'),
    avatarLayout = selected('avatar-layout'),
    window = selected('window'),
    avatar = selected('avatar');
  assert.equal(typeof presence.pinned, 'boolean');
  assert(
    ['x', 'y', 'zoom'].every((key) => Number.isFinite(avatarLayout[key])) &&
      avatarLayout.x >= 0 &&
      avatarLayout.x <= 1 &&
      avatarLayout.y >= 0 &&
      avatarLayout.y <= 1 &&
      avatarLayout.zoom >= 0.6 &&
      avatarLayout.zoom <= 3,
    'Invalid presentation camera values.',
  );
  assert(
    ['x', 'y'].every((key) => Number.isInteger(window[key]) && Math.abs(window[key]) < 2 ** 30),
    'Invalid presentation window position.',
  );
  assert(
    typeof avatar.id === 'string' && /^[a-z\d_-]{1,128}$/iu.test(avatar.id),
    'Invalid presentation avatar ID.',
  );
  const rectangle = (value) =>
    value &&
    ['x', 'y', 'width', 'height'].every(
      (key) => Number.isFinite(value[key]) && Math.abs(value[key]) < 2 ** 30,
    ) &&
    value.width > 0 &&
    value.height > 0
      ? { x: value.x, y: value.y, width: value.width, height: value.height }
      : undefined;
  const footprint = rectangle(window.footprint),
    compactPlacement = rectangle(window.compactPlacement);
  presentationSeed = {
    presence: { schemaVersion: 1, pinned: presence.pinned },
    avatarLayout: {
      schemaVersion: 1,
      x: avatarLayout.x,
      y: avatarLayout.y,
      zoom: avatarLayout.zoom,
    },
    window: {
      schemaVersion: 3,
      x: window.x,
      y: window.y,
      alwaysOnTop: window.alwaysOnTop !== false,
      ...(footprint ? { footprint } : {}),
      ...(compactPlacement ? { compactPlacement } : {}),
    },
    avatar: { schemaVersion: 1, id: avatar.id },
  };
  const desktop = path.join(folder, 'desktop');
  mkdirSync(desktop, { recursive: true });
  for (const [name, value] of [
    ['presence', presentationSeed.presence],
    ['avatar-layout', presentationSeed.avatarLayout],
    ['window', presentationSeed.window],
    ['avatar', presentationSeed.avatar],
  ])
    writeFileSync(path.join(desktop, name + '.json'), JSON.stringify(value));
}
const copy = path.join(
  sourceRoot,
  'apps/desktop/.native-perch-verification-' + randomUUID() + '.mjs',
);
const entry = path.join(folder, 'entry.mjs');
const title = 'Capri owned native perch ' + randomUUID().slice(0, 8);
const report = {
  passed: false,
  sourceRoot,
  folder,
  nativeInput: true,
  inputMethod: 'Win32 SetCursorPos + SendInput; no renderer mouse injection',
  constructorVerification: false,
  homePointerVerification: false,
  overlapHome,
  pinMini,
  restoreGeometry,
  grabRegion,
  targetTopmost,
  ...(matchLivePresentation ? { presentationSeed } : {}),
  pointerRepairCalls: 0,
  registryWrites: false,
  ownerApplicationsTouched: false,
  modelStarted: false,
  checks: [],
  samples: [],
  input: [],
};

// Preserve global verification isolation. Only the detached controller receives its
// normal production constructor option; startPointer/raiseOverlay are untouched.
let main = readFileSync(path.join(sourceRoot, 'apps/desktop/main.mjs'), 'utf8');
const trackerGate = "!verification && process.platform === 'win32'";
assert(main.includes(trackerGate), 'Expected the production native tracker gate.');
main = main.replace(trackerGate, "process.platform === 'win32'");
const constructorStart = main.indexOf('avatarDetach = new AvatarDetach({');
const constructorEnd = main.indexOf('\n  });', constructorStart);
assert(
  constructorStart >= 0 && constructorEnd > constructorStart,
  'Expected AvatarDetach constructor.',
);
const constructor = main.slice(constructorStart, constructorEnd);
assert.equal((constructor.match(/\bverification,/gu) ?? []).length, 1);
main =
  main.slice(0, constructorStart) +
  constructor
    .replace(
      'avatarDetach = new AvatarDetach({',
      'avatarDetach = globalThis.nativePerchAvatar = new AvatarDetach({',
    )
    .replace(/\bverification,/u, 'verification: false,') +
  main.slice(constructorEnd);
const pointerStart = main.indexOf('pointer = new PointerController({');
const pointerEnd = main.indexOf('\n  });', pointerStart);
assert(
  pointerStart >= 0 && pointerEnd > pointerStart,
  'Expected main PointerController constructor.',
);
const pointerConstructor = main.slice(pointerStart, pointerEnd);
assert.equal((pointerConstructor.match(/\bverification,/gu) ?? []).length, 1);
main =
  main.slice(0, pointerStart) +
  pointerConstructor.replace(/\bverification,/u, 'verification: false,') +
  main.slice(pointerEnd);
main += `
globalThis.nativePerchState = () => ({
  perch: perch && { record: perch.record, seated: perch.seated, hidden: perch.hidden, seatPoint: perch.seatPoint, dock: perch.dock },
  watch: desktopTeleportMenu?.windowWatch && { id: desktopTeleportMenu.windowWatch.id, record: desktopTeleportMenu.windowWatch.record },
  homePointer: pointer && { verification: pointer.verification, ignored: pointer.ignored, running: Boolean(pointer.timer), drag: Boolean(pointer.drag), avatarPress: Boolean(pointer.avatarPress) },
  regions,
  home: window && { bounds: window.getBounds(), contentBounds: window.getContentBounds(), visible: window.isVisible(), focusable: window.isFocusable() },
  composer: avatarComposer && { mode: avatarComposer.mode, bounds: avatarComposer.bounds, exists: Boolean(avatarComposer.window), visible: avatarComposer.window?.isVisible(), presentationVisible: avatarComposer.presentationVisible, interactive: avatarComposer.mouseInteractive, draftLength: avatarComposerState?.draft?.length ?? 0 }
});
`;
writeFileSync(copy, main);
writeFileSync(
  entry,
  `
import { DesktopTeleportMenu } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'apps/desktop/main/desktop-teleport-menu.mjs')).href)};
const nativeShow = DesktopTeleportMenu.prototype.show;
DesktopTeleportMenu.prototype.show = function (...args) {
  this.run = () => ({ status: 0, stdout: '' });
  return nativeShow.apply(this, args);
};
await import(${JSON.stringify(pathToFileURL(copy).href)});
`,
);
const targetEntry = path.join(folder, 'target.cjs');
writeFileSync(
  targetEntry,
  `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(folder, 'target-profile'))});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ x:240, y:360, width:700, height:470, alwaysOnTop:${targetTopmost}, title:${JSON.stringify(title)}, webPreferences:{sandbox:true} });
  await win.loadURL('data:text/html,<title>${title}</title><h1>Disposable owned input target</h1>');
  win.show();
});
`,
);
const executable = path.join(folder, 'PerchRestoreProbe.exe');
execFileSync(
  path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  ),
  [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    '/reference:System.Web.Extensions.dll',
    '/out:' + executable,
    fileURLToPath(new URL('./native/PerchRestoreProbe.cs', import.meta.url)),
  ],
  { windowsHide: true, timeout: 15000 },
);
let modelPosts = 0;
const server = createServer((request, response) => {
  if (request.method === 'POST') modelPosts++;
  response.setHeader('content-type', 'application/json').end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let app, target, page, probe, lines, pending, ready;
let lastPoint, lastAvatar;
const poll = async (callback, label, timeout = 8000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await callback();
    if (value) return value;
    await delay(15);
  }
  throw new Error(label);
};
const command = async (value) => {
  if (!/^(?:probe|up|target-state)\b/u.test(value))
    assert(
      Date.now() < inputDeadline,
      'The coordinated input window expired; no further native actions sent.',
    );
  assert(!pending, 'Native input commands must be sequential.');
  const answer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = undefined;
      reject(new Error('Native probe command timed out.'));
    }, 6000);
    pending = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
  });
  probe.stdin.write(value + '\n');
  const result = await answer;
  report.input.push({ command: value, at: Date.now(), ...result });
  assert.equal(result.ok, true, result.error ?? 'Native input failed.');
  return result;
};
const capture = async (label) => {
  const state = await app.evaluate(({ BrowserWindow, screen }) => {
    const avatar = globalThis.nativePerchAvatar;
    const handle = (win) => String(win.getNativeWindowHandle().readBigUInt64LE());
    return {
      ...globalThis.nativePerchState(),
      avatar: {
        available: avatar.available,
        phase: avatar.phase,
        visible: avatar.overlay?.isVisible(),
        verification: avatar.verification,
        pointer: Boolean(avatar.pointerTimer),
        accepts: avatar.acceptsPointer,
        press: avatar.press,
        frame: avatar.session?.spriteUrl,
        point: avatar.session?.point,
        area: avatar.session?.area,
        desktopPoint: avatar.desktopPoint,
        overlay: avatar.overlay && {
          hwnd: handle(avatar.overlay),
          bounds: avatar.overlay.getBounds(),
        },
      },
      cursor: screen.getCursorScreenPoint(),
      counts: { ...globalThis.nativePerchCounts },
      events: globalThis.nativePerchEvents.slice(-30),
      windows: BrowserWindow.getAllWindows().map((win) => ({
        hwnd: handle(win),
        role: win.webContents.getURL().endsWith('/index.html')
          ? 'home'
          : win.webContents.getURL().endsWith('/avatar-detach.html')
            ? 'avatar'
            : win.webContents.getURL().endsWith('/avatar-composer.html')
              ? 'mini'
              : win.webContents.getURL().endsWith('/minimized-chip.html')
                ? 'chip'
                : 'other-owned',
        url: win.webContents.getURL(),
        bounds: win.getBounds(),
        visible: win.isVisible(),
        focused: win.isFocused(),
        focusable: win.isFocusable(),
      })),
    };
  });
  let native;
  if (lastPoint && lastAvatar && probe?.exitCode === null) {
    try {
      native = await command(`probe ${lastAvatar} ${lastPoint.x} ${lastPoint.y}`);
    } catch (error) {
      native = { error: error.message };
    }
  }
  const sample = { label, at: Date.now(), state, native };
  report.samples.push(sample);
  return sample;
};
const point = async (kind = 'head') => {
  const host =
    kind === 'body' && grabRegion === 'host-overlap'
      ? (await command('target-state')).target.bounds
      : undefined;
  const result = await app.evaluate(
    ({ screen }, { kind, host }) => {
      const avatar = globalThis.nativePerchAvatar,
        rect = avatar.spriteRect();
      const mask = avatar.session.mask;
      const own = globalThis.nativePerchState();
      const inside = (point, bounds, margin = 0) =>
        bounds &&
        point.x >= bounds.x - margin &&
        point.x < bounds.x + bounds.width + margin &&
        point.y >= bounds.y - margin &&
        point.y < bounds.y + bounds.height + margin;
      const candidates = [];
      for (let v = 0.12; v < 0.85; v += 0.025)
        for (let u = 0.18; u < 0.82; u += 0.025) {
          const p = {
            x: Math.round(rect.x + rect.width * u),
            y: Math.round(rect.y + rect.height * v),
          };
          if (!avatar.canGrab(p) || (kind === 'head' && avatar.spriteTarget(p) !== 'head'))
            continue;
          let minimumAlpha = 255;
          for (const dy of [-3, 0, 3])
            for (const dx of [-3, 0, 3]) {
              const x = Math.floor(((p.x + dx - rect.x) / rect.width) * mask.imageSize.width);
              const y = Math.floor(((p.y + dy - rect.y) / rect.height) * mask.imageSize.height);
              minimumAlpha = Math.min(minimumAlpha, mask.alpha[y * mask.imageSize.width + x] ?? 0);
            }
          if (minimumAlpha < 200) continue;
          const global = { x: p.x + avatar.session.area.x, y: p.y + avatar.session.area.y };
          const native = screen.dipToScreenPoint(global);
          const margin = screen.dipToScreenPoint({ x: global.x + 4, y: global.y + 4 });
          if (
            host &&
            !(
              native.x >= host.x + Math.abs(margin.x - native.x) &&
              native.x < host.x + host.width - Math.abs(margin.x - native.x) &&
              native.y >= host.y + Math.abs(margin.y - native.y) &&
              native.y < host.y + host.height - Math.abs(margin.y - native.y)
            )
          )
            continue;
          const drop = [
            [220, 200],
            [-220, 200],
            [220, -200],
            [-220, -200],
            [0, 280],
            [-280, 0],
            [280, 0],
          ]
            .map(([dx, dy]) => ({ x: global.x + dx, y: global.y + dy }))
            .find((value) => {
              if (
                !inside(value, {
                  x: avatar.session.area.x + 15,
                  y: avatar.session.area.y + 15,
                  width: avatar.session.area.width - 30,
                  height: avatar.session.area.height - 30,
                }) ||
                inside(value, own.home?.bounds, 16) ||
                inside(value, own.composer?.bounds, 16)
              )
                return false;
              const target = screen.dipToScreenPoint(value);
              return (
                !host ||
                inside(target, {
                  x: host.x + 24,
                  y: host.y + 24,
                  width: host.width - 48,
                  height: host.height - 48,
                })
              );
            });
          if (!drop) continue;
          const focus =
            kind === 'head'
              ? (avatar.session.point.focus ?? {
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height * 0.4,
                })
              : { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.65 };
          candidates.push({
            native,
            drop: screen.dipToScreenPoint(drop),
            dip: global,
            dropDip: drop,
            hostBoundsNative: host,
            hostOverlapMarginDip: host ? 4 : undefined,
            minimumAlpha,
            alphaThreshold: 200,
            alphaNeighborhoodDip: 3,
            score: Math.hypot(p.x - focus.x, p.y - focus.y),
            hwnd: String(avatar.overlay.getNativeWindowHandle().readBigUInt64LE()),
          });
        }
      if (candidates.length) return candidates.sort((a, b) => a.score - b.score)[0];
      throw new Error('No stable opaque input point on the owned avatar.');
    },
    { kind, host },
  );
  lastAvatar = result.hwnd;
  lastPoint = result.native;
  report.samples.push({ label: 'selected-' + kind + '-point', at: Date.now(), point: result });
  return result;
};
const assertRenderedPlacement = async (label) => {
  const value = await app.evaluate(async () => {
    const avatar = globalThis.nativePerchAvatar;
    const expected = avatar.spriteRect();
    const actual = await avatar.overlay.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('parked-avatar'), image = root.querySelector('img');
      const rect = (element) => {const value = element.getBoundingClientRect();return {x:value.x,y:value.y,width:value.width,height:value.height};};
      return {root:rect(root),image:rect(image),hidden:root.hidden,source:image.src,complete:image.complete,naturalWidth:image.naturalWidth};
    })()`);
    return { expected, actual, source: avatar.session.spriteUrl, point: avatar.session.point };
  });
  report.samples.push({ label: label + ':renderer-placement', at: Date.now(), placement: value });
  assert(
    !value.actual.hidden && value.actual.complete && value.actual.naturalWidth > 0,
    'Rendered avatar artwork must be loaded and visible.',
  );
  assert.equal(
    value.actual.source,
    value.source,
    'Renderer and native controller use different source frames.',
  );
  for (const field of ['x', 'y', 'width', 'height']) {
    assert(
      Math.abs(value.expected[field] - value.actual.root[field]) < 1.5,
      'Rendered parked geometry disagrees with native source geometry: ' + field,
    );
    assert(
      Math.abs(value.expected[field] - value.actual.image[field]) < 1.5,
      'Rendered image geometry disagrees with native source geometry: ' + field,
    );
  }
};
const seat = async (label) => {
  await page.evaluate((value) => window.capri.send(value), {
    id: randomUUID(),
    text: 'Sit on the ' + title + ' window',
    thinking: false,
    internet: false,
  });
  await poll(
    () =>
      app.evaluate(() => {
        const avatar = globalThis.nativePerchAvatar,
          value = globalThis.nativePerchState();
        return (
          avatar.available &&
          avatar.overlay?.isVisible() &&
          value.perch?.seated &&
          value.watch &&
          /pose-sit-edge\.png$/u.test(avatar.session?.spriteUrl ?? '')
        );
      }),
    'The owned external perch did not settle.',
  );
  // Initial settling is distinct from the post-restore timing under test.
  await delay(300);
  return capture(label);
};
const configureCollision = async () => {
  if (!overlapHome && !pinMini) return;
  if (pinMini) {
    if ((await page.evaluate(() => document.body.dataset.presence)) === 'core') {
      await page.locator('#presence-core').press('Enter', { timeout: 3000 });
      await page.waitForFunction(() => document.body.dataset.presence === 'portrait', undefined, {
        timeout: 3000,
      });
    }
    // This is an unsent fixture-only draft through the normal owner UI input path.
    await page
      .locator('#message')
      .fill('Owned collision verification draft; do not send.', { timeout: 3000 });
    await poll(
      () =>
        app.evaluate(() => {
          const state = globalThis.nativePerchState();
          return (
            state.composer?.visible &&
            state.composer.presentationVisible &&
            state.composer.draftLength > 0
          );
        }),
      'The unsent draft did not pin the real mini-input window.',
      3000,
    );
  }
  const current = await page.evaluate(() => document.body.dataset.presence);
  const wanted = homePresentation === 'expanded' ? 'portrait' : 'core';
  if (current !== wanted) {
    await page
      .locator(current === 'core' ? '#presence-core' : '#presence-toggle')
      .press('Enter', { timeout: 3000 });
    await page.waitForFunction((wanted) => document.body.dataset.presence === wanted, wanted, {
      timeout: 3000,
    });
  }
  if (overlapHome) {
    const placement = await app.evaluate(({ screen }) => {
      const home = globalThis.nativePerchState().home.bounds;
      const area = screen.getDisplayMatching(home).workArea;
      const width = Math.min(650, area.width - 40),
        height = Math.min(330, area.height - 40);
      const x = Math.round(
        Math.max(
          area.x + 20,
          Math.min(area.x + area.width - width - 20, home.x + home.width * 0.4 - width * 0.66),
        ),
      );
      const y = Math.round(
        Math.max(
          area.y + 150,
          Math.min(area.y + area.height - height, home.y + home.height * 0.65 + 75),
        ),
      );
      return { home, target: { x, y, width, height } };
    });
    await target.evaluate(
      ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
      placement.target,
    );
    await delay(350);
    const grab = await point('body');
    const home = (await app.evaluate(() => globalThis.nativePerchState())).home.bounds;
    const inside =
      grab.dip.x >= home.x &&
      grab.dip.x < home.x + home.width &&
      grab.dip.y >= home.y &&
      grab.dip.y < home.y + home.height;
    assert(
      inside,
      'The collision fixture must place the actual opaque drag point within the home HWND.',
    );
    report.collision = {
      ...placement,
      actualHome: home,
      opaquePoint: grab,
      homePresentation,
      nativeHomeOverlap: inside,
    };
  }
  await capture('collision-configured');
};
const restore = async (label, wait) => {
  await command('minimize');
  await poll(
    () => app.evaluate(() => !globalThis.nativePerchAvatar.overlay.isVisible()),
    'Avatar did not hide with the real minimized target.',
  );
  await capture(label + ':hidden');
  if (restoreGeometry !== 'unchanged')
    await command(
      restoreGeometry === 'move-resize' ? 'move-resize-minimized' : 'maximize-on-restore',
    );
  const at = Date.now();
  await command('restore');
  await poll(
    () => app.evaluate(() => globalThis.nativePerchAvatar.overlay.isVisible()),
    'Avatar did not return after native target restore.',
  );
  if (wait) await delay(wait);
  return { restoredAt: at, requestedDelayMs: wait, restoreGeometry };
};
const headpat = async (label, grab, timing = {}) => {
  const before = await app.evaluate(() => globalThis.nativePerchCounts.headpats);
  const at = Date.now();
  await command(`click ${grab.hwnd} ${grab.native.x} ${grab.native.y}`);
  await poll(
    () => app.evaluate((_, count) => globalThis.nativePerchCounts.headpats === count + 1, before),
    'Native headpat was not delivered.',
  );
  const sample = await capture(label);
  report.checks.push({
    label,
    gesture: 'OS head click',
    downAttemptAt: at,
    ...timing,
    counts: sample.state.counts,
  });
};
const drag = async (label, timing = {}) => {
  await assertRenderedPlacement(label);
  const grab = await point('body');
  await command(`move ${grab.hwnd} ${grab.native.x} ${grab.native.y}`);
  const before = await capture(label + ':before-down');
  const count = before.state.counts.drops;
  const at = Date.now();
  try {
    await command(`down ${grab.hwnd} ${grab.native.x} ${grab.native.y}`);
    await poll(
      () => app.evaluate(() => Boolean(globalThis.nativePerchAvatar.press)),
      'Native LMB down did not reach the avatar.',
    );
    await command(`drag ${grab.hwnd} ${grab.drop.x} ${grab.drop.y}`);
    const held = await capture(label + ':held-over-heartbeat');
    assert(held.state.avatar.press, 'The stacking heartbeat cancelled the real held drag.');
    assert(held.native?.diagnostics?.leftDown, 'Windows must still report held LMB.');
  } finally {
    await command(`up ${grab.hwnd}`);
  }
  await poll(
    () => app.evaluate((_, count) => globalThis.nativePerchCounts.drops === count + 1, count),
    'Native LMB release did not produce exactly one drop callback.',
    1500,
  );
  await poll(
    () =>
      app.evaluate(
        (_, value) => {
          const avatar = globalThis.nativePerchAvatar;
          return (
            globalThis.nativePerchCounts.drops === value.count + 1 &&
            avatar.available &&
            Math.hypot(
              avatar.desktopPoint.x - value.point.x,
              avatar.desktopPoint.y - value.point.y,
            ) > 30
          );
        },
        { count, point: before.state.avatar.desktopPoint },
      ),
    'Native LMB drag did not commit exactly one moved placement.',
  );
  const after = await capture(label + ':after-release');
  assert.equal(after.state.avatar.press, null, 'Release left a stale mouse gesture.');
  report.checks.push({
    label,
    gesture: 'OS held LMB drag beyond dead zone',
    heldMoveMs: 16 * 70,
    downAttemptAt: at,
    ...timing,
    counts: after.state.counts,
  });
};

try {
  const env = {
    ...process.env,
    TEMP: folder,
    TMP: folder,
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_ASR: '0',
    CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
    CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const sourceRequire = createRequire(path.join(sourceRoot, 'package.json'));
  const executablePath = sourceRequire('electron');
  report.sourceElectronPackage = sourceRequire('electron/package.json').version;
  target = await _electron.launch({ executablePath, args: [targetEntry], env, timeout: 30000 });
  report.targetRuntime = await target.evaluate(() => ({
    processId: process.pid,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    executable: process.execPath,
  }));
  const targetHandle = await target.evaluate(({ BrowserWindow }) =>
    String(BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE()),
  );
  const targetPid = await target.evaluate(() => process.pid);
  app = await _electron.launch({
    executablePath,
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  report.avatarRuntime = await app.evaluate(() => ({
    processId: process.pid,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    executable: process.execPath,
  }));
  assert.notEqual(
    report.targetRuntime.processId,
    report.avatarRuntime.processId,
    'The target must be a real separate process.',
  );
  page = await app.firstWindow();
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await app.evaluate(({ BrowserWindow, app }, productionFocusable) => {
    const owner = BrowserWindow.getAllWindows().find(
      (win) => win.webContents.getURL() === 'capri://desktop/index.html',
    );
    if (productionFocusable) owner.setFocusable(true);
    owner.showInactive();
    owner.webContents.send('capri:event', { type: 'startup-intro.skip' });
    globalThis.nativePerchCounts = { headpats: 0, drops: 0 };
    globalThis.nativePerchEvents = [];
    const avatar = globalThis.nativePerchAvatar;
    const headpat = avatar.onHeadpat,
      drop = avatar.onDragDrop;
    avatar.onHeadpat = (...args) => {
      globalThis.nativePerchCounts.headpats++;
      return headpat(...args);
    };
    avatar.onDragDrop = (...args) => {
      globalThis.nativePerchCounts.drops++;
      return drop(...args);
    };
    const observe = (win) =>
      win.webContents.on('before-mouse-event', (_event, input) => {
        if (win !== avatar.overlay || input.type === 'mouseMove') return;
        globalThis.nativePerchEvents.push({
          at: Date.now(),
          type: input.type,
          button: input.button,
          x: input.x,
          y: input.y,
          canGrab: avatar.canGrab(input),
          kind: avatar.spriteTarget(input),
          accepts: avatar.acceptsPointer,
          press: Boolean(avatar.press),
          frame: avatar.session?.spriteUrl,
          point: avatar.session?.point,
        });
        globalThis.nativePerchEvents = globalThis.nativePerchEvents.slice(-60);
      });
    BrowserWindow.getAllWindows().forEach(observe);
    app.on('browser-window-created', (_event, win) => observe(win));
  }, overlapHome);
  probe = spawn(
    executable,
    [String(targetPid), targetHandle, String(await app.evaluate(() => process.pid))],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  probe.stderr.on('data', (bytes) => {
    report.nativeProbeStderr = ((report.nativeProbeStderr ?? '') + bytes.toString('utf8')).slice(
      -6000,
    );
  });
  const readyPromise = new Promise((resolve, reject) => {
    ready = { resolve, reject };
  });
  lines = createInterface({ input: probe.stdout });
  lines.on('line', (line) => {
    if (line === 'ready') {
      ready.resolve();
      return;
    }
    const current = pending;
    pending = undefined;
    if (current) {
      try {
        current.resolve(JSON.parse(line));
      } catch (error) {
        current.reject(error);
      }
    }
  });
  probe.once('error', (error) => {
    ready.reject(error);
    pending?.reject(error);
  });
  probe.once('exit', (code) => {
    if (code) {
      const error = new Error('Native probe exited: ' + code);
      ready.reject(error);
      pending?.reject(error);
    }
  });
  await readyPromise;
  const initial = await seat('baseline:seated');
  await configureCollision();
  assert.equal(initial.state.avatar.verification, false);
  assert(
    initial.state.avatar.pointer,
    'The production constructor path must initialize pointer tracking.',
  );
  let grab = await point('head');
  await headpat('baseline:headpat', grab);
  if (process.argv.includes('--quick-drag')) {
    if (grabRegion === 'host-overlap') {
      await drag('baseline-host-overlap:before-minimize');
      await seat('restore-host-overlap:new-owned-seat');
      await configureCollision();
    }
    grab = await point('body');
    await command(`move ${grab.hwnd} ${grab.native.x} ${grab.native.y}`);
    const timing = await restore('quick-native-drag', 0);
    await drag('quick-native-drag', timing);
  } else {
    const identity = initial.state.watch;
    for (let cycle = 0; cycle < 4; cycle++) {
      grab = await point('head');
      await command(`move ${grab.hwnd} ${grab.native.x} ${grab.native.y}`);
      const timing = await restore('continuous-cycle-' + cycle, cycle % 2 ? 850 : 0);
      const restoredGrab = restoreGeometry === 'unchanged' ? grab : await point('head');
      await headpat('continuous-cycle-' + cycle, restoredGrab, timing);
      const sample = report.samples.at(-1);
      assert.deepEqual(
        sample.state.watch,
        identity,
        'Repeated restoration must retain the same tracked perch.',
      );
      assert.equal(
        sample.state.avatar.overlay.hwnd,
        grab.hwnd,
        'Restore unexpectedly replaced the native avatar window.',
      );
    }
    await drag('continuous-cycles:long-drag');
    // A successful drag legitimately ends the perch. These are separate freshly
    // seated test cases, never described as continuation of the earlier session.
    for (const wait of [0, 850]) {
      await seat('independent-drag-case-' + wait + ':seated');
      grab = await point('body');
      await command(`move ${grab.hwnd} ${grab.native.x} ${grab.native.y}`);
      const timing = await restore('independent-drag-case-' + wait, wait);
      await drag('independent-drag-case-' + wait, timing);
    }
  }
  assert.equal(modelPosts, 0, 'Perching verification must never start model work.');
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  if (app)
    await capture('failure').catch((failure) => {
      report.captureError = failure.message;
    });
  throw error;
} finally {
  report.modelPosts = modelPosts;
  if (probe && probe.exitCode === null) {
    probe.stdin.end('exit\n');
    await Promise.race([new Promise((resolve) => probe.once('exit', resolve)), delay(2000)]);
    if (probe.exitCode === null) probe.kill();
  }
  lines?.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
  await target?.close();
  server.close();
  unlinkSync(copy);
  console.log(
    JSON.stringify({ folder, passed: report.passed, checks: report.checks, error: report.error }),
  );
}
