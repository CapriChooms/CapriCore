// SPDX-License-Identifier: GPL-3.0-only
import {
  boltOnlyFrames,
  color,
  draw,
  fps,
  frames,
  arrivalStart,
  prepareTeleportMotion,
  teleportViewport,
} from './avatar-teleport-motion.mjs';
import { AvatarHeadpat } from './avatar-headpat.mjs';
import { showAvatarTapEffect } from './avatar-tap-effect.mjs';
import { ReplyPages } from './reply-pages.mjs';
import { detachedReplyLayout } from './detached-reply-layout.mjs';
import { replyBubbleOutline } from './reply-bubble-outline.mjs';
import { AvatarMouthLayer, avatarPoseLandmarks, drawPoseEyes } from './avatar-mouth.mjs';
import { AvatarDragTether } from './avatar-drag-tether.mjs';
import { applyInterfaceTheme } from './interface-theme.mjs';
import { musicAnimationReady } from './music-listening-settings.mjs';
import { SIGNAL_STATES } from './presence-model.mjs';
import { avatarGripPose, avatarGripSwing } from '../avatar-grip-rig.mjs';
import { avatarSeatHinge, avatarSeatSwing } from '../avatar-body-regions.mjs';
import { avatarPoseSegments, avatarPoseSwing } from '../avatar-pose-motion.mjs';
import {
  MusicAnimation,
  MusicNotesLayer,
  MUSIC_NOTE_ASSETS,
  MUSIC_POSES,
} from './music-animation.mjs';

const effect = document.getElementById('teleport-effect');
const parked = document.getElementById('parked-avatar');
const parkedImage = parked.querySelector('img');
const stage = parked.querySelector('.avatar-pose-stage');
const portrait = parked.querySelector('.avatar-portrait');
const gripBehind = parked.querySelector('[data-layer="behind"]');
const gripFront = parked.querySelector('[data-layer="front"]');
const seatShins = parked.querySelector('.avatar-seat-shins');
const SVG = 'http://www.w3.org/2000/svg';
function svgNode(name, attributes) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
const poseMotion = svgNode('svg', { class: 'avatar-pose-motion', viewBox: '0 0 1254 1254' });
stage.append(poseMotion);
const hud = document.getElementById('avatar-hud');
const status = document.getElementById('avatar-status');
const reply = document.getElementById('avatar-reply');
const replyText = document.getElementById('avatar-reply-text');
const replySurface = document.getElementById('avatar-reply-surface');
const replyOutline = replySurface.querySelector('path');
let replySurfaceKey;
function drawReplySurface(bubble, faceX, faceY, anchorX) {
  const tailLength = document.body.dataset.presentation === 'dialogue' ? 0 : 16;
  const targetX = faceX - bubble.x,
    targetY = faceY - bubble.y;
  const localAnchorX = Number.isFinite(anchorX) ? anchorX - bubble.x : targetX;
  const key = [bubble.width, bubble.height, targetX, targetY, tailLength, localAnchorX]
    .map((n) => n.toFixed(3))
    .join(',');
  if (key === replySurfaceKey) return;
  replySurfaceKey = key;
  const outline = replyBubbleOutline({
    width: bubble.width,
    height: bubble.height,
    targetX,
    targetY,
    tailLength,
    anchorX: localAnchorX,
  });
  replySurface.setAttribute('viewBox', `0 0 ${bubble.width} ${bubble.height}`);
  replyOutline.setAttribute('d', outline.path);
  replySurface.dataset.tailSide = outline.side ?? '';
  for (const part of ['base', 'tip'])
    for (const axis of ['x', 'y'])
      replySurface.dataset[part + axis.toUpperCase()] = outline[part]
        ? String(outline[part][axis])
        : '';
}
const replyToggle = document.getElementById('avatar-reply-toggle');
const replyNavigation = document.getElementById('avatar-reply-controls');
const replyPrevious = document.getElementById('avatar-reply-previous');
const replyNext = document.getElementById('avatar-reply-next');
const replyPosition = document.getElementById('avatar-reply-position');
const replyPages = new ReplyPages();
const replyMeasure = document.createElement('canvas').getContext('2d');
let replySnapshot,
  replyLayoutWidth = -1,
  replyDirty = false;
let replyFontRevision = 0;
const mouth = new AvatarMouthLayer(parkedImage);
const gripFace = document.createElement('canvas');
gripFace.className = 'avatar-grip-face';
gripFace.setAttribute('aria-hidden', 'true');
gripFace.hidden = true;
portrait.append(gripFace);
const tether = new AvatarDragTether();
const pat = new AvatarHeadpat(document.body, redrawMouth);
const context = effect.getContext('2d', { alpha: true });
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const defaultAnchor = { x: 627 / 1254, y: 1166 / 1254 };
const spriteAddress = /^capri:\/\/desktop\/(?:sprite\.png|sprites\/[a-z0-9_-]+\.png)$/i;
const perchSprite = /\/desktop-perch(?:-[a-z]+)?\.png$/;
const decodedFrames = new Map();

let prepared;
let flight;
let spritePromise;
let spriteUrl;
let parkedPoint;
let parkedAnchor;
let frameRequest;
let placementFrame = 0,
  placementPending,
  placementOrigin,
  placementRevision = 0,
  hudPlacement,
  heartPlacement;
let gripPose;
let rasterPose;
let movingLimbs = [];
let motionFrame = 0;
let lastSwing;
let gripFaceTimer;
let blinkTimer;
let gripFaceRequest = 0;
let mouthShape = 'closed';
let music = {
  enabled: false,
  hearingMusic: false,
  energy: 0.5,
  tempo: 0,
  notes: true,
  motion: true,
};
let musicFrame = 0,
  musicNotes,
  musicDragging = false;
