// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { faceFrames } from '../../apps/desktop/renderer/avatar-face-expressions.mjs';

const rendererFolder = 'apps/desktop/renderer';
const spriteFolder = 'assets/capri/sprites/v1';
const catalogPath = path.join(spriteFolder, 'runtime-sprite-set.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const layer = (name) => readFileSync('assets/default/capri-blink-' + name + '.png');
const baseBytes = layer('pose');
const eyeBytes = layer('eyes');
const base = PNG.sync.read(baseBytes);
const box = { x: 551, y: 318, width: 185, height: 141 };
const moduleSource = readFileSync(path.join(rendererFolder, 'avatar-layered-blink.mjs'), 'utf8');
const browser = await chromium.launch({
  channel: process.env.CAPRI_ART_BROWSER || 'msedge',
  headless: true,
});
const uri = (bytes) => 'data:image/png;base64,' + bytes.toString('base64');
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: moduleSource.replace(/^export /gm, '') });
  const layers = await page.evaluate(
    async ({ states, box, pose, eyes }) => {
      const decode = async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      };
      const draw = prepareLayeredBlink(...(await Promise.all([decode(pose), decode(eyes)])));
      const zoom = 4;
      const hi = new OffscreenCanvas(box.width * zoom, box.height * zoom);
      const ctx = hi.getContext('2d');
      const preview = document.createElement('canvas');
      preview.width = box.width;
      preview.height = box.height;
      const low = preview.getContext('2d');
      low.imageSmoothingQuality = 'high';
      const rasterize = (state) => {
        ctx.setTransform(zoom, 0, 0, zoom, -box.x * zoom, -box.y * zoom);
        ctx.clearRect(box.x, box.y, box.width, box.height);
        for (const name of ['eyes', 'lids', 'mouth']) draw(ctx, 1254, state, name);
        low.clearRect(0, 0, box.width, box.height);
        low.drawImage(hi, 0, 0, box.width, box.height);
        return preview.toDataURL().split(',')[1];
      };
      return Object.fromEntries(
        Object.entries(states).map(([id, state]) => [id, rasterize(state)]),
      );
    },
    { states: faceFrames, box, pose: uri(baseBytes), eyes: uri(eyeBytes) },
  );

  const output = [];
  for (const entry of catalog.sprites) {
    assert.ok(layers[entry.id], 'Missing face artwork for ' + entry.id);
    const art = PNG.sync.read(Buffer.from(layers[entry.id], 'base64'));
    const result = new PNG({ width: base.width, height: base.height });
    base.data.copy(result.data);
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const p = (y * art.width + x) * 4;
        const coverage = art.data[p + 3] / 255;
        if (!coverage) continue;
        const target = ((box.y + y) * result.width + box.x + x) * 4;
        assert.ok(
          result.data[target + 3] > 248,
          'Artwork leaves the face at ' + x + ',' + y + ' in ' + entry.id,
        );
        // Keep original opacity and every untouched pixel of the standing sprite.
        for (let c = 0; c < 3; c++)
          result.data[target + c] = Math.round(
            art.data[p + c] * coverage + result.data[target + c] * (1 - coverage),
          );
      }
    }
    const bytes = PNG.sync.write(result);
    if (entry.id === 'neutral') entry.file = 'capri-idle-relaxed.png';
    entry.sha256 = createHash('sha256').update(bytes).digest('hex');
    output.push([path.join(spriteFolder, entry.file), bytes]);
  }
  for (const [file, bytes] of output) writeFileSync(file, bytes);
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log('Rendered ' + output.length + ' standing face cels.');
} finally {
  await browser.close();
}
