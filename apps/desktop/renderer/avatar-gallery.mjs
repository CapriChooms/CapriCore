// SPDX-License-Identifier: GPL-3.0-only
import { avatarPoseSegments, avatarPoseSwing } from '../avatar-pose-motion.mjs';
import {
  avatarRect,
  MAX_AVATAR_ZOOM,
  MIN_AVATAR_ZOOM,
  moveAvatar,
  zoomAvatar,
} from '../avatar-layout.mjs';
import { SpriteImages } from './animation-director.mjs';
import { faceAnimations, faceFrames } from './avatar-face-expressions.mjs';
import { AvatarHeadpat } from './avatar-headpat.mjs';
import { AvatarMouthLayer } from './avatar-mouth.mjs';
import { avatarFaceState, composeAvatarFace, loadAvatarFaceRig, loadAvatarGestureFaces } from './avatar-face-rig.mjs';
import { layeredBlinkAssets, prepareLayeredBlink } from './avatar-layered-blink.mjs';
import { AvatarSurfacePerformance } from './avatar-surface-performance.mjs';
import {
  draw as drawTeleport,
  fps as teleportFps,
  frames as teleportFrames,
  prepareTeleportMotion,
} from './avatar-teleport-motion.mjs';
import { AvatarWave } from './avatar-wave.mjs';
import { drawMusicNotes, MusicAnimation, MusicPoseLayer } from './music-animation.mjs';
import { musicRig } from './music-beat-motion.mjs';
import { drawSandevistan, prepareSandevistan, sandevistanStamps } from './sandevistan-motion.mjs';
import { getScreenInteraction, screenInteractionClips } from './screen-interaction-motion.mjs';
import { drawStartupIntro } from './startup-intro-motion.mjs';

const resolution = 512;
const poseSize = 1254;
const clipTitles = {
  blink: 'Blink',
  speech: 'Lip sync',
  wink: 'Wink',
  laugh: 'Laugh',
  excited: 'Excited',
  gaze: 'Look around',
  surprise: 'Surprise',
  sleepy: 'Sleepy',
};
const isPose = ({ kind }) => ['reviewed_pose', 'reviewed_music'].includes(kind);
const musicTitle = (frameId) =>
  frameId === 'music-window' ? 'Music at a window' : 'Music on the floor';

export function galleryEntries({ frames = [], clips = [], defaultId = 'neutral', intro } = {}) {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const poses = frames.filter((frame) => frame.id === defaultId || isPose(frame));
  const expressions = frames.filter((frame) => frame.id !== defaultId && !isPose(frame));
  const still = (frame, detail = false) => {
    const label = frame.label.replace(/^Standing · /, '');
    let title = label.charAt(0).toUpperCase() + label.slice(1);
    if (frame.id === defaultId) title = 'Standing';
    if (frame.kind === 'reviewed_music') title = musicTitle(frame.id);
    return {
      id: frame.id,
      title,
      poster: frame,
      detail,
    };
  };
  const animations = [];
  const add = (id, title, kind, frameId, options = {}) => {
    const poster = byId.get(frameId);
    if (poster) animations.push({ id, title, kind, poster, ...options });
  };
  const addClip = ({ id, frames: sequence, effect }) => {
    const title = clipTitles[id] ?? id;
    if (sequence.every(({ id }) => byId.has(id))) {
      if (
        Object.hasOwn(faceAnimations, id) &&
        defaultId === 'neutral' &&
        sequence.every(({ id: frameId }) => Object.hasOwn(faceFrames, frameId))
      ) {
        const cover =
          id === 'blink'
            ? defaultId
            : sequence.reduce((longest, frame) => (frame.ms > longest.ms ? frame : longest)).id;
        add(id, title, 'layered-face', cover, { detail: true });
        return;
      }
      const cover = sequence.reduce((longest, frame) => (frame.ms > longest.ms ? frame : longest));
      add(id, title, 'frames', cover.id, { detail: true, sequence, effect });
    }
  };
  clips.forEach(addClip);
  if (clips.length) {
    add('wave', 'Wave hello', 'wave', defaultId);
    add('headpat', 'Headpat', 'headpat', defaultId);
    // Older Capri packs shipped the expression drawings before cataloguing these clips.
    if (defaultId === 'neutral') {
      for (const [id, poster] of [
        ['gaze', 'idle-look_left'],
        ['surprise', 'surprised'],
        ['sleepy', 'sleepy'],
      ])
        if (!clips.some((clip) => clip.id === id))
          add(id, clipTitles[id], 'layered-face', poster, { detail: true });
    }
    add('lightning', 'Lightning teleport', 'lightning', defaultId);
    add('sandevistan', 'Sandevistan', 'sandevistan', defaultId);
  }
  if (intro?.frames?.length)
    add('startup-intro', 'Startup animation', 'intro', defaultId, { intro });
  for (const [id, { label, defaultFrame }] of Object.entries(screenInteractionClips)) {
    add(id, label, 'surface', defaultFrame, { side: 'left' });
    if (id === 'edge-lean') {
      add('edge-lean-right', 'Lean from the right edge', 'surface', 'pose-dock-right', {
        action: id,
        side: 'right',
      });
    }
  }
  for (const frame of poses) {
    if (avatarPoseSegments(frame.id).length)
      add('sway-' + frame.id, 'Sway · ' + frame.label, 'sway', frame.id);
    if ((clips.length || isPose(frame)) && musicRig(frame.id)) {
      const title = frame.kind === 'reviewed_music'
        ? musicTitle(frame.id)
        : 'Music listening · ' + still(frame).title;
      add('dance-' + frame.id, title, 'music', frame.id);
    }
  }
  return {
    poses: poses.map((frame) => still(frame)),
    expressions: expressions.map((frame) => still(frame, true)),
    animations,
  };
}

