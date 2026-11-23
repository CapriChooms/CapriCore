// SPDX-License-Identifier: GPL-3.0-only
// Real canvas compositor, isolated offscreen profile; no model/audio/desktop input.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { createDesktopResources } from '../../apps/desktop/main/resources.mjs';

const sourceRoot = path.resolve(process.argv[2] ?? root);
const parent = path.join(sourceRoot, '.runtime/headpat-faces');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const catalog = requireCapriAvatar(sourceRoot);
const frames = catalog.frames.filter(
  ({ id, kind }) =>
    ['neutral', 'attentive'].includes(id) ||
    (kind === 'reviewed_pose' && id !== 'pose-sleep') ||
    kind === 'reviewed_music',
);
const resources = Object.fromEntries(
  createDesktopResources({
    root: sourceRoot,
    directory: path.join(sourceRoot, 'apps/desktop'),
    catalog,
    spriteFile: catalog.frames[0].file,
  }),
);
const html = path.join(folder, 'preview.html');
resources['/preview.html'] = { file: html, type: 'text/html; charset=utf-8' };
writeFileSync(
  html,
  `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="avatar-headpat.css"><style>
body{margin:0;background:#101a21;color:#b6f8ef;font:16px sans-serif;padding:16px}h1{font-size:18px}#grid{display:grid;grid-template-columns:repeat(4,220px);gap:12px}.card{position:relative;height:164px;overflow:hidden;border:1px solid #37676a;border-radius:6px}.caption{position:absolute;bottom:0;left:0;right:0;padding:5px;background:#0b111a;z-index:5;font-size:12px}.stage{position:absolute;width:1504.8px;height:1504.8px}.stage>img{width:100%;height:100%}
</style></head><body><h1>Capri · Headpat expression · Original / Affectionate</h1><div id="grid"></div></body></html>`,
);
const entry = path.join(folder, 'main.cjs');
writeFileSync(
  entry,
  `
const {app,BrowserWindow,protocol}=require('electron'); const fs=require('node:fs/promises'),path=require('node:path');
const resources=${JSON.stringify(resources)};
app.setPath('userData',${JSON.stringify(path.join(folder, 'profile'))});
protocol.registerSchemesAsPrivileged([{scheme:'capri',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
protocol.handle('capri',async({url})=>{const asset=resources[new URL(url).pathname];if(!asset)return new Response(null,{status:404});return new Response(await fs.readFile(asset.file),{headers:{'content-type':asset.type}})});
const win=new BrowserWindow({width:984,height:1100,useContentSize:true,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
await win.loadURL('capri://desktop/preview.html');
});`,
);
let app;
const report = { passed: false, checks: [], modelStarted: false, physicalInput: false };
try {
  const env = { ...process.env, TEMP: folder, TMP: folder };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const results = await page.evaluate(async (frames) => {
    const { AvatarHeadpat } = await import('./avatar-headpat.mjs');
    const { AvatarMouthLayer, avatarPoseLandmarks } = await import('./avatar-mouth.mjs');
    await (await import('./avatar-face-rig.mjs')).loadAvatarFaceRig();
    const results = [];
    globalThis.reactions = [];
    for (const frame of frames) {
      const pose = avatarPoseLandmarks(frame.id),
        face = pose?.face ?? [646, 400];
      const make = async (label) => {
        const card = document.createElement('div');
        card.className = 'card';
        const stage = document.createElement('div');
        stage.className = 'stage';
        stage.style.left = -face[0] * 1.2 + 110 + 'px';
        stage.style.top = -face[1] * 1.2 + 68 + 'px';
        const sprite = new Image();
        sprite.src = frame.url;
        stage.append(sprite);
        card.append(stage);
        const caption = document.createElement('span');
        caption.className = 'caption';
        caption.textContent = frame.id + ' · ' + label;
        card.append(caption);
        document.getElementById('grid').append(card);
        await sprite.decode();
        return { sprite, stage };
      };
      await make('Original');
      const { sprite, stage } = await make('Headpat');
      const pat = new AvatarHeadpat(stage);
      const music = frame.id.startsWith('music-');
      pat.play(sprite, { x: 50, y: 80 }, { x: 0, y: 0, width: 200, height: 200 }, !music, frame.id);
      globalThis.reactions.push(pat);
      if (!music) while (pat.layer.canvas.hidden) await new Promise(requestAnimationFrame);
      const canvas = pat.layer?.canvas,
        reactionSource = sprite.src;
      const reference = document.createElement('canvas');
      reference.width = reference.height = 1254;
      const baseCtx = reference.getContext('2d', { willReadFrequently: true });
      baseCtx.drawImage(sprite, 0, 0);
      const before = baseCtx.getImageData(0, 0, 1254, 1254).data;
      if (canvas) baseCtx.drawImage(canvas, ...pat.layer.patch.bounds.slice(0, 2));
      const after = baseCtx.getImageData(0, 0, 1254, 1254).data;
      let changed = 0,
        escaped = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (
          Math.abs(before[i] - after[i]) <= 2 &&
          Math.abs(before[i + 1] - after[i + 1]) <= 2 &&
          Math.abs(before[i + 2] - after[i + 2]) <= 2 &&
          Math.abs(before[i + 3] - after[i + 3]) <= 2
        )
          continue;
        changed++;
        const x = (i / 4) % 1254,
          y = Math.floor(i / 4 / 1254);
        if (Math.hypot(x - face[0], y - face[1]) > 118) escaped++;
      }
      const blue = (data) => {
        let n = 0;
        for (const [x, y, r] of pose?.eyes ?? [
          [608, 400, 18],
          [680, 373, 22],
        ])
          for (let yy = Math.floor(y - r); yy <= y + r; yy++)
            for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
              const i = (yy * 1254 + xx) * 4;
              if (
                data[i + 2] > 100 &&
                data[i + 2] > data[i] + 50 &&
                data[i + 2] > data[i + 1] + 20 &&
                data[i] < 150
              )
                n++;
            }
        return n;
      };
      const mouth = new AvatarMouthLayer(sprite);
      mouth.update(sprite, 'wide', frame.id, pat.expression);
      while (!music && mouth.canvas.hidden) {
        await new Promise(requestAnimationFrame);
        mouth.update(sprite, 'wide', frame.id, pat.expression);
      }
      const mouthWorks = !mouth.canvas.hidden;
      mouth.canvas.remove();
      results.push({
        id: frame.id,
        changed,
        escaped,
        beforeBlue: blue(before),
        afterBlue: blue(after),
        mouthWorks,
        visible: Boolean(canvas && !canvas.hidden),
        sameSource: reactionSource === frame.url,
        hearts: Boolean(pat.hearts),
      });
    }
    return results;
  }, frames);
  for (const result of results) {
    assert(
      result.sameSource && result.hearts,
      result.id + ' must preserve the current sprite and show hearts',
    );
    if (result.id.startsWith('music-')) {
      assert.equal(result.changed, 0);
      assert.equal(result.visible, false);
      assert.equal(result.mouthWorks, false);
      report.checks.push(result);
      continue;
    }
    assert(result.changed > 300, result.id + ' must show the affectionate expression');
    assert.equal(result.escaped, 0, result.id + ' must preserve hair, body and pose');
    assert(result.beforeBlue > 40, result.id + ' fixture must start with open blue eyes');
    assert(
      result.afterBlue < 8,
      result.id + ' must replace the complete eye expression, without open iris rings',
    );
    assert(
      result.mouthWorks && result.visible,
      result.id + ' mouth and headpat layers must remain independent',
    );
    report.checks.push(result);
  }
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const image = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayHidden: true }))
      .toPNG()
      .toString('base64'),
  );
  writeFileSync(path.join(folder, 'headpat-comparison.png'), Buffer.from(image, 'base64'));
  await page.evaluate(() => globalThis.reactions.forEach((pat) => pat.clear()));
  assert.equal(await page.locator('.avatar-headpat-plate').count(), 0);
  report.passed = true;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
  console.log(JSON.stringify({ folder, ...report }));
}
