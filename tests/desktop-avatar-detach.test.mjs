// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { AvatarDetach, avatarDragCanTeleport } from '../apps/desktop/main/avatar-detach.mjs';
import {
  avatarDockFrame,
  avatarDockPoint,
  nearestAvatarDock,
  nearestDisplayAvatarDock,
  pointInReservedDesktop,
  visibleAvatarDock,
} from '../apps/desktop/avatar-docking.mjs';
import { avatarDropOutside, spriteGrabPoint } from '../apps/desktop/geometry.mjs';
import { DesktopTeleportMenu } from '../apps/desktop/main/desktop-teleport-menu.mjs';
import {
  arrivalStart,
  draw,
  frames,
  prepareTeleportMotion,
  teleportViewport,
  transitStart,
} from '../apps/desktop/renderer/avatar-teleport-motion.mjs';

const area = { x: -1600, y: -180, width: 1600, height: 900 };
const geometry = {
  rect: { x: -30, y: -10, width: 370, height: 370 },
  clip: { x: 12, y: 16, width: 230, height: 230 },
};
const sprite = { anchor: { x: 620, y: 1160 }, url: 'capri://desktop/sprites/neutral.png' };
const canvas = { width: 1254, height: 1254 };

function fixture({
  prepare = () => true,
  play = () => true,
  getEffects,
  getSleeping,
  getPortraitGeometry,
  onReturnPlacement,
  onClick,
  onHeadpat,
  onDragDrop,
  watchRelease,
  getCursorScreenPoint = () => ({ x: area.x, y: area.y }),
  verification = true,
  targetDisplay,
  overlayBounds = (bounds) => bounds,
  homeArea = area,
  parked = () => true,
  timeoutMs = 500,
} = {}) {
  const phases = [];
  const overlays = [];
  const commands = [];
  const content = { x: -560, y: -100, width: 480, height: 650 };
  const display = { id: 7, workArea: homeArea };
  class Overlay extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.commands = [];
      this.webContents = new EventEmitter();
      this.webContents.getURL = () => this.url ?? '';
      this.webContents.setWindowOpenHandler = (handler) =>
        assert.deepEqual(handler(), { action: 'deny' });
      this.webContents.executeJavaScript = (source) => {
        if (/^globalThis\.capriAvatarDetach\.play\(\d*\)$/.test(source)) return play(source);
        if (source.startsWith('globalThis.capriAvatarDetach.headpat(')) {
          this.headpat = JSON.parse(
            source.slice('globalThis.capriAvatarDetach.headpat('.length, -1),
          );
          return Promise.resolve();
        }
        const parkedCall =
          /^globalThis\.capriAvatarDetach\.(park|setFrame|setTether|setReply|toggleReply|stepReply|setReplyNear|setMouth|setStatus|waitForMotionChange|finishArrival|whenSettled)\((.*)\)$/.exec(
            source,
          );
        if (parkedCall)
          return Promise.resolve(
            parked(
              parkedCall[1],
              JSON.parse(parkedCall[2] === 'undefined' ? 'null' : parkedCall[2]),
              this,
            ),
          );
        const command = JSON.parse(
          source.slice('globalThis.capriAvatarDetach.prepare('.length, -1),
        );
        commands.push(command);
        this.commands.push(command);
        return prepare();
      };
      overlays.push(this);
    }
    setMenu() {}
    setIgnoreMouseEvents(value) {
      this.clickThrough = value;
    }
    async loadURL(url) {
      this.url = url;
    }
    getBounds() {
      return overlayBounds(this.options, this);
    }
    setBounds(bounds) {
      this.repositioned = bounds;
    }
    isDestroyed() {
      return this.destroyed === true;
    }
    isVisible() {
      return this.visible === true;
    }
    showInactive() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  const controller = new AvatarDetach({
    BrowserWindow: Overlay,
    screen: {
      getDisplayMatching: () => display,
      getDisplayNearestPoint: ({ x }) => (targetDisplay && x >= 0 ? targetDisplay : display),
      getAllDisplays: () => (targetDisplay ? [display, targetDisplay] : [display]),
      getCursorScreenPoint,
    },
    owner: { getContentBounds: () => content },
    onPhase: (phase) => phases.push(phase),
    getEffects,
    getSleeping,
    getPortraitGeometry,
    onReturnPlacement,
    onClick,
    onHeadpat,
    onDragDrop,
    watchRelease,
    verification,
    timeoutMs,
  });
  return { controller, content, display, phases, overlays, commands };
}

test('leave frame accepts DPI rounding of one logical pixel but rejects a mispositioned layer', async () => {
  const rounded = fixture({ overlayBounds: (bounds) => ({ ...bounds, width: bounds.width - 1 }) });
  assert.equal(await rounded.controller.leave(geometry, sprite, canvas), true);
  assert.equal(rounded.controller.phase, 'detached');
  rounded.controller.reset();

  const clipped = fixture({ overlayBounds: (bounds) => ({ ...bounds, width: bounds.width - 2 }) });
  await assert.rejects(
    clipped.controller.leave(geometry, sprite, canvas),
    /could not cover the display/,
  );
  assert.equal(clipped.controller.phase, 'attached');
});

test('a 4K teleport overlay reapplies its target bounds if Windows initially limits the window', async () => {
  const large = { x: 0, y: 0, width: 3840, height: 2112 };
  const nativeBounds = (bounds, overlay) =>
    bounds.width === 3840 && !overlay.repositioned ? { ...bounds, width: 1920 } : bounds;
  const crossing = fixture({
    targetDisplay: { id: 8, workArea: large },
    overlayBounds: nativeBounds,
  });
  assert.equal(await crossing.controller.leave(geometry, sprite, canvas), true);
  assert.equal(await crossing.controller.hop({ x: 3150, y: 800 }), true);
  assert.deepEqual(crossing.overlays.at(-1).repositioned, large);
  crossing.controller.reset();

  const primary = { ...large, x: -3840, y: -180 };
  const leaving = fixture({ homeArea: primary, overlayBounds: nativeBounds });
  assert.equal(await leaving.controller.leave(geometry, sprite, canvas), true);
  assert.deepEqual(leaving.overlays[0].repositioned, primary);
  leaving.controller.reset();
});

test('drag dead zone measures the final cursor vector in logical pixels', () => {
  assert.equal(
    avatarDragCanTeleport(
      { x: 497.99999999999994, y: 20 },
      { x: 588, y: 20 },
      { avatarDragTetherDeadZone: 90 },
    ),
    false,
  );
  const from = { x: -1320, y: -225 };
  const shifted = (x, y = 0) => ({ x: from.x + x, y: from.y + y });
  assert.equal(avatarDragCanTeleport(from, shifted(30)), false);
  assert.equal(avatarDragCanTeleport(from, shifted(18, 24)), false);
  assert.equal(avatarDragCanTeleport(from, shifted(31)), true);
  assert.equal(avatarDragCanTeleport(from, shifted(21, 22)), true);
  const settings = { avatarDragTetherDeadZone: 90, avatarDragTether: false };
  assert.equal(avatarDragCanTeleport(from, shifted(90), settings), false);
  assert.equal(avatarDragCanTeleport(from, shifted(91), settings), true);
  assert.equal(avatarDragCanTeleport(from, shifted(4), { avatarDragTetherDeadZone: 0 }), false);
  assert.equal(avatarDragCanTeleport(from, shifted(5), { avatarDragTetherDeadZone: 0 }), true);
  assert.equal(avatarDragCanTeleport(null, shifted(90), settings), false);
  assert.equal(avatarDragCanTeleport(from, { x: Infinity, y: 0 }, settings), false);
});

test('avatar leaves on its current display, hops to fresh points and returns to the moved portrait', async () => {
  const { controller, content, phases, overlays, commands } = fixture();
  assert.equal(await controller.leave(geometry, sprite, canvas), true);
  assert.equal(controller.available, true);
  assert.equal(overlays[0].clickThrough, true);
  assert.equal(overlays[0].options.focusable, false);
  assert.deepEqual(commands[0].from.clip, { x: 1052, y: 96, width: 230, height: 230 });
  assert.equal(commands[0].spriteUrl, sprite.url);
  const points = new Set();
  for (let i = 0; i < 8; i++) {
    const { to, anchor } = commands.at(-1);
    assert.ok(to.x - anchor.x * to.scale >= 0);
    assert.ok(to.y - anchor.y * to.scale >= 0);
    assert.ok(to.x + (1 - anchor.x) * to.scale <= area.width);
    assert.ok(to.y + (1 - anchor.y) * to.scale <= area.height);
    assert.ok(!points.has(to.key));
    points.add(to.key);
    assert.equal(await controller.hop(), true);
  }
  content.x -= 66;
  controller.checkDisplay();
  assert.equal(await controller.returnToFrame(), true);
  assert.equal(commands.at(-1).to.clip.x, commands[0].from.clip.x - 66);
  assert.equal(commands.at(-1).park, false);
  assert.deepEqual(phases.slice(0, 4), ['leaving', 'detached', 'teleporting', 'detached']);
  assert.deepEqual(phases.slice(-2), ['returning', 'attached']);
  assert.equal(overlays.length, 1);
  assert.ok(overlays[0].isDestroyed());
});

test('return uses the current expanded frame and reserves its sprite for the companion window', async () => {
  const updated = {
    rect: { x: 40, y: 72, width: 270, height: 270 },
    clip: { x: 53, y: 100, width: 250, height: 210 },
  };
  const { controller, commands, content } = fixture({
    getPortraitGeometry: async () => {
      await Promise.resolve();
      return updated;
    },
  });
  await controller.leave(geometry, sprite, canvas);
  assert.equal(await controller.returnToFrame(), true);
  const { to, park } = commands.at(-1);
  assert.equal(park, false);
  assert.equal(to.scale, updated.rect.width);
  assert.deepEqual(to.clip, {
    ...updated.clip,
    x: updated.clip.x + content.x - area.x,
    y: updated.clip.y + content.y - area.y,
  });
});

