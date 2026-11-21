// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { Chess } from 'chess.js';
import {
  advancePosition,
  checkLine,
  chessMoveReactions,
  importGame,
  observedContinuation,
  observedMove,
  placement,
} from '../apps/desktop/chess/position.mjs';
import { markedSquares, refineBoardEdges } from '../apps/desktop/chess/board-colors.mjs';
import {
  ChessPageAccess,
  chessPage,
  chessRectInside,
  sameChessView,
  scaleChessRect,
} from '../apps/desktop/chess/source.mjs';
import {
  ChessSession,
  orientPlacement,
  readScreenPosition,
} from '../apps/desktop/chess/session.mjs';
import { ChessVision } from '../apps/desktop/chess/vision.mjs';
import { Stockfish } from '../apps/desktop/chess/uci.mjs';
import { ChessCapture } from '../apps/desktop/chess/capture.mjs';
import { chessArrowGeometry } from '../apps/desktop/renderer/chess-arrow.mjs';
import { chessFrameFlashes } from '../apps/desktop/renderer/chess-frame-effect.mjs';
import { chessLightningMotion } from '../apps/desktop/renderer/chess-move-lightning.mjs';
import { prepareTeleportMotion } from '../apps/desktop/renderer/avatar-teleport-motion.mjs';
import {
  DEFAULT_CHESS_FRAME,
  chessFrameAppearance,
  restoreChessFrameAppearance,
} from '../apps/desktop/renderer/chess-frame-style.mjs';
import { ChessReactions } from '../apps/desktop/chess/reactions.mjs';
import { chessReactionSettings } from '../apps/desktop/renderer/chess-reaction-settings.mjs';
import {
  ARROW_ANGLED_ENDS,
  ARROW_PRESETS,
  chessArrowAppearance,
  chessArrowDashes,
  restoreChessArrowAppearance,
} from '../apps/desktop/renderer/chess-arrow-style.mjs';
import { chessArrowPath } from '../apps/desktop/renderer/chess-arrow-path.mjs';

const bounds = { x: -800, y: 40, width: 800, height: 700 };
const chessMoveEvents = (...args) => chessMoveReactions(...args).flatMap(({ events }) => events);
const token = 'A'.repeat(64);
const view = (origin, path) => ({ origin, path, bounds, token });

test('Chess reactions infer captures, checks and outcomes from verified moves', () => {
  const opening = importGame({ text: '1. e4 d5' });
  const take = advancePosition(opening, 'e4d5');
  const recapture = advancePosition(take, 'd8d5');
  assert.deepEqual(
    chessMoveEvents(opening, recapture, 'w').map(({ type, side, captured }) => [
      type,
      side,
      captured,
    ]),
    [
      ['capture', 'player', 'p'],
      ['capture', 'opponent', 'p'],
    ],
  );
  assert.deepEqual(chessMoveEvents(take, opening, 'w'), []);
  const setup = importGame({ text: '1. f3 e5 2. g4' });
  assert.deepEqual(chessMoveEvents(setup, advancePosition(setup, 'd8h4'), 'w'), [
    { type: 'mate', san: 'Qh4#', color: 'b', piece: 'q', side: 'opponent' },
  ]);
  const promotion = { fen: 'k7/4P3/8/8/8/8/8/7K w - - 0 1' };
  assert.deepEqual(
    chessMoveEvents(promotion, advancePosition(promotion, 'e7e8n')).map(({ type }) => type),
    ['promotion', 'draw'],
  );
  const castle = { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' };
  assert.equal(chessMoveEvents(castle, advancePosition(castle, 'e1g1'))[0].type, 'castle');
  const check = importGame({ text: '1. e4 e5' });
  assert.equal(chessMoveEvents(check, advancePosition(check, 'f1b5')).length, 0);
  const marked = { fen: 'k7/8/8/8/8/8/8/4R2K w - - 0 1' };
  assert.equal(chessMoveEvents(marked, advancePosition(marked, 'e1e8'))[0].type, 'check');
});

test('verified chess reactions mention both moves, filter events and vary without cooldown', () => {
  const settings = chessReactionSettings();
  const delivered = [];
  const reactions = new ChessReactions({
    preferences: () => settings,
    allowed: () => true,
    now: () => 1000,
    random: () => 0,
    deliver: (text, spoken) => delivered.push([text, spoken]),
  });
  const twoMoves = [
    { events: [{ type: 'capture', side: 'player', piece: 'n', captured: 'q' }], moveNumber: 12 },
    {
      events: [
        { type: 'capture', side: 'opponent', piece: 'r', captured: 'n' },
        { type: 'check', side: 'opponent', piece: 'r' },
      ],
      checkers: ['r'],
      moveNumber: 12,
    },
  ];
  reactions.submit(twoMoves);
  assert.deepEqual(delivered, []);
  settings.enabled = true;
  reactions.submit(twoMoves);
  reactions.submit(twoMoves);
  assert.equal(delivered.length, 2);
  assert.match(
    delivered[0][0],
    /Your knight takes the queen.*opponent’s rook gives check.*rook takes the knight/iu,
  );
  assert.notEqual(delivered[0][0], delivered[1][0]);
  settings.events.check = false;
  settings.spoken = false;
  reactions.submit([twoMoves[1]]);
  assert.match(
    delivered.at(-1)[0],
    /rook takes the knight|knight is off the board|rook just took the knight/iu,
  );
  assert.doesNotMatch(delivered.at(-1)[0], /check/iu);
  assert.equal(delivered.at(-1)[1], false);
});

test('localized Chess reactions use the current style and the verified checker', () => {
  const preferences = chessReactionSettings({
    ...chessReactionSettings(),
    enabled: true,
    interval: 5,
  });
  assert.equal(preferences.enabled, true);
  assert.equal(Object.hasOwn(preferences, 'interval'), false);
  const move = {
    events: [{ type: 'check', color: 'w', piece: 'b' }],
    checkers: ['r'],
    advantage: 'b',
  };
  for (const [style, expected] of [
    ['neutral', /Ладья белых даёт шах.*Перевес у чёрных/iu],
    ['romantic', /Ладья белых даёт шах.*Я теперь смотрю/iu],
    ['business', /Ладья белых даёт шах.*У чёрных перевес/iu],
    ['wild', /Ладья белых даёт шах.*рука на пульте/iu],
  ]) {
    const lines = [];
    const reactions = new ChessReactions({
      preferences: () => preferences,
      allowed: () => true,
      language: () => 'ru',
      style: () => style,
      random: () => 0,
      deliver: (text) => lines.push(text),
    });
    reactions.submit([move]);
    assert.match(lines[0], expected, style);
    assert.doesNotMatch(lines[0], /слон/iu);
  }
});

test('a long chain of repeated checks keeps unique wording and never loses a move', () => {
  const prefs = { ...chessReactionSettings(), enabled: true };
  const lines = [];
  const reactions = new ChessReactions({
    preferences: () => prefs,
    allowed: () => true,
    random: () => 0,
    deliver: (text) => lines.push(text),
  });
  const events = [{ type: 'check', color: 'w', piece: 'q' }];
  for (let moveNumber = 1; moveNumber <= 36; moveNumber++)
    reactions.submit([{ events, moveNumber, checkers: ['q'] }]);
  assert.equal(lines.length, 36);
  assert.equal(new Set(lines).size, 36);
  assert.ok(lines.every((line) => /check/iu.test(line) && line.length <= 130));
});

test('Chess retains fresh reactions during speech and clears stale or cancelled moves', (t) => {
  const preferences = { ...chessReactionSettings(), enabled: true };
  let available = false;
  let now = 0;
  const lines = [];
  const reactions = new ChessReactions({
    preferences: () => preferences,
    allowed: () => available,
    now: () => now,
    random: () => 0,
    deliver: (text) => lines.push(text),
  });
  t.after(() => reactions.cancel());
  const game = new AbortController();
  reactions.submit([{ events: [{ type: 'start' }] }], game.signal);
  reactions.submit(
    [{ events: [{ type: 'check', side: 'opponent' }], checkers: ['q'] }],
    game.signal,
  );
  assert.deepEqual(lines, []);
  now = 400;
  available = true;
  reactions.drain();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Pieces up.*opponent’s queen gives check/iu);

  available = false;
  reactions.submit([{ events: [{ type: 'capture', side: 'player' }] }], game.signal);
  game.abort();
  reactions.submit([{ events: [{ type: 'capture', side: 'opponent' }] }]);
  now += 3001;
  available = true;
  reactions.drain();
  assert.equal(lines.length, 1);
});

