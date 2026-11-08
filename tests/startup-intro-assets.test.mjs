// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from '../packages/runtime/src/host/paths.mjs';
import {
  ACTIVE_STARTUP_INTRO,
  STARTUP_INTRO_IDS,
  loadStartupIntro,
  startupIntroSnapshot,
  startupIntroSourceFiles,
  validateStartupIntro,
} from '../apps/desktop/startup-intro-assets.mjs';
import { createDesktopResources } from '../apps/desktop/main/resources.mjs';
import { resourceResponse } from '../apps/desktop/main/protocol.mjs';
import { sourceFiles } from '../packages/installer/src/payload.mjs';

const parent = path.join(root, '.runtime/startup-intro-assets-unit');
mkdirSync(parent, { recursive: true });
function fixture() {
  const folder = mkdtempSync(path.join(parent, 'pack-'));
  const files = [...startupIntroSourceFiles(root), 'assets/capri/sprites/v1/capri-neutral.png'];
  for (const name of files) {
    mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    copyFileSync(path.join(root, name), path.join(folder, name));
  }
  const manifest = JSON.parse(readFileSync(path.join(folder, ACTIVE_STARTUP_INTRO), 'utf8'));
  return {
    folder,
    manifest,
    save() {
      writeFileSync(path.join(folder, ACTIVE_STARTUP_INTRO), JSON.stringify(manifest));
    },
  };
}

test('reviewed intro is exactly seven transparent 24 fps frames ending on the unchanged main artwork', () => {
  const intro = validateStartupIntro(root);
  assert.equal(intro.durationMs, 3000);
  assert.equal(intro.fps, 24);
  assert.deepEqual(
    intro.frames.map((frame) => frame.id),
    STARTUP_INTRO_IDS,
  );
  assert.deepEqual(
    readFileSync(intro.frames.at(-1).file),
    readFileSync(path.join(root, 'assets/capri/sprites/v1/capri-neutral.png')),
  );
  const snapshot = startupIntroSnapshot(intro);
  assert.equal(JSON.stringify(snapshot).includes(root), false);
  assert.ok(snapshot.frames.every((frame) => !('file' in frame) && !('sha256' in frame)));
});

test('desktop protocol exposes exact reviewed intro PNGs, never authoring material', async () => {
  const intro = loadStartupIntro(root);
  const resources = createDesktopResources({
    root,
    directory: path.join(root, 'apps/desktop'),
    catalog: { portraitFrames: [] },
    spriteFile: intro.frames.at(-1).file,
    startupIntro: intro,
  });
  for (const frame of intro.frames) {
    const response = resourceResponse({ url: frame.url, method: 'GET' }, resources);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(frame.file));
  }
  for (const url of [
    'capri://desktop/intro/runtime-intro.json',
    'capri://desktop/intro/prompts.txt',
    'capri://desktop/intro/originals/01-signal.png',
    'capri://desktop/intro/animatic.mp4',
    'capri://desktop/intro/01-signal.png?source=original',
  ])
    assert.equal(resourceResponse({ url, method: 'GET' }, resources).status, 404);
});

test('missing or damaged optional intro disables itself without breaking desktop resources', () => {
  const pack = fixture();
  unlinkSync(path.join(pack.folder, ACTIVE_STARTUP_INTRO));
  assert.equal(loadStartupIntro(pack.folder), null);
  const resources = createDesktopResources({
    root: pack.folder,
    directory: path.join(root, 'apps/desktop'),
    catalog: { portraitFrames: [] },
    spriteFile: path.join(root, 'assets/capri/sprites/v1/capri-neutral.png'),
  });
  assert.equal(resources.has('/intro/01-signal.png'), false);
  assert.equal(resources.has('/sprite.png'), true);
  const broken = fixture();
  writeFileSync(path.join(broken.folder, 'assets/capri/intro-v1/PNG/03-arrival.png'), 'not a PNG');
  assert.equal(loadStartupIntro(broken.folder), null);
  assert.throws(() => startupIntroSourceFiles(broken.folder), /verification failed/);
});

test('manifest paths, order, timing and image format cannot widen the intro boundary', () => {
  for (const change of [
    (m) => {
      m.frames[0].file = '../originals/01-signal.png';
    },
    (m) => {
      m.frames.reverse();
    },
    (m) => {
      m.frames[0].ms = 4000;
    },
    (m) => {
      m.frames[0].ms++;
    },
    (m) => {
      m.frames[0].visibleBounds.width = 5000;
    },
    (m) => {
      m.canvas.width = 4096;
    },
  ]) {
    const pack = fixture();
    change(pack.manifest);
    pack.save();
    assert.equal(loadStartupIntro(pack.folder), null);
  }
  const format = fixture();
  const name = path.join(format.folder, 'assets/capri/intro-v1/PNG/01-signal.png');
  const bytes = readFileSync(name);
  bytes[25] = 2;
  writeFileSync(name, bytes);
  format.manifest.frames[0].sha256 = createHash('sha256').update(bytes).digest('hex');
  format.save();
  assert.equal(
    loadStartupIntro(format.folder),
    null,
    'Opaque RGB input is not a transparent sprite',
  );
});

test('changed final pose fails closed while public metadata stays minimal', () => {
  const changed = fixture();
  const previous = path.join(changed.folder, 'assets/capri/intro-v1/PNG/06-wink.png');
  const last = path.join(changed.folder, 'assets/capri/intro-v1/PNG/07-ready.png');
  copyFileSync(previous, last);
  changed.manifest.frames.at(-1).sha256 = createHash('sha256')
    .update(readFileSync(last))
    .digest('hex');
  changed.save();
  assert.equal(loadStartupIntro(changed.folder), null);
  const extra = fixture();
  extra.manifest.canvas.privatePath = 'unreviewed';
  extra.manifest.frames[0].visibleBounds.prompt = 'unreviewed';
  extra.save();
  assert.equal(
    loadStartupIntro(extra.folder),
    null,
    'Authoring metadata is not valid runtime configuration',
  );
  const descriptor = validateStartupIntro(root);
  descriptor.frames[0].privatePath = 'unreviewed';
  assert.equal(JSON.stringify(startupIntroSnapshot(descriptor)).includes('unreviewed'), false);
});

test('hardlinked intro frames cannot introduce data outside the reviewed pack', (t) => {
  const linked = fixture();
  const original = path.join(linked.folder, 'assets/capri/intro-v1/PNG/01-signal.png');
  const outside = path.join(linked.folder, 'outside.png');
  copyFileSync(original, outside);
  unlinkSync(original);
  try {
    linkSync(outside, original);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('This environment does not permit creating filesystem links.');
      return;
    }
    throw error;
  }
  assert.equal(loadStartupIntro(linked.folder), null);
});

test('source and installer payload contain only the minimal reviewed intro pack', () => {
  const exported = sourceFiles(root).filter((name) => name.startsWith('assets/capri/intro-v1/'));
  assert.deepEqual(exported, [...startupIntroSourceFiles(root)].sort());
  assert.equal(exported.length, 8);
  assert.ok(
    exported.every((name) => !/(?:originals|prompts|preview|validation|\.zip|\.mp4)/i.test(name)),
  );
});
