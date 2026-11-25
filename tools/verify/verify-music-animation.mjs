// SPDX-License-Identifier: GPL-3.0-only
// Real renderer, reviewed artwork and local protocol only. No microphone,
// system-audio device, model, external service or owner history is opened.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = process.cwd(),
  directory = path.join(root, '.runtime/music-animation-verification');
mkdirSync(directory, { recursive: true });
const folder = mkdtempSync(path.join(directory, 'fixture-'));
const entry = path.join(folder, 'fixture-main.mjs');
const fileImport = (file) => JSON.stringify(pathToFileURL(path.join(root, file)).href);
writeFileSync(
  entry,
  `
import { app, BrowserWindow, protocol } from 'electron';
import { writeFileSync } from 'node:fs';
import { requireCapriAvatar } from ${fileImport('apps/desktop/avatar-catalog.mjs')};
import { createDesktopResources } from ${fileImport('apps/desktop/main/resources.mjs')};
import { resourceResponse } from ${fileImport('apps/desktop/main/protocol.mjs')};
protocol.registerSchemesAsPrivileged([{ scheme: 'capri', privileges: { secure: true, standard: true, supportFetchAPI: true } }]);
app.setPath('userData', ${JSON.stringify(path.join(folder, 'profile'))});
process.on('uncaughtException',error=>{writeFileSync(${JSON.stringify(path.join(folder, 'fixture-error.txt'))},error.stack||error.message);app.exit(1);});
app.whenReady().then(async () => {
const root = ${JSON.stringify(root)}, catalog = requireCapriAvatar(root);
const resources = createDesktopResources({ root, directory: root + '/apps/desktop', catalog, spriteFile: catalog.sprites[0].file });
if (!resources.has('/music-animation.mjs')) throw Error('The real renderer resource allowlist must include music-animation.mjs.');
for (const note of catalog.musicNotes) if (!resources.has(new URL(note.url).pathname)) throw Error('The real resource allowlist must include reviewed music notes.');
protocol.handle('capri', (request) => resourceResponse(request, resources));
const window = new BrowserWindow({ width: 1000, height: 900, show: false, backgroundColor: '#08131d', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
await window.loadURL('capri://desktop/avatar-detach.html');
window.showInactive();
}).catch(error=>{writeFileSync(${JSON.stringify(path.join(folder, 'fixture-error.txt'))},error.stack||error.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
`,
);
const report = {
  passed: false,
  folder,
  checks: [],
  microphone: false,
  systemAudio: false,
  providerRequests: false,
  ownerHistory: false,
};
let application;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(globalThis.capriAvatarDetach));
  await page.evaluate(async () => {
    const { MusicAnimation } = await import('./music-animation.mjs');
    const sample = MusicAnimation.prototype.sample;
    MusicAnimation.prototype.sample = function (now, options) {
      const value = sample.call(this, now, options);
      if (window.musicTempoTrace)
        window.musicTempoTrace.push({
          at: now,
          phase: value.beatPhase,
          angle: value.angle,
          notes: value.notes.length,
          tempo: options.tempo,
        });
      return value;
    };
  });
  const gpu = await page.evaluate(async () => {
    const { createRenderer } = await import('./idle-gesture-rig.mjs');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    const live = new Set();
    let peak = 0;
    const create = gl.createTexture.bind(gl),
      remove = gl.deleteTexture.bind(gl);
    gl.createTexture = () => {
      const tex = create();
      live.add(tex);
      peak = Math.max(peak, live.size);
      return tex;
    };
    gl.deleteTexture = (tex) => {
      live.delete(tex);
      remove(tex);
    };
    const renderer = createRenderer(canvas, {}, { grid: 8 });
    const source = document.createElement('canvas');
    source.width = source.height = 4;
    const ctx = source.getContext('2d');
    const urls = Array.from({ length: 18 }, (_, index) => 'fixture-artwork-' + index);
    const draw = async (url) => {
      ctx.fillStyle = 'rgb(' + (220 - urls.indexOf(url)) + ',0,0)';
      ctx.fillRect(0, 0, 4, 4);
      const image = await createImageBitmap(source);
      try {
        image.src = url;
        renderer.draw(image, {});
      } finally {
        image.close();
      }
    };
    try {
      for (const url of urls) await draw(url);
      const latest = [...live].at(-1);
      await draw(urls.at(-1));
      const reused = latest === [...live].at(-1);
      await draw(urls[0]); // Re-upload the evicted image.
      const rgba = new Uint8Array(4);
      gl.readPixels(12, 12, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      renderer.dispose();
      renderer.dispose();
      return { peak, retained: live.size, reused, pixel: [...rgba], error: gl.getError() };
    } finally {
      renderer.dispose();
    }
  });
  assert.deepEqual(gpu, { peak: 12, retained: 0, reused: true, pixel: [220, 0, 0, 255], error: 0 });
  report.checks.push('WebGL evicts, reuses and frees textures, including a redrawn evicted pose');
  const sample = async () =>
    page.evaluate(() => {
      const stage = document.querySelector('.avatar-pose-stage'),
        matrix = new DOMMatrix(getComputedStyle(stage).transform);
      const notes = [...document.querySelectorAll('canvas')].find(
        (canvas) => canvas.style.zIndex === '14',
      );
      const mouth = document.querySelector('.avatar-mouth-plate');
      return {
        image: document.querySelector('#parked-avatar img').src,
        rotation: Math.atan2(matrix.b, matrix.a),
        bodyFrame: stage.hasAttribute('data-beat-body')
          ? stage.querySelector('.avatar-beat-body')?.avatarTextureRevision
          : null,
        axisX: Math.hypot(matrix.a, matrix.b),
        axisY: Math.hypot(matrix.c, matrix.d),
        dot: matrix.a * matrix.c + matrix.b * matrix.d,
        noteVisible: Boolean(notes && !notes.hidden),
        notePixels: notes ? notes.width * notes.height : 0,
        mouthVisible: Boolean(mouth && !mouth.hidden),
        facePlates: document.querySelectorAll('.avatar-headpat-plate').length,
        hearts: document.querySelectorAll('.avatar-headpat-hearts i').length,
      };
    });
  for (const variant of ['window', 'floor']) {
    await page.evaluate(async (variant) => {
      const anchor =
        variant === 'window' ? { x: 628 / 1254, y: 771 / 1254 } : { x: 641 / 1254, y: 1164 / 1254 };
      await capriAvatarDetach.park({
        point: { x: 500, y: variant === 'window' ? 510 : 810, scale: 700 },
        anchor,
        url: `capri://desktop/sprites/music-${variant}.png`,
        dock: variant === 'window' ? 'seat' : 'ground',
      });
      capriAvatarDetach.setMusic({
        enabled: true,
        hearingMusic: true,
        energy: 0.75,
        tempo: 60,
        tempoConfidence: 1,
        beatAt: 0,
        notes: true,
        motion: true,
      });
    }, variant);
    await page.waitForTimeout(1100);
    const first = await sample();
    await page.waitForTimeout(270);
    const second = await sample();
    assert.equal(
      first.image,
      second.image,
      'The body drawing must not flicker between regenerated PNGs.',
    );
    assert(first.noteVisible && second.noteVisible);
    assert(first.notePixels <= 1_049_600);
    assert(
      Math.abs(first.axisX - 1) < 0.00001 &&
        Math.abs(first.axisY - 1) < 0.00001 &&
        Math.abs(first.dot) < 0.00001,
      'The pose container must retain its scale while the mesh moves.',
    );
    assert(
      first.bodyFrame > 0 && second.bodyFrame > first.bodyFrame,
      'The visible pose mesh advances.',
    );
    await page.screenshot({ path: path.join(folder, `music-${variant}.png`) });
    report.checks.push(`${variant} pose mesh animates while notes move independently`);
    for (const gesture of ['headpat', 'pulse']) {
      await page.evaluate((gesture) => {
        const observed = (window.musicTapFixture = { facePlates: 0, sparks: 0 });
        observed.observer = new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === 'childList') {
              for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                observed.facePlates += Number(node.matches('.avatar-headpat-plate'));
                observed.sparks += Number(node.id === 'avatar-tap');
              }
            }
          }
        });
        observed.observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
        capriAvatarDetach[gesture]({ x: 500, y: 450, count: 1, tone: 'curious' });
      }, gesture);
      await page.locator('.avatar-headpat-hearts i').first().waitFor({ state: 'visible' });
      const during = await sample();
      await page.waitForTimeout(270);
      const later = await sample();
      assert.equal(during.image, first.image);
      assert.equal(later.image, first.image);
      assert.equal(during.hearts, 4);
      assert.equal(during.facePlates, 0);
      assert(during.noteVisible && later.noteVisible);
      assert(later.bodyFrame > during.bodyFrame, 'Music keeps moving during tap hearts.');
      assert(
        Math.abs(later.axisX - 1) < 0.00001 &&
          Math.abs(later.axisY - 1) < 0.00001 &&
          Math.abs(later.dot) < 0.00001,
      );
      await page.locator('.avatar-headpat-hearts').waitFor({ state: 'detached' });
      assert.deepEqual(
        await page.evaluate(() => {
          const { observer, ...observed } = window.musicTapFixture;
          observer.disconnect();
          delete window.musicTapFixture;
          return observed;
        }),
        { facePlates: 0, sparks: 0 },
      );
    }
    report.checks.push(
      `${variant} head and body taps add hearts and preserve the moving pose and notes`,
    );
    await page.evaluate(() => capriAvatarDetach.setMouth('wide'));
    const speaking = await sample();
    assert(
      !speaking.mouthVisible && speaking.bodyFrame > 0,
      'Dedicated music artwork keeps its original resting face during speech.',
    );
    await page.evaluate(() => capriAvatarDetach.setMouth('closed'));
    for (const tempo of [60, 120]) {
      await page.evaluate(
        (tempo) =>
          capriAvatarDetach.setMusic({
            enabled: true,
            hearingMusic: true,
            energy: 0.75,
            tempo,
            tempoConfidence: 1,
            beatAt: 0,
            notes: true,
            motion: true,
          }),
        tempo,
      );
      await page.waitForTimeout(2200);
      await page.evaluate(() => {
        window.musicTempoTrace = [];
      });
      await page.waitForTimeout(1600);
      const trace = await page.evaluate(() => {
        const trace = window.musicTempoTrace;
        window.musicTempoTrace = null;
        return trace;
      });
      assert(trace.length > 10);
      assert(
        trace.every(
          (frame) => frame.tempo === tempo && Number.isFinite(frame.phase) && frame.notes <= 7,
        ),
      );
      let beats = 0;
      for (let index = 1; index < trace.length; index++)
        beats += (trace[index].phase - trace[index - 1].phase + 1) % 1;
      const observed = (beats * 60000) / (trace.at(-1).at - trace[0].at);
      assert(Math.abs(observed - tempo) < 3, variant + ' music follows ' + tempo + ' BPM');
      assert(new Set(trace.map((frame) => frame.angle)).size > 3);
      report.checks.push(`${variant} measured ${tempo} BPM advances at ${observed.toFixed(2)} BPM`);
    }
  }
  report.checks.push('both dedicated music poses retain their painted face during speech');
  await page.evaluate(() =>
    capriAvatarDetach.setMusic({
      enabled: true,
      hearingMusic: true,
      energy: 0.75,
      tempo: 0,
      tempoConfidence: 0,
      beatAt: 0,
      notes: true,
      motion: true,
    }),
  );
  await page.waitForTimeout(3300);
  const unknown = await sample();
  assert.equal(unknown.noteVisible, false);
  assert(Math.abs(unknown.rotation) <= (0.1 * Math.PI) / 180);
  report.checks.push('unknown tempo remains calm without invented beat particles');
  await page.evaluate(() =>
    capriAvatarDetach.setMusic({
      enabled: true,
      hearingMusic: true,
      energy: 0.75,
      tempo: 112,
      notes: true,
      motion: false,
    }),
  );
  // Unknown tempo stopped particle births. Allow the first newly measured beat.
  await page.waitForTimeout(1100);
  const notesOnly = await sample();
  assert.equal(notesOnly.bodyFrame, null);
  assert.equal(
    notesOnly.noteVisible,
    true,
    'Flying notes can remain enabled when body motion is off',
  );
  await page.evaluate(() =>
    capriAvatarDetach.setMusic({
      enabled: true,
      hearingMusic: true,
      energy: 0.75,
      tempo: 112,
      notes: false,
      motion: true,
    }),
  );
  await page.waitForTimeout(160);
  const motionOnly = await sample();
  assert(motionOnly.bodyFrame > 0);
  assert.equal(motionOnly.noteVisible, false, 'Body motion can remain enabled when notes are off');
  report.checks.push('body motion and flying notes can each be disabled independently');
  await page.evaluate(() =>
    capriAvatarDetach.setMusic({
      enabled: true,
      hearingMusic: true,
      energy: 0.75,
      tempo: 112,
      notes: true,
      motion: true,
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  const reduced = await sample();
  assert(Math.abs(reduced.rotation) < 1e-7);
  assert.equal(reduced.noteVisible, false);
  await page.evaluate(() => capriAvatarDetach.headpat({ x: 500, y: 450 }));
  await page.locator('.avatar-headpat-hearts i').first().waitFor({ state: 'visible' });
  assert.equal((await sample()).facePlates, 0);
  assert.equal(
    await page
      .locator('.avatar-headpat-hearts i')
      .first()
      .evaluate((heart) => getComputedStyle(heart).animationName),
    'avatar-headpat-heart-still',
  );
  await page.screenshot({ path: path.join(folder, 'music-reduced-motion.png') });
  report.checks.push('reduced motion keeps the pose static and removes flying notes');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() =>
    capriAvatarDetach.setStatus({ text: 'Sleeping', color: '#8ef5ed', sleeping: true }),
  );
  await page.waitForTimeout(1600);
  const sleeping = await sample();
  assert.equal(sleeping.noteVisible, false);
  assert(Math.abs(sleeping.rotation) < 1e-7);
  await page.evaluate(() => {
    capriAvatarDetach.headpat({ x: 500, y: 450 });
    capriAvatarDetach.pulse({ x: 500, y: 450, count: 1, tone: 'curious' });
  });
  assert.equal((await sample()).hearts, 0);
  report.checks.push('sleep stops musical movement and particles');
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await application?.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