test('Chess confirms the position and keeps evaluation separate from verified facts', async () => {
  const before = importGame({ text: '1. f3 e5 2. g4' });
  const mate = advancePosition(before, 'd8h4');
  const captureBefore = importGame({ text: '1. e4 d5' });
  const capture = advancePosition(captureBefore, 'e4d5');
  const confirmed = [];
  const session = new ChessSession({ react: (groups) => confirmed.push(...groups) });
  const watch = { controller: new AbortController(), trace: () => {} };
  const requests = [];
  let agrees = false;
  let bound;
  session.engine = async () => ({
    async verifyPosition(position) {
      requests.push(position.fen);
      const checked = position.fen === mate.fen && agrees;
      return { checked, checkers: checked ? ['q'] : [] };
    },
    async analyse(position, { quick }) {
      assert.equal(quick, true);
      assert.equal(position.fen, capture.fen);
      return { lines: [{ depth: 9, score: { type: 'cp', value: 205, bound } }] };
    },
  });
  await session.announceReactions(watch, chessMoveReactions(before, mate, 'w'));
  assert.deepEqual(confirmed, []);
  agrees = true;
  await session.announceReactions(watch, chessMoveReactions(before, mate, 'w'));
  assert.equal(requests.at(-1), mate.fen);
  assert.deepEqual(confirmed[0].checkers, ['q']);
  assert.equal(confirmed[0].events[0].type, 'mate');
  await session.announceReactions(watch, chessMoveReactions(captureBefore, capture, 'w'));
  assert.equal(confirmed.at(-1).advantage, 'w');
  bound = 'upperbound';
  await session.announceReactions(watch, chessMoveReactions(captureBefore, capture, 'w'));
  assert.equal(confirmed.at(-1).advantage, undefined);
  assert.equal(confirmed.at(-1).events[0].captured, 'p');
});

test('the board outline and lightning are on a non-activating overlay with real board bounds', async (t) => {
  const screen = new EventEmitter();
  const display = { id: 1, bounds: { x: 0, y: 40, width: 1080, height: 890 }, scaleFactor: 1 };
  screen.getAllDisplays = () => [display];
  screen.dipToScreenRect = (_window, rect) => rect;
  const view = { hwnd: '123', processId: 456 };
  const lightningSettings = {
    teleportColor: '#25c5ff',
    teleportThickness: 140,
    teleportGlow: 80,
    teleportSparkAmount: 90,
    teleportSparkTravel: 100,
  };
  const capture = new ChessCapture({
    screen,
    enabled: () => true,
    teleportEffects: () => ({ ...lightningSettings, avatarRoaming: true }),
    regionBitmap: async (_bounds, size, _signal, target) => {
      assert.deepEqual(target, view);
      assert.equal(visible, true);
      return { isEmpty: () => false, getSize: () => size, toBitmap: () => Buffer.alloc(16) };
    },
  });
  t.after(() => capture.close());
  const geometry = { x: 227, y: 122, width: 800, height: 800 };
  const frame = { display };
  const requests = [];
  let visible = false;
  let ignoresMouse = false;
  let windowBounds = geometry;
  capture.dip = () => geometry;
  capture.window = async (bounds, interactive) => {
    assert.deepEqual(bounds, geometry);
    assert.equal(interactive, false);
    return {
      getBounds: () => windowBounds,
      setBounds: (bounds) => (windowBounds = bounds),
      isDestroyed: () => false,
      isVisible: () => visible,
      setOpacity: () => assert.fail('Chess capture must leave the visible overlay alone'),
      setIgnoreMouseEvents: (value) => (ignoresMouse = value),
      showInactive: () => {
        assert.equal(ignoresMouse, true);
        visible = true;
      },
      hide: () => (visible = false),
      destroy: () => (visible = false),
      webContents: {
        executeJavaScript: async (script) => {
          requests.push(script);
          return true;
        },
      },
    };
  };
  const signal = new AbortController().signal;
  capture.configureBoardFrame(true);
  await capture.showBoardFrame(frame, geometry, signal);
  assert.equal(visible, true);
  await capture.show(frame, geometry, { uci: 'e4d5', orientation: 'white' }, signal);
  capture.configureShowArrow(false);
  await new Promise(setImmediate);
  assert.ok(requests.some((request) => request.includes('move(null)')));
  assert.equal(visible, true);
  capture.configureFrameStyle(chessFrameAppearance({ glow: 0, particlesOutward: false }));
  await new Promise(setImmediate);
  assert.deepEqual(windowBounds, { x: 217, y: 112, width: 820, height: 818 });
  assert.ok(requests.includes('globalThis.capriChessOverlay.layout("10px 10px 8px 10px")'));

  capture.configureFrameStyle(chessFrameAppearance({ glow: 30, particlesOutward: false }));
  await new Promise(setImmediate);
  assert.deepEqual(windowBounds, { x: 149, y: 44, width: 931, height: 886 });
  assert.ok(requests.includes('globalThis.capriChessOverlay.layout("78px 53px 8px 78px")'));

  capture.configureFrameStyle(
    chessFrameAppearance({ glow: 30, detail: 8, particlesOutward: true }),
  );
  await new Promise(setImmediate);
  assert.deepEqual(windowBounds, { x: 99, y: 40, width: 981, height: 890 });
  assert.ok(requests.includes('globalThis.capriChessOverlay.layout("82px 53px 8px 128px")'));
  await capture.flashMove(frame, geometry, { uci: 'e4d5', orientation: 'white' }, signal);
  assert.ok(requests.some((request) => request.includes('frame(true,')));
  assert.ok(
    requests.some(
      (request) =>
        request.includes('frameAppearance(') &&
        request.includes('"glow":30,"detail":8,"particlesOutward":true'),
    ),
  );
  const flashRequest = requests.find((request) => request.includes('flash({"uci":"e4d5"'));
  assert.ok(flashRequest);
  const { effects } = JSON.parse(
    flashRequest.slice('globalThis.capriChessOverlay.flash('.length, -1),
  );
  for (const [key, value] of Object.entries(lightningSettings)) assert.equal(effects[key], value);
  assert.equal(effects.teleportIntensity, 30);
  assert.equal(Object.hasOwn(effects, 'avatarRoaming'), false);
  capture.hideArrow({ keepFrame: true });
  assert.equal(visible, true);
  assert.ok(capture.flashTimer);
  const cleanFrame = await capture.frame('1', signal, { view });
  assert.match(await capture.boardSample(cleanFrame, geometry, signal, view), /^[a-f0-9]{64}$/);
  assert.ok(capture.flashTimer);
  capture.configureMoveLightning(false);
  assert.equal(visible, true);
  capture.configureBoardFrame(false);
  await new Promise(setImmediate);
  assert.equal(visible, false);
  assert.deepEqual(windowBounds, geometry);
  assert.ok(requests.includes('globalThis.capriChessOverlay.layout("0px 0px 0px 0px")'));
});