test('targeted hops use the cursor as the anchor and keep the sprite on screen at the edge', async () => {
  const { controller, commands } = fixture();
  const cursor = { x: -1020, y: 390 };
  assert.equal(await controller.leave(geometry, sprite, canvas, undefined, cursor), true);
  const { to: exact } = commands.at(-1);
  assert.deepEqual({ x: exact.x + area.x, y: exact.y + area.y }, cursor);

  assert.equal(await controller.hop({ x: area.x + 1, y: area.y + area.height - 1 }), true);
  const { to, anchor } = commands.at(-1);
  const left = to.x - anchor.x * to.scale;
  const bottom = to.y + (1 - anchor.y) * to.scale;
  assert.ok(Math.abs(left) <= 1, 'The landing remains as close as possible to the left edge');
  assert.ok(Math.abs(bottom - area.height) <= 1, 'The landing remains above the bottom edge');
  controller.reset();
});

test('the ceiling landing materializes the inverted sprite at its own anchor and focal point', async () => {
  const { controller, commands } = fixture();
  const frame = {
    id: 'pose-ceiling-upside-down',
    kind: 'reviewed_pose',
    url: 'capri://desktop/sprites/pose-ceiling-upside-down.png',
    anchor: { name: 'ceiling-upside-down', x: 626, y: 88 },
    visibleBounds: { x: 182, y: 84, width: 889, height: 933 },
  };
  const at = { x: area.x + 750, y: area.y };
  const mask = { alpha: new Uint8Array(4), imageSize: { width: 2, height: 2 } };
  assert.equal(
    await controller.leave(geometry, sprite, canvas, mask, at, undefined, { frame, canvas, mask }),
    true,
  );
  const command = commands.at(-1);
  assert.equal(command.spriteUrl, sprite.url);
  assert.deepEqual(command.arrival, {
    spriteUrl: frame.url,
    anchor: { x: 626 / 1254, y: 88 / 1254 },
    dock: 'ceiling-upside-down',
  });
  assert.ok(command.to.focus.y > command.to.y + 75, 'Upside-down arrival focuses below the feet');
  assert.equal(controller.session.spriteUrl, frame.url);
  assert.equal(controller.session.mask.poseId, frame.id);
  controller.reset();
});

test('attached drags require a deliberate release beyond the window edges', () => {
  const window = { x: 0, y: 0, width: 480, height: 660 };
  assert.equal(avatarDropOutside({ x: 160, y: -8 }, window), false);
  assert.equal(avatarDropOutside({ x: 495, y: 55 }, window), false);
  assert.equal(avatarDropOutside({ x: 506, y: 55 }, window), true);
  assert.equal(avatarDropOutside({ x: 160, y: -30 }, window), true);
  assert.equal(avatarDropOutside({ x: Infinity, y: -30 }, window), false);
  assert.equal(avatarDropOutside(undefined, window), false);
  assert.deepEqual(
    spriteGrabPoint(
      { x: 160, y: 120 },
      {
        x: 60,
        y: 60,
        width: 200,
        height: 120,
        source: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      },
    ),
    { x: 0.5, y: 0.5 },
  );
});

test('dragging out uses the grabbed sprite point and returning commits measured placement after playback', async () => {
  const cursor = { x: -1020, y: 390 },
    grab = { x: 0.45, y: 0.41 };
  const drop = { point: { x: 130, y: 310 }, grab };
  const layout = { x: 0.42, y: 0.9, zoom: 1.15 };
  const trace = [];
  const { controller, commands } = fixture({
    getPortraitGeometry: (received) => {
      assert.deepEqual(received, drop);
      return { ...geometry, layout };
    },
    onReturnPlacement: (placement) => trace.push(placement),
    play: () => {
      trace.push('played');
      return true;
    },
  });
  assert.equal(await controller.leave(geometry, sprite, canvas, undefined, cursor, grab), true);
  const { to, anchor } = commands[0];
  assert.ok(Math.abs(to.x + area.x + (grab.x - anchor.x) * to.scale - cursor.x) < 0.001);
  assert.ok(Math.abs(to.y + area.y + (grab.y - anchor.y) * to.scale - cursor.y) < 0.001);
  assert.equal(await controller.returnToFrame(drop), true);
  assert.deepEqual(trace, ['played', 'played', layout]);
  assert.equal(controller.phase, 'attached');
});

test('returning by button commits the same measured face-centered placement as its teleport destination', async () => {
  const layout = { x: 0.5, y: 0.7, zoom: 2.2 },
    trace = [];
  const { controller } = fixture({
    getPortraitGeometry: (drop) => {
      assert.equal(drop, undefined);
      return { ...geometry, layout };
    },
    onReturnPlacement: (value) => trace.push(value),
  });
  assert.equal(await controller.leave(geometry, sprite, canvas), true);
  assert.equal(await controller.returnToFrame(), true);
  assert.deepEqual(trace, [layout]);
  assert.equal(controller.phase, 'attached');
});

test('a teleport from the frame can land at the cursor on another monitor', async () => {
  const targetArea = { x: 0, y: -900, width: 1280, height: 1050 };
  const { controller, overlays, phases } = fixture({
    targetDisplay: { id: 8, workArea: targetArea },
  });
  const cursor = { x: 620, y: -200 };
  assert.equal(await controller.leave(geometry, sprite, canvas, undefined, cursor), true);
  const [source, target] = overlays;
  await new Promise(setImmediate);
  assert.equal(source.isDestroyed(), true);
  assert.equal(source.commands[0].park, false);
  const { to, park } = target.commands[0];
  assert.equal(park, true);
  assert.deepEqual({ x: to.x + targetArea.x, y: to.y + targetArea.y }, cursor);
  assert.deepEqual(phases, ['leaving', 'detached']);
  assert.equal(await controller.returnToFrame(), true);
  assert.equal(target.commands.at(-1).interactiveArrival, false);
  assert.deepEqual(phases, ['leaving', 'detached', 'returning', 'attached']);
});

test('arrival can be grabbed while the outgoing display still finishes its effects', async () => {
  const tail = Promise.withResolvers();
  let finishes = 0;
  const { controller, overlays, commands } = fixture({
    targetDisplay: { id: 8, workArea: { x: 0, y: -900, width: 1280, height: 1050 } },
    parked: (method) => {
      if (method === 'whenSettled') return tail.promise;
      if (method === 'finishArrival') finishes++;
      return true;
    },
  });
  const mask = { alpha: new Uint8Array(16).fill(255), imageSize: { width: 4, height: 4 } };
  await controller.leave(geometry, sprite, canvas, mask, { x: 620, y: -200 });
  assert(commands.every((command) => command.interactiveArrival === true));
  assert.equal(controller.available, true);
  const [source, target] = overlays;
  assert.equal(source.isDestroyed(), false);
  assert.equal(controller.overlay, target);
  assert.equal(controller.settlingOverlays.has(source), true);
  const rect = controller.spriteRect();
  const point = { x: rect.x + rect.width * 0.35, y: rect.y + rect.height * 0.35 };
  assert.equal(controller.canGrab(point), true);
  controller.mouse({ type: 'mouseDown', button: 'left', ...point });
  const press = controller.press;
  assert.ok(press);
  assert.equal(finishes, 1);
  tail.resolve(true);
  await new Promise(setImmediate);
  assert.equal(source.isDestroyed(), true);
  assert.equal(controller.settlingOverlays.size, 0);
  assert.equal(controller.press, press, 'Completing old effects must preserve the new grab.');
  assert.equal(controller.available, true);
  controller.reset();
});

test('reset removes outgoing effect layers and stale completion cannot close a new avatar', async () => {
  const tail = Promise.withResolvers();
  const { controller, overlays } = fixture({
    targetDisplay: { id: 8, workArea: { x: 0, y: -900, width: 1280, height: 1050 } },
    parked: (method) => (method === 'whenSettled' ? tail.promise : true),
  });
  await controller.leave(geometry, sprite, canvas, undefined, { x: 620, y: -200 });
  controller.reset();
  assert(overlays.every((overlay) => overlay.isDestroyed()));
  assert.equal(controller.settlingOverlays.size, 0);
  await controller.leave(geometry, sprite, canvas);
  const current = controller.overlay;
  tail.resolve(true);
  await new Promise(setImmediate);
  assert.equal(controller.overlay, current);
  assert.equal(current.isDestroyed(), false);
  assert.equal(controller.available, true);
  controller.reset();
});

test('an echoed standing frame does not interrupt the active arrival effect', async () => {
  const updates = [];
  const standing = { ...sprite, anchor: { ...sprite.anchor, name: 'ground' } };
  const { controller } = fixture({
    parked: (method) => {
      updates.push(method);
      return true;
    },
  });
  await controller.leave(geometry, standing, canvas);
  assert.equal(await controller.updateFrame(standing, canvas), true);
  assert.equal(updates.includes('setFrame'), false);
  controller.reset();
});

test('finishing arrival refreshes the latest reply hit regions, including a new turn', async () => {
  const tail = Promise.withResolvers();
  const edge = { x: 120, y: 140, width: 23, height: 25 };
  let visible = false;
  const turns = [];
  const { controller } = fixture({
    parked: (method, value) => {
      if (method === 'whenSettled') return tail.promise;
      if (method === 'setReply') {
        turns.push(value.turnId);
        return { replyEdge: visible ? edge : null };
      }
      return true;
    },
  });
  controller.sendReply({ turnId: 'old', text: 'Earlier reply' });
  await controller.leave(geometry, sprite, canvas);
  controller.sendReply({ turnId: 'new', text: 'Newest reply' });
  await new Promise(setImmediate);
  assert.equal(controller.replyEdge, null);
  visible = true;
  tail.resolve(true);
  await new Promise(setImmediate);
  assert.equal(turns.at(-1), 'new');
  assert.deepEqual(controller.replyEdge, edge);
  controller.reset();
});

test('the most recent parked frame wins even when it matches the currently visible frame', async () => {
  const { controller } = fixture();
  await controller.leave(geometry, sprite, canvas);
  const pending = [];
  controller.updateParked = (method, frame) => {
    assert.equal(method, 'setFrame');
    const task = Promise.withResolvers();
    pending.push({ ...task, frame });
    return task.promise;
  };
  const first = controller.updateFrame(
    { ...sprite, url: 'capri://desktop/sprites/blink.png' },
    canvas,
  );
  const latest = controller.updateFrame(sprite, canvas);
  assert.equal(pending.length, 2);
  pending[1].resolve(true);
  pending[0].resolve(true);
  assert.equal(await latest, true);
  assert.equal(await first, false);
  assert.equal(controller.session.spriteUrl, sprite.url);
  controller.reset();
});