const musicAnimation = new MusicAnimation();
let sleeping = false;
let replyTurn = '',
  replyCollapsed = false,
  replyNear = false,
  replyEdge;
let replyLabels = { show: 'Show reply', hide: 'Hide reply' };

function redrawMouth() {
  if (document.body.dataset.presentation === 'dialogue') return;
  mouth.update(
    pat.image(parkedImage),
    parked.hidden ? 'closed' : mouthShape,
    frameIdFor(parkedImage.src),
  );
  ensureMusicAnimation();
}

function setMusic(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value.autoBpm !== undefined && typeof value.autoBpm !== 'boolean') ||
    ['enabled', 'hearingMusic', 'notes', 'motion'].some((key) => typeof value[key] !== 'boolean') ||
    !Number.isFinite(value.energy) ||
    value.energy < 0 ||
    value.energy > 1 ||
    !Number.isFinite(value.tempo) ||
    (value.tempo !== 0 && value.tempo < 40) ||
    value.tempo > 240 ||
    (value.tempoConfidence !== undefined &&
      (!Number.isFinite(value.tempoConfidence) ||
        value.tempoConfidence < 0 ||
        value.tempoConfidence > 1)) ||
    (value.beatAt !== undefined && (!Number.isFinite(value.beatAt) || value.beatAt < 0))
  )
    return false;
  music = {
    enabled: value.enabled,
    hearingMusic: value.hearingMusic,
    notes: value.notes,
    motion: value.motion,
    autoBpm: value.autoBpm !== false,
    energy: value.energy,
    tempo: value.tempo,
    tempoConfidence: value.tempoConfidence ?? (value.tempo ? 1 : 0),
    beatAt: value.beatAt ?? 0,
  };
  ensureMusicAnimation();
  return true;
}

function ensureMusicAnimation() {
  if (document.body.dataset.presentation === 'dialogue') return;
  if (!musicFrame) musicFrame = requestAnimationFrame(animateMusic);
}

function animateMusic(now) {
  musicFrame = 0;
  const id = frameIdFor(parkedImage.src),
    pose = MUSIC_POSES[id];
  const reduced = motionPreference.matches;
  const allowed = Boolean(
    pose &&
      musicAnimationReady(music) &&
      !sleeping &&
      !flight &&
      !parked.hidden &&
      !document.hidden &&
      !musicDragging &&
      gripFace.hidden &&
      pat.image(parkedImage) === parkedImage,
  );
  if (!pose) musicAnimation.reset();
  const state = musicAnimation.sample(now, {
    active: allowed,
    strength: music.energy,
    autoBpm: music.autoBpm !== false,
    tempo: music.tempo,
    tempoConfidence: music.tempoConfidence,
    beatAt: music.beatAt,
    reduced,
    frameId: id,
  });
  if (pose) {
    stage.style.transformOrigin = `${(pose.anchor[0] / 1254) * 100}% ${(pose.anchor[1] / 1254) * 100}%`;
    stage.style.transform = music.motion && state.active ? `rotate(${state.angle}deg)` : '';
  } else {
    stage.style.transform = '';
    stage.style.transformOrigin = '';
  }
  if (
    !music.notes ||
    reduced ||
    !pose ||
    !music.enabled ||
    sleeping ||
    flight ||
    parked.hidden ||
    document.hidden ||
    musicDragging
  )
    state.notes = [];
  if (state.notes.length) musicNotes ??= new MusicNotesLayer(document.body, MUSIC_NOTE_ASSETS);
  musicNotes?.update(state, {
    rect: parked.getBoundingClientRect(),
    clip: { x: 0, y: 0, width: innerWidth, height: innerHeight },
  });
  if (
    !reduced &&
    !document.hidden &&
    pose &&
    !flight &&
    !parked.hidden &&
    (music.motion || music.notes) &&
    (allowed || state.active)
  )
    ensureMusicAnimation();
}

function frameIdFor(url) {
  return /\/([a-z0-9_-]+)\.png$/i.exec(url)?.[1] ?? '';
}

function setMouth(shape) {
  if (!['closed', 'small', 'round', 'wide'].includes(shape)) return false;
  mouthShape = shape;
  redrawMouth();
  return true;
}

parkedImage.addEventListener('load', redrawMouth);

function loadFrame(url) {
  let loading = decodedFrames.get(url);
  decodedFrames.delete(url);
  if (!loading) {
    const image = new Image();
    image.src = url;
    loading = image.decode().then(() => image);
    loading.catch(() => {
      if (decodedFrames.get(url) === loading) decodedFrames.delete(url);
    });
  }
  decodedFrames.set(url, loading);
  if (decodedFrames.size > 12) decodedFrames.delete(decodedFrames.keys().next().value);
  return loading;
}

function loadSprite(url) {
  if (url === spriteUrl && spritePromise) return spritePromise;
  spriteUrl = url;
  spritePromise = (async () => {
    const image = await loadFrame(url);

    const tint = document.createElement('canvas');
    tint.width = image.naturalWidth;
    tint.height = image.naturalHeight;
    const ink = tint.getContext('2d');
    ink.drawImage(image, 0, 0);
    ink.globalCompositeOperation = 'source-in';
    ink.fillStyle = color;
    ink.fillRect(0, 0, tint.width, tint.height);
    return { image, tint };
  })();
  return spritePromise;
}