test('Chess frame restores retained preferences and accepts the expanded ranges', () => {
  const older = {
    color: '#76e8e3',
    accent: '#ff3975',
    corner: 4,
    width: 6,
    opacity: 85,
    glow: 7,
    flashCount: 0,
  };
  assert.deepEqual(restoreChessFrameAppearance(older), {
    width: 6,
    opacity: 85,
    glow: 7,
    detail: 8,
    particlesOutward: true,
  });
  assert.deepEqual(DEFAULT_CHESS_FRAME, {
    width: 8,
    opacity: 100,
    glow: 15,
    detail: 8,
    particlesOutward: true,
  });
  assert.deepEqual(restoreChessFrameAppearance(undefined), DEFAULT_CHESS_FRAME);
  assert.equal(
    restoreChessFrameAppearance({ ...older, particlesOutward: false }).particlesOutward,
    false,
  );
  assert.throws(() => chessFrameAppearance({ particlesOutward: 'true' }));
  assert.equal(chessFrameAppearance({ detail: 1 }).detail, 1);
  for (let detail = 2; detail <= 8; detail++)
    assert.equal(chessFrameAppearance({ detail }).detail, detail);
  assert.throws(() => chessFrameAppearance({ detail: 9 }));
  assert.throws(() => chessFrameAppearance({ detail: 1.5 }));
  assert.throws(() => chessFrameAppearance({ flashCount: 0 }));
  assert.throws(() => chessFrameAppearance({ color: '#76e8e3' }));
  assert.equal(chessFrameAppearance({ glow: 30 }).glow, 30);
  assert.throws(() => chessFrameAppearance({ glow: 31 }));
  assert.throws(() => restoreChessFrameAppearance({ ...older, width: -1 }));
});

test('each chess flash stays put, fades out, and can respawn on any edge', () => {
  const seed = 7661901;
  const edges = new Set();
  const positions = new Set();
  let burst;
  let longest = 0;
  let peakCount = 0;
  for (let now = 0; now < 20000; now += 20) {
    assert.equal(chessFrameFlashes(now, 0, seed).length, 0);
    const many = chessFrameFlashes(now, 12, seed);
    assert.ok(many.length <= 12);
    for (const flash of many) edges.add(flash.edge);
    peakCount = Math.max(peakCount, many.length);
    const [flash] = chessFrameFlashes(now, 1, seed);
    if (!flash) {
      if (burst) {
        assert.ok(burst.peak > burst.heat);
        longest = Math.max(longest, now - burst.start);
      }
      burst = null;
      continue;
    }
    const spot = flash.edge + '/' + flash.position;
    if (!burst) {
      burst = { spot, start: now, peak: 0 };
      positions.add(spot);
    }
    assert.equal(spot, burst.spot);
    burst.peak = Math.max(burst.peak, flash.heat);
    burst.heat = flash.heat;
  }
  assert.equal(edges.size, 4);
  assert.ok(positions.size > 8 && longest < 730 && peakCount > 1);
});

test('a rejected screen move leaves the board outline and effects idle', async (t) => {
  let prepared = false;
  const session = new ChessSession({
    enabled: () => true,
    autoMove: () => true,
    install: { cancel() {} },
    capture: {
      frame: async () => ({ revision: 'monitor' }),
      inView: () => true,
      fingerprint: () => 'matching',
      center: () => ({ x: 400, y: 400 }),
      movePoints: () => [
        { x: 20, y: 30 },
        { x: 40, y: 50 },
      ],
      prepareFlash: async () => {
        prepared = true;
      },
      flashMove: () => assert.fail('A press signal is required for lightning'),
      close() {},
      drop() {},
    },
    playScreenMove: async () => ({ status: 'blocked', moveProbe: 'target_obscured' }),
  });
  t.after(() => session.close());
  const watch = {
    board: { rect: {}, fingerprint: 'matching' },
    controller: new AbortController(),
    position: { fen: new Chess().fen() },
    result: { bestMove: { uci: 'e2e4' } },
    orientation: 'white',
    trace() {},
  };
  await session.autoPlay(watch, {}, '8', 'monitor');
  assert.equal(prepared, true);
  assert.equal(watch.expectedMove, undefined);
});

test('Chess streams a legal provisional variation and keeps bestmove authoritative', async (t) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => child.emit('close');
  child.stdin = new Writable({
    write(bytes, _encoding, done) {
      if (String(bytes).startsWith('go ')) {
        child.stdout.write('info depth 1 score cp 44 pv a1a8\n');
        child.stdout.write('info depth 2 score cp 25 pv e2e4 e7e5\n');
        setTimeout(() => {
          child.stdout.write('info depth 9 score cp 31 pv d2d4 d7d5\n');
          child.stdout.write('bestmove d2d4\n');
        }, 180);
      }
      done();
    },
  });
  const engine = new Stockfish('stockfish.exe', { spawnImpl: () => child });
  t.after(() => engine.close());
  const hints = [];
  const result = await engine.analyse(
    { fen: new Chess().fen() },
    { deep: true, onProgress: (value) => hints.push(value.bestMove.uci) },
  );
  assert.deepEqual(hints, ['e2e4', 'd2d4']);
  assert.equal(result.bestMove.uci, 'd2d4');
  assert.equal(result.lines[0].depth, 9);
});

