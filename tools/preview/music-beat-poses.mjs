// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { gripArt } from '../../apps/desktop/renderer/music-grip-art.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, '../assets/capri/media/beat-sway'));
const temp = await mkdtemp(path.join(os.tmpdir(), 'capri-beat-'));
const renderer = path.join(root, 'apps/desktop/renderer');
const assets = path.join(root, 'assets/default');
const catalog = requireCapriAvatar(root);
const poses = [
  ['neutral', 'Стоя', 'Вес переходит с ноги на ногу. Плечи и руки подхватывают ритм.'],
  ['pose-sit-edge', 'На краю окна', 'Капри кивает на удар и отбивает ритм свободной ногой.'],
  ['pose-sit-floor', 'Сидя на полу', 'Корпус качается влево и вправо над скрещёнными ногами.'],
  ['pose-crouch', 'На корточках', 'На каждый удар Капри чуть глубже приседает.'],
  ['pose-ceiling', 'Вис на руках', 'Корпус раскачивается под неподвижным хватом.'],
  [
    'pose-ceiling-upside-down',
    'Вниз головой',
    'Капри раскачивается вокруг опоры у ног. Голова следует за корпусом.',
  ],
  ['pose-dock-left', 'На левой стене', 'Плечо опускается в такт, корпус мягко отходит от стены.'],
  [
    'pose-dock-right',
    'На правой стене',
    'Капри переносит вес от правой стены и возвращается к ней.',
  ],
  ['music-window', 'В наушниках у окна', 'Кивок приходится на удар, свободная нога догоняет его.'],
  [
    'music-floor',
    'В наушниках на полу',
    'Глубокий кивок сочетается с покачиванием из стороны в сторону.',
  ],
  ['pose-sleep', 'Во сне', 'Спокойный вдох и выдох занимают четыре доли.'],
];
const files = new Map([
  ...Object.keys(gripArt).map((id) => [
    '/music-grip-plates/' + id + '.png',
    path.join(assets, 'music-grip-plates', id + '.png'),
  ]),
  ...poses.map(([id]) => ['/pose/' + id, catalog.frames.find((frame) => frame.id === id).file]),
  ...['pose', 'eyes'].map((layer) => [
    '/avatar-blink-' + layer + '.png',
    path.join(assets, 'capri-blink-' + layer + '.png'),
  ]),
  ...['png', 'json'].map((ext) => [
    '/avatar-face-poses.' + ext,
    path.join(assets, 'capri-face-poses.' + ext),
  ]),
]);
const browser = await chromium.launch({
  channel: process.env.CAPRI_BROWSER || 'msedge',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.route('http://capri.test/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    if (url === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    if (/^\/[\w-]+\.mjs$/.test(url))
      return route.fulfill({
        contentType: 'application/javascript',
        path: path.join(
          url === '/avatar-pose-motion.mjs' ? path.dirname(renderer) : renderer,
          url.slice(1),
        ),
      });
    return files.has(url)
      ? route.fulfill({
          contentType: url.endsWith('.json') ? 'application/json' : 'image/png',
          path: files.get(url),
        })
      : route.abort();
  });
  await page.goto('http://capri.test/');
  await page.evaluate(async () => {
    const { loadAvatarFaceRig, composeAvatarFace, avatarFaceState } = await import(
      '/avatar-face-rig.mjs'
    );
    const { beatPoseChannels } = await import('/music-beat-motion.mjs');
    const { MusicPoseLayer } = await import('/music-animation.mjs');
    const { gripArt } = await import('/music-grip-art.mjs');
    const rig = await loadAvatarFaceRig();
    const layer = new MusicPoseLayer(640);
    window.selectPose = async (id) => {
      if (Object.hasOwn(gripArt, id)) await layer.gripFor(id).atlas.decode();
      const image = new Image();
      image.src = '/pose/' + id;
      await image.decode();
      const source = composeAvatarFace(image, rig(image, id), avatarFaceState(id));
      source.avatarTextureRevision = 1;
      window.framePng = (index) => {
        const state = {
          active: true,
          frameId: id,
          frame: index,
          angle: 0,
          channels: beatPoseChannels(id, index / 12),
        };
        const canvas = layer.image(source, state);
        if (canvas === source || !(layer.mesh || layer.grip?.id === id))
          throw Error('Could not render the articulated rig');
        return canvas.toDataURL('image/png').split(',')[1];
      };
    };
  });
  const clips = path.join(output, 'clips');
  await mkdir(clips, { recursive: true });
  const plates = path.join(output, 'layers');
  await mkdir(plates, { recursive: true });
  const selected = process.argv.slice(3);
  for (const [id] of poses.filter(([id]) => !selected.length || selected.includes(id))) {
    await page.evaluate((id) => window.selectPose(id), id);
    if (Object.hasOwn(gripArt, id)) {
      const plate = await page.evaluate(async (id) => {
        const image = new Image();
        image.src = '/music-grip-plates/' + id + '.png';
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 920;
        canvas.height = 625;
        canvas.getContext('2d').drawImage(image, 165, 45, 920, 625, 0, 0, 920, 625);
        return canvas.toDataURL().split(',')[1];
      }, id);
      await writeFile(path.join(plates, id + '.png'), Buffer.from(plate, 'base64'));
    }
    for (let i = 0; i < 48; i++) {
      const png = await page.evaluate((index) => window.framePng(index), i);
      await writeFile(
        path.join(temp, String(i).padStart(2, '0') + '.png'),
        Buffer.from(png, 'base64'),
      );
    }
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-framerate',
      '24',
      '-i',
      path.join(temp, '%02d.png'),
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p',
      '-crf',
      '18',
      '-b:v',
      '0',
      '-row-mt',
      '1',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-auto-alt-ref',
      '0',
      path.join(clips, id + '.webm'),
    ];
    execFileSync('ffmpeg', args);
    console.log(id);
  }
  const html = await readFile(new URL('./music-beat-poses.html', import.meta.url), 'utf8');
  assert.ok(html.includes('/*POSES*/[]'));
  await writeFile(
    path.join(output, 'index.html'),
    html.replace('/*POSES*/[]', JSON.stringify(poses)),
  );
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}
