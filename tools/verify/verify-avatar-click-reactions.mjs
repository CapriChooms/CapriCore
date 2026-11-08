// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { avatarBodyPartAt, avatarParts } from '../../apps/desktop/avatar-body-regions.mjs';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { avatarDockFrame } from '../../apps/desktop/avatar-docking.mjs';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime', 'desktop-verification');
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(path.join(parent, 'avatar-reactions-'));
const entry = path.join(fixture, 'test-main.mjs');
const voiceHost = path.join(fixture, 'test-voice-host.mjs');
writeFileSync(
  voiceHost,
  `
export const companionVoiceSettings = () => ({
  port: Number(process.env.CAPRI_DESKTOP_VERIFICATION_PORT),
  profileDir: 'avatar-click-fixture',
});
export const companionVoiceUrl = () => 'http://127.0.0.1:' + companionVoiceSettings().port;
export const companionVoiceHeaders = () => ({});
export const companionVoiceInstalled = () => true;
export const startCompanionVoice = async () => {};
`,
);
writeFileSync(
  entry,
  `
import { registerHooks } from 'node:module';
import { app, BrowserWindow } from 'electron';
import { companionVoiceUrl } from './test-voice-host.mjs';
import { AvatarDetach } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main/avatar-detach.mjs')).href)};

const visible = new WeakSet();
if (!process.argv.includes('--music-taps-only')) {
  BrowserWindow.prototype.show = BrowserWindow.prototype.showInactive = function () { visible.add(this); };
  BrowserWindow.prototype.isVisible = function () { return visible.has(this); };
}
const leave = AvatarDetach.prototype.leave;
AvatarDetach.prototype.leave = function (...args) {
  globalThis.avatarFixture = this;
  return leave.apply(this, args);
};

// Keep the real VoiceService queue without starting a local model or reading its credentials.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    return resolved.url === ${JSON.stringify(pathToFileURL(path.join(root, 'integrations/voice_runtime/host.mjs')).href)}
      ? { ...resolved, url: ${JSON.stringify(pathToFileURL(voiceHost).href)} }
      : resolved;
  },
});
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  if (new URL(input).pathname === '/api/chat')
    input = companionVoiceUrl() + '/api/chat';
  return realFetch(input, options);
};
try {
  await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
} catch (error) {
  console.error(error);
  app.exit(1);
}
`,
);

const bodyReply = 'Hey, easy with the poking.';
const headReply = 'Okay, my hair is officially a mess.';
const requests = [];
const synthesis = [];
const sampleRate = 24000;
const pcm = Buffer.alloc((sampleRate / 4) * Float32Array.BYTES_PER_ELEMENT);
const gateway = createServer(async (request, response) => {
  if (request.url === '/v1/models')
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
  if (
    request.method !== 'POST' ||
    !['/prepare', '/cancel', '/synthesize', '/api/chat'].includes(request.url)
  )
    return response.writeHead(404).end();
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  if (request.url === '/prepare' || request.url === '/cancel') return response.writeHead(204).end();
  if (request.url === '/synthesize') {
    synthesis.push(payload);
    return response
      .writeHead(200, { 'content-type': 'application/octet-stream', 'x-sample-rate': sampleRate })
      .end(pcm);
  }
  requests.push(payload);
  const content = payload.messages[1].content.includes('patted') ? headReply : bodyReply;
  response
    .writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ message: { content } }));
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const port = gateway.address().port;
const overlayUrl = 'capri://desktop/avatar-detach.html';
const rt = runtime({
  stateDir: path.join(fixture, 'openclaw'),
  workspace: path.join(fixture, 'workspace'),
  gatewayPort: port,
});