test('Stockfish confirms the board and the side in check without a search', async (t) => {
  const before = importGame({ text: '1. f3 e5 2. g4' });
  const mate = advancePosition(before, 'd8h4');
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => child.emit('close');
  const commands = [];
  let returnedFen = mate.fen;
  child.stdin = new Writable({
    write(bytes, _encoding, done) {
      const command = bytes.toString().trim();
      commands.push(command);
      if (command === 'd') child.stdout.write(`Fen: ${returnedFen}\nCheckers: h4 \n`);
      done();
    },
  });
  const engine = new Stockfish('stockfish.exe', { spawnImpl: () => child });
  t.after(() => engine.close());
  assert.deepEqual(await engine.verifyPosition(mate), { checked: true, checkers: ['q'] });
  assert.deepEqual(commands, [`position fen ${mate.initial} moves f2f3 e7e5 g2g4 d8h4`, 'd']);
  returnedFen = before.fen;
  await assert.rejects(engine.verifyPosition(mate), /did not match/);
});

test('Chess bounds display captures while preserving manual resolution', async (t) => {
  const screen = new EventEmitter();
  screen.getAllDisplays = () => [
    { id: 1, bounds: { x: 0, y: 0, width: 3200, height: 1800 }, scaleFactor: 1.25 },
  ];
  const requested = [];
  const capture = new ChessCapture({
    screen,
    enabled: () => true,
    desktopCapturer: {
      getSources: async ({ thumbnailSize }) => {
        requested.push(thumbnailSize);
        return [{ display_id: '1', thumbnail: { isEmpty: () => false } }];
      },
    },
  });
  t.after(() => capture.close());
  const signal = new AbortController().signal;
  await capture.frame('1', signal);
  await capture.frame('1', signal, { maximumEdge: 3200 });
  assert.deepEqual(requested, [
    { width: 1600, height: 900 },
    { width: 3200, height: 1800 },
  ]);
});

test('Chess upgrades existing arrow styles, validates profiles and bounds custom geometry', () => {
  const legacy = chessArrowAppearance({ opacity: 57, style: 'dashed' });
  assert.equal(legacy.opacity, 57);
  assert.equal(legacy.pattern, 'dashed');
  assert.equal(chessArrowAppearance().thickness, 10);
  assert.equal(chessArrowAppearance({ opacity: 100, style: 'thin' }).thickness, 4);
  assert.throws(() => chessArrowAppearance({ opacity: 101, style: 'solid' }));
  assert.throws(() => chessArrowAppearance({ opacity: 50, style: 'unknown' }));
  for (const invalid of [
    { route: 'circle' },
    { fill: 'red' },
    { color: 'url(https://invalid.test)' },
    { shaftPath: '<svg />' },
    { headPath: 'M 0 0 Q 0 -200 1000' },
    { tailPath: 'M 0 0 L 3001 0' },
    { customDash: '0 3' },
    { headAngle: -1 },
    { headAngle: 146 },
    { tailAngle: 14.5 },
  ])
    assert.throws(() => chessArrowAppearance(invalid));

  const style = chessArrowAppearance({
    schemaVersion: 2,
    route: 'custom',
    shaftPath: 'M 0 0 Q 500 -200 1000 0',
    pattern: 'custom',
    customDash: '15, 26 7 26',
    opacity: 55,
    head: 'custom',
    headFill: false,
    headPath: 'M -1000 -500 L 0 0 L -1000 500',
    tail: 'diamond',
    startGap: 20,
    endGap: 20,
  });
  assert.deepEqual(chessArrowDashes(style.customDash), [15, 26, 7, 26]);
  assert.deepEqual(chessArrowAppearance(JSON.parse(JSON.stringify(style))), style);
  const white = chessArrowGeometry('e2e4', 'white', style);
  const black = chessArrowGeometry('e2e4', 'black', style);
  assert.equal(white.transform, 'translate(4.5 6.5) rotate(-90)');
  assert.equal(black.transform, 'translate(3.5 1.5) rotate(90)');
  assert.match(white.path, /^M[^Q]+ Q/);
  assert.match(white.tail.transform, /rotate\(180\)$/);
  assert.equal(white.head.open, true);
  assert.equal(white.tail.open, false);
  assert.equal(chessArrowGeometry('g7g8q', 'white', style).promotion, 'Q');
  assert.equal(chessArrowGeometry('d4d4', 'white', style), null);
});

test('Chess updates saved default arrow widths while retaining customized profiles', () => {
  const formerDefault = {
    ...chessArrowAppearance(),
    thickness: 16,
    headLength: 52,
    headWidth: 61,
    glow: 8,
  };
  delete formerDefault.headAngle;
  delete formerDefault.tailAngle;
  const formerThin = {
    ...formerDefault,
    thickness: 9,
    headLength: 34,
    headWidth: 39,
    glow: 5,
  };
  assert.deepEqual(restoreChessArrowAppearance(formerDefault), chessArrowAppearance());
  assert.deepEqual(
    restoreChessArrowAppearance(formerThin),
    chessArrowAppearance(ARROW_PRESETS.thin),
  );
  const customized = { ...formerDefault, color: '#aa1133' };
  assert.deepEqual(restoreChessArrowAppearance(customized), chessArrowAppearance(customized));
});

test('Chess angles change supported head shapes and short moves limit both tip lengths', () => {
  for (const head of ['triangle', 'chevron', 'diamond', 'rounded', 'swept', 'kite']) {
    assert.ok(ARROW_ANGLED_ENDS.includes(head), head);
    const style = {
      head,
      tail: head,
      startGap: 90,
      endGap: 90,
      headLength: 135,
      tailLength: 135,
      tailAngle: 50,
    };
    const narrow = chessArrowGeometry(
      'b5c5',
      'white',
      chessArrowAppearance({ ...style, headAngle: 30 }),
    );
    const wide = chessArrowGeometry(
      'b5c5',
      'white',
      chessArrowAppearance({ ...style, headAngle: 145 }),
    );
    assert.notEqual(narrow.head.path, wide.head.path, head);
    assert.equal(narrow.head.length, wide.head.length, head);
    assert.ok(narrow.head.length + narrow.tail.length < narrow.end - narrow.start, head);
    assert.equal(narrow.head.clip, true, head);
    assert.equal(narrow.tail.clip, true, head);
    assert.equal(narrow.tail.path, wide.tail.path, head);
  }
  for (const headAngle of [1, 30, 145]) {
    const style = chessArrowAppearance({ headAngle, headLength: 135 });
    const { head } = chessArrowGeometry('b5g5', 'white', style);
    const [, shoulder] = chessArrowPath(head.path);
    const [, [x, y]] = shoulder;
    const measured = (Math.atan2(-y, -x) * 360) / Math.PI;
    assert.ok(Math.abs(measured - headAngle) < 0.03, String(headAngle));
  }
});

test('Chess lightning uses the teleport path on both board orientations', () => {
  const bounds = { width: 800, height: 800 };
  const white = chessLightningMotion('e2e4', 'white', bounds, { seed: 25 });
  assert.deepEqual(white.motion.start, { x: 450, y: 650 });
  assert.deepEqual(white.motion.end, { x: 450, y: 450 });
  assert.deepEqual(white.motion, prepareTeleportMotion(white));
  assert.ok(white.viewport.width * white.viewport.height < bounds.width * bounds.height * 0.25);
  assert.notDeepEqual(
    white.motion.points,
    chessLightningMotion('e2e4', 'white', bounds, { seed: 30 }).motion.points,
  );
  const black = chessLightningMotion('e7e8q', 'black', bounds);
  assert.deepEqual(black.motion.start, { x: 350, y: 650 });
  assert.deepEqual(black.motion.end, { x: 350, y: 750 });
  assert.equal(black.viewport.y + black.viewport.height, bounds.height);
  assert.equal(chessLightningMotion('a1a1', 'white', bounds), null);
});

