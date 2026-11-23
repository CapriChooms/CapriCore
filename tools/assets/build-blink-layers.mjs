// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { chromium } from 'playwright-core';
import { blinkEyeArea } from '../../apps/desktop/renderer/avatar-layered-blink.mjs';

const source = PNG.sync.read(readFileSync('assets/capri/sprites/v1/capri-neutral.png'));
const renderer = readFileSync('apps/desktop/renderer/avatar-layered-blink.mjs', 'utf8').replace(
  /^export /gm,
  '',
);
const browser = await chromium.launch({
  channel: process.env.CAPRI_ART_BROWSER || 'msedge',
  headless: true,
});
const patch = { x: 559, y: 327, width: 147, height: 113 };
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: renderer });
  const result = await page.evaluate(
    ({ patch, area }) => {
      function surface(box) {
        const canvas = document.createElement('canvas');
        canvas.width = box.width * 4;
        canvas.height = box.height * 4;
        const ctx = canvas.getContext('2d');
        ctx.scale(4, 4);
        ctx.translate(-box.x, -box.y);
        return { canvas, ctx };
      }
      const eyes = surface(area);
      paintBlinkEyeArtwork(eyes.ctx);
      const plate = surface(patch);
      const ctx = plate.ctx;
      // Trace the two temples, centre fringe, cheek and raised jaw from the standing cel.
      // The white mouth is drawn independently at playback.
      ctx.fillStyle = blinkPalette.ink;
      ctx.fill(new Path2D('M603 423 L656 409 L664 413 Q652 427 635 438 L608 434 Z'));
      ctx.fillStyle = blinkPalette.green;
      ctx.fill(
        new Path2D(
          'M566.6 362.6 L600.6 354.9 L622.5 388.1 L649.8 343.4 L695.6 332.9 L692.9 356.6 L700.0 398.5 Q655 405.9 622.5 413.1 Q600.5 419 585.0 426.1 Q574.0 413.4 566.8 395.0 Z',
        ),
      );
      const native = document.createElement('canvas');
      native.width = patch.width;
      native.height = patch.height;
      const downsample = native.getContext('2d');
      downsample.imageSmoothingQuality = 'high';
      downsample.drawImage(plate.canvas, 0, 0, native.width, native.height);
      return { eyes: eyes.canvas.toDataURL(), patch: native.toDataURL() };
    },
    { patch, area: blinkEyeArea },
  );
  const bytes = (uri) => Buffer.from(uri.split(',')[1], 'base64');
  const overlay = PNG.sync.read(bytes(result.patch));
  for (let y = 0; y < patch.height; y++)
    for (let x = 0; x < patch.width; x++) {
      const s = ((patch.y + y) * source.width + patch.x + x) * 4;
      const p = (y * patch.width + x) * 4;
      // Remove the green fringe in the old compressed raster before applying the
      // antialiased face plate. Preserve the red hair and its texture at the boundary.
      const [r, g, b] = source.data.subarray(s, s + 3);
      if (g > 14 && g > r * 0.7 && g > b * 0.92 && patch.y + y < 429) {
        const behind =
          r > 53
            ? [
                Math.min(255, Math.round(r / (1 - (g / 255) * 0.85))),
                0,
                Math.min(54, Math.round(r * 0.25)),
              ]
            : [5, 4, 9];
        source.data.set(behind, s);
      }
      const a = overlay.data[p + 3] / 255;
      if (a === 0) continue;
      const under = ((1 - a) * source.data[s + 3]) / 255;
      for (let c = 0; c < 3; c++)
        source.data[s + c] = Math.round(
          (overlay.data[p + c] * a + source.data[s + c] * under) / (a + under),
        );
      source.data[s + 3] = Math.round(255 * (a + under));
    }
  writeFileSync('assets/default/capri-blink-pose.png', PNG.sync.write(source));
  writeFileSync('assets/default/capri-blink-eyes.png', bytes(result.eyes));
} finally {
  await browser.close();
}