async function spritePoints(page, selector, attached = false) {
  const { clear, candidates, poseId } = await page.evaluate(
    async ({ selector, attached }) => {
      const { CRT_CURVATURE, screenSample } = await import('./screen-geometry.mjs');
      const image = document.querySelector(selector);
      const region = attached ? document.querySelector('#sprite-region') : image;
      const { x, y, width, height } = image.getBoundingClientRect();
      let lens;
      if (attached && document.body.dataset.crt === 'webgl') {
        const frame = document.querySelector('#portrait-panel').getBoundingClientRect();
        lens = {
          x: frame.x + 12,
          y: frame.y + 14,
          width: frame.width - 24,
          height: frame.height - 44,
          curve: CRT_CURVATURE,
        };
      }
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const at = (u, v) =>
        alpha[
          (Math.floor(v * canvas.height) * canvas.width + Math.floor(u * canvas.width)) * 4 + 3
        ];
      const candidates = [];
      let clear;
      for (let v = 0.16; v < 0.94; v += 0.012) {
        for (let u = 0.07; u < 0.94; u += 0.012) {
          const point = { x: Math.round(x + u * width), y: Math.round(y + v * height) };
          if (attached && !region.contains(document.elementFromPoint(point.x, point.y))) continue;
          const projected = screenSample(point, lens);
          const sourceX = (projected.x - x) / width;
          const sourceY = (projected.y - y) / height;
          const radius = sourceY > 0.605 ? 0.003 : 0.008;
          const offsets = [-radius, 0, radius];
          const samples = offsets.flatMap((dy) =>
            offsets.map((dx) => at(sourceX + dx, sourceY + dy)),
          );
          if (samples.every((value) => value >= 230))
            candidates.push({ point, u: sourceX, v: sourceY });
          if ((sourceX < 0.11 || sourceX > 0.91) && samples.every((value) => value === 0))
            clear ??= point;
        }
      }
      const poseId = /\/sprites\/(music-(?:floor|window))\.png$/.exec(image.src)?.[1];
      return { clear, candidates, poseId };
    },
    { selector, attached },
  );
  const points = { clear };
  for (const { point, u, v } of candidates) {
    const part = avatarBodyPartAt(u, v, () => true, { poseId });
    // Favor the crown away from pose-dependent edges so repeated headpats stay in the same region.
    if (!poseId && part === 'head' && !(v < 0.28 && u > 0.42 && u < 0.61)) continue;
    points[part] ??= point;
  }
  const bodyPart = ['torso', 'right-arm', 'left-arm', 'right-hand', 'left-hand'].find(
    (part) => points[part],
  );
  return { ...points, body: points[bodyPart], bodyPart };
}