test('a cursor on another display moves the detached avatar there and returns to the owner display', async () => {
  const targetArea = { x: 0, y: -900, width: 1280, height: 1050 };
  const targetDisplay = { id: 8, workArea: targetArea };
  const { controller, content, phases, overlays, commands } = fixture({ targetDisplay });
  await controller.leave(geometry, sprite, canvas);
  const initialPortrait = commands[0].from;
  const cursor = { x: 620, y: -200 };
  assert.equal(await controller.hop(cursor), true);
  await new Promise(setImmediate);
  const activeOverlays = overlays.filter((overlay) => !overlay.isDestroyed());
  assert.equal(activeOverlays.length, 1);
  const [parked] = activeOverlays;
  assert.deepEqual(
    ['x', 'y', 'width', 'height'].map((key) => parked.getBounds()[key]),
    [targetArea.x, targetArea.y, targetArea.width, targetArea.height],
  );
  const { to, seed, park } = parked.commands.at(-1);
  assert.deepEqual({ x: to.x + targetArea.x, y: to.y + targetArea.y }, cursor);
  assert.equal(park, true);
  assert.equal(overlays[0].commands.at(-1).park, false);
  assert.equal(overlays[0].commands.at(-1).seed, seed);
  content.x -= 30;
  controller.checkDisplay();
  assert.equal(controller.available, true);

  assert.equal(await controller.returnToFrame(), true);
  const portraitOverlay = overlays.findLast((overlay) => overlay.getBounds().x === area.x);
  const { to: arrival, park: parkOnReturn } = portraitOverlay.commands.at(-1);
  assert.equal(parkOnReturn, false);
  assert.equal(parked.commands.at(-1).park, false);
  assert.deepEqual(arrival, {
    ...initialPortrait,
    x: initialPortrait.x - 30,
    focus: { ...initialPortrait.focus, x: initialPortrait.focus.x - 30 },
    clip: { ...initialPortrait.clip, x: initialPortrait.clip.x - 30 },
  });
  assert.ok(overlays.every((overlay) => overlay.isDestroyed()));
  assert.deepEqual(phases, [
    'leaving',
    'detached',
    'teleporting',
    'detached',
    'returning',
    'attached',
  ]);
});

test('a subsequent teleport uses the currently saved effect controls', async () => {
  let effects = {
    teleportIntensity: 12,
    teleportJaggedness: 52,
    teleportBranches: 92,
    teleportReducedFlash: false,
  };
  const { controller, commands } = fixture({ getEffects: () => effects });
  assert.equal(await controller.leave(geometry, sprite, canvas), true);
  assert.deepEqual(commands[0].effects, effects);
  effects = { ...effects, teleportBranches: 0, teleportReducedFlash: true };
  assert.equal(await controller.hop(), true);
  assert.deepEqual(commands[1].effects, effects);
  assert.equal(commands[0].effects.teleportBranches, 92);
  controller.reset();
});

test('detached taps require opaque pixels on press and release and no drag', async () => {
  let clicks = 0;
  let headpats = 0;
  const drops = [];
  const { controller, overlays, commands } = fixture({
    onClick: () => clicks++,
    onHeadpat: () => headpats++,
    onDragDrop: (point) => drops.push(point),
  });
  const alpha = new Uint8Array(16);
  alpha[2] = 255;
  alpha[5] = 255;
  const mask = { alpha, imageSize: { width: 4, height: 4 } };
  await controller.leave(geometry, sprite, canvas, mask);
  const { to, anchor } = commands[0];
  const mouse = (type, u, v) =>
    overlays[0].webContents.emit(
      'before-mouse-event',
      {},
      {
        type,
        button: 'left',
        x: to.x + (u - anchor.x) * to.scale,
        y: to.y + (v - anchor.y) * to.scale,
      },
    );
  mouse('mouseDown', 0.1, 0.1);
  mouse('mouseUp', 0.1, 0.1);
  mouse('mouseDown', 0.35, 0.35);
  mouse('mouseUp', 0.55, 0.35);
  assert.equal(clicks, 0);
  assert.equal(drops.length, 1);
  mouse('mouseDown', 0.35, 0.35);
  mouse('mouseUp', 0.35, 0.35);
  assert.equal(clicks, 1);
  mouse('mouseDown', 0.55, 0.2);
  mouse('mouseMove', 0.85, 0.2);
  mouse('mouseUp', 0.55, 0.2);
  assert.equal(headpats, 0);
  assert.equal(drops.length, 1);
  mouse('mouseDown', 0.55, 0.2);
  mouse('mouseUp', 0.55, 0.2);
  assert.equal(headpats, 1);
  assert.equal(clicks, 1);
  assert.deepEqual(overlays[0].headpat, {
    x: to.x + (0.55 - anchor.x) * to.scale,
    y: to.y + (0.2 - anchor.y) * to.scale,
  });
  controller.reset();
});

test('sleeping desktop head taps still reach the host without playing hearts and dragging never counts as a tap', async () => {
  let sleeping = true;
  let taps = 0;
  let drops = 0;
  const { controller, overlays, commands } = fixture({
    getSleeping: () => sleeping,
    onHeadpat: () => taps++,
    onDragDrop: () => drops++,
  });
  const alpha = new Uint8Array(16);
  alpha[2] = 255;
  await controller.leave(geometry, sprite, canvas, { alpha, imageSize: { width: 4, height: 4 } });
  const { to, anchor } = commands[0];
  const point = {
    x: to.x + (0.55 - anchor.x) * to.scale,
    y: to.y + (0.2 - anchor.y) * to.scale,
  };
  for (let i = 0; i < 10; i++) {
    controller.mouse({ type: 'mouseDown', button: 'left', ...point });
    controller.mouse({ type: 'mouseUp', button: 'left', ...point });
  }
  assert.equal(taps, 10);
  assert.equal(overlays[0].headpat, undefined);
  controller.mouse({ type: 'mouseDown', button: 'left', ...point });
  controller.mouse({ type: 'mouseUp', button: 'left', ...point, x: point.x + 31 });
  assert.equal(drops, 1);
  assert.equal(taps, 10);
  sleeping = false;
  controller.mouse({ type: 'mouseDown', button: 'left', ...point });
  controller.mouse({ type: 'mouseUp', button: 'left', ...point });
  assert.equal(taps, 11);
  assert.deepEqual(overlays[0].headpat, point);
  controller.reset();
});

test('a transparent gap accepts a tethered desktop drag but never a tap', async () => {
  const actions = [];
  const { controller, commands } = fixture({
    onClick: (part) => actions.push(part),
    onHeadpat: () => actions.push('headpat'),
    onDragDrop: () => actions.push('drop'),
    getEffects: () => ({ avatarDragTether: true, avatarDragTetherIntensity: 65 }),
    parked: (method, value) => {
      if (method === 'setTether') actions.push(value);
      return true;
    },
  });
  const alpha = new Uint8Array(16);
  alpha[5] = alpha[7] = 255;
  const mask = {
    alpha,
    imageSize: { width: 4, height: 4 },
    visibleBounds: { x: 1, y: 1, width: 3, height: 1 },
  };
  await controller.leave(geometry, sprite, canvas, mask);
  const { to, anchor } = commands[0];
  const point = {
    x: to.x + (0.625 - anchor.x) * to.scale,
    y: to.y + (0.375 - anchor.y) * to.scale,
  };
  const moved = { x: point.x + 36, y: point.y - 15 };
  const mouse = (type, position) => controller.mouse({ type, button: 'left', ...position });
  mouse('mouseDown', point);
  mouse('mouseUp', point);
  assert.deepEqual(actions, []);
  const atDeadZone = { x: point.x + 30, y: point.y };
  mouse('mouseDown', point);
  mouse('mouseMove', atDeadZone);
  mouse('mouseUp', atDeadZone);
  assert.deepEqual(actions.splice(0), []);
  mouse('mouseDown', point);
  mouse('mouseMove', moved);
  mouse('mouseUp', moved);
  const seed = actions[0].seed;
  assert.ok(Number.isInteger(seed));
  assert.deepEqual(actions, [
    { from: point, to: moved, intensity: 65, chaos: 55, seed },
    null,
    'drop',
  ]);
  controller.reset();
});

test('desktop release honors the configured dead zone independently of drag lightning', async () => {
  for (const enabled of [true, false]) {
    const drops = [];
    const tethers = [];
    let taps = 0;
    const { controller, commands } = fixture({
      onClick: () => taps++,
      onHeadpat: () => taps++,
      onDragDrop: (point, offset) => drops.push({ point, offset }),
      getEffects: () => ({
        avatarDragTether: enabled,
        avatarDragTetherIntensity: 70,
        avatarDragTetherDeadZone: 90,
      }),
      parked: (method, value) => {
        if (method === 'setTether') tethers.push(value);
        return true;
      },
    });
    await controller.leave(geometry, sprite, canvas, {
      alpha: new Uint8Array(16).fill(255),
      imageSize: { width: 4, height: 4 },
    });
    const { to, anchor } = commands[0];
    const point = {
      x: to.x + (0.4 - anchor.x) * to.scale,
      y: to.y + (0.4 - anchor.y) * to.scale,
    };
    const shifted = (x) => ({ x: point.x + x, y: point.y });
    const mouse = (type, position) => controller.mouse({ type, button: 'left', ...position });
    for (const distance of [29, 89, 90]) {
      mouse('mouseDown', point);
      mouse('mouseMove', shifted(distance));
      mouse('mouseUp', shifted(distance));
    }
    assert.deepEqual(drops, []);
    assert.deepEqual(tethers, []);
    assert.equal(taps, 0);

    mouse('mouseDown', point);
    mouse('mouseMove', shifted(120));
    mouse('mouseMove', shifted(20));
    mouse('mouseUp', shifted(20));
    assert.deepEqual(drops, []);
    assert.equal(taps, 0);
    if (enabled) {
      assert.equal(tethers[0].to.x, point.x + 120);
      assert.equal(tethers.at(-1), null);
    } else assert.deepEqual(tethers, []);

    // A native release can arrive without a final mouse-move event.
    mouse('mouseDown', point);
    mouse('mouseUp', shifted(91));
    assert.equal(drops.length, 1);
    assert.deepEqual(drops[0].point, { x: area.x + point.x + 91, y: area.y + point.y });
    assert.deepEqual(drops[0].offset, {
      x: (to.x - point.x) / to.scale,
      y: (to.y - point.y) / to.scale,
    });
    assert.equal(taps, 0);
    controller.reset();
  }
});

