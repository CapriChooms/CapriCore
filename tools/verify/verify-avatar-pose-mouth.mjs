// SPDX-License-Identifier: GPL-3.0-only
// Isolated Electron compositor fixture. No installed profile, audio or desktop input.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { createDesktopResources } from '../../apps/desktop/main/resources.mjs';
import { avatarPoseLandmarks } from '../../apps/desktop/renderer/avatar-mouth.mjs';
import { avatarPoseSegments } from '../../apps/desktop/avatar-pose-motion.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime', 'desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'pose-mouth-'));
const catalog = requireCapriAvatar(root);
const staticIds = new Set(['pose-sleep', 'music-window', 'music-floor']);
const sprites = catalog.desktopPoseFrames.filter(({ id }) => !staticIds.has(id));
assert.equal(sprites.length, 7);
const entry = path.join(folder, 'main.mjs');
const desktop = path.join(root, 'apps/desktop');
const resources = Object.fromEntries(
  createDesktopResources({
    root,
    directory: desktop,
    catalog,
    spriteFile: catalog.frames[0].file,
  }),
);
writeFileSync(
  entry,
  `
import { app, BrowserWindow, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
const resources = ${JSON.stringify(resources)};
app.setPath('userData', ${JSON.stringify(path.join(folder, 'profile'))});
protocol.registerSchemesAsPrivileged([{ scheme:'capri', privileges:{ standard:true, secure:true, supportFetchAPI:true } }]);
app.whenReady().then(async () => {
protocol.handle('capri', async ({ url }) => {
  const asset = resources[new URL(url).pathname];
  if (!asset) return new Response(null, { status:404 });
  try { return new Response(await readFile(asset.file), { headers: { 'content-type': asset.type } }); }
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
  await page.evaluate(async () => {
    const { prepareLayeredBlink, layeredBlinkAssets, blinkEyeArea } = await import(
      '/avatar-layered-blink.mjs'
    );
    const { faceAnimations, faceFrames } = await import('/avatar-face-expressions.mjs');
    const images = await Promise.all(
      Object.values(layeredBlinkAssets).map(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      }),
    );
    const paint = prepareLayeredBlink(...images);
    const { x, y, width, height } = blinkEyeArea;
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    ctx.translate(-x, -y);
    let triangle, triangles;
    const traced = new Proxy(ctx, {
      get(target, key) {
        if (key === 'beginPath')
          return () => {
            triangle = [];
            target.beginPath();
          };
        if (key === 'moveTo' || key === 'lineTo')
          return (...p) => {
            triangle.push(p);
            target[key](...p);
          };
        if (key === 'fill')
          return (...args) => {
            if (!args.length) triangles.push(triangle);
            target.fill(...args);
          };
        const v = Reflect.get(target, key, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set(target, key, value) {
        return Reflect.set(target, key, value, target);
      },
    });
    const phases = [0, 0.25, 0.5, 0.75, 1].map((closure) => {
      triangles = [];
      paint(traced, 1254, { closure }, 'lids');
      if (triangles.length !== 4) throw Error('Expected one lash on each lid');
      return triangles;
    });
    const angle = ([a, , b]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
    const localShape = ([a, tip, b]) => {
      const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const cos = (b[0] - a[0]) / width,
        sin = (b[1] - a[1]) / width;
      const dx = tip[0] - (a[0] + b[0]) / 2,
        dy = tip[1] - (a[1] + b[1]) / 2;
      return [width, dx * cos + dy * sin, dy * cos - dx * sin];
    };
    for (const [i, open] of phases[0].entries()) {
      const original = localShape(open);
      // Left lashes stay rigid. Right lashes meet their mirrored counterparts
      // at full closure, while following the tangent of their own eyelid.
      const target = localShape(phases[0][i % 2]);
      if (i >= 2) target[1] *= -1;
      for (const [step, phase] of phases.entries()) {
        const t = step / (phases.length - 1);
        const travel = t * t * (3 - 2 * t);
        const actual = localShape(phase[i]);
        if (
          actual.some(
            (v, j) => Math.abs(v - (original[j] + (target[j] - original[j]) * travel)) > 1e-6,
          )
        )
          throw Error('Unexpected lash shape at closure ' + t);
      }
      if (Math.abs(angle(phases.at(-1)[i]) - angle(open)) < 0.06)
        throw Error('Lash did not rotate with its lid');
    }
    // Measure the eye artwork before lid clipping so a covered pupil isn't
    // mistaken for a smaller pupil. Supersampling keeps subpixel gaze measurable.
    const zoom = 4;
    const probe = new OffscreenCanvas(width * zoom, height * zoom).getContext('2d', {
      willReadFrequently: true,
    });
    probe.scale(zoom, zoom);
    probe.translate(-x, -y);
    function measureEyes(state) {
      probe.clearRect(x, y, width, height);
      paint(probe, 1254, state, 'eye-art');
      const { data, width: stride } = probe.getImageData(0, 0, width * zoom, height * zoom);
      const eyes = Array.from({ length: 2 }, () => ({ pupil: 0, iris: 0, x: 0, y: 0 }));
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 220) continue;
        const px = ((i / 4) % stride) / zoom;
        const eye = eyes[px + x < 628 ? 0 : 1];
        if (data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 220) {
          eye.pupil++;
          eye.x += px;
          eye.y += Math.floor(i / 4 / stride) / zoom;
        } else if (data[i + 2] - data[i] > 150) eye.iris++;
      }
      for (const eye of eyes) {
        if (!eye.pupil || !eye.iris) throw Error('Eye artwork missing');
        eye.x /= eye.pupil;
        eye.y /= eye.pupil;
      }
      return eyes;
    }
    const rest = measureEyes(faceFrames.neutral);
    for (const [clip, times] of [
      ['wink', [0, 100, 280, 435, 600, 760, 860, 1290]],
      ['excited', [300, 500, 900]],
      ['surprise', [200, 900, 1150]],
    ]) {
      for (const ms of times) {
        const eyes = measureEyes(faceAnimations[clip].sample(ms));
        for (const [i, eye] of eyes.entries())
          if (['pupil', 'iris'].some((key) => Math.abs(eye[key] / rest[i][key] - 1) > 0.04))
            throw Error(clip + ' changed eye size at ' + ms + ' ms');
      }
    }
    for (const [direction, axis, sign, ms] of [
      ['left', 'x', -1, 350],
      ['right', 'x', 1, 1600],
      ['up', 'y', -1, 1010],
      ['down', 'y', 1, 2250],
    ]) {
      for (const state of [faceFrames['idle-look_' + direction], faceAnimations.gaze.sample(ms)]) {
        for (const [i, eye] of measureEyes(state).entries()) {
          if ((eye[axis] - rest[i][axis]) * sign < 4.5)
            throw Error('Insufficient gaze movement: ' + direction);
        }
      }
    }
  });
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
      async ({ frameId, anchor, scale, dock, center, eyes }) => {
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
        const rig = await (await import('/avatar-face-rig.mjs')).loadAvatarFaceRig();
        const [px, py, pw, ph] = rig(sprite, frameId).bounds;
        api.setMouth('closed');
        const canvas = document.querySelector('.avatar-mouth-plate');
        const position = (axis) => Math.round((parseFloat(canvas.style[axis]) * 1254) / 100);
        const deadline = performance.now() + 3000;
        while (
          canvas.hidden ||
          canvas.width !== pw ||
          canvas.height !== ph ||
          position('left') !== px ||
          position('top') !== py
        ) {
          if (performance.now() > deadline) throw new Error('No current face plate for ' + frameId);
          await new Promise(requestAnimationFrame);
        }
        const { width, height } = canvas;
        const painter = canvas.getContext('2d');
        const rest = painter.getImageData(0, 0, width, height).data;
        const left = position('left');
        const top = position('top');
        // Scan from the mouth towards the eyes so this works upside down too.
        const midX = Math.round((eyes[0][0] + eyes[1][0]) / 2) - left;
        const eyesY = Math.round((eyes[0][1] + eyes[1][1]) / 2) - top;
        const mouthY = Math.round(center[1]) - top;
        const step = Math.sign(eyesY - mouthY);
        const edge = [];
        for (let x = midX - 10; x <= midX + 10; x++) {
          for (let y = mouthY; y !== eyesY; y += step) {
            const i = (y * width + x) * 4;
            if (rest[i + 1] > 145 && rest[i] < rest[i + 1] / 2) {
              edge.push(y);
              break;
            }
          }
        }
        const smooth =
          edge.length === 21 &&
          edge.every((y, i) => Math.abs(y - (edge[0] + ((edge.at(-1) - edge[0]) * i) / 20)) < 1.5);
        if (!smooth) throw new Error(frameId + ' has a broken cheek edge: ' + edge.join(','));
        const shapes = [];
        for (const shape of ['small', 'round', 'wide']) {
          api.setMouth(shape);
          const pose = painter.getImageData(0, 0, width, height).data;
          let pixels = 0;
          let escaped = 0;
          let white = 0;
          for (let i = 0; i < pose.length; i += 4) {
            const x = left + ((i / 4) % width);
            const y = top + Math.floor(i / 4 / width);
            const atJaw = Math.hypot(x - center[0], y - center[1]) <= 39;
            if (atJaw && pose[i] > 225 && pose[i + 1] > 225 && pose[i + 2] > 225) white++;
            if (
              Math.abs(pose[i] - rest[i]) <= 3 &&
              Math.abs(pose[i + 1] - rest[i + 1]) <= 3 &&
              Math.abs(pose[i + 2] - rest[i + 2]) <= 3
            )
              continue;
            pixels++;
            if (!atJaw) escaped++;
          }
          shapes.push({
            pixels,
            escaped,
            white,
            keepsRaster: getComputedStyle(sprite).visibility === 'visible',
          });
        }
        return shapes;
      },
      { frameId, anchor, scale, dock: anchor.name, center: landmark.mouth, eyes: landmark.eyes },
    );
    for (const shape of result) {
      assert.ok(
        shape.pixels > 25 && shape.white > 10,
        frameId + ' changes a solid white mouth ' + JSON.stringify(shape),
      );
      assert.equal(shape.escaped, 0, frameId + ' only animates at the jaw');
      assert.ok(shape.keepsRaster, frameId + ' leaves the pose raster visible');
    }
    assert(result[2].white > result[0].white, frameId + ' distinguishes small and wide visemes');
    await screenshot(`${id}-wide.png`);
    await page.evaluate(() => window.capriAvatarDetach.setMouth('closed'));
    assert.equal(await page.locator('.avatar-mouth-plate').isHidden(), false);
    if (landmark.inverted) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const wink = await page.evaluate(async (eyes) => {
        const api = window.capriAvatarDetach;
        const plate = document.querySelector('.avatar-mouth-plate');
        const x = Math.round((parseFloat(plate.style.left) * 1254) / 100);
        const y = Math.round((parseFloat(plate.style.top) * 1254) / 100);
        const sprite = document.querySelector('#parked-avatar img');
        const blue = () =>
          eyes.map(([ex, ey]) => {
            const { data } = plate.getContext('2d').getImageData(ex - x - 12, ey - y - 12, 24, 24);
            let count = 0;
            for (let i = 0; i < data.length; i += 4)
              if (data[i + 2] > 150 && data[i + 2] - data[i + 1] > 40) count++;
            return count;
          });
        const before = blue();
        const url = sprite.currentSrc;
        const accepted = api.setFace({
          expression: 'flirty',
          clip: 'wink',
          startedAt: Date.now() - 495,
        });
        await new Promise(requestAnimationFrame);
        const after = blue();
        api.setFace({ expression: null, clip: null, startedAt: 0 });
        return { accepted, before, after, samePose: url === sprite.currentSrc };
      }, landmark.eyes);
      assert.ok(wink.accepted && wink.samePose);
      assert.ok(wink.before[0] > 50 && wink.before[1] > 50);
      assert.ok(wink.after[0] < 8 && wink.after[1] > 50);
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
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
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const { id, url, anchor } of catalog.desktopPoseFrames.filter(({ id }) =>
    staticIds.has(id),
  )) {
    const result = await page.evaluate(
      async ({ id, url, anchor }) => {
        const api = window.capriAvatarDetach;
        const point = {
          x: 120 + (anchor.x * 600) / 1254,
          y: 110 + (anchor.y * 600) / 1254,
          scale: 600,
        };
        await api.park({
          point,
          url,
          anchor: { x: anchor.x / 1254, y: anchor.y / 1254 },
          dock: anchor.name,
        });
        const sprite = document.querySelector('#parked-avatar img');
        await sprite.decode();
        api.setMouth('wide');
        api.setFace({ expression: 'surprised', clip: 'surprise', startedAt: Date.now() - 320 });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const { loadAvatarFaceRig } = await import('/avatar-face-rig.mjs');
        const rig = await loadAvatarFaceRig();
        return (
          rig(sprite, id) === null &&
          document.querySelector('.avatar-mouth-plate').hidden &&
          sprite.currentSrc === url &&
          getComputedStyle(sprite).visibility === 'visible'
        );
      },
      { id, url, anchor },
    );
    assert.ok(result, id + ' must keep the original artwork during speech and reactions');
    await screenshot(id + '-original.png');
  }
  console.log(
    `PASS ${sprites.length} animated poses, ${staticIds.size} original static faces, and limb motion: ${folder}`,
  );
} finally {
  await application?.close();
}