function validPoint(point) {
  const clip = point?.clip;
  const focus = point?.focus;
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    Number.isFinite(point?.scale) &&
    point.scale > 0 &&
    (!focus || (Number.isFinite(focus.x) && Number.isFinite(focus.y))) &&
    (!clip ||
      (Number.isFinite(clip.x) &&
        Number.isFinite(clip.y) &&
        Number.isFinite(clip.width) &&
        Number.isFinite(clip.height) &&
        clip.width > 0 &&
        clip.height > 0))
  );
}

function validAnchor(anchor) {
  return [anchor?.x, anchor?.y].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
}

async function prepare(message) {
  finishArrival();
  const { from, to, seed, anchor = defaultAnchor, arrival } = message;
  if (
    flight ||
    !validPoint(from) ||
    !validPoint(to) ||
    !Number.isInteger(seed) ||
    !validAnchor(anchor) ||
    !spriteAddress.test(message.spriteUrl) ||
    (arrival && (!validAnchor(arrival.anchor) || !spriteAddress.test(arrival.spriteUrl)))
  )
    return false;
  if (!setPresentation(message.presentation ?? 'character')) return false;
  const next = { ...message, anchor };
  prepared = next;
  const loading = loadSprite(message.spriteUrl);
  try {
    const arriving =
      arrival && message.park !== false && arrival.spriteUrl !== message.spriteUrl
        ? loadSprite(arrival.spriteUrl)
        : loading;
    [next.sprite, next.arrivalSprite] = await Promise.all([loading, arriving]);
    return prepared === next;
  } catch {
    if (spritePromise === loading) spritePromise = undefined;
    if (prepared === next) prepared = undefined;
    return false;
  }
}

function position({ x, y, scale }, anchor) {
  return { left: x - anchor.x * scale, top: y - anchor.y * scale, scale };
}

function placeParked(point, anchor) {
  const { left, top, scale } = position(point, anchor);
  const clip = point.clip;
  const insets = clip && [
    clip.y - top,
    left + scale - clip.x - clip.width,
    top + scale - clip.y - clip.height,
    clip.x - left,
  ];
  Object.assign(parked.style, {
    transform: '',
    left: left + 'px',
    top: top + 'px',
    width: scale + 'px',
    height: scale + 'px',
    clipPath: insets
      ? 'inset(' + insets.map((value) => Math.max(0, value) + 'px').join(' ') + ')'
      : 'none',
  });
  parkedAnchor = anchor;
  placementOrigin = { ...point };
}

function cancelPlacement(revision) {
  if (Number.isSafeInteger(revision)) {
    if (revision < placementRevision) return false;
    placementRevision = revision;
  }
  cancelAnimationFrame(placementFrame);
  placementFrame = 0;
  placementPending = undefined;
  return true;
}

function flushPlacement() {
  const next = placementPending;
  placementPending = undefined;
  if (!next || parked.hidden || flight || !placementOrigin) return;
  if (pat.hearts && heartPlacement?.node !== pat.hearts)
    heartPlacement = { node: pat.hearts, x: parkedPoint.x, y: parkedPoint.y };
  parkedPoint = next.point;
  const dx = parkedPoint.x - placementOrigin.x,
    dy = parkedPoint.y - placementOrigin.y;
  parked.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  if (pat.hearts && heartPlacement?.node === pat.hearts)
    pat.hearts.style.transform = `translate3d(${parkedPoint.x - heartPlacement.x}px,${parkedPoint.y - heartPlacement.y}px,0)`;
  if (!hudPlacement) return;
  const base = hudPlacement;
  const moveX = parkedPoint.x - base.x,
    moveY = parkedPoint.y - base.y;
  const x = clamp(base.hud.x + moveX, 8, Math.max(8, innerWidth - 8 - base.hud.width));
  const y = clamp(base.hud.y + moveY, 8, Math.max(8, innerHeight - 8 - base.hud.height));
  const shiftX = x - base.hud.x,
    shiftY = y - base.hud.y;
  base.current = { x, y, width: base.hud.width, height: base.hud.height };
  hud.style.transform = `translate3d(${shiftX}px,${shiftY}px,0)`;
  if (!base.collapsed && base.bubble)
    drawReplySurface(
      base.bubble,
      base.faceX + moveX - shiftX,
      base.faceY + moveY - shiftY,
      base.tailAnchorX,
    );
  if (base.edge) {
    replyEdge = {
      ...base.edge,
      x: clamp(base.edge.x + shiftX, 0, innerWidth - base.edge.width),
      y: clamp(base.edge.y + shiftY, 0, innerHeight - base.edge.height),
    };
    replyToggle.style.transform = `translate3d(${replyEdge.x - base.edge.x}px,${replyEdge.y - base.edge.y}px,0)`;
  }
}

function setPlacement({ point, revision } = {}) {
  finishArrival();
  if (
    parked.hidden ||
    flight ||
    frameRequest ||
    !validPoint(point) ||
    !placementOrigin ||
    point.scale !== placementOrigin.scale ||
    !Number.isSafeInteger(revision) ||
    revision <= placementRevision
  )
    return false;
  placementRevision = revision;
  placementPending = { point, revision };
  if (!placementFrame)
    placementFrame = requestAnimationFrame(() => {
      placementFrame = 0;
      flushPlacement();
    });
  return true;
}

function settlePlacement(revision) {
  finishArrival();
  if (revision !== placementRevision || parked.hidden || flight || frameRequest) return false;
  cancelAnimationFrame(placementFrame);
  placementFrame = 0;
  flushPlacement();
  positionHud();
  return parkedState();
}