function loadImage(url) {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

async function registeredGalleryPose(image, id) {
  const rig = await loadAvatarFaceRig();
  return composeAvatarFace(image, rig(image, id), avatarFaceState(id));
}

export class AvatarGallery {
  constructor(panel, ui) {
    this.panel = panel;
    this.ui = ui;
    this.stage = panel.querySelector('.avatar-gallery-stage');
    this.art = panel.querySelector('.avatar-gallery-art');
    this.poster = panel.querySelector('.avatar-gallery-poster');
    const paintPose = () => {
      if (this.entry && !this.entry.kind && isPose(this.entry.poster))
        this.poseFace.update(this.poster, 'closed', this.entry.poster.id);
    };
    this.poseFace = new AvatarMouthLayer(this.poster, { onReady: paintPose });
    this.poster.addEventListener('load', paintPose);
    this.canvas = panel.querySelector('.avatar-gallery-canvas');
    this.canvas.width = this.canvas.height = resolution;
    this.heading = panel.querySelector('#avatar-gallery-selection');
    this.status = panel.querySelector('#avatar-gallery-status');
    this.items = panel.querySelector('#avatar-gallery-items');
    this.playButton = panel.querySelector('#avatar-gallery-play');
    this.loopButton = panel.querySelector('#avatar-gallery-loop');
    this.zoomOut = panel.querySelector('#avatar-gallery-zoom-out');
    this.zoomIn = panel.querySelector('#avatar-gallery-zoom-in');
    this.resetButton = panel.querySelector('#avatar-gallery-reset');
    this.categories = [...panel.querySelectorAll('[data-gallery-category]')];
    this.category = 'poses';
    this.selection = new Map();
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    for (const button of this.categories)
      button.onclick = () => this.browse(button.dataset.galleryCategory);
    this.playButton.onclick = () => (this.run ? this.stop() : void this.play());
    this.loopButton.onclick = () => {
      this.loop = !this.loop;
      this.refreshControls();
      if (this.loop && !this.run) void this.play();
    };
    this.zoomOut.onclick = () => this.zoom(1 / 1.18);
    this.zoomIn.onclick = () => this.zoom(1.18);
    this.resetButton.onclick = () => this.resetView();
    this.stage.addEventListener(
      'wheel',
      (event) => {
        if (!this.layout || !event.deltaY) return;
        event.preventDefault();
        const bounds = this.stage.getBoundingClientRect();
        const delta =
          event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
        this.zoom(Math.exp(-Math.max(-150, Math.min(150, delta)) * 0.0018), {
          x: event.clientX - bounds.left - this.stage.clientLeft,
          y: event.clientY - bounds.top - this.stage.clientTop,
        });
      },
      { passive: false },
    );
    this.stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.pan || !this.layout) return;
      this.pan = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.stage.dataset.panning = '';
      this.stage.setPointerCapture(event.pointerId);
    });
    this.stage.addEventListener('pointermove', (event) => {
      if (this.pan?.id !== event.pointerId) return;
      const { clientX: x, clientY: y } = event;
      const viewport = this.viewport();
      if (viewport) this.layout = moveAvatar(this.layout, viewport, x - this.pan.x, y - this.pan.y);
      this.layoutAdjusted = true;
      Object.assign(this.pan, { x, y });
      this.positionArt();
    });
    this.stage.addEventListener('lostpointercapture', () => this.endPan());
    this.observer = new ResizeObserver(() => this.positionArt());
    this.observer.observe(this.stage);
    this.motion.addEventListener('change', () => this.stop());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stop();
        this.endPan();
      } else this.refreshControls();
    });
    window.addEventListener('pagehide', () => this.stop());
    this.poster.addEventListener('error', () => {
      if (this.active) this.unavailable();
    });
  }

  viewport() {
    const { clientWidth: width, clientHeight: height } = this.stage;
    return width && height
      ? { x: 0, y: 0, width, height, baseSize: Math.min(width, height), centerFaces: true }
      : null;
  }

  endPan() {
    const id = this.pan?.id;
    this.pan = null;
    delete this.stage.dataset.panning;
    if (id !== undefined && this.stage.hasPointerCapture(id)) this.stage.releasePointerCapture(id);
  }

  resetView() {
    this.endPan();
    this.layout = null;
    this.layoutAdjusted = false;
    this.positionArt();
  }

  zoom(factor, point) {
    const viewport = this.viewport();
    if (!this.layout || !viewport) return;
    this.layoutAdjusted = true;
    this.layout = zoomAvatar(
      this.layout,
      viewport,
      this.layout.zoom * factor,
      point ?? {
        x: viewport.width / 2,
        y: viewport.height / 2,
      },
    );
    this.positionArt();
  }

  positionArt() {
    const viewport = this.viewport();
    if (!this.entry || !viewport) return;
    if (!this.layout) {
      const detail = this.entry.detail;
      const home = { x: 0.5, y: 0.5, zoom: detail ? 2.3 : 1 };
      const rect = avatarRect(home, viewport);
      this.layout = moveAvatar(
        home,
        viewport,
        viewport.width / 2 - rect.x - rect.width / 2,
        viewport.height / 2 - rect.y - rect.height * (detail ? 400 / poseSize : 0.5),
      );
    }
    const { x, y, width, height } = avatarRect(this.layout, viewport);
    Object.assign(this.art.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    this.updateZoomControls();
  }

  load(data, notes = [], effects) {
    this.entries = galleryEntries(data);
    this.images = new SpriteImages(data?.frames ?? [], 10);
    this.notes = notes;
    this.effects = effects;
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    if (active) this.browse(this.category);
    else {
      this.stop();
      this.endPan();
      this.surface?.dispose();
      this.surface = null;
      this.musicPose?.clear();
      this.musicPose = null;
      this.poster.removeAttribute('src');
      this.items.replaceChildren();
      this.cards = [];
      this.images?.cache.clear();
    }
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      this.stop();
      this.endPan();
    } else this.refreshControls();
  }

  browse(category) {
    const changed = this.category !== category;
    this.category = category;
    const entries = this.entries?.[category] ?? [];
    for (const button of this.categories) {
      const name = button.dataset.galleryCategory;
      button.disabled = !this.entries?.[name]?.length;
      button.setAttribute('aria-pressed', String(category === name));
    }
    this.cards = entries.map((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'avatar-gallery-card';
      button.dataset.galleryItem = entry.id;
      button.dataset.untranslated = '';
      button.toggleAttribute('data-gallery-detail', entry.detail === true);
      const thumbnail = document.createElement('span');
      thumbnail.className = 'avatar-gallery-thumbnail';
      const image = new Image();
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = entry.poster.url;
      if (entry.poster.id === 'pose-sleep') image.dataset.frame = entry.poster.id;
      const label = document.createElement('span');
      thumbnail.append(image);
      button.append(thumbnail, label);
      button.onclick = () => this.select(entry, { play: true });
      return { button, entry, label };
    });
    this.items.replaceChildren(...this.cards.map(({ button }) => button));
    this.items.scrollTop = 0;
    this.select(entries.find(({ id }) => id === this.selection.get(category)) ?? entries[0], {
      reset: changed,
    });
    this.translate();
  }

  select(entry, { play = false, reset = false } = {}) {
    this.stop();
    this.poseFace.canvas.hidden = true;
    const detailChanged = this.entry?.detail !== entry?.detail;
    this.entry = entry;
    this.status.hidden = true;
    if (entry) {
      this.selection.set(this.category, entry.id);
      this.poster.src = entry.poster.url;
      this.poster.dataset.frame = entry.poster.id;
      if (!entry.kind && isPose(entry.poster) && this.poster.currentSrc === this.poster.src)
        this.poseFace.update(this.poster, 'closed', entry.poster.id);
    }
    this.poster.hidden = !entry;
    if (!entry) delete this.poster.dataset.frame;
    if (reset || (detailChanged && !this.layoutAdjusted)) this.resetView();
    else this.positionArt();
    for (const card of this.cards)
      card.button.setAttribute('aria-pressed', String(card.entry === entry));
    this.translate();
    if (play && entry?.kind) void this.play();
  }

  title(value) {
    if (value.startsWith('Music listening · '))
      return this.ui.text('Music listening') + ' · ' + this.ui.text(value.slice('Music listening · '.length));
    return value.startsWith('Sway · ')
      ? this.ui.text('Sway') + ' · ' + this.ui.text(value.slice(7))
      : this.ui.text(value);
  }

  translate() {
    for (const { entry, label } of this.cards ?? []) label.textContent = this.title(entry.title);
    this.heading.textContent = this.entry ? this.title(this.entry.title) : '';
    this.poster.alt = this.heading.textContent;
    this.refreshControls();
  }

  refreshControls() {
    this.playButton.hidden = !this.entry?.kind;
    this.loopButton.hidden = this.playButton.hidden;
    this.playButton.disabled = this.loopButton.disabled = !this.canPlay();
    this.playButton.textContent = this.ui.text(this.run ? 'Stop' : 'Play animation');
    this.loopButton.textContent = this.ui.text('Loop animation');
    this.loopButton.setAttribute('aria-pressed', String(Boolean(this.loop)));
    this.updateZoomControls();
  }

  updateZoomControls() {
    this.zoomOut.disabled = !this.layout || this.layout.zoom <= MIN_AVATAR_ZOOM;
    this.zoomIn.disabled = !this.layout || this.layout.zoom >= MAX_AVATAR_ZOOM;
    this.resetButton.disabled = !this.layout;
  }

  canPlay() {
    return this.active && this.visible && !document.hidden && !this.motion.matches;
  }

  stop() {
    const run = this.run;
    this.run = null;
    if (run) {
      cancelAnimationFrame(run.frame);
      clearTimeout(run.timer);
      this.surface?.stop();
      this.wave?.stop();
      this.headpat?.clear();
      this.art.removeAttribute('data-gallery-playing');
      this.canvas.hidden = true;
      delete this.canvas.dataset.galleryFrame;
    }
    this.refreshControls();
  }

  unavailable() {
    this.status.textContent = this.ui.text('Unavailable');
    this.status.hidden = false;
  }

  async play() {
    if (this.run || !this.entry?.kind || !this.canPlay()) return;
    const entry = this.entry;
    const run = (this.run = {});
    this.status.hidden = true;
    this.art.dataset.galleryPlaying = entry.id;
    this.refreshControls();
    try {
      const source = await this.images.get(entry.poster.id);
      if (this.run !== run) return;
      if (entry.kind === 'surface' && entry.id !== 'edge-hang') {
        const action = entry.action ?? entry.id;
        if (!getScreenInteraction(action, { frameId: entry.poster.id, side: entry.side }))
          throw Error('Unavailable');
        this.surface ??= new AvatarSurfacePerformance(this.art, {
          canPlay: () => this.canPlay(),
          shouldLoop: () => Boolean(this.loop),
          onChange: () => {
            if (this.run?.surfaceStarted && !this.surface.active) this.stop();
          },
        });
        if (!(await this.surface.play(action, source, entry.poster.id, entry.side)))
          throw Error('Unavailable');
        if (this.run === run) run.surfaceStarted = true;
        return;
      }
      if (entry.kind === 'wave') {
        this.wave ??= new AvatarWave(this.art, { canPlay: () => this.canPlay() });
        if (!(await this.wave.play({ shouldLoop: () => Boolean(this.loop) })) && this.run === run)
          this.unavailable();
        if (this.run === run) this.stop();
        return;
      }
      if (entry.kind === 'headpat') {
        await this.poster.decode();
        if (this.run !== run) return;
        this.headpat ??= new AvatarHeadpat(this.art);
        const playCycle = () => {
          if (this.run !== run) return;
          const { left, top, width, height } = this.art.getBoundingClientRect();
          this.headpat.play(
            this.poster,
            { x: left + width * 0.51, y: top + height * 0.24 },
            null,
            true,
            entry.poster.id,
          );
          run.timer = setTimeout(() => (this.loop ? playCycle() : this.stop()), 1450);
        };
        playCycle();
        return;
      }
      const timeline = await this.timeline(entry, source);
      if (this.run === run) this.animate(run, timeline);
    } catch (error) {
      if (this.run !== run) return;
      this.stop();
      this.unavailable();
      console.warn('Avatar gallery preview failed:', error);
    }
  }

  animate(run, { duration, paint }) {
    const ctx = this.canvas.getContext('2d');
    this.canvas.hidden = false;
    const start = performance.now();
    let exposure = -1;
    let cycle = 0;
    const tick = (now) => {
      if (this.run !== run) return;
      const elapsed = Math.max(0, now - start);
      const nextCycle = Math.floor(elapsed / duration);
      if (!this.canPlay() || (!this.loop && nextCycle !== cycle)) return this.stop();
      cycle = nextCycle;
      const frame = Math.floor(elapsed / (1000 / 30));
      if (frame !== exposure) {
        exposure = frame;
        ctx.clearRect(0, 0, resolution, resolution);
        try {
          paint(ctx, elapsed % duration, elapsed);
        } catch (error) {
          this.stop();
          this.unavailable();
          console.warn('Avatar gallery preview failed:', error);
          return;
        }
      }
      run.frame = requestAnimationFrame(tick);
    };
    tick(start);
  }

  async timeline(entry, source) {
    if (entry.kind === 'layered-face') {
      const [pose, eyes] = await Promise.all([
        loadImage(layeredBlinkAssets.pose),
        loadImage(layeredBlinkAssets.eyes),
      ]);
      const draw = prepareLayeredBlink(pose, eyes);
      return {
        duration: faceAnimations[entry.id].duration,
        paint: (ctx, time) => draw(ctx, resolution, faceAnimations[entry.id].sample(time)),
      };
    }
    if (entry.id === 'edge-hang') {
      const { anchor } = getScreenInteraction(entry.id);
      const rim = (anchor.y / poseSize) * resolution;
      return {
        duration: 1370,
        paint(ctx, time) {
          // Show the approach to the contact that the desktop renderer already holds.
          const reach = Math.min(1, time / 420);
          const approach = resolution * 0.16 * (1 - reach) ** 2;
          const tension = Math.max(0, 1 - (time - 420) / 580);
          const settle = time <= 420 ? 1 : 1 + Math.sin((time - 420) / 83) * tension * 0.07;
          ctx.fillStyle = '#497b7f';
          ctx.fillRect(resolution * 0.23, rim - 2, resolution * 0.54, 4);
          ctx.save();
          ctx.translate(0, rim + approach);
          ctx.scale(1, settle);
          ctx.drawImage(source, 0, -rim, resolution, resolution);
          ctx.restore();
        },
      };
    }
    if (entry.kind === 'frames') {
      let duration = 0;
      const sequence = await Promise.all(
        entry.sequence.map(async ({ id, ms }) => {
          duration += ms;
          const until = duration;
          return { id, ms, until, image: await this.images.get(id) };
        }),
      );
      const effect = entry.effect && (await this.images.get(entry.effect.id));
      return {
        duration,
        paint: (ctx, time) => {
          const { id, image, until, ms } = sequence.find(({ until }) => time < until);
          this.canvas.dataset.galleryFrame = id;
          ctx.drawImage(image, 0, 0, resolution, resolution);
          if (effect && entry.effect.onFrame === id) {
            const size = (resolution * entry.effect.width) / poseSize;
            const rise = 1 - (until - time) / ms;
            ctx.drawImage(effect, resolution * 0.64, resolution * (0.42 - rise * 0.25), size, size);
          }
        },
      };
    }
    if (entry.kind === 'intro') {
      const { frames, durationMs } = entry.intro;
      const [drawFace, ...images] = await Promise.all([
        loadAvatarGestureFaces(),
        ...frames.map(({ url }) => loadImage(url)),
      ]);
      return {
        duration: durationMs,
        paint: (ctx, time) =>
          drawStartupIntro(ctx, {
            time,
            width: resolution,
            height: resolution,
            images,
            drawFace: (context, index, size) => {
              if (index) drawFace(context, 'intro:' + frames[index].id, size);
            },
            durationMs,
          }),
      };
    }
    if (entry.kind === 'music') {
      const animation = new MusicAnimation();
      const pose = this.musicPose ??= new MusicPoseLayer(resolution);
      const notes = await Promise.all(this.notes.map(({ url }) => loadImage(url)));
      source = await registeredGalleryPose(source, entry.poster.id);
      if (!source.src) source.avatarTextureRevision ??= 1;
      return {
        duration: (8 * 60000) / 110,
        paint: (ctx, time, elapsed = time) => {
          const state = animation.sample(elapsed, {
            active: true,
            tempo: 110,
            frameId: entry.poster.id,
            wallTime: elapsed,
          });
          const body = pose.image(source, state);
          ctx.drawImage(body, 0, 0, resolution, resolution);
          drawMusicNotes(ctx, state.notes, notes, { width: resolution });
        },
      };
    }
    if (entry.kind === 'sway') {
      source = await registeredGalleryPose(source, entry.poster.id);
      const segments = avatarPoseSegments(entry.poster.id);
      return {
        duration: 4000,
        paint: (ctx, time) => {
          ctx.save();
          ctx.scale(resolution / poseSize, resolution / poseSize);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, poseSize, poseSize);
          for (const {
            bounds: [x, y, right, bottom],
          } of segments)
            ctx.rect(x, y, right - x, bottom - y);
          ctx.clip('evenodd');
          ctx.drawImage(source, 0, 0);
          ctx.restore();
          for (const segment of segments) {
            const {
              pivot: [px, py],
              bounds: [x, y, right, bottom],
            } = segment;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate((avatarPoseSwing(time, segment) * Math.PI) / 180);
            ctx.translate(-px, -py);
            ctx.drawImage(
              source,
              x,
              y - 5,
              right - x,
              bottom - y + 5,
              x,
              y - 5,
              right - x,
              bottom - y + 5,
            );
            ctx.restore();
          }
          ctx.restore();
        },
      };
    }
    const from = { x: resolution * 0.24, y: resolution * 0.86 };
    const to = { x: resolution * 0.76, y: resolution * 0.64 };
    const scale = resolution * 0.49;
    const options = { from, to, scale, effects: this.effects };
    if (entry.kind === 'sandevistan') {
      const motion = prepareSandevistan(options);
      const stamps = sandevistanStamps(source, motion);
      return {
        duration: motion.endMs + 200,
        paint: (ctx, time) => drawSandevistan(ctx, motion, time, stamps, source),
      };
    }
    Object.assign(options, { seed: 14761, bounds: { width: resolution, height: resolution } });
    const motion = prepareTeleportMotion(options);
    return {
      duration: (teleportFrames * 1000) / teleportFps + 200,
      paint: (ctx, time) => {
        drawTeleport(ctx, {
          ...options,
          motion,
          frame: (time * teleportFps) / 1000,
          drawCapri: (point) =>
            ctx.drawImage(
              source,
              point.x - scale / 2,
              point.y - (scale * 1166) / poseSize,
              scale,
              scale,
            ),
        });
      },
    };
  }
}