async function verifyFramedMusicTaps(app, page) {
  const originalMusic = (await page.evaluate(() => window.capri.bootstrap())).musicListening;
  const sendMusic = (state) =>
    app.evaluate(({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
        .webContents.send('capri:event', { type: 'music.status', ...state });
    }, state);
  if ((await page.evaluate(() => document.body.dataset.avatarDetach)) !== 'attached') {
    await page.locator('#avatar-detach').click({ force: true });
    await page.waitForFunction(() => document.body.dataset.avatarDetach === 'attached');
  }
  await sendMusic({
    enabled: true,
    hearingMusic: true,
    phase: 'listening',
    energy: 0.75,
    tempo: 120,
    tempoConfidence: 1,
    beatAt: Date.now(),
    settings: { enabled: true, motion: true, notes: true },
  });
  await page.waitForFunction(
    () => document.querySelector('#sprite').dataset.frame === 'music-floor',
  );
  await page.evaluate(async () => {
    const { MusicAnimation } = await import('./music-animation.mjs');
    const sample = MusicAnimation.prototype.sample;
    window.__musicTapFixture = { sample, samples: [], frames: [], reactions: [], parts: [] };
    window.__musicTapFixture.unsubscribe = window.capri.onEvent((event) => {
      if (event.type === 'avatar.tap') window.__musicTapFixture.parts.push(event.part);
    });
    MusicAnimation.prototype.sample = function (...args) {
      const value = sample.apply(this, args);
      window.__musicTapFixture.samples.push({
        listening: value.listening,
        frameId: value.frameId,
        angle: value.angle,
        notes: value.notes.length,
      });
      return value;
    };
  });
  await page.waitForFunction(() =>
    window.__musicTapFixture.samples.some((sample) => sample.notes > 0),
  );
  await page.evaluate(() => {
    const fixture = window.__musicTapFixture;
    fixture.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') fixture.frames.push(record.target.dataset.frame);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('.avatar-headpat-plate, .avatar-tap-spark'))
            fixture.reactions.push(node.className);
        }
      }
    });
    fixture.observer.observe(document.getElementById('avatar-viewport'), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-frame'],
    });
  });
  try {
    for (const part of ['head', 'body']) {
      const points = await spritePoints(page, '#sprite', true);
      assert.ok(points[part], 'Music pose has an opaque ' + part + ' click target.');
      await page.mouse.move(points[part].x, points[part].y);
      await page.evaluate(() => {
        window.__musicTapFixture.samples = [];
      });
      await page.mouse.down();
      await delay(160);
      const held = await page.evaluate(() => ({
        frame: document.querySelector('#sprite').dataset.frame,
        samples: window.__musicTapFixture.samples,
      }));
      assert.equal(held.frame, 'music-floor', 'A stationary press keeps the music pose.');
      assert(held.samples.length >= 1, 'The held press receives a real music animation tick.');
      assert(held.samples.every((sample) => sample.listening && sample.frameId === 'music-floor'));
      await page.mouse.up();
      await page.locator('.avatar-headpat-hearts i').first().waitFor({ state: 'visible' });
      await page.evaluate(() => {
        window.__musicTapFixture.samples = [];
      });
      await delay(350);
      const during = await page.evaluate(() => ({
        frame: document.querySelector('#sprite').dataset.frame,
        activity: document.body.dataset.activity,
        plateCount: document.querySelectorAll('.avatar-headpat-plate').length,
        heartCount: document.querySelectorAll('.avatar-headpat-hearts i').length,
        samples: window.__musicTapFixture.samples,
        frames: window.__musicTapFixture.frames,
        reactions: window.__musicTapFixture.reactions,
        lastPart: window.__musicTapFixture.parts.at(-1),
      }));
      assert.equal(during.frame, 'music-floor');
      assert.equal(during.activity, 'Music listening');
      assert.equal(during.plateCount, 0);
      assert.equal(during.heartCount, 4);
      assert.equal(during.lastPart, part === 'head' ? 'head' : points.bodyPart);
      assert(during.samples.length >= 2);
      assert(
        during.samples.every((sample) => sample.listening && sample.frameId === 'music-floor'),
      );
      assert(new Set(during.samples.map((sample) => sample.angle)).size > 1);
      assert(during.samples.some((sample) => sample.notes > 0));
      assert(during.frames.every((frame) => frame === 'music-floor'));
      assert.deepEqual(during.reactions, []);
      await page.locator('.avatar-headpat-hearts').waitFor({ state: 'detached' });
    }
  } finally {
    await page.evaluate(async () => {
      const { MusicAnimation } = await import('./music-animation.mjs');
      const fixture = window.__musicTapFixture;
      MusicAnimation.prototype.sample = fixture.sample;
      fixture.unsubscribe();
      fixture.observer.disconnect();
      delete window.__musicTapFixture;
    });
    await sendMusic(originalMusic);
  }
}