function showPose(url, dock) {
  const seated = perchSprite.test(url);
  if (seated && seatShins.dataset.source !== url) {
    seatShins.dataset.source = url;
    seatShins.style.backgroundImage = `url(${JSON.stringify(url)})`;
  }
  const name = seated ? 'seat' : (dock ?? '');
  const frameId = frameIdFor(url);
  const pose = avatarPoseLandmarks(frameId);
  if (parked.dataset.dock === name && parked.dataset.poseFrame === (pose ? frameId : '')) return;
  clearGripExpression();
  parked.dataset.dock = name;
  parked.dataset.poseFrame = pose ? frameId : '';
  parked.toggleAttribute('data-legacy-seat', seated);
  lastSwing = undefined;
  rasterPose = pose;
  gripPose = pose ? null : avatarGripPose(name);
  movingLimbs = [];
  poseMotion.replaceChildren();
  gripBehind.replaceChildren();
  gripFront.replaceChildren();
  parked.toggleAttribute('data-grip', Boolean(gripPose));
  stage.toggleAttribute('data-mirror', gripPose?.mirror === true);
  gripFace.toggleAttribute('data-registered-face', Boolean(pose));
  if (gripPose) {
    const { head, layers } = gripPose;
    portrait.style.transform = `translate(${(head.x / 1254) * 100}%, ${(head.y / 1254) * 100}%) scale(${head.scale})`;
    portrait.style.clipPath =
      'polygon(' +
      head.clip.map(([x, y]) => `${(x / 1254) * 100}% ${(y / 1254) * 100}%`).join(',') +
      ')';
    for (const { part, fill, points, behindHead, swing } of layers) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      node.setAttribute('data-part', part);
      node.setAttribute('points', points.map(([x, y]) => `${x},${y}`).join(' '));
      node.setAttribute('fill', fill);
      (behindHead ? gripBehind : gripFront).append(node);
      if (swing) movingLimbs.push({ node, swing });
    }
  } else {
    portrait.style.transform = '';
    portrait.style.clipPath = '';
  }
  if (pose) prepareRasterMotion(frameId, url);
  seatShins.style.setProperty(
    '--seat-shin-pivot',
    avatarSeatHinge.map((v) => `${v * 100}%`).join(' '),
  );
  drawPoseMotion();
}

function prepareRasterMotion(frameId, url) {
  const segments = avatarPoseSegments(frameId);
  if (!segments.length) return;
  const defs = svgNode('defs', {});
  const clip = svgNode('clipPath', {
    id: 'avatar-pose-static',
    clipPathUnits: 'objectBoundingBox',
  });
  let outline = 'M0 0H1V1H0Z';
  for (const [index, segment] of segments.entries()) {
    const {
      bounds: [left, top, right, bottom],
    } = segment;
    outline += `M${left / 1254} ${top / 1254}H${right / 1254}V${bottom / 1254}H${left / 1254}Z`;
    const id = `avatar-pose-limb-${index}`;
    const mask = svgNode('clipPath', { id });
    // A short overlap through the hinge covers subpixel antialiasing at the seam.
    mask.append(
      svgNode('rect', { x: left, y: top - 5, width: right - left, height: bottom - top + 5 }),
    );
    defs.append(mask);
    const limb = svgNode('g', {});
    limb.append(
      svgNode('image', { href: url, width: 1254, height: 1254, 'clip-path': `url(#${id})` }),
    );
    poseMotion.append(limb);
    movingLimbs.push({ node: limb, segment });
  }
  clip.append(svgNode('path', { d: outline, 'clip-rule': 'evenodd' }));
  defs.prepend(clip);
  poseMotion.prepend(defs);
}

function clearGripExpression() {
  gripFaceRequest++;
  clearTimeout(gripFaceTimer);
  gripFace.hidden = true;
}

async function showGripExpression(tone) {
  if (rasterPose) {
    if (!['curious', 'neutral', 'boundary', 'blink'].includes(tone)) return;
    clearTimeout(gripFaceTimer);
    if (gripFace.width !== 1254) gripFace.width = gripFace.height = 1254;
    const painter = gripFace.getContext('2d');
    if (!painter) return;
    painter.clearRect(0, 0, 1254, 1254);
    drawPoseEyes(painter, rasterPose, tone);
    gripFace.dataset.frame = tone;
    gripFace.hidden = false;
    gripFaceTimer = setTimeout(clearGripExpression, tone === 'blink' ? 105 : 740);
    return;
  }
  if (!gripPose) return;
  const frame = { curious: 'skeptical', neutral: 'attentive', boundary: 'annoyed' }[tone];
  if (!frame) return;
  clearTimeout(gripFaceTimer);
  const request = ++gripFaceRequest;
  try {
    const expression = await loadFrame(`capri://desktop/sprites/${frame}.png`);
    if (request !== gripFaceRequest || parked.hidden) return;
    const { naturalWidth: width, naturalHeight: height } = expression;
    if (gripFace.width !== width) gripFace.width = width;
    if (gripFace.height !== height) gripFace.height = height;
    const painter = gripFace.getContext('2d');
    if (!painter) return;
    painter.clearRect(0, 0, width, height);
    painter.drawImage(expression, 0, 0);
    gripFace.dataset.frame = frame;
    gripFace.hidden = false;
    gripFaceTimer = setTimeout(clearGripExpression, 740);
  } catch {
    if (request === gripFaceRequest) clearGripExpression();
    // Pulse feedback still works if the optional expression frame is absent.
  }
}

