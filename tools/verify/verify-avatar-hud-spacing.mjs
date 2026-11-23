// SPDX-License-Identifier: GPL-3.0-only
// Real app and native mini panel, isolated state; no models, audio or physical input.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
const sourceRoot = path.resolve(process.argv[2] ?? root);
const parent = path.join(sourceRoot, '.runtime/avatar-hud-spacing');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
const url = (file) => JSON.stringify(pathToFileURL(path.join(sourceRoot, file)).href);
writeFileSync(
  entry,
  `
import {AvatarDetach} from ${url('apps/desktop/main/avatar-detach.mjs')};
import {AvatarComposer} from ${url('apps/desktop/main/avatar-composer.mjs')};
import {requireCapriAvatar} from ${url('apps/desktop/avatar-catalog.mjs')};
globalThis.fixtureCatalog=requireCapriAvatar(${JSON.stringify(sourceRoot)});
const start=AvatarDetach.prototype.startPointer;
AvatarDetach.prototype.startPointer=function(){globalThis.fixtureAvatar=this;return start.call(this);};
const sync=AvatarComposer.prototype.sync;
AvatarComposer.prototype.sync=function(value){globalThis.fixtureComposer=this;return sync.call(this,{...value,keepVisible:true});};
const update=AvatarDetach.prototype.updateFrame;
AvatarDetach.prototype.updateFrame=function(frame,...args){if(globalThis.fixturePose&&frame.id!==globalThis.fixturePose)return Promise.resolve(false);return update.call(this,frame,...args);};
await import(${url('apps/desktop/main.mjs')});`,
);
const gateway = createServer((_req, res) =>
  res.setHeader('content-type', 'application/json').end('{"data":[]}'),
);
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
let app, page;
const report = { passed: false, checks: [], physicalInput: false, modelStarted: false };
try {
  const env = {
    ...process.env,
    TEMP: folder,
    TMP: folder,
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(gateway.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_ASR: '0',
    CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html'),
    );
    win.webContents.send('capri:event', { type: 'startup-intro.skip' });
    win.showInactive();
  });
  await page.waitForFunction(() => !document.getElementById('avatar-detach').disabled);
  await page.locator('#avatar-detach').click({ force: true });
  for (let i = 0; i < 160; i++) {
    if (await app.evaluate(() => globalThis.fixtureAvatar?.available)) break;
    if (i === 159) throw Error('Avatar did not leave its frame');
    await page.waitForTimeout(50);
  }
  for (const pose of ['pose-ceiling-upside-down', 'pose-ceiling'])
    for (const fraction of [0.12, 0.5, 0.88]) {
      await app.evaluate(
        async ({ screen, nativeImage }, { pose, fraction }) => {
          const avatar = globalThis.fixtureAvatar,
            catalog = globalThis.fixtureCatalog;
          const frame = catalog.frames.find((f) => f.id === pose),
            display = screen.getDisplayMatching(avatar.overlay.getBounds()),
            area = display.workArea;
          const bitmap = nativeImage.createFromPath(frame.file).getBitmap();
          const alpha = new Uint8Array(bitmap.length / 4);
          for (let i = 0; i < alpha.length; i++) alpha[i] = bitmap[i * 4 + 3];
          globalThis.fixturePose = pose;
          await avatar.followFrame(
            frame,
            catalog.canvas,
            { alpha, imageSize: catalog.canvas, visibleBounds: frame.visibleBounds },
            { x: area.x + area.width * fraction, y: area.y + 10 },
            display,
          );
          avatar.sendStatus({ text: 'CONNECTING', color: '#8ef5ed' });
          avatar.sendReply({
            text: 'Still here, choom. The input and status both need their own space.',
            turnId: pose + fraction,
            autoCollapsed: true,
          });
        },
        { pose, fraction },
      );
      for (const mode of ['compact', 'text'])
        for (const collapsed of [true, false]) {
          await app.evaluate(
            (_, { mode, collapsed }) => {
              const avatar = globalThis.fixtureAvatar,
                composer = globalThis.fixtureComposer;
              composer.setMode(mode);
              avatar.sendReply({
                text: 'Still here, choom. The input and status both need their own space.',
                turnId: 'spacing',
                autoCollapsed: collapsed,
              });
            },
            { mode, collapsed },
          );
          await page.waitForTimeout(150);
          const overlay = app.windows().find((p) => p.url().endsWith('/avatar-detach.html'));
          await overlay.evaluate(() => globalThis.capriAvatarDetach.setReplyNear(true));
          await app.evaluate(() => {
            const avatar = globalThis.fixtureAvatar;
            avatar.onPointer(avatar.desktopPoint);
          });
          await page.waitForTimeout(100);
          const actual = await app.evaluate(() => ({
            bar: globalThis.fixtureComposer.window?.getBounds(),
            reserved: globalThis.fixtureAvatar.hudBounds,
            body: globalThis.fixtureComposer.placement.body,
          }));
          const visible = await overlay.evaluate(() =>
            ['avatar-status', 'avatar-reply-toggle', 'avatar-reply']
              .map((id) => {
                const node = document.getElementById(id);
                if (node.hidden) return null;
                const { x, y, width, height } = node.getBoundingClientRect();
                return { id, x, y, width, height };
              })
              .filter(Boolean),
          );
          const origin = await app.evaluate(() => globalThis.fixtureAvatar.session.area);
          assert(actual.bar, 'The native mini panel must exist');
          for (const rect of visible)
            assert(
              !overlaps(actual.bar, { ...rect, x: rect.x + origin.x, y: rect.y + origin.y }),
              'Native mini panel overlaps ' +
                rect.id +
                ' ' +
                JSON.stringify({ pose, fraction, mode, collapsed, actual, rect }),
            );
          report.checks.push({ pose, fraction, mode, collapsed, ...actual });
        }
    }
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  throw error;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
  gateway.close();
  console.log(
    JSON.stringify({
      folder,
      passed: report.passed,
      checks: report.checks.length,
      error: report.error,
    }),
  );
}