test('a perched frame tracks across displays without replaying teleport', async () => {
  const target = { id: 8, workArea: { x: 0, y: -700, width: 900, height: 880 } };
  const updates = [];
  const { controller, display, commands, overlays } = fixture({
    targetDisplay: target,
    parked: (method, value) => {
      updates.push({ method, value });
      return true;
    },
  });
  const seated = {
    anchor: { name: 'seat', x: 600, y: 790 },
    visibleBounds: { x: 240, y: 195, width: 850, height: 955 },
    url: 'capri://desktop/sprites/desktop-perch-neutral.png',
  };
  await controller.leave(geometry, sprite, canvas);
  const first = { x: -600, y: 200 };
  assert.equal(await controller.followFrame(seated, canvas, null, first, display), true);
  assert.deepEqual(controller.desktopPoint, first);
  controller.sendMouth('round');
  const next = { x: 550, y: -300 };
  assert.equal(await controller.followFrame(seated, canvas, null, next, target), true);
  assert.deepEqual(controller.desktopPoint, next);
  assert.equal(controller.phase, 'detached');
  assert.equal(commands.length, 1);
  assert.equal(overlays[0].isDestroyed(), true);
  assert.deepEqual(
    updates.map(({ method }) => method),
    ['whenSettled', 'setFrame', 'setMouth', 'park', 'setMouth'],
  );
  controller.reset();
});

test('native pointer picks the independently drawn right grip through a padded grab box', async () => {
  const parts = [];
  const preferences = [];
  const { controller } = fixture({
    onClick: (part) => parts.push(part),
    parked(method, previous) {
      if (method === 'setFrame') return { reducedMotion: false };
      if (method === 'waitForMotionChange') {
        const waiter = Promise.withResolvers();
        preferences.push({ ...waiter, previous });
        return waiter.promise;
      }
      return true;
    },
  });
  const pixels = new Uint8Array(canvas.width * canvas.height);
  for (let y = 411; y <= 417; y++)
    for (let x = 1023; x <= 1029; x++) pixels[y * canvas.width + x] = 255;
  const mask = {
    alpha: pixels,
    imageSize: { width: 1254, height: 1254 },
    visibleBounds: { x: 198, y: 76, width: 859, height: 1102 },
  };
  await controller.leave(geometry, sprite, canvas, mask);
  const frame = avatarDockFrame(
    new Map([
      [
        'pose-dock-right',
        {
          ...sprite,
          id: 'pose-dock-right',
          kind: 'reviewed_pose',
          anchor: { name: 'dock-right', x: 1038, y: 425 },
          visibleBounds: mask.visibleBounds,
        },
      ],
    ]),
    {
      kind: 'left',
      edge: 'left',
    },
  );
  assert.equal(frame.anchor.name, 'dock-right');
  assert.equal(await controller.updateFrame(frame, canvas, mask), true);
  const rect = controller.spriteRect();
  const screenPoint = (x, y) => ({
    x: rect.x + (x * rect.width) / canvas.width,
    y: rect.y + (y * rect.height) / canvas.height,
  });
  const hand = screenPoint(1026, 414);
  const gap = screenPoint(500, 340);
  for (const point of [hand, gap]) assert.equal(controller.canGrab(point), true);
  for (const point of [hand, gap]) {
    controller.mouse({ type: 'mouseDown', button: 'left', ...point });
    controller.mouse({ type: 'mouseUp', button: 'left', ...point });
  }
  assert.deepEqual(parts, ['left-hand']);
  assert.equal(preferences[0].previous, false);
  preferences[0].resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.session.reducedMotion, true);
  assert.equal(preferences[1].previous, true);
  controller.reset();
  preferences[1].resolve(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(preferences.length, 2);
});

test('desktop drag draws the same tether across a second monitor and clears the click-through layer on release', async () => {
  const target = { id: 8, workArea: { x: 0, y: -640, width: 1000, height: 1450 } };
  const paints = [];
  const drops = [];
  const { controller, commands, overlays } = fixture({
    targetDisplay: target,
    onDragDrop: (cursor) => drops.push(cursor),
    getEffects: () => ({ avatarDragTether: true, avatarDragTetherIntensity: 70 }),
    parked: (method, value, view) => {
      if (method === 'setTether') paints.push({ view, value });
      return true;
    },
  });
  const mask = {
    alpha: new Uint8Array(16).fill(255),
    imageSize: { width: 4, height: 4 },
    visibleBounds: { x: 0, y: 0, width: 4, height: 4 },
  };
  await controller.leave(geometry, sprite, canvas, mask);
  const { to, anchor } = commands[0];
  const from = { x: to.x + (0.5 - anchor.x) * to.scale, y: to.y + (0.5 - anchor.y) * to.scale };
  const finish = { x: 1700, y: from.y + 30 };
  const mouse = (type, point) => controller.mouse({ type, button: 'left', ...point });
  mouse('mouseDown', from);
  mouse('mouseMove', finish);
  await new Promise(setImmediate);
  assert.equal(overlays.length, 2);
  const view = overlays[1];
  assert.equal(view.isVisible(), true);
  assert.equal(view.clickThrough, true);
  const seed = paints[0].value.seed;
  assert.ok(Number.isInteger(seed));
  assert.deepEqual(paints, [
    { view: overlays[0], value: { from, to: finish, intensity: 70, chaos: 55, seed } },
    {
      view,
      value: {
        from: { x: from.x - 1600, y: from.y + 460 },
        to: { x: finish.x - 1600, y: finish.y + 460 },
        intensity: 70,
        chaos: 55,
        seed,
      },
    },
  ]);
  mouse('mouseUp', finish);
  assert.equal(view.isDestroyed(), true);
  assert.deepEqual(drops, [{ x: 100, y: finish.y - 180 }]);
  controller.reset();
});

test('a portrait drag moves its preview to desktop layers outside the companion and clears on re-entry', async () => {
  const paints = [];
  const { controller, content, overlays } = fixture({
    targetDisplay: { id: 8, workArea: { x: 0, y: -180, width: 1000, height: 900 } },
    getEffects: () => ({ avatarDragTether: true, avatarDragTetherIntensity: 60 }),
    parked: (method, value) => {
      if (method === 'setTether') paints.push(value);
      return true;
    },
  });
  const press = { point: { x: 300, y: 200 } };
  const inside = { x: content.x + 350, y: content.y + 200 };
  const outside = { x: 120, y: 160 };
  controller.trackAttachedTether(press, inside, content, 1);
  assert.equal(overlays.length, 0);
  controller.trackAttachedTether(press, outside, content, 40);
  await new Promise(setImmediate);
  assert.equal(overlays.length, 2);
  assert.ok(overlays.every((overlay) => overlay.isVisible() && overlay.clickThrough));
  assert.equal(paints[0].seed, paints[1].seed);
  assert.deepEqual(paints[0].exclude, {
    x: content.x + 1600,
    y: content.y + 180,
    width: content.width,
    height: content.height,
  });
  controller.trackAttachedTether(press, inside, content, 80);
  assert.ok(overlays.every((overlay) => overlay.isDestroyed()));
  controller.trackAttachedTether(press, outside, content, 120);
  controller.trackAttachedTether();
  await new Promise(setImmediate);
  assert.equal(overlays.length, 4);
  assert.ok(overlays.every((overlay) => overlay.isDestroyed()));
});

test('drag lightning is silent inside its configured dead zone and stops when a drag moves back into it', async () => {
  const paints = [];
  const { controller, content, overlays } = fixture({
    getEffects: () => ({
      avatarDragTether: true,
      avatarDragTetherIntensity: 60,
      avatarDragTetherChaos: 85,
      avatarDragTetherDeadZone: 45,
    }),
    parked: (method, value) => {
      if (method === 'setTether') paints.push(value);
      return true;
    },
  });
  const press = { point: { x: content.width - 4, y: 200 } };
  const cursor = (dx) => ({ x: content.x + press.point.x + dx, y: content.y + press.point.y });
  controller.trackAttachedTether(press, cursor(45), content, 40);
  assert.equal(overlays.length, 0);
  controller.trackAttachedTether(press, cursor(46), content, 80);
  await new Promise(setImmediate);
  assert.equal(overlays.length, 1);
  assert.equal(paints[0].chaos, 85);
  controller.trackAttachedTether(press, cursor(42), content, 120);
  assert.equal(overlays[0].isDestroyed(), true);
});

test('the detached reply handle reveals near Capri, reopens on click and resets for a new turn', async () => {
  const edge = { x: 120, y: 140, width: 15, height: 20 };
  let cursor = { x: area.x + 125, y: area.y + 150 };
  let collapsed = false;
  const updates = [];
  const { controller } = fixture({
    getCursorScreenPoint: () => cursor,
    parked: (method, value) => {
      updates.push({ method, value });
      if (method === 'toggleReply') collapsed = !collapsed;
      if (method === 'setReply') collapsed = value.collapsed;
      return { replyEdge: edge, replyCollapsed: collapsed };
    },
  });
  await controller.leave(geometry, sprite, canvas, undefined, { x: area.x + 700, y: area.y + 500 });
  controller.sendReply({ turnId: 'turn-a', text: 'One' });
  await Promise.resolve();
  controller.mouse({ type: 'mouseDown', button: 'left', x: 125, y: 150 });
  controller.mouse({ type: 'mouseUp', button: 'left', x: 125, y: 150 });
  await Promise.resolve();
  controller.updatePointer();
  assert.equal(controller.replyNear, false);
  cursor = { x: area.x + 20, y: area.y + 30 };
  controller.updatePointer();
  const body = controller.spriteRect();
  cursor = { x: area.x + body.x + body.width / 2, y: area.y + body.y + body.height / 2 };
  controller.updatePointer();
  assert.equal(controller.replyNear, true);
  assert.deepEqual(updates.at(-1), { method: 'setReplyNear', value: true });
  controller.sendReply({ turnId: 'turn-a', text: 'One, continued' });
  assert.equal(updates.at(-1).value.collapsed, true);
  controller.mouse({ type: 'mouseDown', button: 'left', x: 125, y: 150 });
  controller.mouse({ type: 'mouseUp', button: 'left', x: 125, y: 150 });
  await Promise.resolve();
  assert.equal(controller.replyCollapsed, false);
  controller.sendReply({ turnId: 'turn-b', text: 'Two' });
  assert.equal(updates.at(-1).value.collapsed, false);
  controller.reset();
});