function drawPoseMotion() {
  const now = Date.now();
  if (rasterPose) {
    const moving = !parked.hidden && !motionPreference.matches && movingLimbs.length > 0;
    poseMotion.toggleAttribute('data-active', moving);
    portrait.style.clipPath = moving ? 'url(#avatar-pose-static)' : '';
    for (const { node, segment } of movingLimbs) {
      const [x, y] = segment.pivot;
      const swing = moving ? avatarPoseSwing(now, segment) : 0;
      node.setAttribute('transform', `rotate(${swing} ${x} ${y})`);
    }
    return;
  }
  const seated = parked.hasAttribute('data-legacy-seat');
  const swing = motionPreference.matches
    ? 0
    : seated
      ? avatarSeatSwing(now)
      : avatarGripSwing(now, parked.dataset.dock);
  if (lastSwing === swing) return;
  lastSwing = swing;
  if (seated) seatShins.style.setProperty('--seat-shin-angle', `${swing}deg`);
  for (const {
    node,
    swing: [x, y, direction],
  } of movingLimbs)
    node.setAttribute('transform', `rotate(${swing * direction} ${x} ${y})`);
}

function animatePose() {
  clearTimeout(motionFrame);
  if (document.body.dataset.presentation === 'dialogue') return;
  motionFrame = 0;
  drawPoseMotion();
  if (
    !parked.hidden &&
    !motionPreference.matches &&
    (movingLimbs.length || parked.hasAttribute('data-legacy-seat'))
  )
    motionFrame = setTimeout(animatePose, 1000 / 12);
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  if (document.body.dataset.presentation === 'dialogue') return;
  if (
    parked.hidden ||
    !rasterPose ||
    motionPreference.matches ||
    Object.hasOwn(MUSIC_POSES, frameIdFor(parkedImage.src))
  )
    return;
  blinkTimer = setTimeout(
    () => {
      if (gripFace.hidden && pat.image(parkedImage) === parkedImage)
        void showGripExpression('blink');
      scheduleBlink();
    },
    3300 + Math.random() * 2200,
  );
}

motionPreference.addEventListener('change', () => {
  animatePose();
  scheduleBlink();
  ensureMusicAnimation();
});
document.addEventListener('visibilitychange', ensureMusicAnimation);

function parkedState() {
  return { ...replyState(), reducedMotion: motionPreference.matches };
}

async function park({ point, anchor, url, dock } = {}) {
  finishArrival();
  if (flight || !validPoint(point) || !validAnchor(anchor) || !spriteAddress.test(url))
    return false;
  cancelPlacement();
  const image = await loadFrame(url);
  parkedPoint = point;
  placeParked(point, anchor);
  parkedImage.src = image.src;
  showPose(image.src, dock);
  parked.hidden = false;
  animatePose();
  scheduleBlink();
  showHud();
  return parkedState();
}

