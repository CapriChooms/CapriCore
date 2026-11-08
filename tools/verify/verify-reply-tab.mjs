// SPDX-License-Identifier: GPL-3.0-only
// Hidden owned renderer only: no models, microphone, capture or physical input.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
const parent = path.join(root, '.runtime/reply-tab');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  entry = path.join(folder, 'main.mjs');
const source = (name) => JSON.stringify(pathToFileURL(path.join(root, name)).href);
writeFileSync(
  entry,
  `
import {app,BrowserWindow,protocol} from 'electron';
import {requireCapriAvatar} from ${source('apps/desktop/avatar-catalog.mjs')};
import {createDesktopResources} from ${source('apps/desktop/main/resources.mjs')};
import {resourceResponse} from ${source('apps/desktop/main/protocol.mjs')};
app.setPath('userData',${JSON.stringify(path.join(folder, 'profile'))});
protocol.registerSchemesAsPrivileged([{scheme:'capri',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 const root=${JSON.stringify(root)},catalog=requireCapriAvatar(root);
 const resources=createDesktopResources({root,directory:root+'/apps/desktop',catalog,spriteFile:catalog.sprites.find(s=>s.id===catalog.defaultId).file});
 protocol.handle('capri',request=>resourceResponse(request,resources));
 const view=new BrowserWindow({show:false,width:1000,height:760,useContentSize:true,webPreferences:{backgroundThrottling:false,offscreen:true}});
 await view.loadURL('capri://desktop/avatar-detach.html');
});
app.on('window-all-closed',()=>app.quit());
`,
);
let app;
const report = { checks: [], errors: [], physicalInput: false };
try {
  const env = { ...process.env, TEMP: folder, TMP: folder };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
    env,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => Boolean(globalThis.capriAvatarDetach));
  const scenarios = [
    { side: 'above', x: 500, y: 520, url: 'neutral' },
    { side: 'right', x: 160, y: 240, url: 'neutral' },
    { side: 'left', x: 840, y: 240, url: 'neutral' },
    { side: 'below', x: 500, y: 400, url: 'pose-ceiling-upside-down' },
  ];
  for (const item of scenarios) {
    await page.evaluate(async (item) => {
      const api = globalThis.capriAvatarDetach;
      await api.park({
        point: { x: item.x, y: item.y, scale: 240 },
        anchor: { x: 0.5, y: 1 },
        url: 'capri://desktop/sprites/' + item.url + '.png',
      });
      api.setStatus({ text: 'CONNECTING', color: '#b5a3ff' });
      api.setReply({
        text: 'Still here, choom. The signal opens in the direction shown on the status tab.',
        turnId: item.side,
        collapsed: true,
      });
      api.setReplyNear(true);
    }, item);
    await page.evaluate(() => document.fonts.ready);
    const collapsed = await page.evaluate(() => {
      const label = document.getElementById('avatar-status'),
        tab = document.getElementById('avatar-reply-toggle');
      const rect = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        side: tab.dataset.side,
        badge: rect(label),
        tab: rect(tab),
        labelColor: getComputedStyle(label).color,
        tabColor: getComputedStyle(tab).color,
      };
    });
    assert.equal(collapsed.side, item.side);
    assert.equal(collapsed.labelColor, collapsed.tabColor);
    assert.equal(await page.locator('#avatar-reply-toggle svg').count(), 1);
    const clip = {
      x: Math.floor(Math.min(collapsed.badge.x, collapsed.tab.x) - 8),
      y: Math.floor(Math.min(collapsed.badge.y, collapsed.tab.y) - 8),
      width: Math.ceil(
        Math.max(collapsed.badge.x + collapsed.badge.width, collapsed.tab.x + collapsed.tab.width) -
          Math.min(collapsed.badge.x, collapsed.tab.x) +
          16,
      ),
      height: Math.ceil(
        Math.max(
          collapsed.badge.y + collapsed.badge.height,
          collapsed.tab.y + collapsed.tab.height,
        ) -
          Math.min(collapsed.badge.y, collapsed.tab.y) +
          16,
      ),
    };
    await page.locator('#parked-avatar').evaluate((node) => {
      node.style.visibility = 'hidden';
    });
    await page.screenshot({
      path: path.join(folder, item.side + '-tab.png'),
      clip,
      omitBackground: true,
    });
    await page.locator('#parked-avatar').evaluate((node) => {
      node.style.visibility = '';
    });
    const expanded = await page.evaluate(() => {
      const value = globalThis.capriAvatarDetach.toggleReply();
      const tab = document.getElementById('avatar-reply-toggle'),
        label = document.getElementById('avatar-status').getBoundingClientRect(),
        bubble = document.getElementById('avatar-reply').getBoundingClientRect();
      return {
        value,
        side: tab.dataset.side,
        badge: { x: label.x, y: label.y },
        bubble: { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height },
        label: { x: label.x, y: label.y, width: label.width, height: label.height },
      };
    });
    assert.equal(expanded.side, item.side);
    assert.equal(expanded.badge.x, collapsed.badge.x);
    assert.equal(expanded.badge.y, collapsed.badge.y);
    const { bubble, label } = expanded;
    const outline = await page.evaluate(() => {
      const surface = document.getElementById('avatar-reply-surface');
      const path = surface.querySelector('path');
      const join = new DOMPoint(Number(surface.dataset.baseX), Number(surface.dataset.baseY));
      const point = new DOMPoint(Number(surface.dataset.tipX), Number(surface.dataset.tipY));
      const half = 9;
      const vertical = ['top', 'bottom'].includes(surface.dataset.tailSide);
      const ends = vertical
        ? [new DOMPoint(join.x - half, join.y), new DOMPoint(join.x + half, join.y)]
        : [new DOMPoint(join.x, join.y - half), new DOMPoint(join.x, join.y + half)];
      const vertices = [...ends, point].map((p) => p.matrixTransform(surface.getScreenCTM()));
      const tab = document.getElementById('avatar-reply-toggle').getBoundingClientRect();
      const tail = {
        left: Math.min(...vertices.map((p) => p.x)),
        right: Math.max(...vertices.map((p) => p.x)),
        top: Math.min(...vertices.map((p) => p.y)),
        bottom: Math.max(...vertices.map((p) => p.y)),
      };
      return {
        path: path.getAttribute('d'),
        side: surface.dataset.tailSide,
        joinedFill: path.isPointInFill(join),
        seam: path.isPointInStroke(join),
        clearTab:
          tail.right <= tab.left ||
          tail.left >= tab.right ||
          tail.bottom <= tab.top ||
          tail.top >= tab.bottom,
        paths: surface.querySelectorAll('path').length,
        oldTail: Boolean(document.getElementById('avatar-reply-tail')),
        border: getComputedStyle(document.getElementById('avatar-reply')).borderTopWidth,
        background: getComputedStyle(document.getElementById('avatar-reply')).backgroundColor,
      };
    });
    assert.equal(outline.paths, 1);
    assert.equal((outline.path.match(/M/g) ?? []).length, 1);
    assert.equal((outline.path.match(/Z/g) ?? []).length, 1);
    assert(['top', 'right', 'bottom', 'left'].includes(outline.side));
    assert.equal(outline.joinedFill, true, 'The tail root belongs to the same filled bubble');
    assert.equal(outline.seam, false, 'There must be no border seam across the tail root');
    assert.equal(outline.clearTab, true, 'The status tab must not cover the tail');
    assert.equal(outline.oldTail, false);
    assert.equal(outline.border, '0px');
    assert.equal(outline.background, 'rgba(0, 0, 0, 0)');
    assert(
      bubble.x >= 0 &&
        bubble.y >= 0 &&
        bubble.x + bubble.width <= 1000 &&
        bubble.y + bubble.height <= 760,
    );
    if (item.side === 'above') assert(bubble.y + bubble.height < label.y);
    if (item.side === 'below') assert(bubble.y > label.y + label.height);
    if (item.side === 'left') assert(bubble.x + bubble.width < label.x);
    if (item.side === 'right') assert(bubble.x > label.x + label.width);
    await page.screenshot({
      path: path.join(folder, item.side + '-expanded.png'),
      omitBackground: true,
    });
    await page.evaluate(() => {
      const api = globalThis.capriAvatarDetach;
      api.toggleReply();
      api.setReplyNear(false);
    });
    assert.equal(await page.locator('#avatar-reply-toggle').isVisible(), false);
    await page.evaluate(() => globalThis.capriAvatarDetach.setReplyNear(true));
    assert.equal(await page.locator('#avatar-reply-toggle').isVisible(), true);
    report.checks.push(item.side);
  }
  assert.deepEqual(report.errors, []);
  const images = scenarios.map(({ side }) => ({
    side,
    data: readFileSync(path.join(folder, side + '-tab.png')).toString('base64'),
  }));
  await app.evaluate(async ({ BrowserWindow }, images) => {
    const win = new BrowserWindow({
      show: false,
      width: 960,
      height: 260,
      useContentSize: true,
      webPreferences: { offscreen: true },
    });
    await win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="margin:0;background:#08131c;color:#97cfd5;font:14px Segoe UI;display:flex;align-items:center;justify-content:space-evenly;height:260px">' +
            images
              .map(
                (item) =>
                  '<section style="width:220px;text-align:center"><div style="color:#c7b8ff;font-size:12px;letter-spacing:2px;margin-bottom:24px">' +
                  item.side.toUpperCase() +
                  '</div><img style="image-rendering:auto;transform:scale(1.3)" src="data:image/png;base64,' +
                  item.data +
                  '"></section>',
              )
              .join('') +
            '</body>',
        ),
    );
  }, images);
  const preview = app.windows().find((view) => view.url().startsWith('data:text/html'));
  await preview.locator('img').last().waitFor();
  await preview.screenshot({ path: path.join(folder, 'reply-tabs-preview.png') });
  report.passed = true;
} finally {
  await app?.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ...report, folder }));
