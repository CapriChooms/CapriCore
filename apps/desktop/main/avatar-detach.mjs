// SPDX-License-Identifier: GPL-3.0-only
import { randomInt } from 'node:crypto';
import { COMPANION_DEFAULTS } from '../companion-settings.mjs';
import { pointInRect, spriteDragHit, spritePressKind } from '../geometry.mjs';

const overlayUrl = 'capri://desktop/avatar-detach.html';
const keys = ['x', 'y', 'width', 'height'];
const dragDistance = 5;
const tetherInterval = 20;
const stackingInterval = 750;
const isCursor = ({ x, y }) => Number.isFinite(x) && Number.isFinite(y);
/** Cursor displacement is in Windows logical pixels, independent of sprite size and grab anchor. */
export function avatarDragCanTeleport(from, to, settings = {}) {
  if (!from || !to || !isCursor(from) || !isCursor(to)) return false;
  const configured = settings?.avatarDragTetherDeadZone;
  const deadZone = Number.isFinite(configured)
    ? Math.max(0, Math.min(120, configured))
    : COMPANION_DEFAULTS.avatarDragTetherDeadZone;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  // Fractional-DPI coordinates can turn an exact boundary into 90.00000000000006.
  return distance >= dragDistance && distance > deadZone + 1e-6;
}
const isRect = (value) =>
  value && keys.every((key) => Number.isFinite(value[key])) && value.width > 0 && value.height > 0;

function intersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function withinRadius(point, rect, radius) {
  const dx = Math.max(rect.x - point.x, point.x - (rect.x + rect.width), 0);
  const dy = Math.max(rect.y - point.y, point.y - (rect.y + rect.height), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function portraitGeometry({ rect, clip } = {}, content) {
  if (
    !isRect(rect) ||
    !isRect(clip) ||
    Math.abs(rect.width - rect.height) > 1 ||
    rect.width > 3 * Math.max(content.width, content.height)
  ) {
    throw new Error('Invalid portrait geometry.');
  }
  const bounded = intersection(clip, { x: 0, y: 0, width: content.width, height: content.height });
  const visible = bounded && intersection(bounded, rect);
  if (!visible || visible.width < 12 || visible.height < 12)
    throw new Error('The portrait is outside the window.');
  return { rect, clip: visible };
}

function portraitPoint(source, content, area, anchor) {
  const dx = content.x - area.x;
  const dy = content.y - area.y;
  const clip = intersection(
    { ...source.clip, x: source.clip.x + dx, y: source.clip.y + dy },
    { x: 0, y: 0, width: area.width, height: area.height },
  );
  if (!clip) return null;
  return {
    x: source.rect.x + dx + source.rect.width * anchor.x,
    y: source.rect.y + dy + source.rect.height * anchor.y,
    scale: source.rect.width,
    focus: { x: clip.x + clip.width / 2, y: clip.y + clip.height / 2 },
    clip,
  };
}

function cursorLanding(cursor, area, scale, anchor) {
  const x = Math.max(0, Math.min(area.width - scale, cursor.x - area.x - scale * anchor.x));
  const y = Math.max(0, Math.min(area.height - scale, cursor.y - area.y - scale * anchor.y));
  return { x: x + scale * anchor.x, y: y + scale * anchor.y, scale, key: x + ',' + y };
}

function anchoredPoint(seat, area, scale, anchor, visible, canvas) {
  const left = (visible.x / canvas.width - anchor.x) * scale;
  const right = ((visible.x + visible.width) / canvas.width - anchor.x) * scale;
  const top = (visible.y / canvas.height - anchor.y) * scale;
  const bottom = ((visible.y + visible.height) / canvas.height - anchor.y) * scale;
  return {
    x: Math.max(-left, Math.min(area.width - right, seat.x - area.x)),
    y: Math.max(-top, Math.min(area.height - bottom, seat.y - area.y)),
    scale,
  };
}

function focusPose(point, anchor, { x, y, width, height }, canvas) {
  return {
    ...point,
    focus: {
      x: point.x + ((x + width / 2) / canvas.width - anchor.x) * point.scale,
      y: point.y + ((y + height / 2) / canvas.height - anchor.y) * point.scale,
    },
  };
}

function poseMask(frame, mask) {
  return mask && frame.visibleBounds
    ? {
        ...mask,
        visibleBounds: frame.visibleBounds,
        ...(['reviewed_pose', 'reviewed_music'].includes(frame.kind) && { poseId: frame.id }),
      }
    : mask;
}

function rebasePoint(point, fromArea, toArea) {
  if (fromArea === toArea) return point;
  const dx = fromArea.x - toArea.x;
  const dy = fromArea.y - toArea.y;
  const translate = (value) => ({ ...value, x: value.x + dx, y: value.y + dy });
  return {
    ...translate(point),
    ...(point.focus && { focus: translate(point.focus) }),
    ...(point.clip && { clip: translate(point.clip) }),
  };
}

function tetherCrosses(from, to, area) {
  let enter = 0;
  let exit = 1;
  // Include the farthest bend plus red sparks when a neighboring display is close.
  for (const [axis, size] of [
    ['x', 'width'],
    ['y', 'height'],
  ]) {
    const start = from[axis];
    const delta = to[axis] - start;
    const min = area[axis] - 55;
    const max = area[axis] + area[size] + 55;
    if (!delta) {
      if (start < min || start > max) return false;
      continue;
    }
    const a = (min - start) / delta;
    const b = (max - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}

function tetherStyle({
  avatarDragTether,
  avatarDragTetherIntensity: intensity,
  avatarDragTetherChaos: chaos = COMPANION_DEFAULTS.avatarDragTetherChaos,
  avatarDragTetherDeadZone: deadZone = COMPANION_DEFAULTS.avatarDragTetherDeadZone,
} = {}) {
  return avatarDragTether && intensity > 0 ? { intensity, chaos, deadZone } : null;
}

function landing(area, content, origin, scale, anchor, seen) {
  const inset = Math.min(18, area.width * 0.04, area.height * 0.04);
  const maxX = Math.floor(area.width - scale - inset);
  const maxY = Math.floor(area.height - scale - inset);
  const min = Math.ceil(inset);
  const occupied = { ...content, x: content.x - area.x, y: content.y - area.y };
  const gap = Math.min(180, Math.hypot(maxX - min, maxY - min) * 0.29);
  let best;
  for (const [left, top] of [
    ...Array.from({ length: 24 }, () => [randomInt(min, maxX + 1), randomInt(min, maxY + 1)]),
    [min, min],
    [min, maxY],
    [maxX, min],
    [maxX, maxY],
  ]) {
    const key = left + ',' + top;
    if (seen.has(key)) continue;
    const x = left + anchor.x * scale;
    const y = top + anchor.y * scale;
    const distance = Math.hypot(x - origin.x, y - origin.y);
    const clear = !intersection(occupied, { x: left, y: top, width: scale, height: scale });
    const point = { x, y, scale, key };
    if (clear && distance >= gap) return point;
    const score = distance + (clear ? gap : 0);
    if (!best || score > best.score) best = { point, score };
  }
  if (!best) throw new Error('No new position is available on this display.');
  return best.point;
}

async function withTimeout(task, timeoutMs, cancelled) {
  let timer;
  try {
    return await Promise.race([
      task,
      ...(cancelled ? [cancelled] : []),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The teleport renderer timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A user-triggered presentation layer; the companion window keeps owning chat and input. */
export class AvatarDetach {
  constructor({
    BrowserWindow,
    screen,
    owner,
    getOwnerDisplay = () => screen.getDisplayMatching(owner.getContentBounds()),
    onPhase,
    onRaised = () => {},
    onPointer = () => {},
    onClick = () => {},
    onHeadpat = () => {},
    onDragDrop = () => {},
    watchRelease = () => {},
    verification = false,
    getEffects = () => undefined,
    getSleeping = () => false,
    getTheme = () => undefined,
    getPresentation = () => 'character',
    getPortraitGeometry = () => undefined,
    onReturnPlacement = () => {},
    timeoutMs = 5000,
  }) {
    Object.assign(this, {
      BrowserWindow,
      screen,
      owner,
      getOwnerDisplay,
      onPhase,
      onRaised,
      onPointer,
      onClick,
      onHeadpat,
      onDragDrop,
      watchRelease,
      verification,
      getEffects,
      getSleeping,
      getTheme,
      getPresentation,
      getPortraitGeometry,
      onReturnPlacement,
      timeoutMs,
    });
    this.phase = 'attached';
    this.presentation = this.getPresentation();
    this.tetherViews = new Map();
    this.settlingOverlays = new Set();
    this.replyControls = [];
    this.replyGeometryEpoch = 0;
    this.placementRevision = 0;
    this.placementGeneration = 0;
  }

  get available() {
    return this.phase === 'detached' && !this.operation && !this.relocation;
  }

  get desktopPoint() {
    if (!this.session?.point) return null;
    const { area, point } = this.session;
    return { x: area.x + point.x, y: area.y + point.y };
  }

  /** Current status, reply and tab bounds in desktop DIP, including follow motion. */
  get hudBounds() {
    const session = this.session,
      base = this.replyPlacement;
    if (!this.available || !session || !this.overlay?.isVisible()) return null;
    const { area, point } = session;
    const rects = [];
    if (base && isRect(base.hud)) {
      const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
      rects.push({
        x:
          area.x +
          clamp(base.hud.x + point.x - base.x, 8, Math.max(8, area.width - 8 - base.hud.width)),
        y:
          area.y +
          clamp(base.hud.y + point.y - base.y, 8, Math.max(8, area.height - 8 - base.hud.height)),
        width: base.hud.width,
        height: base.hud.height,
      });
    }
    // Older installed renderers report the tab separately from the status box.
    if (isRect(this.replyEdge))
      rects.push({ ...this.replyEdge, x: area.x + this.replyEdge.x, y: area.y + this.replyEdge.y });
    if (!rects.length) return null;
    const x = Math.min(...rects.map((r) => r.x)),
      y = Math.min(...rects.map((r) => r.y));
    return {
      x,
      y,
      width: Math.max(...rects.map((r) => r.x + r.width)) - x,
      height: Math.max(...rects.map((r) => r.y + r.height)) - y,
    };
  }

  sendReply(value) {
    if (value.turnId !== this.reply?.turnId) {
      this.replyCollapsed = false;
      this.replyNear = false;
      this.replySuppressedEdge = null;
      this.replyControls = [];
    }
    this.reply = value;
    if (typeof value.autoCollapsed === 'boolean') {
      this.replyCollapsed = value.autoCollapsed;
      if (this.replyCollapsed) this.replyControls = [];
    }
    if (this.available)
      this.updateParked('setReply', { ...value, collapsed: this.replyCollapsed }).catch(() => {});
  }

  sendStatus(value) {
    this.status = value;
    if (this.available) this.updateParked('setStatus', value).catch(() => {});
  }

  refreshTheme(overlays = [this.overlay, this.nextOverlay]) {
    const theme = this.getTheme();
    if (!theme) return;
    for (const overlay of overlays) {
      if (!overlay || overlay.isDestroyed() || overlay.webContents.getURL() !== overlayUrl)
        continue;
      void overlay.webContents
        .executeJavaScript(`globalThis.capriAvatarDetach.setTheme(${JSON.stringify(theme)})`)
        .catch(() => {});
    }
  }

  async refreshPresentation() {
    if (!this.available) return false;
    const presentation = this.getPresentation();
    if (this.presentation === presentation) return false;
    const result = await this.updateParked('setPresentation', presentation);
    if (result === false) return false;
    this.presentation = presentation;
    if (this.pointerTimer) {
      this.stopPointer();
      this.startPointer();
    }
    this.onPointer(this.screen.getCursorScreenPoint());
    return result;
  }

  sendMouth(shape) {
    this.mouth = shape;
    if (this.available) this.updateParked('setMouth', shape).catch(() => {});
  }

  sendMusic(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      (value.autoBpm !== undefined && typeof value.autoBpm !== 'boolean') ||
      ['enabled', 'hearingMusic', 'notes', 'motion'].some(
        (key) => typeof value[key] !== 'boolean',
      ) ||
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
    this.music = {
      enabled: value.enabled,
      hearingMusic: value.hearingMusic,
      notes: value.notes,
      motion: value.motion,
      ...(value.autoBpm !== undefined ? { autoBpm: value.autoBpm } : {}),
      energy: value.energy,
      tempo: value.tempo,
      ...(value.tempoConfidence !== undefined ? { tempoConfidence: value.tempoConfidence } : {}),
      ...(value.beatAt !== undefined ? { beatAt: value.beatAt } : {}),
    };
    if (this.available) this.updateParked('setMusic', this.music).catch(() => {});
    return true;
  }

  async updateParked(method, value) {
    const contents = this.overlay?.webContents;
    if (!contents || this.overlay.isDestroyed() || contents.getURL() !== overlayUrl) return false;
    const replyTurn = this.reply?.turnId;
    const replyGeometryEpoch = this.replyGeometryEpoch;
    const placementGeneration = this.placementGeneration;
    const frameUpdate = this.frameUpdate;
    const result = await contents.executeJavaScript(
      `globalThis.capriAvatarDetach.${method}(${JSON.stringify(value)})`,
    );
    if (
      this.overlay?.webContents === contents &&
      this.reply?.turnId === replyTurn &&
      this.replyGeometryEpoch === replyGeometryEpoch &&
      this.placementGeneration === placementGeneration &&
      (method !== 'setFrame' || this.frameUpdate === frameUpdate) &&
      result &&
      Object.hasOwn(result, 'replyEdge')
    ) {
      const edge = result.replyEdge;
      const previousEdge = this.replyEdge;
      const area = this.session?.area;
      this.replyEdge =
        isRect(edge) &&
        area &&
        edge.width <= 30 &&
        edge.height <= 32 &&
        edge.x >= 0 &&
        edge.y >= 0 &&
        edge.x + edge.width <= area.width + 1 &&
        edge.y + edge.height <= area.height + 1
          ? edge
          : null;
      const controls = result.replyControls;
      this.replyControls =
        !(method === 'toggleReply' ? result.replyCollapsed === true : this.replyCollapsed) &&
        Array.isArray(controls) &&
        controls.length <= 2 &&
        new Set(controls.map((control) => control?.action)).size === controls.length &&
        controls.every(
          (control) =>
            ['previous', 'next'].includes(control?.action) &&
            isRect(control) &&
            area &&
            control.width <= 28 &&
            control.height <= 28 &&
            control.x >= 0 &&
            control.y >= 0 &&
            control.x + control.width <= area.width &&
            control.y + control.height <= area.height,
        )
          ? controls.map(({ action, x, y, width, height }) => ({ action, x, y, width, height }))
          : [];
      if (method === 'toggleReply') {
        this.replyCollapsed = result.replyCollapsed === true;
        this.replySuppressedEdge = this.replyCollapsed ? previousEdge : null;
        this.replyNear = false;
        if (this.replyCollapsed) this.replyControls = [];
      }
      const layout = result.replyLayout;
      this.replyPlacement =
        layout &&
        area &&
        layout.hud &&
        keys.every((key) => Number.isFinite(layout.hud[key])) &&
        layout.hud.width >= 0 &&
        layout.hud.height >= 0 &&
        layout.hud.x >= 0 &&
        layout.hud.y >= 0 &&
        layout.hud.x + layout.hud.width <= area.width + 1 &&
        layout.hud.y + layout.hud.height <= area.height + 1 &&
        Number.isFinite(layout.x) &&
        Number.isFinite(layout.y) &&
        layout.hud.width <= area.width + 1 &&
        layout.hud.height <= area.height + 1
          ? {
              ...layout,
              edge: this.replyEdge && { ...this.replyEdge },
              controls: this.replyControls.map((control) => ({ ...control })),
            }
          : null;
      if (this.replyPlacement && method !== 'setFrame') this.moveReplyGeometry(this.session.point);
    }
    return result;
  }

  moveReplyGeometry(point) {
    const base = this.replyPlacement,
      area = this.session?.area;
    if (!base || !area) return;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const dx = point.x - base.x,
      dy = point.y - base.y;
    const hudX = clamp(base.hud.x + dx, 8, Math.max(8, area.width - 8 - base.hud.width));
    const hudY = clamp(base.hud.y + dy, 8, Math.max(8, area.height - 8 - base.hud.height));
    const shiftX = hudX - base.hud.x,
      shiftY = hudY - base.hud.y;
    if (base.edge)
      this.replyEdge = {
        ...base.edge,
        x: clamp(base.edge.x + shiftX, 0, area.width - base.edge.width),
        y: clamp(base.edge.y + shiftY, 0, area.height - base.edge.height),
      };
    this.replyControls = base.collapsed
      ? []
      : base.controls.map((control) => ({
          ...control,
          x: control.x + shiftX,
          y: control.y + shiftY,
        }));
  }

  cancelPlacement() {
    clearTimeout(this.placementSettleTimer);
    this.placementScheduled = this.placementSettleTimer = null;
    this.placementPending = this.placementInFlight = null;
    this.placementGeneration++;
    const revision = ++this.placementRevision;
    const overlay = this.overlay;
    void Promise.resolve()
      .then(() => this.sendOverlay(overlay, 'cancelPlacement', revision))
      .catch(() => {});
  }

  queuePlacement(point, previousPoint = point) {
    const session = this.session,
      contents = this.overlay?.webContents;
    if (!this.available || !contents || this.overlay.isDestroyed()) return;
    const generation = this.placementGeneration;
    if (this.replySuppressedEdge) {
      const edge = this.replySuppressedEdge,
        area = session.area;
      this.replySuppressedEdge = {
        ...edge,
        x: Math.max(0, Math.min(area.width - edge.width, edge.x + point.x - previousPoint.x)),
        y: Math.max(0, Math.min(area.height - edge.height, edge.y + point.y - previousPoint.y)),
      };
    }
    this.placementPending = {
      point,
      revision: ++this.placementRevision,
      session,
      contents,
      generation,
    };
    this.moveReplyGeometry(point);
    this.schedulePlacement();
    clearTimeout(this.placementSettleTimer);
    const settle = () => {
      if (!this.available || this.session !== session || generation !== this.placementGeneration)
        return;
      if (this.placementPending || this.placementInFlight) {
        this.placementSettleTimer = setTimeout(settle, 17);
        return;
      }
      this.placementSettleTimer = null;
      void this.updateParked('settlePlacement', this.placementRevision).catch(() => {});
    };
    this.placementSettleTimer = setTimeout(settle, 120);
    this.placementSettleTimer.unref?.();
  }

  schedulePlacement() {
    if (this.placementScheduled || this.placementInFlight || !this.placementPending) return;
    const scheduled = (this.placementScheduled = {});
    // Keep only the latest point and one outstanding IPC. The renderer owns
    // display cadence; a second Windows timer can quantize 16.7ms into 31ms.
    queueMicrotask(() => {
      if (this.placementScheduled !== scheduled) return;
      this.placementScheduled = null;
      const value = this.placementPending;
      this.placementPending = null;
      if (
        !value ||
        !this.available ||
        this.session !== value.session ||
        this.overlay?.webContents !== value.contents ||
        value.generation !== this.placementGeneration
      )
        return;
      const token = (this.placementInFlight = {});
      Promise.resolve()
        .then(() =>
          value.contents.executeJavaScript(
            'globalThis.capriAvatarDetach.setPlacement(' +
              JSON.stringify({ point: value.point, revision: value.revision }) +
              ')',
          ),
        )
        .catch(() => {})
        .finally(() => {
          if (this.placementInFlight !== token) return;
          this.placementInFlight = null;
          this.schedulePlacement();
        });
    });
  }

  watchPoseMotion(session, rendered) {
    if (typeof rendered.reducedMotion !== 'boolean') return;
    session.reducedMotion = rendered.reducedMotion;
    const contents = this.overlay.webContents;
    if (this.poseMotionWatch === contents) return;
    this.poseMotionWatch = contents;
    const current = () => this.session === session && this.overlay?.webContents === contents;
    const watch = async () => {
      while (current()) {
        const reduced = await contents.executeJavaScript(
          `globalThis.capriAvatarDetach.waitForMotionChange(${session.reducedMotion})`,
        );
        if (!current() || typeof reduced !== 'boolean') return;
        session.reducedMotion = reduced;
      }
    };
    void watch()
      .catch(() => {})
      .finally(() => {
        if (this.poseMotionWatch === contents) this.poseMotionWatch = null;
      });
  }

  async updateFrame(frame, canvas, mask, seat) {
    const session = this.session;
    if (!this.available || !frame.anchor) return false;
    const anchor = { x: frame.anchor.x / canvas.width, y: frame.anchor.y / canvas.height };
    const { point, area } = session;
    let nextPoint = seat
      ? anchoredPoint(seat, area, point.scale, anchor, frame.visibleBounds, canvas)
      : {
          ...point,
          x: point.x + (anchor.x - session.anchor.x) * point.scale,
          y: point.y + (anchor.y - session.anchor.y) * point.scale,
        };
    if (['reviewed_pose', 'reviewed_music'].includes(frame.kind))
      nextPoint = focusPose(nextPoint, anchor, frame.visibleBounds, canvas);
    else if (nextPoint.focus) delete nextPoint.focus;
    if (
      !this.frameUpdate &&
      frame.url === session.spriteUrl &&
      frame.anchor.name === session.dock &&
      nextPoint.x === point.x &&
      nextPoint.y === point.y
    )
      return true;
    if (
      !this.frameUpdate &&
      frame.url === session.spriteUrl &&
      frame.anchor.name === session.dock &&
      anchor.x === session.anchor.x &&
      anchor.y === session.anchor.y &&
      nextPoint.scale === point.scale &&
      !nextPoint.clip &&
      !point.clip
    ) {
      session.point = nextPoint;
      this.queuePlacement(nextPoint, point);
      return true;
    }
    this.cancelPlacement();
    const request = (this.frameUpdate = {});
    try {
      const rendered = await this.updateParked('setFrame', {
        url: frame.url,
        anchor,
        point: nextPoint,
        dock: frame.anchor.name,
      });
      if (!rendered) return false;
      if (!this.available || this.session !== session || request !== this.frameUpdate) return false;
      Object.assign(session, {
        spriteUrl: frame.url,
        point: nextPoint,
        anchor,
        mask: poseMask(frame, mask),
        dock: frame.anchor.name,
      });
      this.moveReplyGeometry(session.point);
      this.watchPoseMotion(session, rendered);
      return true;
    } finally {
      if (this.frameUpdate === request) this.frameUpdate = null;
    }
  }

  async followFrame(frame, canvas, mask, seat, display, restoring = false) {
    const session = this.session;
    if (!this.available || !frame?.anchor || !seat || !display) return false;
    if (display.id === session.displayId) {
      const result = await this.updateFrame(frame, canvas, mask, seat);
      if (
        result &&
        this.session === session &&
        (restoring || !this.overlay?.isVisible() || (!this.verification && !this.pointerTimer))
      )
        this.showParked();
      return result;
    }
    const token = (this.relocation = {});
    this.cancelPlacement();
    this.replyPlacement = null;
    this.replyControls = [];
    this.replyPress = null;
    this.replyGeometryEpoch++;
    const { workArea: area } = display;
    const anchor = { x: frame.anchor.x / canvas.width, y: frame.anchor.y / canvas.height };
    const scale = Math.min(session.point.scale, area.width * 0.42, area.height * 0.48);
    let point = anchoredPoint(seat, area, scale, anchor, frame.visibleBounds, canvas);
    if (['reviewed_pose', 'reviewed_music'].includes(frame.kind))
      point = focusPose(point, anchor, frame.visibleBounds, canvas);
    const target = (this.nextOverlay = this.createOverlay(area));
    try {
      await withTimeout(target.loadURL(overlayUrl), this.timeoutMs);
      if (this.relocation !== token || target.webContents.getURL() !== overlayUrl) return false;
      const rendered = await withTimeout(
        target.webContents.executeJavaScript(
          'globalThis.capriAvatarDetach.park(' +
            JSON.stringify({ point, anchor, url: frame.url, dock: frame.anchor.name }) +
            ')',
        ),
        this.timeoutMs,
      );
      if (!rendered) return false;
      if (this.relocation !== token || this.session !== session) return false;
      const previous = this.overlay;
      this.stopPointer();
      this.overlay = target;
      this.nextOverlay = null;
      this.relocation = null;
      this.replyEdge = null;
      this.replyNear = false;
      this.replySuppressedEdge = null;
      Object.assign(session, {
        area,
        point,
        anchor,
        mask: poseMask(frame, mask),
        displayId: display.id,
        spriteUrl: frame.url,
        dock: frame.anchor.name,
      });
      this.watchPoseMotion(session, rendered);
      target.showInactive();
      previous?.destroy();
      this.startPointer();
      if (this.reply) this.sendReply(this.reply);
      if (this.status) this.sendStatus(this.status);
      if (this.mouth) this.sendMouth(this.mouth);
      if (this.music) this.sendMusic(this.music);
      return true;
    } finally {
      if (this.relocation === token) {
        this.relocation = this.nextOverlay = null;
        if (!target.isDestroyed()) target.destroy();
      }
    }
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.onPhase(phase);
  }

  hideParked() {
    if (!this.available || !this.overlay || this.overlay.isDestroyed()) return false;
    this.cancelPlacement();
    this.replyPlacement = null;
    this.stopPointer();
    this.overlay.hide();
    return true;
  }

  showParked() {
    if (!this.available || !this.overlay || this.overlay.isDestroyed()) return false;
    const hidden = !this.overlay.isVisible();
    if (hidden) this.stopPointer(false);
    // Windows can show the HWND before Chromium's content window is restored.
    // Always run the normal show path, even when native visibility is already true.
    this.overlay.showInactive();
    // The native show event and explicit recovery both use the same path.
    this.raiseOverlay();
    if (hidden && this.session) this.queuePlacement(this.session.point);
    if (hidden && this.reply) this.sendReply(this.reply);
    return true;
  }

  raiseOverlay(overlay = this.overlay) {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return false;
    // The default floating level can put Settings (or the taskbar) over her legs.
    // moveTop preserves keyboard focus while restoring her own transparent layer.
    overlay.setAlwaysOnTop?.(true, 'screen-saver');
    overlay.moveTop?.();
    if (overlay === this.overlay && this.available && this.session?.mask && !this.verification) {
      // ShowWindow/restacking can change native hit routing independently of
      // our cached hover flag. Repair it on the existing low-rate heartbeat,
      // even with a stationary cursor; never restart a live mouse gesture.
      if (!this.pointerTimer) this.startPointer();
      else this.updatePointer(true);
    }
    this.onRaised();
    return true;
  }

  reset() {
    this.cancelPlacement();
    this.replyPlacement = null;
    this.stopPointer();
    const overlays = [this.overlay, this.nextOverlay, ...this.settlingOverlays];
    this.settlingOverlays.clear();
    this.overlay = null;
    this.nextOverlay = null;
    this.operation?.resolve(false);
    this.operation = null;
    this.frameUpdate = null;
    this.relocation = null;
    this.session = null;
    this.reply = null;
    this.replyEdge = this.replyPress = null;
    this.replyCollapsed = this.replyNear = false;
    this.replySuppressedEdge = null;
    this.status = null;
    this.mouth = 'closed';
    for (const overlay of overlays) if (overlay && !overlay.isDestroyed()) overlay.destroy();
    this.setPhase('attached');
  }

  spriteRect() {
    const {
      point: { x, y, scale },
      anchor,
    } = this.session;
    return { x: x - scale * anchor.x, y: y - scale * anchor.y, width: scale, height: scale };
  }

  spriteTarget(point) {
    if (this.getPresentation() === 'dialogue') return null;
    if (!this.available || !this.session.mask) return null;
    return spritePressKind(point, this.spriteRect(), this.session.mask, true, this.session);
  }

  canGrab(point) {
    if (this.getPresentation() === 'dialogue')
      return Boolean(
        this.available && this.replyPlacement?.hud && pointInRect(point, this.replyPlacement.hud),
      );
    return (
      this.available &&
      this.session.mask &&
      spriteDragHit(point, this.spriteRect(), this.session.mask)
    );
  }

  replyHit(point) {
    return Boolean(this.replyTarget(point));
  }

  replyTarget(point) {
    if (!this.available) return null;
    if (!this.replyCollapsed) {
      const control = this.replyControls.find((control) => pointInRect(point, control));
      if (control) return control.action;
    }
    return this.replyEdge &&
      (!this.replyCollapsed || this.replyNear) &&
      pointInRect(point, this.replyEdge)
      ? 'toggle'
      : null;
  }

  nearReply(point) {
    const sprite = this.spriteRect();
    const { visibleBounds, imageSize } = this.session.mask ?? {};
    const body =
      visibleBounds && imageSize
        ? {
            x: sprite.x + sprite.width * (visibleBounds.x / imageSize.width),
            y: sprite.y + sprite.height * (visibleBounds.y / imageSize.height),
            width: sprite.width * (visibleBounds.width / imageSize.width),
            height: sprite.height * (visibleBounds.height / imageSize.height),
          }
        : sprite;
    return withinRadius(point, body, 42) || withinRadius(point, this.replyEdge, 26);
  }

  mouse(mouse) {
    if (!this.available || !this.overlay?.isVisible()) return;
    if (mouse.type === 'mouseMove') {
      this.trackPress(mouse);
      return;
    }
    if (mouse.button !== 'left') return;
    if (mouse.type === 'mouseDown') {
      this.press = null;
      const action = this.replyTarget(mouse);
      this.replyPress = action ? { action, turnId: this.reply?.turnId } : null;
      if (this.replyPress) return;
      if (this.canGrab(mouse)) {
        // Arrival is already interactive; a grab can dismiss its remaining FX.
        this.playReaction('finishArrival');
        const kind = this.spriteTarget(mouse);
        const { x, y, scale } = this.session.point;
        this.press = {
          x: mouse.x,
          y: mouse.y,
          at: Date.now(),
          kind,
          grabOffset: { x: (x - mouse.x) / scale, y: (y - mouse.y) / scale },
        };
      }
    } else if (mouse.type === 'mouseUp' && this.replyPress) {
      const press = this.replyPress;
      this.replyPress = null;
      if (press.turnId === this.reply?.turnId && this.replyTarget(mouse) === press.action)
        void this.updateParked(
          press.action === 'toggle' ? 'toggleReply' : 'stepReply',
          press.action === 'toggle' ? undefined : press.action === 'previous' ? -1 : 1,
        ).catch(() => {});
    } else if (mouse.type === 'mouseUp' && this.press) {
      const { area } = this.session;
      const point = { x: mouse.x, y: mouse.y };
      const cursor =
        Number.isFinite(mouse.globalX) && Number.isFinite(mouse.globalY)
          ? { x: mouse.globalX, y: mouse.globalY }
          : { x: area.x + point.x, y: area.y + point.y };
      this.releasePress(point, cursor);
    }
  }

  releasePress(point, cursor) {
    const press = this.press;
    this.press = null;
    if (press?.tetherAt) this.clearTether();
    if (!press || Date.now() - press.at > 30000 || !this.available) return;
    press.moved ||= Math.hypot(point.x - press.x, point.y - press.y) >= dragDistance;
    if (press.moved) {
      // Dead zone governs the release itself, even with drag-lightning disabled.
      // Returning inside it cancels the move instead of starting a short teleport.
      if (avatarDragCanTeleport(press, point, this.getEffects() ?? {}))
        this.onDragDrop(cursor, press.grabOffset);
    } else if (
      press.kind &&
      Date.now() - press.at < 800 &&
      this.spriteTarget(point) === press.kind
    ) {
      if (press.kind === 'head') {
        if (!this.getSleeping()) this.playReaction('headpat', point);
        this.onHeadpat();
      } else {
        this.tapAt = point;
        this.onClick(press.kind);
      }
    }
  }

  trackPress({ x, y }) {
    const press = this.press;
    if (!press) return;
    const distance = Math.hypot(x - press.x, y - press.y);
    press.moved ||= distance >= dragDistance;
    const settings = this.getEffects() ?? {};
    const style = tetherStyle(settings);
    if (!style || !press.moved || !avatarDragCanTeleport(press, { x, y }, settings)) {
      if (press.tetherAt) this.clearTether();
      press.tetherAt = press.lastX = press.lastY = undefined;
      return;
    }
    if (press.lastX === x && press.lastY === y) return;
    const now = Date.now();
    if (now - (press.tetherAt ?? 0) < tetherInterval) return;
    press.tetherAt = now;
    press.lastX = x;
    press.lastY = y;
    const command = {
      from: { x: press.x, y: press.y },
      to: { x, y },
      intensity: style.intensity,
      chaos: style.chaos,
      seed: press.at >>> 0,
    };
    this.playReaction('setTether', command);
    this.drawDesktopTether(command, this.session.area, this.session.displayId);
  }

  trackAttachedTether(press, cursor, area, now) {
    if (!press || this.phase !== 'attached' || this.operation || pointInRect(cursor, area)) {
      if (press) press.tether = undefined;
      if (this.phase === 'attached' && !this.operation && this.tetherViews.size) this.clearTether();
      return;
    }
    const to = { x: cursor.x - area.x, y: cursor.y - area.y };
    const settings = this.getEffects() ?? {};
    const style = tetherStyle(settings);
    if (!style || !avatarDragCanTeleport(press.point, to, settings)) {
      press.tether = undefined;
      if (this.tetherViews.size) this.clearTether();
      return;
    }
    if (
      (to.x === press.tether?.x && to.y === press.tether?.y) ||
      now - (press.tether?.at ?? -Infinity) < tetherInterval
    )
      return;
    press.tether = { ...to, at: now };
    press.tetherSeed ??= (press.at ?? now) >>> 0;
    this.drawDesktopTether(
      {
        from: press.point,
        to,
        intensity: style.intensity,
        chaos: style.chaos,
        seed: press.tetherSeed,
      },
      area,
    );
  }

  drawDesktopTether({ from, to, ...style }, area, displayId) {
    const desktopFrom = rebasePoint(from, area, { x: 0, y: 0 });
    const desktopTo = rebasePoint(to, area, { x: 0, y: 0 });
    const visible = this.screen
      .getAllDisplays()
      .filter(
        (display) =>
          display.id !== displayId && tetherCrosses(desktopFrom, desktopTo, display.workArea),
      );
    for (const [id, view] of this.tetherViews) {
      if (!visible.some((display) => display.id === id)) this.closeTetherView(id, view);
    }
    for (const { id, workArea } of visible) {
      const command = {
        from: rebasePoint(from, area, workArea),
        to: rebasePoint(to, area, workArea),
        ...style,
      };
      if (displayId === undefined) {
        command.exclude = { ...area, x: area.x - workArea.x, y: area.y - workArea.y };
      }
      const existing = this.tetherViews.get(id);
      if (existing) {
        existing.command = command;
        if (existing.ready) this.paintTetherView(id, existing);
        continue;
      }
      const overlay = this.createOverlay(workArea);
      const view = { overlay, command, ready: false };
      this.tetherViews.set(id, view);
      const close = () => this.closeTetherView(id, view);
      overlay.once('closed', close);
      overlay.webContents.once('render-process-gone', close);
      void overlay
        .loadURL(overlayUrl)
        .then(() => {
          view.ready = true;
          this.paintTetherView(id, view);
        })
        .catch(close);
    }
  }

  paintTetherView(id, view) {
    const { overlay, command } = view;
    if (this.tetherViews.get(id) !== view || overlay.isDestroyed() || view.pending) return;
    const task = this.sendOverlay(overlay, 'setTether', command);
    if (!task) {
      this.closeTetherView(id, view);
      return;
    }
    view.pending = true;
    void task
      .then(() => {
        if (this.tetherViews.get(id) === view && !overlay.isDestroyed() && !overlay.isVisible())
          overlay.showInactive();
      })
      .catch(() => this.closeTetherView(id, view))
      .finally(() => {
        view.pending = false;
        if (this.tetherViews.get(id) === view && view.command !== command)
          this.paintTetherView(id, view);
      });
  }

  closeTetherView(id, view) {
    if (this.tetherViews.get(id) !== view) return;
    this.tetherViews.delete(id);
    if (!view.overlay.isDestroyed()) view.overlay.destroy();
  }

  clearTether() {
    this.sendOverlay(this.overlay, 'setTether', null)?.catch(() => {});
    for (const [id, view] of this.tetherViews) this.closeTetherView(id, view);
  }

  pulse(count, tone) {
    if (!this.tapAt) return false;
    const point = this.tapAt;
    this.tapAt = null;
    return this.playReaction('pulse', { ...point, count, tone });
  }

  playReaction(reaction, details) {
    if (!this.available) return false;
    const task = this.sendOverlay(this.overlay, reaction, details);
    task?.catch(() => {});
    return Boolean(task);
  }

  sendOverlay(overlay, method, value) {
    if (!overlay || overlay.isDestroyed() || overlay.webContents.getURL() !== overlayUrl) return;
    return overlay.webContents.executeJavaScript(
      `globalThis.capriAvatarDetach.${method}(${JSON.stringify(value)})`,
    );
  }

  retireOverlay(overlay) {
    this.settlingOverlays.add(overlay);
    void withTimeout(
      Promise.resolve().then(() => this.sendOverlay(overlay, 'whenSettled')),
      this.timeoutMs,
    )
      .catch(() => {})
      .finally(() => {
        this.settlingOverlays.delete(overlay);
        if (!overlay.isDestroyed()) overlay.destroy();
      });
  }

  watchArrivalCompletion(session, overlay) {
    const generation = this.placementGeneration;
    void withTimeout(
      Promise.resolve().then(() => this.sendOverlay(overlay, 'whenSettled')),
      this.timeoutMs,
    )
      .then(() => {
        if (
          this.available &&
          this.session === session &&
          this.overlay === overlay &&
          this.placementGeneration === generation &&
          this.reply
        )
          this.sendReply(this.reply);
      })
      .catch(() => {});
  }

  stopPointer(clearReplyControls = true) {
    clearInterval(this.pointerTimer);
    this.pointerTimer = null;
    this.stopReleaseWatch?.();
    this.stopReleaseWatch = null;
    if (this.press?.tetherAt || this.tetherViews.size) this.clearTether();
    this.press = this.tapAt = null;
    this.replyPress = null;
    if (clearReplyControls) {
      this.replyControls = [];
      this.replyGeometryEpoch++;
    }
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.setIgnoreMouseEvents(true);
    this.acceptsPointer = false;
  }

  startPointer() {
    this.stopPointer(false);
    if (this.verification || !this.available || !this.session.mask || !this.overlay?.isVisible())
      return;
    this.stopReleaseWatch = this.watchRelease(this.overlay, (cursor) => {
      const { area } = this.session;
      // A non-focusable Windows overlay can miss release beyond its native bounds.
      if (!pointInRect(cursor, area)) {
        this.replyPress = false;
        if (this.press) this.releasePress({ x: cursor.x - area.x, y: cursor.y - area.y }, cursor);
      }
    });
    this.pointerTimer = setInterval(
      () => this.updatePointer(),
      this.getPresentation() === 'dialogue' ? 33 : 16,
    );
    this.pointerTimer.unref();
    this.updatePointer();
  }

  updatePointer(forceNative = false) {
    if (
      !this.available ||
      !this.overlay ||
      this.overlay.isDestroyed() ||
      !this.overlay.isVisible()
    ) {
      this.stopPointer();
      return;
    }
    const { x, y } = this.screen.getCursorScreenPoint();
    const { area } = this.session;
    const point = { x: x - area.x, y: y - area.y };
    if (this.press && Date.now() - this.press.at > 30000) {
      if (this.press.tetherAt) this.clearTether();
      this.press = null;
    }
    this.trackPress(point);
    if (this.replyCollapsed && this.replyEdge) {
      if (this.replySuppressedEdge && !pointInRect(point, this.replySuppressedEdge))
        this.replySuppressedEdge = null;
      const reveal = this.nearReply(point) && !this.replySuppressedEdge;
      if (reveal !== this.replyNear) {
        this.replyNear = reveal;
        void this.updateParked('setReplyNear', reveal).catch(() => {});
      }
    }
    // Keep native capture through the release even after the cursor leaves the sprite.
    const interactive = Boolean(
      this.press || this.replyPress || this.canGrab(point) || this.replyHit(point),
    );
    if ((forceNative || this.acceptsPointer !== interactive) && !this.overlay.isDestroyed()) {
      this.acceptsPointer = interactive;
      this.overlay.setIgnoreMouseEvents(!interactive);
    }
    this.onPointer({ x, y });
  }

  checkDisplay() {
    if (!this.session) return;
    const content = this.owner.getContentBounds();
    if (
      this.getOwnerDisplay().id !== this.session.homeDisplayId ||
      (this.operation && keys.some((key) => content[key] !== this.operation.content[key]))
    ) {
      this.reset();
    }
  }

  createOverlay(area) {
    const overlay = new this.BrowserWindow({
      ...area,
      title: 'Capri Avatar',
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        backgroundThrottling: false,
      },
    });
    const lost = () => {
      if (this.overlay === overlay || this.nextOverlay === overlay) this.reset();
    };
    // Windows puts every topmost app in the same band. Recover when another
    // application promotes itself, without polling its contents or taking focus.
    const stackingTimer = setInterval(() => this.raiseOverlay(overlay), stackingInterval);
    stackingTimer.unref?.();
    overlay.once('closed', () => clearInterval(stackingTimer));
    overlay.once('closed', lost);
    overlay.on('show', () => this.raiseOverlay(overlay));
    overlay.on('hide', () => {
      if (this.overlay === overlay) this.stopPointer();
    });
    overlay.webContents.once('render-process-gone', lost);
    overlay.webContents.once('did-finish-load', () => this.refreshTheme([overlay]));
    overlay.webContents.on('before-mouse-event', (_event, input) => {
      if (this.overlay === overlay) this.mouse(input);
    });
    overlay.setMenu(null);
    overlay.setAlwaysOnTop?.(true, 'screen-saver');
    overlay.setIgnoreMouseEvents(true);
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview'])
      overlay.webContents.on(event, (value) => value.preventDefault());
    return overlay;
  }

  async leave(value, sprite, canvas, mask, cursor, grabPoint, appearance) {
    if (this.session || this.operation || (cursor && !isCursor(cursor))) return false;
    if (!sprite?.anchor) throw new Error('Capri artwork is unavailable.');
    const content = this.owner.getContentBounds();
    const { id: displayId, workArea: area } = this.screen.getDisplayMatching(content);
    if (area.width < 100 || area.height < 100) throw new Error('The display is too small.');
    const source = portraitGeometry(value, content);
    const anchor = { x: sprite.anchor.x / canvas.width, y: sprite.anchor.y / canvas.height };
    const from = portraitPoint(source, content, area, anchor);
    if (!from) throw new Error('The portrait is outside the active display.');
    const scale = Math.min(240, Math.max(108, from.scale), area.width * 0.42, area.height * 0.48);
    const session = {
      source,
      anchor,
      spriteUrl: sprite.url,
      dock: sprite.anchor.name,
      mask,
      area,
      displayId,
      homeArea: area,
      homeDisplayId: displayId,
      scale,
      seen: new Set(),
    };
    const offset = grabPoint && { x: anchor.x - grabPoint.x, y: anchor.y - grabPoint.y };
    const destination = cursor
      ? this.cursorDestination(cursor, session, offset, appearance)
      : session;
    const to = destination.to ?? landing(area, content, from.focus, scale, anchor, session.seen);
    this.session = session;
    return this.travel('leaving', from, to, destination);
  }

  cursorDestination(cursor, { area, displayId, scale, anchor }, grabOffset, appearance) {
    const target =
      appearance?.display ??
      this.screen.getDisplayNearestPoint({
        x: Math.round(cursor.x),
        y: Math.round(cursor.y),
      });
    const targetArea = target.id === displayId ? area : target.workArea;
    const targetScale = Math.min(scale, targetArea.width * 0.42, targetArea.height * 0.48);
    if (appearance) {
      const { frame, canvas, mask, free } = appearance;
      const { x, y, name: dock } = frame.anchor;
      const arrivalAnchor = { x: x / canvas.width, y: y / canvas.height };
      const released =
        free && grabOffset
          ? {
              x: cursor.x + targetScale * (arrivalAnchor.x - anchor.x + grabOffset.x),
              y: cursor.y + targetScale * (arrivalAnchor.y - anchor.y + grabOffset.y),
            }
          : cursor;
      const point = free
        ? cursorLanding(released, targetArea, targetScale, arrivalAnchor)
        : anchoredPoint(
            cursor,
            targetArea,
            targetScale,
            arrivalAnchor,
            frame.visibleBounds,
            canvas,
          );
      return {
        area: targetArea,
        displayId: target.id,
        to: focusPose(point, arrivalAnchor, frame.visibleBounds, canvas),
        arrival: { anchor: arrivalAnchor, spriteUrl: frame.url, dock },
        mask: poseMask(frame, mask),
      };
    }
    const landing = grabOffset
      ? { x: cursor.x + targetScale * grabOffset.x, y: cursor.y + targetScale * grabOffset.y }
      : cursor;
    return {
      area: targetArea,
      displayId: target.id,
      to: cursorLanding(landing, targetArea, targetScale, anchor),
    };
  }

  async hop(cursor, grabOffset, appearance) {
    if (!this.available) return false;
    const { area, point, anchor, seen } = this.session;
    if (cursor) {
      if (!isCursor(cursor)) return false;
      const destination = this.cursorDestination(cursor, this.session, grabOffset, appearance);
      return this.travel('teleporting', point, destination.to, destination);
    }
    const to = landing(area, this.owner.getContentBounds(), point, point.scale, anchor, seen);
    return this.travel('teleporting', point, to);
  }

  async returnToFrame(drop) {
    if (!this.available) return false;
    const session = this.session;
    const { homeArea: area, homeDisplayId: displayId, anchor, point } = session;
    let source = session.source;
    let layout;
    try {
      const geometry = await withTimeout(
        Promise.resolve(this.getPortraitGeometry(drop)),
        this.timeoutMs,
        undefined,
      );
      if (geometry) {
        source = portraitGeometry(geometry, this.owner.getContentBounds());
        layout = geometry.layout;
      }
    } catch {}
    if (!this.available || this.session !== session) return false;
    const to = portraitPoint(source, this.owner.getContentBounds(), area, anchor);
    if (!to) {
      this.reset();
      return true;
    }
    return this.travel('returning', point, to, { area, displayId, layout });
  }

  async travel(phase, from, to, destination = this.session) {
    const session = this.session;
    const crossing = destination.displayId !== session.displayId;
    const token = { ...Promise.withResolvers(), content: this.owner.getContentBounds() };
    this.operation = token;
    this.cancelPlacement();
    this.replyPlacement = null;
    this.stopPointer();
    this.replyEdge = null;
    this.replyNear = false;
    this.replySuppressedEdge = null;
    try {
      const overlay = (this.overlay ??= this.createOverlay(session.area));
      const target = crossing ? (this.nextOverlay = this.createOverlay(destination.area)) : overlay;
      const views = [{ overlay, area: session.area }];
      if (crossing) views.push({ overlay: target, area: destination.area });
      await withTimeout(
        Promise.all(
          views.map(({ overlay }) =>
            overlay.webContents.getURL() === overlayUrl ? undefined : overlay.loadURL(overlayUrl),
          ),
        ),
        this.timeoutMs,
        token.promise,
      );
      if (this.operation !== token) return false;
      const seed = randomInt(2 ** 32);
      const effects = this.getEffects();
      this.presentation = this.getPresentation();
      const prepared = await withTimeout(
        Promise.all(
          views.map(({ overlay, area }) => {
            const contents = overlay.webContents;
            if (contents.getURL() !== overlayUrl) throw new Error('Invalid teleport renderer.');
            const command = {
              from: rebasePoint(from, session.area, area),
              to: rebasePoint(to, destination.area, area),
              seed,
              anchor: session.anchor,
              spriteUrl: session.spriteUrl,
              ...(destination.arrival && { arrival: destination.arrival }),
              effects,
              crossing,
              park: overlay === target && phase !== 'returning',
              interactiveArrival: phase !== 'returning',
              presentation: this.getPresentation(),
              reduceMotion: this.getPresentation() === 'dialogue',
            };
            return contents.executeJavaScript(
              'globalThis.capriAvatarDetach.prepare(' + JSON.stringify(command) + ')',
            );
          }),
        ),
        this.timeoutMs,
        token.promise,
      );
      if (this.operation !== token) return false;
      if (!prepared.every(Boolean))
        throw new Error('The teleport renderer could not prepare the sprite.');
      for (const { overlay, area } of views) {
        if (!overlay.isVisible()) overlay.showInactive();
        const bounds = overlay.getBounds();
        if (!overlay.isVisible() || !keys.every((key) => bounds[key] === area[key]))
          throw new Error('The teleport layer could not cover the display.');
      }
      this.setPhase(phase);
      const playback = crossing
        ? `globalThis.capriAvatarDetach.play(${Date.now() + 48})`
        : 'globalThis.capriAvatarDetach.play()';
      const played = await withTimeout(
        Promise.all(views.map(({ overlay }) => overlay.webContents.executeJavaScript(playback))),
        this.timeoutMs,
        token.promise,
      );
      if (this.operation !== token) return false;
      if (!played.every(Boolean))
        throw new Error('The teleport renderer could not complete the animation.');
      if (phase === 'returning') {
        if (destination.layout) this.onReturnPlacement(destination.layout);
        this.reset();
      } else {
        if (crossing) {
          this.overlay = target;
          this.nextOverlay = null;
          this.retireOverlay(overlay);
          session.area = destination.area;
          session.displayId = destination.displayId;
          session.seen.clear();
        }
        session.point = to;
        if (destination.arrival) {
          Object.assign(session, destination.arrival, { mask: destination.mask });
          this.watchPoseMotion(session, played.at(-1));
        }
        session.seen.add(to.key);
        this.operation = null;
        this.setPhase('detached');
        this.startPointer();
        this.watchArrivalCompletion(session, target);
        if (this.reply) this.sendReply(this.reply);
        if (this.status) this.sendStatus(this.status);
        if (this.mouth) this.sendMouth(this.mouth);
        if (this.music) this.sendMusic(this.music);
      }
      return true;
    } catch (error) {
      if (this.operation !== token) return false;
      this.reset();
      throw error;
    }
  }
}