async function verifyRasterRegions(page) {
  const catalog = requireCapriAvatar(root);
  const frames = [...new Set([...catalog.portraitFrames, ...catalog.desktopPoseFrames])].map(
    ({ id, url, kind }) => ({
      url,
      poseId: ['reviewed_pose', 'reviewed_music'].includes(kind) ? id : undefined,
    }),
  );
  const missing = await page.evaluate(
    async ({ frames, parts }) => {
      const { avatarBodyPartAt } = await import('./avatar-body-regions.mjs');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const gaps = [];
      for (const { url, poseId } of frames) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const width = (canvas.width = image.naturalWidth);
        const height = (canvas.height = image.naturalHeight);
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, width, height);
        const found = new Set();
        const opaque = (x, y) =>
          data[(Math.floor(y * height) * width + Math.floor(x * width)) * 4 + 3] >= 230;
        for (let y = 1; y < height && found.size < parts.length; y += 4) {
          for (let x = 1; x < width && found.size < parts.length; x += 4) {
            const part = avatarBodyPartAt(x / width, y / height, opaque, {
              poseId,
              reducedMotion: true,
            });
            if (part) found.add(part);
          }
        }
        const absent = parts.filter((part) => !found.has(part));
        if (absent.length) gaps.push({ url, absent });
      }
      return gaps;
    },
    { frames, parts: Object.keys(avatarParts).filter((part) => part !== 'body') },
  );
  assert.deepEqual(missing, []);
  return frames.length;
}

async function verifyHeadpat(page, sprite, animationName) {
  await page.waitForFunction(
    (sprite) => Boolean(document.querySelector(sprite + ' + .avatar-headpat-plate:not([hidden])')),
    sprite,
  );
  const hearts = page.locator('.avatar-headpat-hearts i');
  assert.equal(await hearts.count(), 4);
  assert.equal(
    await hearts.first().evaluate((element) => getComputedStyle(element).animationName),
    animationName,
  );
}

async function verifySpokenReaction(page, count, cue, text) {
  await page.waitForFunction((count) => window.__avatarSpeech.completed.length >= count, count);
  await page.waitForFunction((count) => window.__avatarSpeech.generated.length >= count, count);
  const speech = await page.evaluate(() => window.__avatarSpeech);
  assert.equal(speech.turns.length, count);
  assert.equal(speech.completed.length, count);
  assert.equal(speech.generated.length, count);
  assert.equal(speech.audio.length, count);
  assert.equal(requests.length, count);
  const reactionAudio = synthesis.filter(({ requestId }) =>
    speech.turns.some((turnId) => requestId === `${turnId}:0`),
  );
  assert.equal(reactionAudio.length, count);

  const request = requests.at(-1);
  assert.deepEqual(request.tools, []);
  assert.equal(request.messages.length, 2);
  assert.match(request.messages[0].content, /React to a tap on your character/);
  assert.match(request.messages[1].content, cue);
  const turnId = speech.turns.at(-1);
  assert.deepEqual(speech.completed.at(-1), { turnId, text });
  assert.equal(speech.generated.at(-1), turnId);
  assert.deepEqual(speech.audio.at(-1), {
    turnId,
    sequence: 0,
    text,
    sampleRate,
    pcm: pcm.toString('base64'),
  });
  assert.deepEqual(reactionAudio.at(-1), { text, language: 'en', requestId: `${turnId}:0` });
}