test('reserved taskbar strips and a maximized window floor cannot act as an underside', () => {
  const bounds = { x: -1920, y: 0, width: 1920, height: 1080 };
  const workArea = { ...bounds, height: 1032 };
  assert.equal(pointInReservedDesktop({ x: -200, y: 1055 }, { bounds, workArea }), true);
  assert.equal(pointInReservedDesktop({ x: -200, y: 1010 }, { bounds, workArea }), false);
  const verticalBar = { ...bounds, x: -1872, width: 1872 };
  assert.equal(
    pointInReservedDesktop({ x: -1900, y: 500 }, { bounds, workArea: verticalBar }),
    true,
  );
  assert.equal(visibleAvatarDock({ edge: 'bottom' }, { x: -200, y: 1032 }, workArea), false);
  assert.equal(visibleAvatarDock({ edge: 'bottom' }, { x: -200, y: 840 }, workArea), true);
  assert.equal(visibleAvatarDock({ edge: 'top' }, { x: -200, y: 0 }, workArea), true);
  assert.equal(visibleAvatarDock({ edge: 'left' }, { x: -1920, y: 500 }, verticalBar), false);
  assert.equal(
    visibleAvatarDock({ edge: 'top' }, { x: -200, y: 0 }, { ...bounds, y: 48, height: 1032 }),
    false,
  );
});

test('an old reply toggle cannot collapse the next turn', async () => {
  const edge = { x: 120, y: 140, width: 15, height: 20 };
  const toggle = Promise.withResolvers();
  const { controller } = fixture({
    parked: (method) => (method === 'toggleReply' ? toggle.promise : { replyEdge: edge }),
  });
  await controller.leave(geometry, sprite, canvas);
  controller.sendReply({ turnId: 'turn-a', text: 'One' });
  await new Promise(setImmediate);
  controller.mouse({ type: 'mouseDown', button: 'left', x: 125, y: 150 });
  controller.mouse({ type: 'mouseUp', button: 'left', x: 125, y: 150 });
  controller.sendReply({ turnId: 'turn-b', text: 'Two' });
  toggle.resolve({ replyEdge: edge, replyCollapsed: true });
  await new Promise(setImmediate);
  assert.equal(controller.replyCollapsed, false);
  assert.equal(controller.replyHit({ x: 125, y: 150 }), true);
  controller.reset();
});

test('reply arrows use native hit testing and dispatch one fixed step without avatar actions', async () => {
  const controls = [
    { action: 'previous', x: 200, y: 140, width: 24, height: 24 },
    { action: 'next', x: 228, y: 140, width: 24, height: 24 },
  ];
  const steps = [];
  const avatarActions = [];
  let cursor = { x: area.x + 210, y: area.y + 150 };
  const { controller, overlays } = fixture({
    getCursorScreenPoint: () => cursor,
    onClick: () => avatarActions.push('click'),
    onHeadpat: () => avatarActions.push('headpat'),
    onDragDrop: () => avatarActions.push('drag'),
    parked: (method, value) => {
      if (method === 'stepReply') steps.push(value);
      return {
        replyEdge: { x: 120, y: 140, width: 23, height: 25 },
        replyControls: controls,
        replyCollapsed: false,
      };
    },
  });
  await controller.leave(geometry, sprite, canvas);
  controller.sendReply({ turnId: 'reply-a', text: 'First reply' });
  await new Promise(setImmediate);
  for (const [index, direction] of [
    [0, -1],
    [1, 1],
  ]) {
    const { x, y } = controls[index];
    cursor = { x: area.x + x + 10, y: area.y + y + 10 };
    controller.updatePointer();
    assert.equal(overlays[0].clickThrough, false);
    for (const type of ['mouseDown', 'mouseUp'])
      overlays[0].webContents.emit(
        'before-mouse-event',
        {},
        {
          type,
          button: 'left',
          x: x + 10,
          y: y + 10,
        },
      );
    await new Promise(setImmediate);
    assert.equal(steps.at(-1), direction);
    assert.equal(steps.length, index + 1);
  }
  cursor = { x: area.x + 180, y: area.y + 100 };
  controller.updatePointer();
  assert.equal(overlays[0].clickThrough, true, 'Bubble text outside its controls passes through.');
  assert.deepEqual(avatarActions, []);
  controller.reset();
});

test('reply arrow releases require the same arrow and the same current reply', async () => {
  const steps = [];
  const controls = [
    { action: 'previous', x: 200, y: 140, width: 24, height: 24 },
    { action: 'next', x: 228, y: 140, width: 24, height: 24 },
  ];
  const { controller } = fixture({
    parked: (method, value) => {
      if (method === 'stepReply') steps.push(value);
      return { replyEdge: null, replyControls: controls };
    },
  });
  await controller.leave(geometry, sprite, canvas);
  controller.sendReply({ turnId: 'reply-a', text: 'First reply' });
  await new Promise(setImmediate);
  const down = () => controller.mouse({ type: 'mouseDown', button: 'left', x: 210, y: 150 });
  const up = (x) => controller.mouse({ type: 'mouseUp', button: 'left', x, y: 150 });
  down();
  up(240);
  down();
  up(180);
  down();
  controller.sendReply({ turnId: 'reply-b', text: 'Next reply' });
  await new Promise(setImmediate);
  up(210);
  await new Promise(setImmediate);
  assert.deepEqual(steps, []);
  assert.equal(controller.replyPress, null);
  controller.mouse({ type: 'mouseDown', button: 'right', x: 210, y: 150 });
  controller.mouse({ type: 'mouseUp', button: 'right', x: 210, y: 150 });
  assert.deepEqual(steps, []);
  down();
  up(210);
  await new Promise(setImmediate);
  assert.deepEqual(steps, [-1]);
  controller.reset();
});

test('reply control geometry accepts only two unique small in-area navigation targets', async () => {
  const previous = { action: 'previous', x: 200, y: 140, width: 24, height: 24 };
  const next = { ...previous, action: 'next', x: 228 };
  let replyControls;
  const { controller } = fixture({ parked: () => ({ replyEdge: null, replyControls }) });
  await controller.leave(geometry, sprite, canvas);
  controller.reply = { turnId: 'reply-a', text: 'Reply' };
  for (replyControls of [
    undefined,
    {},
    [previous, next, previous],
    [previous, previous],
    [{ ...previous, action: 'execute' }],
    [{ ...previous, width: 29 }],
    [{ ...previous, height: 29 }],
    [{ ...previous, x: -1 }],
    [{ ...previous, x: area.width - 23 }],
    [{ ...previous, y: area.height - 23 }],
    [{ ...previous, y: area.height }],
    [{ ...previous, width: NaN }],
    [null],
  ]) {
    await controller.updateParked('setReply', controller.reply);
    assert.deepEqual(controller.replyControls, []);
    assert.equal(controller.replyHit({ x: 210, y: 150 }), false);
  }
  replyControls = [previous, next];
  await controller.updateParked('setReply', controller.reply);
  assert.deepEqual(controller.replyControls, replyControls);
  controller.reset();
  assert.deepEqual(controller.replyControls, []);
});

test('reply collapse, pointer stop and hide remove arrows, while reopening restores them', async () => {
  const edge = { x: 120, y: 140, width: 23, height: 25 };
  const controls = [{ action: 'next', x: 228, y: 140, width: 24, height: 24 }];
  let collapsed = false;
  const { controller } = fixture({
    parked: (method) => {
      if (method === 'toggleReply') collapsed = !collapsed;
      return {
        replyEdge: edge,
        replyControls: collapsed ? [] : controls,
        replyCollapsed: collapsed,
      };
    },
  });
  await controller.leave(geometry, sprite, canvas);
  controller.sendReply({ turnId: 'reply-a', text: 'Reply' });
  await new Promise(setImmediate);
  assert.equal(controller.replyHit({ x: 240, y: 150 }), true);
  await controller.updateParked('toggleReply');
  assert.deepEqual(controller.replyControls, []);
  assert.equal(controller.replyHit({ x: 240, y: 150 }), false);
  await controller.updateParked('toggleReply');
  assert.deepEqual(controller.replyControls, controls);
  controller.startPointer();
  assert.deepEqual(
    controller.replyControls,
    controls,
    'A pointer restart preserves current geometry.',
  );
  controller.stopPointer();
  assert.deepEqual(controller.replyControls, []);
  controller.sendReply(controller.reply);
  await new Promise(setImmediate);
  controller.hideParked();
  assert.deepEqual(controller.replyControls, []);
  controller.showParked();
  await new Promise(setImmediate);
  assert.deepEqual(controller.replyControls, controls);
  controller.reset();
});

test('delayed navigation cannot restore arrow hit regions after stop or update the next reply', async () => {
  const controls = [{ action: 'next', x: 228, y: 140, width: 24, height: 24 }];
  let pending;
  const { controller } = fixture({
    parked: (method) =>
      method === 'stepReply' ? pending.promise : { replyEdge: null, replyControls: controls },
  });
  await controller.leave(geometry, sprite, canvas);
  controller.sendReply({ turnId: 'reply-a', text: 'First reply' });
  await new Promise(setImmediate);
  pending = Promise.withResolvers();
  const stopped = controller.updateParked('stepReply', 1);
  controller.stopPointer();
  pending.resolve({ replyEdge: null, replyControls: controls });
  await stopped;
  assert.deepEqual(controller.replyControls, []);
  controller.sendReply(controller.reply);
  await new Promise(setImmediate);
  pending = Promise.withResolvers();
  const obsolete = controller.updateParked('stepReply', 1);
  controller.sendReply({ turnId: 'reply-b', text: 'Next reply' });
  await new Promise(setImmediate);
  pending.resolve({ replyEdge: null, replyControls: [] });
  await obsolete;
  assert.deepEqual(controller.replyControls, controls);
  controller.reset();
});

