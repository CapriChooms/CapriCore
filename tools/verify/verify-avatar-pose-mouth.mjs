// SPDX-License-Identifier: GPL-3.0-only
// Isolated Electron compositor fixture. No installed profile, audio or desktop input.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { avatarPoseLandmarks } from '../../apps/desktop/renderer/avatar-mouth.mjs';
import { avatarPoseSegments } from '../../apps/desktop/avatar-pose-motion.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime', 'desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'pose-mouth-'));
const sprites = requireCapriAvatar(root).frames.filter(
  ({ id, kind }) => kind === 'reviewed_pose' && id !== 'pose-sleep',
);
assert.equal(sprites.length, 7);
const entry = path.join(folder, 'main.mjs');
const desktop = path.join(root, 'apps/desktop');
const files = Object.fromEntries([
  ...sprites.map(({ url, file }) => [new URL(url).pathname, file]),
  ...[
    'avatar-detach.html',
    'avatar-detach.css',
    'avatar-detach.mjs',
    'avatar-mouth.mjs',
    'avatar-headpat.mjs',
    'avatar-headpat.css',
    'avatar-drag-tether.mjs',
    'avatar-teleport-motion.mjs',
    'avatar-tap-effect.mjs',
    'avatar-sleep.css',
    'reply-pages.mjs',
    'subtitles.mjs',
    'speech-text.mjs',
    'detached-reply-layout.mjs',
    'reply-bubble-outline.mjs',
    'interface-theme.mjs',
    'presence-model.mjs',
    'music-animation.mjs',
  ].map((name) => [`/${name}`, path.join(desktop, 'renderer', name)]),
  ...[
    'avatar-grip-rig.mjs',
    'avatar-body-regions.mjs',
    'avatar-pose-motion.mjs',
    'music-listening-settings.mjs',
  ].map((name) => [`/${name}`, path.join(desktop, name)]),
  ['/headpat-face.png', path.join(root, 'assets/default/capri-headpat.png')],
]);
writeFileSync(
  entry,
  `
import { app, BrowserWindow, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const files = ${JSON.stringify(files)};
const types = { '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' };
app.setPath('userData', ${JSON.stringify(path.join(folder, 'profile'))});
protocol.registerSchemesAsPrivileged([{ scheme:'capri', privileges:{ standard:true, secure:true, supportFetchAPI:true } }]);
app.whenReady().then(async () => {
protocol.handle('capri', async ({ url }) => {
  const file = files[new URL(url).pathname];
  if (!file) return new Response(null, { status:404 });
  try { return new Response(await readFile(file), { headers: { 'content-type': types[path.extname(file)] } }); }
  catch { return new Response(null, { status:404 }); }
});
globalThis.poseFixture = new BrowserWindow({ width:1050, height:840, useContentSize:true, show:false, webPreferences:{ backgroundThrottling:false, offscreen:true } });
const win = globalThis.poseFixture;
await win.loadURL('capri://desktop/avatar-detach.html');
});
`,
);
let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
  });
  const page = await application.firstWindow();
  const screenshot = async (name) => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const data = await application.evaluate(async ({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows();
      return (await win.capturePage(undefined, { stayHidden: true })).toPNG().toString('base64');
    });
    const png = Buffer.from(data, 'base64');
    assert.ok(png.length > 1000, 'The fixture must capture the actual frame');
    writeFileSync(path.join(folder, name), png);
  };
  await page.waitForFunction(() => Boolean(window.capriAvatarDetach), null, { polling: 50 });
  await page.evaluate(() => {
    document.body.style.background = '#192333';
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const { id: frameId, anchor } of sprites) {
    const id = frameId.slice(5);
    const landmark = avatarPoseLandmarks(frameId);
    assert.ok(landmark, frameId);
    const scale = 600;
    const result = await page.evaluate(
      async ({ frameId, anchor, scale, dock, center }) => {
        const api = window.capriAvatarDetach;
        const url = `capri://desktop/sprites/${frameId}.png`;
        const point = {
          x: 120 + (scale * anchor.x) / 1254,
          y: 110 + (scale * anchor.y) / 1254,
          scale,
        };
        if (
          !(await api.park({
            url,
            point,
            anchor: { x: anchor.x / 1254, y: anchor.y / 1254 },
            dock,
          }))
        )
          throw new Error(`Unable to park ${frameId}`);
        const sprite = document.querySelector('#parked-avatar img');
        await sprite.decode();
        if (sprite.currentSrc !== url) throw new Error(`Unexpected raster for ${frameId}`);
        const canvas = document.querySelector('.avatar-mouth-plate');
        const reference = document.createElement('canvas');
        reference.width = reference.height = 1254;
        const imageCtx = reference.getContext('2d', { willReadFrequently: true });
        imageCtx.drawImage(sprite, 0, 0, 1254, 1254);
        const base = imageCtx.getImageData(0, 0, 1254, 1254).data;
        const painter = canvas.getContext('2d');
        const shapes = [];
        for (const shape of ['small', 'round', 'wide']) {
          api.setMouth(shape);
          const { width, height } = canvas;
          const patch = painter.getImageData(0, 0, width, height).data;
          const left = Math.round((parseFloat(canvas.style.left) * 1254) / 100);
          const top = Math.round((parseFloat(canvas.style.top) * 1254) / 100);
          let pixels = 0;
          let escaped = 0;
          let teethY = 0;
          let teethPixels = 0;
          let cavityY = 0;
          let cavityPixels = 0;
          for (let i = 0; i < patch.length; i += 4) {
            if (patch[i + 3] === 0) continue;
            pixels++;
            const x = left + ((i / 4) % width);
            const y = top + Math.floor(i / 4 / width);
            if (Math.hypot(x - center[0], y - center[1]) > 35 || base[(y * 1254 + x) * 4 + 3] < 230)
              escaped++;
            if (patch[i] > 225 && patch[i + 1] > 225 && patch[i + 2] > 225) {
              teethPixels++;
              teethY += y;
            }
            if (patch[i] === 42 && patch[i + 1] === 24 && patch[i + 2] === 40) {
              cavityPixels++;
              cavityY += y;
            }
          }
          shapes.push({
            pixels,
            escaped,
            width,
            keepsRaster: getComputedStyle(sprite).visibility === 'visible',
            orientation: Math.sign(cavityY / cavityPixels - teethY / teethPixels),
          });
        }
        return shapes;
      },
      { frameId, anchor, scale, dock: anchor.name, center: landmark.mouth },
    );
    for (const shape of result) {
      assert.ok(shape.pixels > 50, `${frameId} changes a visible mouth`);
      assert.equal(shape.escaped, 0, `${frameId} only animates the registered local patch`);
      assert.ok(
        shape.width <= 80 && shape.keepsRaster,
        `${frameId} leaves the pose raster visible`,
      );
      assert.equal(shape.orientation, landmark.inverted ? -1 : 1, `${frameId} jaw orientation`);
    }
    await screenshot(`${id}-wide.png`);
    await page.evaluate(() => window.capriAvatarDetach.setMouth('closed'));
    assert.equal(await page.locator('.avatar-mouth-plate').isHidden(), true);
    if (avatarPoseSegments(frameId).length) {
      const motion = page.locator('.avatar-pose-motion');
      assert.equal(await motion.isHidden(), true);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await motion.waitFor();
      const limb = motion.locator('g').first();
      const before = await limb.getAttribute('transform');
      await page.waitForFunction(
        (before) =>
          document.querySelector('.avatar-pose-motion g').getAttribute('transform') !== before,
        before,
        { polling: 50 },
      );
      await screenshot(`${id}-motion.png`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await motion.waitFor({ state: 'hidden' });
    }
  }
  console.log(
    `PASS ${sprites.length} rendered pose mouth registrations and four stable limb cycles: ${folder}`,
  );
} finally {
  await application?.close();
}