let app;
try {
  initialize(rt);
  const env = {
    ...environment(rt),
    CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_VOICE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [
      entry,
      '--verification',
      ...(process.argv.includes('--music-taps-only') ? ['--music-taps-only'] : []),
    ],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.showInactive();
    window.webContents.setAudioMuted(true);
    window.webContents.setBackgroundThrottling(false);
  });
  await page.evaluate(() => window.capri.setVoiceEnabled(true));
  await page.waitForFunction(async () => (await window.capri.bootstrap()).voice.ready);
  const presence = page.locator('#presence-toggle');
  if ((await presence.getAttribute('aria-pressed')) !== 'true')
    await presence.click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  await page.waitForFunction(() => Boolean(document.querySelector('#sprite').dataset.frame));
  await page.waitForFunction(() => {
    const sprite = document.querySelector('#sprite');
    return (
      sprite.complete &&
      sprite.naturalWidth &&
      parseFloat(document.body.style.getPropertyValue('--reveal')) >= 0.99
    );
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (process.argv.includes('--music-taps-only')) {
    await verifyFramedMusicTaps(app, page);
    console.log(
      'PASS framed music-floor head and body hearts preserve pose, held presses, motion and notes',
    );
  } else {
    await page.evaluate(() => {
      window.__avatarTaps = [];
      window.__avatarPartTaps = [];
      window.__headpats = 0;
      window.__avatarCue = { id: null, text: null };
      window.__avatarSpeech = { turns: [], completed: [], generated: [], audio: [] };
      window.capri.onEvent((event) => {
        if (event.type === 'avatar.tap') {
          window.__avatarTaps.push(event.count);
          window.__avatarPartTaps.push(event.part);
        }
        if (event.type === 'avatar.headpat') window.__headpats++;
        if (event.type === 'voice.preview-started') window.__avatarCue.id = event.turnId;
        if (event.type === 'voice.audio' && event.turnId === window.__avatarCue.id)
          window.__avatarCue.text = event.text;
        if (event.type === 'turn.started' && event.source === 'avatar-click')
          window.__avatarSpeech.turns.push(event.turnId);
        if (event.type === 'turn.completed' && window.__avatarSpeech.turns.includes(event.turnId))
          window.__avatarSpeech.completed.push({
            turnId: event.turnId,
            text: event.assistant.text,
          });
        if (event.type === 'voice.generated' && window.__avatarSpeech.turns.includes(event.turnId))
          window.__avatarSpeech.generated.push(event.turnId);
        if (event.type === 'voice.audio' && window.__avatarSpeech.turns.includes(event.turnId)) {
          const { turnId, sequence, text, sampleRate, pcm } = event;
          window.__avatarSpeech.audio.push({ turnId, sequence, text, sampleRate, pcm });
        }
      });
    });

    const { head, clear } = await spritePoints(page, '#sprite', true);
    assert.ok(head && clear);
    const region = page.locator('#sprite-region');
    const pose = await region.boundingBox();
    await page.mouse.move(clear.x, clear.y);
    await page.mouse.down();
    await page.mouse.move(clear.x + 22, clear.y - 15);
    await page.mouse.up();
    assert.deepEqual(await region.boundingBox(), pose);

    await page.mouse.move(head.x, head.y);
    await page.mouse.down();
    await page.mouse.move(head.x + 22, head.y + 15);
    await page.waitForFunction(
      () => document.querySelector('#sprite-region').dataset.dragging === 'true',
    );
    await page.mouse.up();
    assert.notDeepEqual(await region.boundingBox(), pose);
    assert.equal(await page.evaluate(() => window.__headpats), 0);

    const moved = await spritePoints(page, '#sprite', true);
    assert.ok(moved.head && moved.body);
    for (let i = 1; i <= 3; i++) {
      await page.mouse.click(moved.head.x, moved.head.y);
      await page.waitForFunction((count) => window.__headpats === count, i);
      if (i === 1) {
        await page.waitForFunction(() => Boolean(window.__avatarCue.text));
        assert.match(await page.evaluate(() => window.__avatarCue.text), /^(?:Aww|Easy)\./);
      }
    }
    await verifyHeadpat(page, '#sprite', 'avatar-headpat-heart');
    await page.locator('.avatar-headpat-hearts').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.avatar-headpat-plate').count(), 0);
    assert.deepEqual(requests, []);
    assert.deepEqual(await page.evaluate(() => window.__avatarTaps), [1, 2, 3]);

    for (let i = 0; i < 7; i++) await page.mouse.click(moved.head.x, moved.head.y);
    await page.waitForFunction(() => window.__headpats === 10);
    await verifyHeadpat(page, '#sprite', 'avatar-headpat-heart');
    await verifySpokenReaction(page, 1, /patted .*many times/, headReply);
    const tapSeries = Array.from({ length: 10 }, (_, index) => index + 1);
    assert.deepEqual(await page.evaluate(() => window.__avatarTaps), tapSeries);

    // Use the production cooldown so separate gestures exercise the real gate.
    await delay(8500);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.click(moved.body.x, moved.body.y);
      await page.waitForFunction((count) => window.__avatarTaps.length === count, 10 + i);
    }
    await page.waitForFunction(() =>
      document.getElementById('subtitle-text').textContent.includes('easy with the poking'),
    );
    assert.deepEqual(await page.evaluate(() => window.__avatarTaps), [...tapSeries, ...tapSeries]);
    await verifySpokenReaction(
      page,
      2,
      new RegExp(`^The user tapped your ${avatarParts[moved.bodyPart]} many times`),
      bodyReply,
    );

    await delay(8500);
    await page.locator('#avatar-detach').click({ force: true });
    await page.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
    const overlay = app.windows().find((item) => item.url() === overlayUrl);
    assert.ok(overlay);
    await overlay.emulateMedia({ reducedMotion: 'reduce' });
    const parked = '#parked-avatar .avatar-portrait > img';
    await overlay.waitForFunction(
      (selector) => document.querySelector(selector)?.naturalWidth,
      parked,
    );
    let desktop = await spritePoints(overlay, parked);
    assert.ok(desktop.head && desktop.body && desktop.clear);
    const desktopPress = (from, to = from) =>
      app.evaluate(
        ({ BrowserWindow }, { url, from, to }) => {
          const contents = BrowserWindow.getAllWindows().find(
            (item) => item.webContents.getURL() === url,
          ).webContents;
          // Verification keeps the overlay click-through, so deliver its native callback directly.
          contents.emit('before-mouse-event', {}, { ...from, type: 'mouseDown', button: 'left' });
          contents.emit('before-mouse-event', {}, { ...to, type: 'mouseUp', button: 'left' });
        },
        { url: overlayUrl, from, to },
      );
    await desktopPress(desktop.clear);
    const beforeDesktopDrag = await overlay.locator(parked).boundingBox();
    await desktopPress(desktop.head, desktop.body);
    await overlay.waitForFunction(({ x, y }) => {
      const rect = document.querySelector('#parked-avatar img').getBoundingClientRect();
      return rect.width > 0 && (Math.abs(rect.x - x) > 5 || Math.abs(rect.y - y) > 5);
    }, beforeDesktopDrag);
    await page.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
    desktop = await spritePoints(overlay, parked);
    assert.ok(desktop.head && desktop.body);
    assert.equal(await overlay.locator('.avatar-headpat-hearts').count(), 0);
    await desktopPress(desktop.head);
    await verifyHeadpat(overlay, parked, 'avatar-headpat-heart-still');
    await overlay.locator('.avatar-headpat-hearts').waitFor({ state: 'detached' });
    assert.equal(await overlay.locator('.avatar-headpat-plate').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__avatarTaps), [
      ...tapSeries,
      ...tapSeries,
      1,
    ]);
    assert.equal(requests.length, 2);

    for (let i = 0; i < 5; i++) await desktopPress(desktop.head);
    await desktopPress(desktop.body);
    await verifyHeadpat(overlay, parked, 'avatar-headpat-heart-still');
    await overlay.locator('#avatar-tap').waitFor({ state: 'visible' });
    for (let i = 0; i < 9; i++) await desktopPress(desktop.head);
    assert.equal(requests.length, 2);
    await desktopPress(desktop.head);
    await verifySpokenReaction(page, 3, /patted .*many times/, headReply);
    assert.deepEqual(await page.evaluate(() => window.__avatarTaps.slice(-10)), tapSeries);
    await delay(8500);
    const detachedHand = (await spritePoints(overlay, parked))['left-hand'];
    assert.ok(detachedHand);
    for (let i = 0; i < 10; i++) await desktopPress(detachedHand);
    await verifySpokenReaction(page, 4, /^The user tapped your left hand many times/, bodyReply);
    const coveredFrames = await verifyRasterRegions(overlay);
    const catalog = requireCapriAvatar(root);
    const dockFrames = new Map(catalog.desktopPoseFrames.map((frame) => [frame.id, frame]));
    const gripRegions = [
      [{ kind: 'left', edge: 'left', display: true }, 209, 421, 'right-hand'],
      [{ kind: 'left', edge: 'left' }, 1029, 373, 'left-hand'],
      [{ kind: 'ceiling', edge: 'top', display: true }, 565, 89, 'right-foot'],
      [{ kind: 'ceiling', edge: 'bottom' }, 737, 81, 'left-hand'],
      [{ kind: 'seat', edge: 'top' }, 365, 745, 'right-hand'],
    ];
    await app.evaluate(() => {
      const controller = globalThis.avatarFixture;
      const updateFrame = controller.updateFrame;
      globalThis.poseQualification = { updateFrame, ignored: 0 };
      // Real perching owns its pose through main's perch record. This raster
      // qualifier installs reviewed poses directly, so do not let the unrelated
      // live standing animation supersede those manual frame requests.
      controller.updateFrame = function (frame, ...args) {
        if (frame.kind !== 'reviewed_pose') {
          globalThis.poseQualification.ignored++;
          return Promise.resolve(false);
        }
        return updateFrame.call(this, frame, ...args);
      };
    });
    let ignoredStandingUpdates;
    try {
      for (const [dock, x, y, part] of gripRegions) {
        const frame = avatarDockFrame(dockFrames, dock);
        assert.equal(
          await app.evaluate(
            async ({ nativeImage }, { frame, canvas }) => {
              const controller = globalThis.avatarFixture;
              const image = nativeImage.createFromPath(frame.file);
              const rgba = image.toBitmap();
              const imageSize = image.getSize();
              const alpha = new Uint8Array(imageSize.width * imageSize.height);
              for (let index = 0; index < alpha.length; index++) alpha[index] = rgba[index * 4 + 3];
              return controller.updateFrame(frame, canvas, { alpha, imageSize });
            },
            { frame, canvas: catalog.canvas },
          ),
          true,
        );
        await overlay
          .locator(`#parked-avatar[data-dock="${frame.anchor.name}"] img[src$="/${frame.id}.png"]`)
          .waitFor();
        const box = await overlay.locator('#parked-avatar').boundingBox();
        const count = await page.evaluate(() => window.__avatarPartTaps.length);
        await desktopPress({
          x: box.x + box.width * (x / catalog.canvas.width),
          y: box.y + box.height * (y / catalog.canvas.height),
        });
        await page.waitForFunction(
          (expected) => window.__avatarPartTaps.length === expected,
          count + 1,
        );
        assert.equal(await page.evaluate(() => window.__avatarPartTaps.at(-1)), part);
      }
      await overlay.evaluate(() => {
        window.capriAvatarDetach.setMouth('wide');
        window.capriAvatarDetach.pulse({ x: 100, y: 100, count: 1, tone: 'boundary' });
      });
      await overlay.locator('.avatar-grip-face[data-frame="boundary"]').waitFor();
      assert.equal(
        await overlay
          .locator('.avatar-grip-face')
          .evaluate((face) => getComputedStyle(face).visibility),
        'visible',
      );
      assert.equal(await overlay.locator('.avatar-mouth-plate').isVisible(), true);
    } finally {
      ignoredStandingUpdates = await app.evaluate(() => {
        const qualification = globalThis.poseQualification;
        globalThis.avatarFixture.updateFrame = qualification.updateFrame;
        delete globalThis.poseQualification;
        return qualification.ignored;
      });
    }
    console.log(
      `PASS framed and detached headpats, sprite dragging, spoken reactions, region coverage in ${coveredFrames} PNG frames, and native picking of all five support poses (${ignoredStandingUpdates} unrelated standing updates isolated during manual pose qualification)`,
    );
  }
} finally {
  await app?.close();
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
}