test('Chess samples only its selected display and probes the board region at fractional DPI', async (t) => {
  const screen = new EventEmitter();
  screen.getAllDisplays = () => [
    { id: 22, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: 11, bounds: { x: -1280, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 },
  ];
  screen.dipToScreenRect = (_window, rect) =>
    Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * 1.5)]));
  screen.dipToScreenPoint = (point) => screen.dipToScreenRect(null, point);
  const calls = [];
  const capture = new ChessCapture({
    screen,
    enabled: () => true,
    desktopCapturer: { getSources: () => assert.fail('Must not capture all displays') },
    regionBitmap: async (region, limit, _signal, windowClient) => {
      calls.push({ region, limit, ...(windowClient && { windowClient }) });
      return { isEmpty: () => false, getSize: () => limit, toBitmap: () => Buffer.alloc(16) };
    },
  });
  t.after(() => capture.close());
  const signal = new AbortController().signal;
  const frame = await capture.frame('11', signal);
  const rect = { x: 500, y: 250, width: 500, height: 500 };
  const view = { hwnd: '27183', processId: 19, token: 'internal' };
  const sample = await capture.boardSample(frame, rect, signal, view);
  assert.match(sample, /^[a-f0-9]{64}$/);
  assert.deepEqual(capture.movePoints(frame, rect, 'e2e4', 'white'), [
    { x: -982, y: 788 },
    { x: -982, y: 638 },
  ]);
  assert.deepEqual(capture.movePoints(frame, rect, 'e2e4', 'black'), [
    { x: -1057, y: 413 },
    { x: -1057, y: 563 },
  ]);
  assert.deepEqual(calls, [
    { region: { x: -1920, y: 0, width: 1920, height: 1080 }, limit: { width: 1600, height: 900 } },
    {
      region: { x: -1320, y: 300, width: 600, height: 600 },
      limit: { width: 96, height: 96 },
      windowClient: { hwnd: '27183', processId: 19 },
    },
  ]);
});

test('Chess imports PGN at the chosen ply and preserves move history', () => {
  const analysis = importGame({ text: '1. e4 e5 2. Nf3 Nc6', ply: 2 });
  assert.equal(analysis.count, 4);
  assert.deepEqual(analysis.moves, ['e2e4', 'e7e5']);
  assert.equal(new Chess(analysis.fen).turn(), 'w');
  assert.deepEqual(checkLine(analysis.fen, ['g1f3', 'b8c6', 'a1a8']), [
    { uci: 'g1f3', san: 'Nf3' },
    { uci: 'b8c6', san: 'Nc6' },
  ]);
  assert.throws(() => importGame({ text: '1. e4 e5', ply: 3 }));
  assert.throws(() => importGame({ text: '8/8/8/8/8/8/8/8 w - - 0 1' }));
  assert.throws(() => importGame({ text: '4k3/8/8/8/8/8/8/4K3 w K - 0 1' }));
});

test('Chess resolves screenshot geometry orientation and tracks only a legal single move', () => {
  const original = 'r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1';
  const start = placement(original);
  const reversed = orientPlacement(start, 'black');
  assert.equal(orientPlacement(reversed, 'black'), start);
  const board = new Chess(original);
  board.move('exd6');
  assert.equal(observedMove(original, placement(board.fen())).move, 'e5d6');
  board.move('O-O');
  assert.equal(observedMove(original, placement(board.fen())), null);
  const promotion = '7k/P7/8/8/8/8/8/7K w - - 0 1';
  assert.deepEqual(checkLine(promotion, ['a7a8n']), [{ uci: 'a7a8n', san: 'a8=N' }]);
  assert.equal(chessRectInside({ x: -630, y: 80, width: 400, height: 400 }, bounds), true);
  assert.equal(chessRectInside({ x: -250, y: 80, width: 400, height: 400 }, bounds), false);
});

test('Chess recognizes the side from the opening in either orientation and retains exact FEN from an analysis page', () => {
  const board = new Chess();
  const screen = (orientation = 'white') => ({
    placement: orientPlacement(placement(board.fen()), orientation),
    reliable: true,
    orientation,
  });
  assert.equal(readScreenPosition(screen()).fen, board.fen());
  board.move('e4');
  assert.equal(readScreenPosition(screen('black')).fen, board.fen());
  board.move('d5');
  assert.deepEqual(readScreenPosition(screen()).moves, ['e2e4', 'd7d5']);
  for (const move of ['exd5', 'Qxd5', 'Nc3']) board.move(move);
  assert.equal(readScreenPosition(screen()), null);
  const address = view(
    'https://lichess.org',
    '/analysis/standard/' + board.fen().replaceAll(' ', '_'),
  );
  assert.equal(readScreenPosition(screen('black'), address).fen, board.fen());
  assert.equal(readScreenPosition({ ...screen(), reliable: false }, address), null);
});

test('Chess resolves uncertain piece identities only when the opening occupancy matches', () => {
  const expected = new Chess().fen();
  const page = view('https://www.chess.com', '/play/computer');
  const read = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNbQKbnP';
  for (const orientation of ['white', 'black']) {
    const confidence = Array(64).fill(0.99);
    for (const i of [2, 5, 6, 7]) confidence[orientation === 'black' ? (i + 56) ^ 7 : i] = 0.55;
    const screen = {
      placement: orientPlacement(read, orientation),
      orientation,
      reliable: false,
      confidence,
    };
    assert.equal(readScreenPosition(screen, page).fen, expected);
    assert.equal(readScreenPosition(screen), null);
    assert.equal(readScreenPosition({ ...screen, confidence: Array(64).fill(0.99) }, page), null);
    assert.equal(
      readScreenPosition(
        { ...screen, placement: orientPlacement(read.replace('RNbQ', 'RN1Q'), orientation) },
        page,
      ),
      null,
    );
  }
});

test('Chess recovers the side from visible last-move highlights and checks the move geometry', () => {
  const board = new Chess();
  for (const move of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3']) board.move(move);
  const squares = [57, 42]; // b1–c3
  const screen = { placement: placement(board.fen()), reliable: true, orientation: 'white' };
  const bytes = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const row = Math.floor(y / 16),
        column = Math.floor(x / 16);
      const color = squares.includes(row * 8 + column)
        ? [93, 185, 236]
        : (row + column) % 2
          ? [77, 122, 79]
          : [195, 220, 232];
      bytes.set(color, (y * 128 + x) * 4);
    }
  }
  const marks = markedSquares({
    getSize: () => ({ width: 128, height: 128 }),
    toBitmap: () => bytes,
  });
  assert.deepEqual(
    marks.toSorted((a, b) => a - b),
    [42, 57],
  );
  assert.equal(readScreenPosition(screen, null, marks).fen.split(' ')[1], 'b');
  assert.equal(readScreenPosition(screen, null, [0, 57]), null);
});

