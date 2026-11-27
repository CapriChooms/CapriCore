// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { avatarFacePose } from '../../apps/desktop/renderer/avatar-face-rig.mjs';

const assetDir = 'assets/default/';
const poses = requireCapriAvatar(process.cwd()).desktopPoseFrames.filter(({ id }) =>
  avatarFacePose(id),
);
// The coordinates are measured in the native 512 px cels, left pupil first.
// The closed eyes in the keytar flourish are registered at their optical centres.
const cels = {
  'hang-catch': [
    [238.4, 153.8, 265.7, 144.8],
    [240.3, 155.8, 266.3, 147.2],
    [248.3, 154.5, 274, 144.3],
    [246.1, 158, 273.1, 147.8],
    [239.8, 153.3, 264.6, 141.7],
    [237.5, 153.4, 263.7, 144.9],
  ],
  'hang-catch-breakdowns': [
    [237.4, 153.4, 262.9, 145.3],
    [240, 155.4, 266.2, 148.1],
    [242, 155.9, 268.5, 148.4],
    [240.8, 157.2, 266.4, 150.1],
    [238.7, 155.8, 264.9, 147.7],
    [239.4, 156, 264.8, 148.3],
  ],
  'hang-pullup': [
    [238.1, 154.3, 263.4, 146.2],
    [237.4, 160.2, 264.1, 152.3],
    [236.6, 119.9, 263.6, 112.1],
    [236.4, 69.8, 264.5, 65.8],
    [233.2, 119.2, 260.6, 111.3],
    [238.6, 154.6, 263.7, 145.5],
  ],
  'hang-pullup-breakdowns': [
    [237.5, 155.1, 262, 147.4],
    [239.2, 161.6, 264, 154],
    [236.8, 127.5, 263.6, 120.3],
    [235.9, 89.4, 263.1, 84.2],
    [230.7, 130.6, 259.4, 122.8],
    [238.4, 157.7, 264.3, 149.5],
  ],
  'hang-wrist-scan': [
    [239.6, 156.5, 266.4, 147.6],
    [240.5, 155.7, 268.1, 147.1],
    [240.8, 156.3, 268.3, 147.3],
    [241.3, 156.8, 268.8, 148],
    [241.3, 157, 269.2, 148.4],
    [241.3, 157.4, 268.9, 149.1],
  ],
  'ledge-keytar': [
    [239.2, 163.2, 266.5, 154.8],
    [227.6, 164.2, 256, 156],
    [224.5, 184.7, 252.8, 179.4],
    [211.5, 140, 244, 131.5],
    [229.6, 189.8, 259.3, 183.6],
    [238.3, 163.6, 266.1, 155.3],
  ],
  'ledge-keytar-breakdowns': [
    [234.2, 160, 260.6, 151.6],
    [228.1, 159, 255.3, 150.9],
    [219.7, 165.7, 246.6, 160.1],
    [211.5, 142, 244, 134],
    [228.6, 178.9, 258.7, 175.8],
    [226.9, 175.9, 255, 171.4],
  ],
};
const intro = {
  '02-gaze': [[586.7, 435.8], [665.5, 405.7], [634, 465.4], 'idle-look_left'],
  '03-arrival': [[589.6, 364.1], [655.8, 335.1], [632.9, 384.9], 'surprised'],
  '04-landing': [[558.7, 797], [627.7, 764.8], [603.1, 821.2], 'focused'],
  '05-greeting': [[601.7, 366.1], [677.3, 339.1], [643.8, 399.7], 'idle-excited'],
  '06-wink': [[595, 399], [668, 379], [638, 432], 'idle-wink_closed'],
  '07-ready': [[595, 399], [666, 377], [635, 427], 'neutral'],
};
const files = new Map([
  ...poses.map(({ id, file }) => ['/pose/' + id, file]),
  ...Object.keys(cels).map((id) => ['/cel/' + id, assetDir + 'hanging-cels/' + id + '.webp']),
  ...Object.keys(intro).map((id) => ['/intro/' + id, 'assets/capri/intro-v1/PNG/' + id + '.png']),
  ['/wave', assetDir + 'capri-wave.webp'],
  ['/standing', assetDir + 'capri-blink-pose.png'],
  ['/eyes', assetDir + 'capri-blink-eyes.png'],
]);
const browser = await chromium.launch({
  channel: process.env.CAPRI_ART_BROWSER || 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.route('http://localhost/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '' });
    const asset = files.get(url.pathname);
    if (asset)
      return route.fulfill({
        contentType: asset.endsWith('.png') ? 'image/png' : 'image/webp',
        body: readFileSync(asset),
      });
    const module = /^\/([a-z-]+\.mjs)$/.exec(url.pathname);
    if (!module) return route.abort();
    return route.fulfill({
      contentType: 'text/javascript',
      body: readFileSync('apps/desktop/renderer/' + module[1]),
    });
  });
  await page.goto('http://localhost/');
  const output = await page.evaluate(
    async ({ poseIds, cels, intro }) => {
      const { buildPoseFacePlate, buildGestureFacePlate, avatarFaceState } = await import(
        '/avatar-face-rig.mjs'
      );
      const { faceFrames } = await import('/avatar-face-expressions.mjs');
      const { prepareLayeredBlink, faceEyeCenters } = await import('/avatar-layered-blink.mjs');
      const canvas = (width, height) =>
        Object.assign(document.createElement('canvas'), { width, height });
      const load = async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      };
      const draw = prepareLayeredBlink(...(await Promise.all(['/standing', '/eyes'].map(load))));
      const atlas = (plates) => {
        const entries = {};
        const columns = 8;
        const width = Math.max(...plates.map(([, { bounds }]) => bounds[2]));
        const height = Math.max(...plates.map(([, { bounds }]) => bounds[3]));
        const sheet = canvas(width * columns, height * Math.ceil(plates.length / columns));
        const context = sheet.getContext('2d');
        plates.forEach(([id, { base, bounds }], i) => {
          const x = (i % columns) * width;
          const y = Math.floor(i / columns) * height;
          entries[id] = [x, y, ...bounds];
          context.drawImage(base, x, y);
        });
        return { entries, png: sheet.toDataURL('image/png').split(',')[1] };
      };
      const posePlates = await Promise.all(
        poseIds.map(async (id) => [id, buildPoseFacePlate(await load('/pose/' + id), id)]),
      );
      const gestures = [];
      const size = 1254;
      const cell = canvas(size, size);
      const context = cell.getContext('2d', { willReadFrequently: true });
      for (const [id, registrations] of Object.entries(cels)) {
        const sheet = await load('/cel/' + id);
        for (const [index, [lx, ly, rx, ry]] of registrations.entries()) {
          const scale = size / 512;
          const eyes = [
            [lx * scale, ly * scale],
            [rx * scale, ry * scale],
          ];
          const keytar = id.startsWith('ledge-keytar');
          const flourish = keytar && index === 3;
          const jaw = flourish
            ? [229, 147]
            : index === 3 && id.startsWith('hang-pullup')
              ? [250, id.endsWith('breakdowns') ? 101 : 83]
              : null;
          const expression = flourish
            ? 'idle-laughing'
            : id.startsWith('hang-wrist-scan') && index > 0
              ? 'idle-look_down'
              : id.startsWith('hang-catch') && index >= 2 && index < 5
                ? 'idle-look_right'
                : id.startsWith('hang-pullup') && index === 3
                  ? 'happy'
                  : 'neutral';
          context.clearRect(0, 0, size, size);
          context.drawImage(
            sheet,
            (index % 3) * 512,
            Math.floor(index / 3) * 512,
            512,
            512,
            0,
            0,
            size,
            size,
          );
          gestures.push([
            id + ':' + index,
            buildGestureFacePlate(cell, eyes, faceFrames[expression], draw, {
              mouth: jaw?.map((point) => point * scale),
              mouthRadius: keytar ? 48 : 36,
              eraseMouth: flourish ? [227 * scale, 142 * scale] : undefined,
              cleanBridge: flourish || undefined,
            }),
          ]);
        }
      }
      for (const [id, [left, right, mouth, expression]] of Object.entries(intro)) {
        const image = await load('/intro/' + id);
        gestures.push([
          'intro:' + id,
          buildGestureFacePlate(image, [left, right], faceFrames[expression], draw, {
            mouth,
            mouthRadius: 48,
          }),
        ]);
      }
      // Wave keeps the same head design. Track the upper bangs through all
      // exposures, so the face also follows frames with both lids shut.
      const decoder = new ImageDecoder({
        type: 'image/webp',
        data: await (await fetch('/wave')).arrayBuffer(),
        preferAnimation: true,
      });
      await decoder.tracks.ready;
      const track = [600, 338, 84, 50];
      const vector = (pixels, i) => pixels[i] > 130 && pixels[i] > 2.1 * pixels[i + 1];
      let template;
      try {
        for (let index = 0; index < decoder.tracks.selectedTrack.frameCount; index++) {
          const { image } = await decoder.decode({ frameIndex: index });
          try {
            const t = image.timestamp / 1000;
            context.clearRect(0, 0, size, size);
            context.drawImage(image, 0, 0, size, size);
            const [x, y, width, height] = track;
            const bufferWidth = width + 16;
            const pixels = context.getImageData(x - 8, y - 8, bufferWidth, height + 16).data;
            const at = (px, py) => vector(pixels, ((py + 8) * bufferWidth + px + 8) * 4);
            template ??= Array.from({ length: width * height }, (_, i) =>
              at(i % width, Math.floor(i / width)),
            );
            let best = Infinity,
              shift;
            for (let dy = -8; dy <= 8; dy++)
              for (let dx = -8; dx <= 8; dx++) {
                let cost = Math.hypot(dx, dy) / 20;
                for (let row = 0; row < height; row += 3)
                  for (let col = 0; col < width; col += 3)
                    cost += Number(at(col + dx, row + dy) !== template[row * width + col]);
                if (cost < best) {
                  best = cost;
                  shift = [dx, dy];
                }
              }
            const eyes = faceEyeCenters.map(([px, py]) => [px + shift[0], py + shift[1]]);
            const expression = t > 450 && t < 2560 ? 'idle-excited' : 'neutral';
            const [clip, time] =
              t <= 370
                ? ['blink', 400 + t * 1.75]
                : t >= 2150 && t < 2540
                  ? ['wink', 360 + (t - 2150) * 1.3]
                  : t >= 2540 && t < 2850
                    ? ['blink', 410 + (t - 2540) * 1.8]
                    : [null, 0];
            const pose = avatarFaceState('neutral', expression, clip, time);
            gestures.push([
              'wave:' + index,
              buildGestureFacePlate(cell, eyes, pose, draw, { mouthRadius: 38 }),
            ]);
          } finally {
            image.close();
          }
        }
      } finally {
        decoder.close();
      }
      return { poses: atlas(posePlates), gestures: atlas(gestures) };
    },
    { poseIds: poses.map(({ id }) => id), cels, intro },
  );
  assert.equal(Object.keys(output.poses.entries).length, poses.length);
  assert.ok(Object.keys(output.gestures.entries).length > Object.keys(cels).length * 6);
  for (const [group, { entries, png }] of Object.entries(output)) {
    const base = assetDir + 'capri-face-' + group;
    writeFileSync(base + '.png', Buffer.from(png, 'base64'));
    writeFileSync(base + '.json', JSON.stringify(entries, null, 2) + '\n');
    console.log(group + ': ' + Object.keys(entries).length + ' registered face plates');
  }
} finally {
  await browser.close();
}