test('teleport reuses its curve and draws a distinct interpolated position inside a bounded surface', () => {
  const from = { x: 310, y: 500, scale: 200 },
    to = { x: 660, y: 570, scale: 200 };
  const anchor = { x: 0.5, y: 0.92 },
    bounds = { width: 1920, height: 1080 };
  const options = { from, to, anchor, bounds, scale: 200, seed: 17 };
  const motion = prepareTeleportMotion(options);
  const region = teleportViewport(motion, from, to, anchor, bounds);
  assert.ok(region.width * region.height < (bounds.width * bounds.height) / 2);
  assert.ok(
    motion.points.every(
      ({ x, y }) =>
        x >= region.x &&
        x <= region.x + region.width &&
        y >= region.y &&
        y <= region.y + region.height,
    ),
  );
  const render = (frame) => {
    const points = [];
    const measure = (x, y) => points.push([x, y]);
    draw(
      {
        beginPath() {},
        moveTo: measure,
        lineTo: measure,
        closePath() {},
        fill() {},
        ellipse: measure,
      },
      { ...options, motion, frame, drawCapri() {} },
    );
    return points;
  };
  assert.notDeepEqual(render(transitStart + 1.45), render(transitStart + 1));
  assert.notDeepEqual(render(transitStart + 1.45), render(transitStart + 2));
});

test('docking geometry uses the nearest allowed edge and preserves its fractional anchor', () => {
  const bounds = { x: -600, y: 300, width: 450, height: 200 };
  const dock = nearestAvatarDock({ x: -375, y: 275 }, bounds, 36);
  assert.deepEqual(dock, { kind: 'seat', edge: 'top', fraction: 0.5, distance: 25 });
  assert.deepEqual(avatarDockPoint({ ...bounds, x: 100, width: 600 }, dock), { x: 400, y: 300 });
  assert.equal(nearestAvatarDock({ x: -375, y: 275 }, bounds, 20), null);
  assert.equal(nearestAvatarDock({ x: -375, y: 500 }, bounds, 36, true), null);
  assert.equal(nearestAvatarDock({ x: -375, y: 500 }, bounds, 36).kind, 'ceiling');
  const art = new Map(
    ['dock-left', 'dock-right', 'ceiling', 'ceiling-upside-down', 'sit-edge'].map((id) => [
      `pose-${id}`,
      id,
    ]),
  );
  const left = nearestAvatarDock({ x: -601, y: 400 }, bounds, 36, true);
  assert.equal(avatarDockFrame(art, { ...left, display: true }), 'dock-left');
  assert.equal(avatarDockFrame(art, left), 'dock-right');
  assert.equal(
    avatarDockFrame(art, { ...dock, display: true, kind: 'ceiling' }),
    'ceiling-upside-down',
  );
  assert.equal(avatarDockFrame(art, { kind: 'ceiling', edge: 'bottom' }), 'ceiling');
  assert.equal(avatarDockFrame(art, dock), 'sit-edge');
});

test('the display floor uses the seated pose above the bottom taskbar', () => {
  const bounds = { x: -1920, y: -50, width: 1920, height: 1080 };
  const workArea = { ...bounds, height: 1032 };
  const display = { bounds, workArea };
  const contact = { x: -960, y: 982 };
  const poses = new Map([['pose-sit-floor', 'ground']]);
  for (const y of [970, 995, 1029]) {
    const dock = nearestDisplayAvatarDock({ x: contact.x, y }, display, 20);
    assert.equal(dock.kind, 'floor');
    assert.deepEqual(avatarDockPoint(dock.bounds, dock), contact);
    assert.equal(visibleAvatarDock(dock, contact, workArea), true);
    assert.equal(avatarDockFrame(poses, dock), 'ground');
  }
  assert.equal(nearestDisplayAvatarDock({ x: contact.x, y: 961 }, display, 20), null);
  assert.equal(nearestDisplayAvatarDock({ x: contact.x, y: 970 }, display, 0), null);
  assert.equal(
    nearestDisplayAvatarDock({ x: contact.x, y: 1029 }, { bounds, workArea: bounds }, 20).kind,
    'floor',
  );
  const sideBar = { ...bounds, x: bounds.x + 48, width: bounds.width - 48 };
  assert.equal(
    nearestDisplayAvatarDock({ x: bounds.x + 3, y: 1029 }, { bounds, workArea: sideBar }, 20),
    null,
  );
});

test('floor seating stays on the selected monitor at a vertical display boundary', () => {
  const selected = { id: 8, workArea: { ...area, y: area.y - area.height } };
  const { controller, display } = fixture({ targetDisplay: selected });
  const contact = { x: area.x + area.width / 2, y: area.y };
  const frame = {
    anchor: { name: 'ground', x: 643, y: 1166 },
    url: 'capri://desktop/poses/pose-sit-floor.png',
    visibleBounds: { x: 185, y: 247, width: 884, height: 920 },
  };
  const from = { area, displayId: display.id, scale: 180, anchor: { x: 0.5, y: 0.9 } };
  const destination = controller.cursorDestination(contact, from, undefined, {
    frame,
    canvas,
    display: selected,
  });
  assert.equal(destination.displayId, selected.id);
  assert.deepEqual(destination.area, selected.workArea);
  assert.equal(destination.arrival.dock, 'ground');
  const spriteBottom = destination.to.y + (destination.to.scale * (1167 - 1166)) / canvas.height;
  assert.ok(Math.abs(spriteBottom - selected.workArea.height) < 0.001);
});

test('detached drag keeps pointer capture outside the sprite and accepts an off-display release', async () => {
  const drops = [];
  let release;
  let cursor = { x: area.x, y: area.y };
  const { controller, overlays, commands } = fixture({
    verification: false,
    onDragDrop: (point) => drops.push(point),
    getCursorScreenPoint: () => cursor,
    watchRelease(overlay, callback) {
      assert.equal(overlay, overlays[0]);
      release = callback;
      return () => {
        release = null;
      };
    },
  });
  const mask = { alpha: new Uint8Array(16).fill(255), imageSize: { width: 4, height: 4 } };
  await controller.leave(geometry, sprite, canvas, mask);
  const { to, anchor } = commands[0];
  const x = to.x + (0.35 - anchor.x) * to.scale;
  const y = to.y + (0.35 - anchor.y) * to.scale;
  cursor = { x: x + area.x, y: y + area.y };
  controller.updatePointer();
  assert.equal(overlays[0].clickThrough, false);
  controller.mouse({ type: 'mouseDown', button: 'left', x, y });
  cursor = { x: 200, y: 140 };
  controller.updatePointer();
  assert.equal(overlays[0].clickThrough, false);
  release(cursor);
  controller.updatePointer();
  assert.deepEqual(drops, [cursor]);
  assert.equal(overlays[0].clickThrough, true);
  controller.mouse({ type: 'mouseUp', button: 'left', x: cursor.x - area.x, y: cursor.y - area.y });
  assert.equal(drops.length, 1);
  controller.reset();
  assert.equal(release, null);
});

test('HUD bounds include a separately reported reply tab and follow the current desktop position', async () => {
  const { controller } = fixture();
  await controller.leave(geometry, sprite, canvas, {
    alpha: new Uint8Array(16).fill(255),
    imageSize: { width: 4, height: 4 },
  });
  try {
    const point = { ...controller.session.point };
    controller.replyPlacement = {
      x: point.x,
      y: point.y,
      hud: { x: 300, y: 100, width: 90, height: 22 },
      collapsed: true,
      controls: [],
    };
    controller.replyEdge = { x: 333, y: 128, width: 24, height: 25 };
    controller.replyPlacement.edge = { ...controller.replyEdge };
    const assertBounds = (expected) => {
      const actual = controller.hudBounds;
      for (const [key, value] of Object.entries(expected))
        assert(Math.abs(actual[key] - value) < 1e-8, `${key}: ${actual[key]} versus ${value}`);
    };
    assertBounds({
      x: area.x + 300,
      y: area.y + 100,
      width: 90,
      height: 53,
    });
    controller.session.point = { ...point, x: point.x + 50, y: point.y + 40 };
    controller.moveReplyGeometry(controller.session.point);
    assertBounds({
      x: area.x + 350,
      y: area.y + 140,
      width: 90,
      height: 53,
    });
    controller.hideParked();
    assert.equal(controller.hudBounds, null);
  } finally {
    controller.reset();
  }
});

test('native restacking repairs lost click-through state without cancelling a held drag', async () => {
  let cursor = { x: area.x, y: area.y };
  let watches = 0;
  const { controller, overlays } = fixture({
    verification: false,
    getCursorScreenPoint: () => cursor,
    watchRelease: () => {
      watches++;
      return () => watches--;
    },
  });
  const mask = { alpha: new Uint8Array(16).fill(255), imageSize: { width: 4, height: 4 } };
  try {
    await controller.leave(geometry, sprite, canvas, mask);
    const overlay = overlays[0],
      rect = controller.spriteRect();
    const point = { x: rect.x + rect.width * 0.4, y: rect.y + rect.height * 0.4 };
    cursor = { x: area.x + point.x, y: area.y + point.y };
    controller.updatePointer();
    assert.equal(overlay.clickThrough, false);
    // A native hide/restore can change HWND styles after the cached hover state.
    overlay.clickThrough = true;
    controller.updatePointer();
    assert.equal(
      overlay.clickThrough,
      true,
      'Unchanged hover alone cannot detect native style drift',
    );
    controller.raiseOverlay();
    assert.equal(
      overlay.clickThrough,
      false,
      'The native recovery heartbeat must repair hit routing',
    );
    controller.mouse({ type: 'mouseDown', button: 'left', ...point });
    const press = controller.press,
      timer = controller.pointerTimer;
    overlay.clickThrough = true;
    controller.raiseOverlay();
    assert.equal(overlay.clickThrough, false);
    assert.equal(controller.press, press, 'Recovery must preserve an active LMB hold');
    assert.equal(controller.pointerTimer, timer);
    assert.equal(watches, 1);
    controller.stopPointer();
    assert.equal(watches, 0);
    controller.raiseOverlay();
    assert.ok(
      controller.pointerTimer,
      'A visible detached layer recovers a stopped pointer watcher',
    );
    assert.equal(overlay.clickThrough, false);
    assert.equal(watches, 1);
    cursor = { x: area.x, y: area.y };
    overlay.clickThrough = false;
    controller.raiseOverlay();
    assert.equal(overlay.clickThrough, true, 'Empty desktop remains click-through after recovery');
  } finally {
    controller.reset();
  }
});