test('Chess keeps opening rights and follows two moves that fit between screen captures', () => {
  const initial = new Chess();
  const position = { fen: initial.fen() };
  initial.move('e4');
  initial.move('e5');
  const next = observedContinuation(position, placement(initial.fen()), { replies: true });
  assert.equal(next.fen, initial.fen());
  assert.deepEqual(next.moves, ['e2e4', 'e7e5']);
  assert.equal(next.initial, position.fen);
  initial.move('Nf3');
  const pieces = placement(initial.fen()).replace('RNBQKB1R', 'RNbQKB1R');
  const confidence = Array(64).fill(0.99);
  confidence[58] = 0.61;
  assert.equal(observedContinuation(next, pieces), null);
  assert.deepEqual(observedContinuation(next, pieces, { confidence }).moves, [
    'e2e4',
    'e7e5',
    'g1f3',
  ]);
  const beforeReply = importGame({ text: '1. e4 c5' });
  const { fen, initial: opening, moves } = importGame({ text: '1. e4 c5 2. Nf3 Nc6' });
  assert.deepEqual(observedContinuation(beforeReply, placement(fen), { replies: true }), {
    fen,
    initial: opening,
    moves,
    count: 0,
  });
});

test('Chess auto move applies en passant, castling and promotion with the original history', () => {
  const source = { fen: 'r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1' };
  const capture = advancePosition(source, 'e5d6');
  assert.deepEqual(capture.moves, ['e5d6']);
  assert.equal(new Chess(capture.fen).get('d5'), undefined);
  const castle = advancePosition(capture, 'e8g8');
  assert.deepEqual(castle.moves, ['e5d6', 'e8g8']);
  assert.equal(castle.initial, source.fen);
  assert.deepEqual(new Chess(castle.fen).get('f8'), { type: 'r', color: 'b' });
  const promotion = advancePosition({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1' }, 'a7a8n');
  assert.deepEqual(new Chess(promotion.fen).get('a8'), { type: 'n', color: 'w' });
  assert.throws(() => advancePosition(source, 'e5e8'));
});

test('offline analysis never auto-plays on the preview and respects late cancellation', async (t) => {
  const session = new ChessSession({
    enabled: () => true,
    autoMove: () => true,
    playScreenMove: () => assert.fail('Offline analysis must never send pointer input'),
    capture: { drop() {}, close() {} },
    install: { cancel() {} },
  });
  t.after(() => session.close());
  const history = [];
  session.engine = async () => ({
    analyse: async ({ fen, moves }) => {
      history.push(moves);
      const [move] = new Chess(fen).moves({ verbose: true });
      return { bestMove: { uci: move.lan } };
    },
  });
  const text = '1. e4 e5 2. Nf3';
  const value = await session.analyse({ text, play: true });
  assert.equal(value.nextFen, undefined);
  assert.equal(new Chess(value.fen).turn(), 'b');
  assert.deepEqual(history.at(-1), ['e2e4', 'e7e5', 'g1f3']);

  let finish;
  session.engine = async () => ({
    analyse: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const cancelled = session.analyse({ text, play: true });
  await new Promise(setImmediate);
  session.stop();
  finish({ bestMove: { uci: 'b8c6' } });
  await assert.rejects(cancelled, { name: 'AbortError' });
});

test('Chess overlay admits analysis and built-in computer pages without treating arbitrary pages as trusted', async () => {
  assert.ok(chessPage(view('https://www.chess.com', '/analysis')));
  assert.ok(chessPage(view('https://www.chess.com', '/play/computer')));
  for (const path of [
    '/ru/play/computer',
    '/pt-BR/play/computer/Isabel',
    '/fr/play/computer/group/creators',
    '/ru/analysis',
  ])
    assert.ok(chessPage(view('https://www.chess.com', path)), path);
  assert.ok(chessPage(view('https://lichess.org', '/analysis/standard')));
  for (const source of [
    view('https://www.chess.com', '/game/live/123'),
    view('https://www.chess.com', '/analysis/game/live/123'),
    view('https://www.chess.com', '/ru/analysis/game/daily/123'),
    view('https://www.chess.com', '/ru/play/online'),
    view('https://www.chess.com', '/ru/play/computer-tools'),
    view('https://www.chess.com', '/play/online'),
    view('https://www.chess.com.example.org', '/analysis'),
    view('https://www.chess.com', '/analysis-looking'),
    view('https://lichess.org', '/tournament/AbCd1234'),
    view('http://lichess.org', '/analysis'),
  ])
    assert.equal(chessPage(source), null);
  let requests = 0;
  let game = { id: 'AbCd1234', variant: 'standard', status: 'started', players: {} };
  const access = new ChessPageAccess({
    inspect: async () => view('https://lichess.org', '/AbCd1234Wxyz/white'),
    fetchImpl: async (url) => {
      requests++;
      assert.match(url, /\/AbCd1234\?/);
      return Response.json(game);
    },
  });
  const signal = new AbortController().signal;
  assert.equal(await access.allowed(signal), null);
  game = { ...game, status: 'resign' };
  assert.ok(await access.allowed(signal));
  assert.ok(await access.allowed(signal));
  assert.equal(requests, 2);
});

test('Chess prefers tab identity and falls back to the verified bot window', () => {
  const first = {
    ...view('https://www.chess.com', '/play/computer'),
    tabId: token,
    windowId: 'D'.repeat(64),
  };
  const next = { ...first, path: '/ru/play/computer/Maximum', token: 'B'.repeat(64) };
  assert.equal(sameChessView(first, next), true);
  assert.equal(sameChessView(first, { ...next, tabId: 'C'.repeat(64) }), false);
  assert.equal(sameChessView(first, { ...next, path: '/analysis' }), false);
  assert.equal(sameChessView(first, { ...next, path: '/game/live/123' }), false);
  assert.equal(sameChessView(first, { ...next, tabId: null }), true);
  assert.equal(sameChessView(first, { ...next, tabId: null, windowId: 'E'.repeat(64) }), false);
});

test(
  'Chess follows a bot rematch after an interruption, detects the new color and makes one confirmed move',
  { timeout: 12000 },
  async (t) => {
    const rect = { x: 36, y: 46, width: 400, height: 400 };
    const ended = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
    const rematch = new Chess();
    rematch.move('e4');
    const first = { ...view('https://www.chess.com', '/play/computer'), tabId: token };
    const second = { ...first, path: '/play/computer/Maximum', token: 'B'.repeat(64) };
    let active = first;
    let game = ended;
    let orientation = 'white';
    let resume;
    const commands = [];
    const flashes = [];
    const reactions = [];
    const searches = [];
    const events = [];
    const confirmed = Promise.withResolvers();
    const screenPlacement = () => orientPlacement(placement(game.fen()), orientation);
    const session = new ChessSession({
      enabled: () => true,
      autoMove: () => true,
      reactionsEnabled: () => true,
      react: (moves) => reactions.push(...moves.flatMap(({ events }) => events)),
      install: { cancel() {} },
      access: { allowed: async () => active },
      trace: () => (stage, details) => {
        events.push({ stage, ...details });
        if (details?.reason === 'auto_move_confirmed') confirmed.resolve();
      },
      capture: {
        async afterOverlay() {},
        async frame() {
          return { revision: 'monitor' };
        },
        center: () => ({ x: 236, y: 246 }),
        inView: (_frame, _rect, view) => Boolean(view),
        fingerprint: screenPlacement,
        movePoints: (_frame, _rect, uci, facing) => {
          assert.equal(uci, 'e7e5');
          assert.equal(facing, 'black');
          return [
            { x: 211, y: 371 },
            { x: 211, y: 271 },
          ];
        },
        async flashMove(_frame, _rect, move) {
          flashes.push(move);
        },
        async show() {},
        hideArrow() {},
        drop() {},
        close() {},
      },
      hideSettings() {},
      showSettings() {},
      playScreenMove: async (command) => {
        commands.push(command);
        assert.equal(command.token, second.token);
        assert.equal(flashes.length, 0);
        command.onMovePressed();
        assert.equal(flashes.length, 1);
        rematch.move('e5');
        return { status: 'sent' };
      },
    });
    t.after(() => {
      clearTimeout(resume);
      session.close();
    });
    session.detect = async () => [{ rect, reliable: true, placement: screenPlacement() }];
    session.engine = async () => ({
      verifyPosition: async ({ fen }) => ({ checked: new Chess(fen).isCheck() }),
      analyse: async ({ fen, moves }) => {
        searches.push({ fen, moves });
        if (fen === ended.fen()) {
          active = null;
          resume = setTimeout(() => {
            active = second;
            game = rematch;
            orientation = 'black';
          }, 3600);
          return { terminal: true };
        }
        return { bestMove: { uci: new Chess(fen).turn() === 'b' ? 'e7e5' : 'g1f3' } };
      },
    });
    session.scanned = {
      id: '8',
      revision: 'monitor',
      result: [
        {
          rect,
          view: first,
          fingerprint: screenPlacement(),
          placement: screenPlacement(),
          position: { fen: ended.fen() },
          watchable: true,
        },
      ],
    };
    session.watch({ index: 0, orientation: 'white', analyse: true });
    await confirmed.promise;
    assert.equal(commands.length, 1);
    assert.deepEqual(flashes, [{ uci: 'e7e5', orientation: 'black' }]);
    assert.deepEqual(reactions, [{ type: 'start' }]);
    assert.deepEqual(searches[1].moves, ['e2e4']);
    assert.ok(events.some(({ stage }) => stage === 'paused'));
    assert.ok(events.some(({ stage }) => stage === 'resumed'));
    assert.ok(events.some(({ reason }) => reason === 'view_rebound'));
    assert.ok(events.some(({ reason }) => reason === 'new_game'));
    assert.equal(session.scanned.result[0].orientation, 'black');
    assert.equal(
      session.shouldAutoMove(
        { ...session.watchRun, result: { bestMove: { uci: 'g1f3' } } },
        second,
      ),
      false,
    );
  },
);

test(
  'Chess anchors a selected window to its visible board and refreshes its arrow after a move',
  { timeout: 9000 },
  async (t) => {
    const board = new Chess();
    const rect = { x: 36, y: 46, width: 400, height: 400 };
    const frame = { revision: 'display revision' };
    const initialView = view('https://lichess.org', '/analysis');
    let switched = false;
    let overlayOpen = false;
    let retryView = false;
    const arrows = [];
    const diagnostics = [];
    const lost = Promise.withResolvers();
    const session = new ChessSession({
      enabled: () => true,
      trace: (operation) => (stage, details) => diagnostics.push({ operation, stage, ...details }),
      install: { cancel() {} },
      access: {
        allowed: async (signal, target) => {
          signal.throwIfAborted();
          if (target.hwnd) assert.equal(target.hwnd, '123');
          if (retryView) {
            retryView = false;
            return null;
          }
          return switched ? null : initialView;
        },
      },
      capture: {
        async afterOverlay() {},
        async *pageFrames() {
          yield { id: '8', frame, crop: rect };
        },
        frame: async (id) => {
          assert.equal(id, '8');
          return frame;
        },
        center: () => ({ x: 236, y: 246 }),
        inView: () => true,
        fingerprint: () => placement(board.fen()),
        show: async (_frame, area, arrow) => {
          assert.deepEqual(area, rect);
          arrows.push(arrow.uci);
          overlayOpen = true;
          if (arrows.length === 1) {
            board.move('e4');
            retryView = true;
          } else switched = true;
        },
        hideArrow: () => (overlayOpen = false),
        drop: () => (overlayOpen = false),
        close() {},
      },
      hideSettings: () => assert.fail('Tracking must leave Settings visible'),
      showSettings: () => assert.fail('Tracking must not refocus Settings'),
      event: (event) => {
        if (event.lost) lost.resolve();
      },
    });
    t.after(() => session.close());
    session.detect = async () => [{ rect, reliable: true, placement: placement(board.fen()) }];
    session.engine = async () => ({
      analyse: async ({ moves = [] }) => ({ bestMove: { uci: moves.length ? 'e7e5' : 'e2e4' } }),
    });
    session.scanned = {
      id: 'window:123:0',
      result: [{ placement: placement(board.fen()), rect: { ...rect, x: 0 } }],
    };
    await session.analyse({ text: board.fen() });
    assert.equal(session.watch({ index: 0, orientation: 'white' }), true);
    await lost.promise;
    await new Promise(setImmediate);
    assert.deepEqual(arrows, ['e2e4', 'e7e5']);
    assert.equal(session.last.position.fen, board.fen());
    assert.equal(session.scanned.result[0].position.fen, board.fen());
    assert.ok(diagnostics.some((event) => event.operation === 'watch' && event.stage === 'paused'));
    assert.ok(
      diagnostics.some(
        (event) =>
          event.operation === 'watch' &&
          event.stage === 'recognition' &&
          event.reason === 'position_changed',
      ),
    );
    assert.equal(
      diagnostics.filter((event) => event.stage === 'overlay' && event.visible).length,
      2,
    );
    assert.equal(overlayOpen, false);
  },
);

test('The pinned ONNX model and worker run locally and decline an empty automatic scan', async (t) => {
  const vision = new ChessVision();
  t.after(() => vision.close());
  const bitmap = {
    getSize: () => ({ width: 256, height: 256 }),
    toBitmap: () => new Uint8Array(256 * 256 * 4),
  };
  assert.deepEqual(await vision.scan(bitmap), []);
  const manual = await vision.scan(bitmap, { manual: true });
  assert.equal(manual[0].placement, '8/8/8/8/8/8/8/8');
  assert.equal(manual[0].reliable, false);
});

test('Chess snaps the far edges to the last tile and scales the four boundaries independently', () => {
  const width = 520;
  const height = 510;
  const data = new Float32Array(width * height).fill(38);
  for (let y = 32; y < 456; y++) {
    for (let x = 25; x < 449; x++) {
      const parity = (Math.floor((x - 25) / 53) + Math.floor((y - 32) / 53)) % 2;
      data[y * width + x] = parity ? 129 : 224;
    }
  }
  assert.deepEqual(
    refineBoardEdges({ width, height, data }, { x0: 25, y0: 31, x1: 455, y1: 463 }),
    { x0: 25, y0: 32, x1: 449, y1: 456 },
  );
  assert.deepEqual(scaleChessRect({ x: 17, y: 41, width: 200, height: 198 }, 1.199, 1.2), {
    x: 20,
    y: 49,
    width: 240,
    height: 238,
  });
});

test('A tight manual Chess selection first checks for the whole board around its edges', async () => {
  const session = new ChessSession({});
  const frame = { bitmap: { getSize: () => ({ width: 720, height: 540 }) } };
  const crop = { x: 109, y: 114, width: 288, height: 288 };
  const board = { rect: { x: 104, y: 110, width: 296, height: 296 } };
  session.detect = async (_frame, area, manual) => {
    assert.equal(manual, false);
    assert.ok(chessRectInside(board.rect, area));
    return [board];
  };
  assert.deepEqual(await session.detectSelection(frame, crop), [board]);
  session.detect = async (_frame, area, manual) => {
    if (!manual) return [{ rect: { x: 100, y: 120, width: 240, height: 240 } }];
    assert.deepEqual(area, crop);
    return [{ rect: crop }];
  };
  assert.deepEqual(await session.detectSelection(frame, crop), [{ rect: crop }]);
});

test(
  'Chess rediscovers a moved bot board and analyses its new position despite changing pixels',
  {
    timeout: 7000,
  },
  async (t) => {
    const game = new Chess();
    const original = { x: 40, y: 60, width: 400, height: 400 };
    const relocated = { ...original, x: 560 };
    const initialView = { ...view('https://www.chess.com', '/play/computer'), hwnd: '123' };
    const frame = { revision: 'display' };
    const refreshed = Promise.withResolvers();
    const relocatedArrow = Promise.withResolvers();
    const arrows = [];
    let moved = false;
    let images = 0;
    let handleProbes = 0;
    let candidateProbes = 0;
    const diagnostics = [];
    const session = new ChessSession({
      enabled: () => true,
      trace: () => (stage, details) => diagnostics.push({ stage, ...details }),
      install: { cancel() {} },
      access: {
        async allowed(_signal, target) {
          if (target.hwnd) {
            assert.equal(target.hwnd, initialView.hwnd);
            handleProbes++;
          } else if (target.x === relocated.x) candidateProbes++;
          else if (moved) return null;
          return initialView;
        },
      },
      capture: {
        async afterOverlay() {},
        async frame() {
          images++;
          return frame;
        },
        center: (_frame, rect) => ({ x: rect.x, y: rect.y }),
        inView: () => true,
        fingerprint: () => (moved ? `changed-${images}` : 'original'),
        async show(_frame, rect, { uci }) {
          arrows.push({ rect, uci });
          if (!moved) {
            game.move('e4');
            moved = true;
          } else if (rect.x === relocated.x) relocatedArrow.resolve();
        },
        hideArrow() {},
        drop() {},
        close() {},
      },
      event: (event) => {
        if (event.result && event.fen === game.fen() && moved) refreshed.resolve();
      },
    });
    t.after(() => session.close());
    session.detect = async (_frame, crop) =>
      moved && crop?.x === original.x
        ? []
        : [
            {
              rect: moved ? relocated : original,
              reliable: true,
              placement: placement(game.fen()),
            },
          ];
    session.engine = async () => ({
      analyse: async ({ moves = [] }) => ({ bestMove: { uci: moves.length ? 'e7e5' : 'e2e4' } }),
    });
    session.scanned = {
      id: '8',
      revision: frame.revision,
      result: [
        {
          rect: original,
          placement: placement(game.fen()),
          fingerprint: 'original',
          reliable: true,
          watchable: true,
          view: initialView,
          position: importGame({ text: game.fen() }),
        },
      ],
    };
    session.watch({ index: 0, orientation: 'white', analyse: true });
    await refreshed.promise;
    await relocatedArrow.promise;
    assert.equal(session.last.position.fen, game.fen());
    assert.deepEqual(arrows.at(-1), { rect: relocated, uci: 'e7e5' });
    assert.ok(handleProbes > 0 && candidateProbes >= 2);
    assert.ok(diagnostics.some(({ stage }) => stage === 'paused'));
    assert.ok(diagnostics.some(({ stage }) => stage === 'resumed'));
  },
);

test(
  'Chess starts analysis after the first observed move when the scan has no turn evidence',
  { timeout: 6000 },
  async (t) => {
    const board = new Chess();
    for (const move of ['e4', 'd5', 'exd5']) board.move(move);
    const rect = { x: 36, y: 46, width: 400, height: 400 };
    const initial = placement(board.fen());
    const shown = Promise.withResolvers();
    const calls = [];
    const reactions = [];
    let frames = 0;
    const session = new ChessSession({
      enabled: () => true,
      install: { cancel() {} },
      access: { allowed: async () => view('https://www.chess.com', '/play/computer') },
      reactionsEnabled: () => true,
      react: (moves) => reactions.push(...moves.flatMap(({ events }) => events)),
      capture: {
        async afterOverlay() {},
        async frame() {
          if (++frames === 3) board.move('Qxd5');
          return { revision: 'monitor' };
        },
        center: () => ({ x: 236, y: 246 }),
        inView: () => true,
        fingerprint: () => placement(board.fen()),
        show: async (_frame, _rect, arrow) => shown.resolve(arrow.uci),
        hideArrow() {},
        drop() {},
        close() {},
      },
      hideSettings() {},
      showSettings() {},
    });
    t.after(() => session.close());
    session.detect = async () => [{ rect, reliable: true, placement: placement(board.fen()) }];
    session.engine = async () => ({
      verifyPosition: async ({ fen }) => ({ checked: new Chess(fen).isCheck() }),
      analyse: async (position, { quick = false }) => {
        calls.push({ ...position, quick });
        return { bestMove: { uci: 'd2d4' } };
      },
    });
    session.scanned = {
      id: '8',
      revision: 'monitor',
      result: [{ rect, placement: initial, fingerprint: initial, reliable: true, watchable: true }],
    };
    session.watch({ index: 0, orientation: 'white', waiting: true });
    assert.equal(await shown.promise, 'd2d4');
    assert.deepEqual(
      calls.map(({ moves, fen, quick }) => [moves, fen.split(' ')[1], quick]),
      [
        [['d8d5'], 'w', true],
        [['d8d5'], 'w', false],
      ],
    );
    assert.deepEqual(
      reactions.map(({ type, color, side, captured }) => [type, color, side, captured]),
      [['capture', 'b', undefined, 'p']],
    );
  },
);