async function setFrame(value) {
  finishArrival();
  const {
    url,
    anchor = parkedAnchor,
    point,
    dock,
  } = typeof value === 'string' ? { url: value } : (value ?? {});
  if (
    parked.hidden ||
    typeof url !== 'string' ||
    !spriteAddress.test(url) ||
    !validAnchor(anchor) ||
    (point !== undefined && !validPoint(point))
  )
    return false;
  cancelPlacement();
  const request = (frameRequest = {});
  try {
    const image = await loadFrame(url);
    if (request !== frameRequest) return false;
    const frameId = frameIdFor(url);
    const poseChanged =
      parked.dataset.dock !== (perchSprite.test(url) ? 'seat' : (dock ?? '')) ||
      parked.dataset.poseFrame !== (avatarPoseLandmarks(frameId) ? frameId : '');
    const moved =
      point &&
      (point.x !== parkedPoint.x || point.y !== parkedPoint.y || point.scale !== parkedPoint.scale);
    const placementChanged = point || parkedAnchor.x !== anchor.x || parkedAnchor.y !== anchor.y;
    if (poseChanged || moved) pat.clear();
    if (parkedImage.src !== image.src) parkedImage.src = image.src;
    if (placementChanged) {
      parkedPoint = point ?? parkedPoint;
      placeParked(parkedPoint, anchor);
    }
    showPose(image.src, dock);
    if (poseChanged) {
      animatePose();
      scheduleBlink();
      if (!motionPreference.matches && rasterPose) {
        stage.getAnimations().forEach((animation) => animation.cancel());
        stage.animate([{ filter: 'brightness(1.27) saturate(1.1)' }, { filter: 'none' }], {
          duration: 145,
          easing: 'ease-out',
        });
      }
    }
    if (poseChanged || placementChanged) positionHud();
    return parkedState();
  } catch {
    return false;
  } finally {
    if (frameRequest === request) frameRequest = undefined;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionHud() {
  if (parked.hidden || (status.hidden && reply.hidden && !replyCollapsed)) {
    hudPlacement = undefined;
    return;
  }
  flushPlacement();
  hud.style.transform = '';
  replyToggle.style.transform = '';
  const { left, top, scale } = position(parkedPoint, parkedAnchor);
  // Face and crown landmarks on each registered sprite canvas.
  const perched = perchSprite.test(parkedImage.src);
  const head = gripPose?.head ?? { x: 0, y: 0, scale: 1 };
  const focusX = rasterPose?.face[0] ?? head.x + (perched ? 649 : 642) * head.scale;
  const focusY = rasterPose?.face[1] ?? head.y + (perched ? 488 : 394) * head.scale;
  const crown = rasterPose?.crown ?? head.y + (perched ? 195 : 112) * head.scale;
  const faceX = left + ((gripPose?.mirror ? 1254 - focusX : focusX) / 1254) * scale;
  const faceY = top + (focusY / 1254) * scale;
  const crownY = top + (crown / 1254) * scale;
  const hasReply = Boolean(replySnapshot?.text.trim());
  const wasHidden = reply.hidden;
  status.style.width = 'max-content';
  status.style.maxWidth = Math.min(344, innerWidth - 16) + 'px';
  const badge = {
    width: status.hidden ? 0 : status.offsetWidth,
    height: status.hidden ? 0 : status.offsetHeight,
  };
  let layout;
  if (hasReply) {
    // Measure the actual next reply even while collapsed. Opening must not flip
    // the tab to another side or reserve an invisible full-width hit region.
    reply.hidden = false;
    reply.style.width = Math.min(344, innerWidth - 16) + 'px';
    renderReply();
    const measure = () =>
      detachedReplyLayout({
        width: innerWidth,
        height: innerHeight,
        faceX,
        faceY,
        crownY,
        scale,
        badge,
        reply: { width: reply.offsetWidth, height: reply.offsetHeight },
        collapsed: replyCollapsed,
        inverted: rasterPose?.inverted === true,
      });
    layout = measure();
    if (Math.abs(layout.reply.width - reply.offsetWidth) > 0.5) {
      reply.style.width = layout.reply.width + 'px';
      renderReply();
      layout = measure();
    }
    reply.hidden = wasHidden;
  } else {
    const x = clamp(faceX - badge.width / 2, 8, innerWidth - 8 - badge.width);
    const y = clamp(crownY - 16 - badge.height, 8, innerHeight - 8 - badge.height);
    layout = { badge: { x, y, ...badge }, hud: { x, y, ...badge } };
  }
  const { hud: box, badge: label, reply: bubble, tab, side } = layout;
  Object.assign(hud.style, {
    left: box.x + 'px',
    top: box.y + 'px',
    width: box.width + 'px',
    height: box.height + 'px',
  });
  Object.assign(status.style, { left: label.x - box.x + 'px', top: label.y - box.y + 'px' });
  let tailAnchorX;
  if (bubble) {
    Object.assign(reply.style, {
      left: bubble.x - box.x + 'px',
      top: bubble.y - box.y + 'px',
      width: bubble.width + 'px',
    });
    if (side === 'above' || side === 'below') {
      // Reserve the status tab's gap. The tail still points to the actual face.
      const anchors = [tab.x - 26, tab.x + tab.width + 26].filter(
        (x) => x >= bubble.x + 18 && x <= bubble.x + bubble.width - 18,
      );
      tailAnchorX = anchors.sort((a, b) => Math.abs(a - faceX) - Math.abs(b - faceX))[0];
    }
    drawReplySurface(bubble, faceX, faceY, tailAnchorX);
    replyText.scrollTop = 0;
    replyEdge = { ...tab };
    Object.assign(replyToggle.style, {
      left: tab.x + 'px',
      top: tab.y + 'px',
      width: tab.width + 'px',
      height: tab.height + 'px',
    });
    replyToggle.dataset.side = side;
    replyToggle.toggleAttribute('data-expanded', !replyCollapsed);
  } else replyEdge = undefined;
  hudPlacement = {
    x: parkedPoint.x,
    y: parkedPoint.y,
    hud: box,
    current: box,
    edge: replyEdge && { ...replyEdge },
    collapsed: replyCollapsed,
    faceX,
    faceY,
    bubble: bubble && { ...bubble },
    tailAnchorX,
  };
}

function setReplyNear(value) {
  replyNear = value === true;
  replyToggle.hidden = !replyEdge || parked.hidden || (replyCollapsed && !replyNear);
}

function replyState() {
  const replyControls = [];
  if (!parked.hidden && !reply.hidden && !replyNavigation.hidden)
    for (const [action, button] of [
      ['previous', replyPrevious],
      ['next', replyNext],
    ]) {
      if (button.disabled) continue;
      const { x, y, width, height } = button.getBoundingClientRect();
      replyControls.push({ action, x, y, width, height });
    }
  return {
    replyEdge,
    replyControls,
    replyCollapsed,
    ...(hudPlacement && {
      replyLayout: {
        x: parkedPoint.x,
        y: parkedPoint.y,
        hud: { ...hudPlacement.current },
        collapsed: replyCollapsed,
      },
    }),
  };
}

function replyFits(text) {
  const style = getComputedStyle(replyText);
  replyMeasure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const width = Math.max(1, replyText.clientWidth - 24);
  const lines = Math.max(
    1,
    Math.floor((Math.min(150, innerHeight - 88) - 18) / parseFloat(style.lineHeight)),
  );
  let used = 0,
    count = 1;
  for (const word of text.split(' ')) {
    const segment = (used ? ' ' : '') + word;
    if (used + replyMeasure.measureText(segment).width <= width) {
      used += replyMeasure.measureText(segment).width;
      continue;
    }
    if (used) {
      count++;
      used = 0;
    }
    for (const character of Array.from(word)) {
      const advance = replyMeasure.measureText(character).width;
      if (used && used + advance > width) {
        count++;
        used = 0;
      }
      used += advance;
    }
    if (count > lines) return false;
  }
  return true;
}

function renderReply() {
  if (!replySnapshot) return;
  const width = replyText.clientWidth;
  if (width < 24) {
    replyText.textContent = replySnapshot.text.trim();
    replyNavigation.hidden = true;
    return;
  }
  if (replyDirty || width !== replyLayoutWidth) {
    replyPages.update(replySnapshot, replyFits, `${width}:${replyFontRevision}`);
    replyDirty = false;
    replyLayoutWidth = width;
  }
  const view = replyPages.view();
  replyText.textContent = view.text;
  replyNavigation.hidden = view.total < 2 || !view.text;
  replyPrevious.disabled = !view.previous;
  replyNext.disabled = !view.next;
  replyPosition.textContent = `${view.index + 1} / ${view.total}`;
}

function showHud() {
  reply.hidden = parked.hidden || !replyText.textContent || replyCollapsed;
  status.hidden = parked.hidden || !status.textContent;
  if (parked.hidden || !replyText.textContent) replyEdge = undefined;
  positionHud();
  setReplyNear(replyNear);
}

function setReply({ text, turnId, collapsed, history } = {}) {
  if (typeof text !== 'string' || typeof turnId !== 'string') return false;
  if (turnId !== replyTurn) {
    replyTurn = turnId;
    replyCollapsed = collapsed === true;
  }
  replySnapshot = { text, turnId, history };
  replyDirty = true;
  renderReply();
  replyToggle.setAttribute('aria-label', replyCollapsed ? replyLabels.show : replyLabels.hide);
  showHud();
  return replyState();
}

function toggleReply() {
  if (!replyEdge || !replyText.textContent || parked.hidden) return false;
  replyCollapsed = !replyCollapsed;
  replyNear = false;
  replyToggle.setAttribute('aria-label', replyCollapsed ? replyLabels.show : replyLabels.hide);
  showHud();
  return replyState();
}

function stepReply(direction) {
  if (![-1, 1].includes(direction) || parked.hidden || reply.hidden) return false;
  replyPages.step(direction);
  renderReply();
  showHud();
  return replyState();
}

function setStatus(value) {
  const { text = '', color, replyLabels: labels } = value ?? {};
  if (value !== null && (typeof text !== 'string' || !/^#[\da-f]{6}$/i.test(color))) return false;
  sleeping = value?.sleeping === true;
  document.body.dataset.sleeping = String(sleeping);
  if (sleeping) {
    pat.clear();
    clearGripExpression();
    document.getElementById('avatar-tap')?.remove();
  }
  if (typeof labels?.show === 'string' && typeof labels?.hide === 'string') {
    replyLabels = labels;
    replyToggle.setAttribute('aria-label', replyCollapsed ? labels.show : labels.hide);
  }
  if (typeof labels?.previous === 'string') {
    replyPrevious.setAttribute('aria-label', labels.previous);
    replyPrevious.title = labels.previous;
  }
  if (typeof labels?.next === 'string') {
    replyNext.setAttribute('aria-label', labels.next);
    replyNext.title = labels.next;
  }
  if (typeof labels?.navigation === 'string')
    replyNavigation.setAttribute('aria-label', labels.navigation);
  const clean = text.trim();
  if (status.textContent !== clean) status.textContent = clean;
  if (color)
    status.style.setProperty(
      '--avatar-signal',
      color === SIGNAL_STATES.online.color ? 'var(--cyan, #8ef5ed)' : color,
    );
  replyToggle.style.setProperty(
    '--avatar-signal',
    status.style.getPropertyValue('--avatar-signal'),
  );
  showHud();
  ensureMusicAnimation();
  return replyState();
}

function resizeEffect() {
  const bounds = { width: innerWidth, height: innerHeight };
  flight.motion = prepareTeleportMotion({
    ...flight,
    scale: Math.min(flight.from.scale, flight.to.scale),
    bounds: flight.crossing ? undefined : bounds,
  });
  const region = teleportViewport(
    flight.motion,
    flight.from,
    flight.to,
    flight.anchor,
    bounds,
    flight.arrival?.anchor,
  );
  flight.region = region;
  const pixelRatio = Math.min(
    devicePixelRatio || 1,
    2,
    Math.sqrt(8_294_400 / (region.width * region.height)),
  );
  Object.assign(effect.style, {
    left: `${region.x}px`,
    top: `${region.y}px`,
    width: `${region.width}px`,
    height: `${region.height}px`,
  });
  effect.width = Math.max(1, Math.round(region.width * pixelRatio));
  effect.height = Math.max(1, Math.round(region.height * pixelRatio));
  const scaleX = effect.width / region.width;
  const scaleY = effect.height / region.height;
  context.setTransform(scaleX, 0, 0, scaleY, -region.x * scaleX, -region.y * scaleY);
}

function markArrivalReady(run) {
  if (flight !== run || run.arrivalReady) return;
  run.arrivalReady = true;
  if (run.interactiveArrival === true)
    run.resolvePlay(run.arrival && run.park !== false ? parkedState() : true);
}

function paint() {
  const run = flight;
  const { from, to, frame, sprite, anchor, arrival, arrivalSprite, motion, region } = run;
  context.clearRect(region.x, region.y, region.width, region.height);
  draw(context, {
    frame,
    from,
    to,
    anchor,
    arrivalAnchor: arrival?.anchor,
    motion,
    materialize: flight.park !== false,
    drawCapri(point, tint = 0) {
      const arriving = point === to && arrival;
      const image = arriving ? arrivalSprite : sprite;
      const { left, top, scale } = position(point, arriving ? arrival.anchor : anchor);
      context.save();
      if (point.clip) {
        const { x, y, width, height } = point.clip;
        context.beginPath();
        context.rect(x, y, width, height);
        context.clip();
      }
      context.drawImage(image.image, left, top, scale, scale);
      if (tint > 0) {
        context.globalAlpha *= tint;
        context.drawImage(image.tint, left, top, scale, scale);
      }
      context.restore();
      if (point === to && frame > arrivalStart) markArrivalReady(run);
    },
  });
  // A crossing's source layer has no arriving sprite, but must release its
  // logical handoff with the target instead of delaying it for the bolt tail.
  if (run.park === false && run.crossing && frame > arrivalStart) markArrivalReady(run);
}

function complete(run = flight) {
  if (!run) return true;
  if (run.completed) return run.result;
  if (flight !== run) return false;
  run.completed = true;
  cancelAnimationFrame(run.raf);
  const { to, sprite, anchor, arrival, arrivalSprite, park } = run;
  flight = undefined;
  if (park !== false) {
    parkedPoint = to;
    placeParked(to, arrival?.anchor ?? anchor);
    parkedImage.src = (arrival ? arrivalSprite : sprite).image.src;
    showPose(parkedImage.src, arrival?.dock);
    parked.hidden = false;
    redrawMouth();
    ensureMusicAnimation();
    animatePose();
    scheduleBlink();
    showHud();
  }
  effect.hidden = true;
  // Parked animation uses the same sprite element without a full-screen canvas.
  effect.width = effect.height = 1;
  run.result = arrival && park !== false ? parkedState() : true;
  run.resolvePlay(run.result);
  run.resolveSettled(run.result);
  return run.result;
}

function finishArrival() {
  if (!flight?.arrivalReady) return false;
  return complete(flight);
}

function whenSettled() {
  return flight?.settled ?? true;
}

async function play(startAt) {
  if (!prepared?.sprite || flight) return false;
  pat.clear();
  clearGripExpression();
  frameRequest = undefined;
  parked.hidden = true;
  replyNear = false;
  animatePose();
  scheduleBlink();
  showHud();
  const run = (flight = { ...prepared, frame: 0, raf: 0, arrivalReady: false });
  run.played = new Promise((resolve) => {
    run.resolvePlay = resolve;
  });
  run.settled = new Promise((resolve) => {
    run.resolveSettled = resolve;
  });
  prepared = undefined;
  if (flight.reduceMotion || motionPreference.matches || !context) {
    return complete(run);
  }
  const delay = Number.isFinite(startAt) ? Math.min(100, startAt - Date.now()) : 0;
  const started = performance.now() + delay;
  const stopAt = flight.park === false ? boltOnlyFrames : frames - 1;
  resizeEffect();
  flight.frame = Math.max(0, ((performance.now() - started) * fps) / 1000);
  if (flight.frame >= stopAt) return complete(run);
  effect.hidden = false;
  paint();
  function step(now) {
    if (flight !== run || run.completed) return;
    const next = ((now - started) * fps) / 1000;
    if (next >= stopAt || motionPreference.matches) {
      complete(run);
      return;
    }
    if (next > run.frame) {
      run.frame = next;
      paint();
    }
    if (flight === run && !run.completed) run.raf = requestAnimationFrame(step);
  }
  run.raf = requestAnimationFrame(step);
  return run.played;
}

function pulse({ x, y, count, tone }) {
  if (sleeping || parked.hidden || ![x, y, count].every(Number.isFinite)) return;
  if (Object.hasOwn(MUSIC_POSES, frameIdFor(parkedImage.src))) {
    headpat({ x, y });
    return;
  }
  void showGripExpression(tone);
  showAvatarTapEffect(document.body, { x, y, count, tone, id: 'avatar-tap' });
}

function headpat(point) {
  if (!sleeping && !parked.hidden) {
    clearGripExpression();
    pat.play(
      parkedImage,
      point,
      undefined,
      !perchSprite.test(parkedImage.src) &&
        !Object.hasOwn(MUSIC_POSES, frameIdFor(parkedImage.src)),
      frameIdFor(parkedImage.src),
    );
  }
}

addEventListener('resize', () => {
  if (flight && !effect.hidden) {
    resizeEffect();
    paint();
  }
  positionHud();
});
document.fonts.addEventListener('loadingdone', () => {
  replyFontRevision++;
  replyDirty = true;
  positionHud();
});
function setPresentation(value) {
  if (!['character', 'dialogue'].includes(value)) return false;
  const changed = document.body.dataset.presentation !== value;
  document.body.dataset.presentation = value;
  if (changed && value === 'dialogue') {
    cancelAnimationFrame(musicFrame);
    musicFrame = 0;
    clearTimeout(motionFrame);
    clearTimeout(blinkTimer);
    musicNotes?.destroy();
    musicNotes = undefined;
    pat.clear();
    stage.style.transform = '';
  } else if (changed) {
    redrawMouth();
    animatePose();
    scheduleBlink();
  }
  showHud();
  return parkedState();
}
globalThis.capriAvatarDetach = Object.freeze({
  setPresentation,
  setTheme: (theme) => applyInterfaceTheme(theme),
  setTether: (value) => {
    musicDragging = Boolean(value);
    tether.draw(value);
    ensureMusicAnimation();
  },
  setMusic,
  prepare,
  park,
  play,
  finishArrival,
  whenSettled,
  pulse,
  headpat,
  setFrame,
  setPlacement,
  cancelPlacement,
  settlePlacement,
  setMouth,
  setReply,
  stepReply,
  setReplyNear,
  toggleReply,
  setStatus,
  waitForMotionChange(previous) {
    if (motionPreference.matches !== previous) return motionPreference.matches;
    return new Promise((resolve) => {
      motionPreference.addEventListener('change', (event) => resolve(event.matches), {
        once: true,
      });
    });
  },
});