test('restoring a hidden perched avatar reinstalls hit testing and releases stale mouse gestures', async () => {
  let cursor = { x: area.x, y: area.y };
  let watching = 0,
    stops = 0;
  const drops = [];
  const { controller, overlays } = fixture({
    verification: false,
    getCursorScreenPoint: () => cursor,
    onDragDrop: (point) => drops.push(point),
    watchRelease: () => {
      watching++;
      return () => {
        watching--;
        stops++;
      };
    },
  });
  const mask = { alpha: new Uint8Array(16).fill(255), imageSize: { width: 4, height: 4 } };
  const seated = {
    ...sprite,
    anchor: { x: 620, y: 800, name: 'seat' },
    visibleBounds: { x: 0, y: 0, ...canvas },
  };
  const display = { id: 7, workArea: area };
  try {
    await controller.leave(geometry, sprite, canvas, mask);
    const seat = { x: area.x + 300, y: area.y + 400 };
    assert.equal(await controller.followFrame(seated, canvas, mask, seat, display), true);
    const overlay = overlays[0];
    // Model Windows rebuilding the native click-through state on a new ShowWindow.
    const show = overlay.showInactive.bind(overlay);
    let shows = 0,
      raises = 0;
    overlay.showInactive = () => {
      shows++;
      overlay.clickThrough = true;
      show();
    };
    overlay.moveTop = () => raises++;
    for (let iteration = 0; iteration < 6; iteration++) {
      const rect = controller.spriteRect();
      const point = { x: rect.x + rect.width * 0.4, y: rect.y + rect.height * 0.4 };
      cursor = { x: area.x + point.x, y: area.y + point.y };
      controller.updatePointer();
      assert.equal(overlay.clickThrough, false);
      controller.mouse({ type: 'mouseDown', button: 'left', ...point });
      assert.ok(controller.press);
      controller.hideParked();
      assert.equal(controller.press, null);
      assert.equal(controller.pointerTimer, null);
      assert.equal(watching, 0);
      assert.equal(overlay.clickThrough, true);
      controller.mouse({ type: 'mouseDown', button: 'left', ...point });
      assert.equal(controller.press, null, 'Hidden artwork cannot capture an invisible drag');
      // Cover both host-controlled showing and an HWND restored before the
      // first follow callback. The latter must still rearm native input.
      if (iteration >= 3) overlay.showInactive();
      assert.equal(await controller.followFrame(seated, canvas, mask, seat, display), true);
      assert.equal(overlay.isVisible(), true);
      assert.equal(
        overlay.clickThrough,
        false,
        'The stationary cursor is rechecked immediately after restore',
      );
      assert.equal(watching, 1);
      assert.equal(typeof controller.stopReleaseWatch, 'function');
      assert.equal(controller.acceptsPointer, true);
      const timer = controller.pointerTimer;
      const currentShows = shows,
        currentRaises = raises;
      assert.equal(await controller.followFrame(seated, canvas, mask, seat, display), true);
      assert.equal(controller.pointerTimer, timer, 'Ordinary follow preserves the active timer.');
      assert.equal(shows, currentShows);
      assert.equal(
        raises,
        currentRaises,
        'Following a visible avatar must not promote it every frame.',
      );
      assert.equal(watching, 1);
      controller.showParked();
      assert.equal(
        controller.pointerTimer,
        timer,
        'Showing an already visible avatar must preserve its active drag tracking',
      );
      controller.mouse({ type: 'mouseDown', button: 'left', ...point });
      controller.mouse({ type: 'mouseMove', x: point.x + 60, y: point.y + 45 });
      const released = { x: area.x + point.x + 60, y: area.y + point.y + 45 };
      cursor = released;
      controller.updatePointer();
      assert.equal(overlay.clickThrough, false, 'Dragging retains native mouse capture.');
      controller.mouse({ type: 'mouseUp', button: 'left', x: point.x + 60, y: point.y + 45 });
      controller.mouse({ type: 'mouseUp', button: 'left', x: point.x + 60, y: point.y + 45 });
      assert.deepEqual(drops.at(-1), released);
      assert.equal(drops.length, iteration + 1, 'One completed drag produces one teleport.');
    }
    assert.equal(drops.length, 6);
    assert.ok(stops >= 6);
    controller.hideParked();
    overlay.showInactive();
    assert.equal(await controller.followFrame(seated, canvas, mask, seat, display), true);
    assert.equal(
      watching,
      1,
      'An overlay already restored by Windows also resumes pointer tracking',
    );
    assert.equal(overlay.clickThrough, false);
  } finally {
    controller.reset();
  }
  assert.equal(watching, 0);
});

test('host restore shows Chromium content even after Windows already showed the avatar HWND', async () => {
  let cursor = { x: area.x, y: area.y };
  const { controller, overlays, display } = fixture({
    verification: false,
    getCursorScreenPoint: () => cursor,
  });
  const mask = { alpha: new Uint8Array(16).fill(255), imageSize: { width: 4, height: 4 } };
  const seated = {
    ...sprite,
    anchor: { x: 620, y: 800, name: 'seat' },
    visibleBounds: { x: 0, y: 0, ...canvas },
  };
  const seat = { x: area.x + 300, y: area.y + 400 };
  try {
    await controller.leave(geometry, sprite, canvas, mask);
    await controller.followFrame(seated, canvas, mask, seat, display);
    const overlay = overlays[0];
    let contentVisible = true,
      shows = 0;
    const show = overlay.showInactive.bind(overlay),
      hide = overlay.hide.bind(overlay);
    overlay.showInactive = () => {
      contentVisible = true;
      shows++;
      show();
    };
    overlay.hide = () => {
      contentVisible = false;
      hide();
    };
    const rect = controller.spriteRect(),
      point = { x: rect.x + rect.width * 0.4, y: rect.y + rect.height * 0.4 };
    cursor = { x: area.x + point.x, y: area.y + point.y };
    controller.hideParked();
    // Raw ShowWindow exposes only the native HWND. Its show event can restart
    // hover polling while Chromium's hidden content still rejects native input.
    overlay.visible = true;
    overlay.emit('show');
    const timer = controller.pointerTimer;
    assert.ok(timer);
    assert.equal(overlay.isVisible(), true);
    assert.equal(contentVisible, false);
    assert.equal(await controller.followFrame(seated, canvas, mask, seat, display), true);
    assert.equal(shows, 0, 'Ordinary follow avoids showing an already visible window.');
    assert.equal(contentVisible, false);
    assert.equal(await controller.followFrame(seated, canvas, mask, seat, display, true), true);
    assert.equal(contentVisible, true, 'An explicit host restore runs Chromium normal show.');
    assert.equal(shows, 1);
    assert.equal(controller.pointerTimer, timer);
    assert.equal(overlay.clickThrough, false);
    controller.mouse({ type: 'mouseDown', button: 'left', ...point });
    const press = controller.press;
    assert.ok(press);
    await controller.followFrame(seated, canvas, mask, seat, display);
    assert.equal(controller.press, press, 'Normal follow preserves the active LMB gesture.');
    assert.equal(controller.pointerTimer, timer);
    assert.equal(shows, 1);
    contentVisible = false;
    controller.showParked();
    assert.equal(contentVisible, true, 'Explicit recovery also repairs an already visible HWND.');
    assert.equal(shows, 2);
    assert.equal(controller.press, press);
    assert.equal(controller.pointerTimer, timer);
  } finally {
    controller.reset();
  }
});

test('detached drag moves by the cursor delta and preserves the grabbed point across monitors', async () => {
  const targetArea = { x: 0, y: 0, width: 500, height: 380 };
  let moving;
  const { controller, commands } = fixture({
    targetDisplay: { id: 8, workArea: targetArea },
    onDragDrop: (cursor, offset) => {
      moving = controller.hop(cursor, offset);
    },
  });
  const mask = { alpha: new Uint8Array(16).fill(255), imageSize: { width: 4, height: 4 } };
  await controller.leave(geometry, sprite, canvas, mask);
  const { anchor, to } = commands[0];
  const grab = { x: 0.42, y: 0.31 };
  const pressAt = (point) => ({
    x: point.x + (grab.x - anchor.x) * point.scale,
    y: point.y + (grab.y - anchor.y) * point.scale,
  });
  const mouse = (type, point) => controller.mouse({ type, button: 'left', ...point });
  const press = pressAt(to);
  const drop = { x: 600, y: 280 };
  mouse('mouseDown', press);
  mouse('mouseUp', drop);
  assert.equal(await moving, true);
  const sameDisplay = commands.at(-1).to;
  assert.ok(Math.abs(sameDisplay.x - to.x - (drop.x - press.x)) < 1e-8);
  assert.ok(Math.abs(sameDisplay.y - to.y - (drop.y - press.y)) < 1e-8);
  const cursor = { x: 220, y: 160 };
  mouse('mouseDown', pressAt(sameDisplay));
  mouse('mouseUp', { x: cursor.x - area.x, y: cursor.y - area.y });
  assert.equal(await moving, true);
  const acrossDisplay = commands.at(-1).to;
  assert.ok(acrossDisplay.scale < sameDisplay.scale);
  const onTarget = pressAt(acrossDisplay);
  assert.ok(Math.abs(onTarget.x + targetArea.x - cursor.x) < 1e-8);
  assert.ok(Math.abs(onTarget.y + targetArea.y - cursor.y) < 1e-8);
  controller.reset();
});

test('desktop shell registration waits for native coordinates and removes only its own verb', async () => {
  const commands = [];
  const teleports = [];
  let registryOwner = 'f'.repeat(64);
  const root = "D:\\Capri's test";
  const helper = root + '\\.runtime\\CapriDesktopTeleport.exe';
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  let token;
  const menu = new DesktopTeleportMenu(root, (point) => teleports.push(point), {
    run(args) {
      commands.push(args);
      return { status: 0, stdout: '    CapriOwner    REG_SZ    ' + registryOwner };
    },
    prepare: () => helper,
    start(executable, sessionToken) {
      assert.equal(executable, helper);
      token = sessionToken;
      return child;
    },
  });
  menu.hide();
  assert.deepEqual(
    commands.map(([verb]) => verb),
    ['query'],
  );
  await menu.show('Телепортировать Capri');
  assert.equal(commands.length, 1);
  child.stdout.write('999 999\nready\n');
  const command = commands.find((args) => args[1]?.endsWith('\\command')).at(-2);
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(command, `"${helper}" --teleport ${token}`);
  assert.ok(commands.some((args) => args.includes('Телепортировать Capri')));
  child.stdout.write('invalid\n-40 126\n');
  assert.deepEqual(teleports, [{ x: -40, y: 126 }]);
  const releases = [];
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(4242n);
  const cancel = menu.watchRelease(handle, (point) => releases.push(point));
  child.stdout.write('release 2 20 30\nrelease 1 12 34\n');
  cancel();
  child.stdout.write('release 1 55 55\n');
  assert.deepEqual(releases, [{ x: 12, y: 34 }]);
  const anchors = [];
  const unwatch = menu.watchWindow(
    { windowId: '526', processId: '11', startedAtTicks: '30401' },
    (point) => anchors.push(point),
  );
  child.stdout.write(
    'anchor 1 visible 12 20 900 650\nanchor 2 visible -42 12 640 600\nanchor 2 hidden\n',
  );
  unwatch();
  child.stdout.write('anchor 2 closed\n');
  assert.deepEqual(anchors, [
    { state: 'visible', x: -42, y: 12, width: 640, height: 600 },
    { state: 'hidden' },
  ]);
  registryOwner = menu.owner;
  menu.hide();
  assert.equal(commands.at(-1)[0], 'delete');
  assert.match(commands.at(-1)[1], /DesktopBackground\\shell\\Capri\.Teleport$/);
  child.stdout.write('10 20\n');
  assert.deepEqual(teleports, [{ x: -40, y: 126 }]);
});

test('invalid or undecodable artwork leaves the portrait attached', async () => {
  const { controller, phases, overlays } = fixture({ prepare: () => false });
  await assert.rejects(controller.leave(geometry, undefined, canvas), /artwork/);
  await assert.rejects(
    controller.leave({ rect: { ...geometry.rect, x: Infinity } }, sprite, canvas),
    /geometry/,
  );
  assert.equal(overlays.length, 0);
  await assert.rejects(controller.leave(geometry, sprite, canvas), /prepare the sprite/);
  assert.deepEqual(phases, []);
  assert.ok(overlays[0].isDestroyed());
});

test('switching displays cancels the current handoff and an obsolete reply cannot reset a new flight', async () => {
  const delayed = Promise.withResolvers();
  let played = 0;
  const { controller, display, overlays, phases } = fixture({
    play: () => (played++ === 0 ? delayed.promise : true),
  });
  const obsolete = controller.leave(geometry, sprite, canvas);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.phase, 'leaving');
  assert.equal(await controller.leave(geometry, sprite, canvas), false);
  display.id++;
  controller.checkDisplay();
  assert.equal(await obsolete, false);
  assert.equal(await controller.leave(geometry, sprite, canvas), true);
  delayed.resolve(true);
  assert.deepEqual(phases, ['leaving', 'attached', 'leaving', 'detached']);
  assert.ok(overlays[0].isDestroyed());
  assert.ok(!overlays[1].isDestroyed());
  controller.reset();
});

test('an unresponsive flight times out, removes the overlay and restores the portrait', async () => {
  const { controller, phases, overlays } = fixture({
    play: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  await assert.rejects(controller.leave(geometry, sprite, canvas), /timed out/);
  assert.deepEqual(phases, ['leaving', 'attached']);
  assert.ok(overlays[0].isDestroyed());
  assert.equal(controller.available, false);
});

test('return removes the desktop layer even when the companion has moved out of the work area', async () => {
  const { controller, content, phases, overlays } = fixture();
  assert.equal(await controller.leave(geometry, sprite, canvas), true);
  content.x = 1000;
  assert.equal(await controller.returnToFrame(), true);
  assert.deepEqual(phases, ['leaving', 'detached', 'attached']);
  assert.ok(overlays[0].isDestroyed());
});

test('short flights draw a narrower bolt and long flights retain the full spread', () => {
  function spread(distance, angle, reducedFlash) {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let furthest = 0;
    const measure = (x, y, radius = 0) => {
      furthest = Math.max(furthest, Math.abs(y * ux - x * uy) + radius);
    };
    const context = {
      beginPath() {},
      moveTo: measure,
      lineTo: measure,
      closePath() {},
      fill() {},
      ellipse: measure,
    };
    const origin = { x: 0, y: 0 };
    const target = { x: distance * ux, y: distance * uy };
    for (let frame = transitStart; frame < arrivalStart; frame++)
      draw(context, {
        frame,
        from: { ...origin, focus: origin },
        to: { ...target, focus: target },
        seed: 0x382bc1,
        scale: 240,
        reducedFlash,
        drawCapri: () => assert.fail('Sprite should be absent in transit'),
      });
    return furthest;
  }
  for (const angle of [0, Math.PI / 2, Math.PI / 3]) {
    for (const reducedFlash of [false, true]) {
      const [short, medium, long, extraLong] = [90, 240, 480, 720].map((distance) =>
        spread(distance, angle, reducedFlash),
      );
      assert.ok(short > 0 && short < long / 4);
      assert.ok(short < medium && medium < long);
      assert.ok(Math.abs(long - extraLong) < long / 10);
    }
  }
});

test('teleport sliders independently change stroke width, cuts and branches', () => {
  function render(overrides, reducedFlash = false) {
    let points;
    const shapes = [];
    const vertex = (x, y) => points.push({ x, y });
    const context = {
      beginPath() {
        points = [];
      },
      moveTo: vertex,
      lineTo: vertex,
      closePath() {},
      ellipse: vertex,
      fill() {
        shapes.push({ color: this.fillStyle, points });
      },
    };
    draw(context, {
      frame: transitStart + 6,
      from: { x: 80, y: 240 },
      to: { x: 700, y: 240 },
      seed: 0x382bc1,
      scale: 220,
      effects: { teleportIntensity: 50, teleportJaggedness: 20, teleportBranches: 0, ...overrides },
      reducedFlash,
      drawCapri: () => assert.fail('Sprite should be absent in transit'),
    });
    return shapes;
  }
  const area = (points) =>
    Math.abs(
      points.reduce((sum, a, i) => {
        const b = points[(i + 1) % points.length];
        return sum + a.x * b.y - a.y * b.x;
      }, 0),
    ) / 2;
  const [clean] = render({});
  assert.equal(render({}).length, 1);
  assert.ok(area(render({ teleportIntensity: 100 })[0].points) > area(clean.points));
  assert.ok(render({ teleportJaggedness: 100 })[0].points.length > clean.points.length);
  const branched = { teleportBranches: 100 };
  assert.ok(render(branched).some(({ color }) => color !== clean.color));
  assert.deepEqual(render({ ...branched, teleportReducedFlash: true }), render(branched, true));
});

test('arrival retracts opaque lightning and reveals the fixed destination sprite in stages', () => {
  const from = { x: 100, y: 220, focus: { x: 100, y: 150 } };
  const to = {
    x: 640,
    y: 220,
    scale: 190,
    focus: { x: 640, y: 150 },
    clip: { x: 570, y: 78, width: 150, height: 150 },
  };
  const anchor = { x: 0.5, y: 0.82 };

  function record(frame, reducedFlash) {
    let path;
    const opacityWrites = [];
    const paintedX = [];
    const masks = [];
    const saves = [];
    const sprites = [];
    const vertex = (x, y) => path.push({ x, y });
    const context = {
      get globalAlpha() {
        return 1;
      },
      set globalAlpha(value) {
        opacityWrites.push(value);
      },
      beginPath() {
        path = [];
      },
      moveTo: vertex,
      lineTo: vertex,
      closePath() {},
      ellipse(x, y, radius) {
        vertex(x - radius, y);
        vertex(x + radius, y);
      },
      fill() {
        paintedX.push(...path.map(({ x }) => x));
      },
      save() {
        saves.push(masks.length);
      },
      restore() {
        masks.length = saves.pop();
      },
      clip() {
        masks.push(path);
      },
    };
    draw(context, {
      frame,
      from,
      to,
      anchor,
      seed: 0x382bc1,
      scale: 190,
      reducedFlash,
      drawCapri: (point, tint = 0) => sprites.push({ point, tint, mask: masks.at(-1) }),
    });
    assert.deepEqual(opacityWrites, [], 'Arrival effects should cut away at full opacity');
    assert.equal(saves.length, 0);
    return { tail: to.x - Math.min(to.x, ...paintedX), sprites };
  }

  for (const reducedFlash of [false, true]) {
    const arrival = Array.from({ length: frames - arrivalStart }, (_, age) =>
      record(arrivalStart + age, reducedFlash),
    );
    assert.ok(arrival[0].tail > arrival[2].tail, 'The bolt tail should retreat toward Capri');
    assert.ok(arrival.some(({ sprites }) => sprites.some(({ mask }) => mask?.length >= 4)));
    for (const { sprites } of arrival)
      for (const { point } of sprites) assert.deepEqual(point, to, 'The sprite should stay fixed');
    for (const { tail, sprites } of arrival.slice(-2)) {
      assert.equal(tail, 0);
      assert.deepEqual(sprites, [{ point: to, tint: 0, mask: undefined }]);
    }
  }
});
