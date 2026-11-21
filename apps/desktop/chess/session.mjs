// SPDX-License-Identifier: GPL-3.0-only
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_POSITION } from 'chess.js';
import { ChessVision } from './vision.mjs';
import { Stockfish } from './uci.mjs';
import { markedSquares } from './board-colors.mjs';
import { chessFailure, silentChessTrace } from './diagnostics.mjs';
import { chessBotPage, chessRectInside, sameChessView } from './source.mjs';
import {
  advancePosition,
  chessMoveReactions,
  diagramPositions,
  importGame,
  matchingPlacement,
  observedContinuation,
  openingPosition,
  placement,
  positionFromMarks,
} from './position.mjs';

const BROWSER_RECHECK_MS = 3000;
const BOT_BOARD_GRACE_MS = 60000;

// FEN is rank 8 first. Rotate the raw read when Black is at the bottom.
export function orientPlacement(value, orientation) {
  return orientation === 'black'
    ? value
        .split('/')
        .reverse()
        .map((row) => [...row].reverse().join(''))
        .join('/')
    : value;
}

function orderedConfidence(raw, orientation) {
  if (raw?.length !== 64) return undefined;
  // Model scores are A1 through H8. Match the screen placement's rank order.
  const mask = orientation === 'black' ? 7 : 56;
  return Array.from({ length: 64 }, (_, i) => raw[i ^ mask]);
}

export function readScreenPosition(board, view, marks = []) {
  const pieces = orientPlacement(board.placement, board.orientation);
  const confidence = view ? orderedConfidence(board.confidence, board.orientation) : undefined;
  const opening = openingPosition(pieces, confidence);
  // Manual crops sometimes fall back to direct tile classification. A complete
  // match to a legal opening is stronger evidence than a single tile confidence.
  if (!board.reliable) return opening;
  const possibilities = diagramPositions(pieces);
  const marked = positionFromMarks(possibilities, marks, board.orientation);
  const fen =
    view?.origin === 'https://lichess.org'
      ? /^\/analysis\/(?:standard|fromPosition)\/(.+)$/.exec(view.path)?.[1]
      : null;
  if (fen) {
    try {
      const position = importGame({ text: decodeURIComponent(fen).replaceAll('_', ' ') });
      if (
        placement(position.fen) === pieces &&
        (!marked || marked.fen.split(' ')[1] === position.fen.split(' ')[1])
      )
        return position;
    } catch {
      // Fall back to the board when the address does not contain a valid position.
    }
  }
  if (opening && (!marked || marked.fen.split(' ')[1] === opening.fen.split(' ')[1]))
    return opening;
  if (marked) return marked;
  if (possibilities.length === 1) return possibilities[0];
  return null;
}

function matchObservedPosition(watch, { pieces, matchConfidence }) {
  const expected = watch.expectedMove;
  if (expected) {
    if (matchingPlacement(pieces, matchConfidence)(placement(expected.fen))) return expected;
    const reply = observedContinuation(expected, pieces, { confidence: matchConfidence });
    if (reply) return reply;
  }
  const candidates = watch.position ? [watch.position] : watch.possible;
  const positions = candidates
    .map((position) =>
      observedContinuation(position, pieces, {
        replies: Boolean(watch.position),
        confidence: matchConfidence,
      }),
    )
    .filter(Boolean);
  return positions.length === 1 ? positions[0] : null;
}

function recognizeNewGame(item, orientation) {
  const opening = openingPosition(item.pieces, item.matchConfidence);
  if (opening) return { item, position: opening, orientation, newGame: true };
  const flipped = orientation === 'white' ? 'black' : 'white';
  const rotated = openingPosition(
    orientPlacement(item.placement, flipped),
    item.reliable ? undefined : orderedConfidence(item.confidence, flipped),
  );
  return rotated ? { item, position: rotated, orientation: flipped, newGame: true } : null;
}

function sameObservedBoard(previous, current) {
  return (
    previous &&
    previous.fen === current.fen &&
    previous.orientation === current.orientation &&
    ['x', 'y', 'width', 'height'].every(
      (key) => Math.abs(previous.rect[key] - current.rect[key]) <= 3,
    )
  );
}

export class ChessSession {
  constructor({
    capture,
    access,
    install,
    enabled,
    autoMove = () => false,
    playScreenMove,
    prompt,
    event = () => {},
    react = () => {},
    reactionsEnabled = () => false,
    trace = silentChessTrace,
  }) {
    Object.assign(this, {
      capture,
      access,
      install,
      enabled,
      autoMove,
      playScreenMove,
      prompt,
      event,
      react,
      reactionsEnabled,
      trace,
    });
    this.vision = new ChessVision();
  }

  async snapshot() {
    const displays = await this.capture.sources();
    return {
      engine: this.install.snapshot(),
      displays,
      watching: Boolean(this.watchRun),
      autoMove: this.autoMove(),
      moveLightning: this.capture.moveLightning ?? true,
      showArrow: this.capture.showArrow ?? true,
      frameStyle: this.capture.frameStyle,
      boardFrame: this.capture.boardFrame ?? false,
      arrow: this.capture.appearance,
    };
  }

  diagnosticState() {
    const { installed, phase, supported } = this.install.snapshot();
    return {
      installed,
      phase,
      supported,
      watching: Boolean(this.watchRun),
      autoMove: this.autoMove(),
      candidates: this.scanned?.result.length ?? 0,
    };
  }

  async admittedView(signal, target, onDecision) {
    try {
      let decision;
      const check = () =>
        this.access.allowed(signal, target, (value) => {
          decision = value;
        });
      const view = await check();
      if (decision) onDecision?.(decision);
      return view;
    } catch (error) {
      signal.throwIfAborted();
      onDecision?.({ reason: 'inspection_error', ...chessFailure(error) });
      return null;
    }
  }

  async exclusive(job, trace) {
    if (!this.enabled()) throw new Error('Enable the Chess skill first');
    if (this.operation) throw new Error('Chess is busy');
    const controller = new AbortController();
    this.operation = controller;
    clearTimeout(this.idle);
    try {
      return await job(controller.signal);
    } catch (error) {
      trace?.(controller.signal.aborted ? 'cancelled' : 'failed', chessFailure(error));
      throw error;
    } finally {
      if (this.operation === controller) this.operation = null;
      if (!this.watchRun) this.scheduleIdle();
    }
  }

  async scan({ id, manual }) {
    if (
      typeof id !== 'string' ||
      !/^(?:-?\d{1,20}|window:[1-9]\d{0,19}:\d{1,10})$/.test(id) ||
      typeof manual !== 'boolean'
    )
      throw new Error('Choose a chess source');
    if (manual || !id.startsWith('window:')) this.capture.display(id);
    this.stopWatch();
    this.scanned = null;
    const source = id.startsWith('window:') ? 'window' : 'display';
    const trace = this.trace('scan', { source, mode: manual ? 'manual' : 'automatic' });
    return this.exclusive(async (signal) => {
      const relative = manual ? await this.capture.select(id, this.prompt(), signal) : null;
      if (manual && !relative) {
        trace('cancelled', { reason: 'selection_cancelled' });
        return { items: [] };
      }
      if (manual) await this.capture.afterOverlay(signal);
      const captureStarted = performance.now();
      const bounds = relative && this.capture.display(id).bounds;
      const maximumEdge = bounds
        ? Math.min(
            4096,
            Math.max(
              1600,
              Math.ceil((144 * Math.max(bounds.width, bounds.height)) / relative.width),
            ),
          )
        : undefined;
      const frame = await this.capture.frame(id, signal, { maximumEdge });
      const crop = relative ? this.capture.pixels(frame, relative) : null;
      const { width, height } = crop ?? frame.bitmap.getSize();
      trace('captured', { width, height, captureMs: performance.now() - captureStarted });
      const recognitionStarted = performance.now();
      const result = crop
        ? await this.detectSelection(frame, crop, signal)
        : await this.detect(frame, null, false, 3, signal);
      trace('recognition', {
        candidates: result.length,
        recognitionMs: performance.now() - recognitionStarted,
      });
      const windowView =
        frame.display || !result.length
          ? null
          : await this.admittedView(signal, { hwnd: id.split(':')[1] }, (details) =>
              trace('access', details),
            );
      const items = [];
      for (const [boardIndex, item] of result.entries()) {
        const point = frame.display && this.capture.center(frame, item.rect);
        const view = point
          ? await this.admittedView(signal, point, (details) =>
              trace('access', { ...details, boardIndex }),
            )
          : windowView;
        const bitmap = frame.bitmap.crop(item.rect);
        const marks = markedSquares(bitmap);
        item.watchable = Boolean(view && (!point || this.capture.inView(frame, item.rect, view)));
        item.view = item.watchable ? view : null;
        item.position = readScreenPosition(item, item.watchable ? view : null, marks);
        if (item.position)
          item.placement = orientPlacement(placement(item.position.fen), item.orientation);
        item.canWait =
          item.watchable &&
          item.reliable &&
          !item.position &&
          diagramPositions(orientPlacement(item.placement, item.orientation)).length > 0;
        item.fingerprint = this.capture.fingerprint(frame, item.rect);
        const {
          confidence = [],
          reliable,
          orientation,
          watchable,
          rect,
          position: resolved,
        } = item;
        trace('candidate', {
          boardIndex,
          reliable,
          orientation,
          watchable,
          waiting: item.canWait,
          width: rect.width,
          height: rect.height,
          turn: resolved?.fen.split(' ')[1],
          markedSquares: marks.length,
          minConfidence: Math.min(...confidence),
          meanConfidence: confidence.reduce((sum, score) => sum + score, 0) / confidence.length,
          uncertainSquares: confidence.filter((score) => score < 0.85).length,
        });
        const { fingerprint, view: boundView, position, ...visible } = item;
        items.push({
          ...visible,
          fen: position?.fen,
          preview: new Uint8Array(bitmap.resize({ width: 256, height: 256 }).toPNG()),
        });
      }
      signal.throwIfAborted();
      this.scanned = { id, revision: frame.revision, result, scanId: trace.id, maximumEdge };
      trace('completed', {
        candidates: items.length,
        reason: items.length ? undefined : 'no_board',
      });
      return { items };
    }, trace);
  }

  async detectSelection(frame, crop, signal) {
    const size = frame.bitmap.getSize();
    const pad = Math.max(4, Math.ceil(Math.min(crop.width, crop.height) / 28));
    const x = Math.max(0, crop.x - pad);
    const y = Math.max(0, crop.y - pad);
    const padded = {
      x,
      y,
      width: Math.min(size.width, crop.x + crop.width + pad) - x,
      height: Math.min(size.height, crop.y + crop.height + pad) - y,
    };
    const [candidate] = await this.detect(frame, padded, false, 1, signal);
    if (
      candidate &&
      Math.abs(candidate.rect.width - crop.width) <= pad * 2 &&
      Math.abs(candidate.rect.height - crop.height) <= pad * 2 &&
      chessRectInside(candidate.rect, padded)
    )
      return [candidate];
    return this.detect(frame, crop, true, 1, signal);
  }

  async detect(frame, crop, manual, limit, signal) {
    const items = await this.vision.scan(crop ? frame.bitmap.crop(crop) : frame.bitmap, {
      manual,
      limit,
      signal,
    });
    if (crop)
      for (const item of items) {
        item.rect.x += crop.x;
        item.rect.y += crop.y;
      }
    return items;
  }

  async trackableBoards(frame, crop, view, orientation, signal, limit = 3) {
    const items = await this.detect(frame, crop, Boolean(crop && limit === 1), limit, signal);
    return items.flatMap((item) => {
      if (!this.capture.inView(frame, item.rect, view)) return [];
      const pieces = orientPlacement(item.placement, orientation);
      const confidence = item.reliable
        ? undefined
        : orderedConfidence(item.confidence, orientation);
      return [
        {
          ...item,
          orientation,
          pieces,
          matchConfidence: confidence,
          matches: matchingPlacement(pieces, confidence),
        },
      ];
    });
  }

  async engine(signal, trace) {
    if (!this.stockfish || this.stockfish.closed) {
      const verifying = performance.now();
      const file = await this.install.verifiedExecutable(signal);
      trace?.('decision', { verifyMs: performance.now() - verifying, installed: true });
      const engine = (this.stockfish = new Stockfish(file));
      await engine.init(signal);
    }
    return this.stockfish;
  }

  async search(position, { signal, deep = false, onProgress }, trace) {
    const started = performance.now();
    trace('search', {
      turn: position.fen.split(' ')[1],
      historyPlies: position.moves?.length ?? 0,
      cold: !this.stockfish || this.stockfish.closed,
    });
    let result;
    let firstMoveMs;
    try {
      result = await (
        await this.engine(signal, trace)
      ).analyse(position, {
        signal,
        deep,
        onProgress: (result) => {
          firstMoveMs ??= performance.now() - started;
          onProgress?.(result);
        },
      });
    } catch (error) {
      if (!signal.aborted)
        trace('result', {
          reason: 'search_failed',
          searchMs: performance.now() - started,
          ...chessFailure(error),
        });
      throw error;
    }
    trace('result', {
      searchMs: performance.now() - started,
      terminal: Boolean(result.terminal),
      bestMove: Boolean(result.bestMove),
      lines: result.lines?.length ?? 0,
      depth: result.lines?.[0]?.depth,
      firstMoveMs,
    });
    return result;
  }

  async analyse({ text, ply, index, analysisId, deep = false }) {
    this.stopWatch();
    if (
      typeof deep !== 'boolean' ||
      (analysisId !== undefined && !Number.isSafeInteger(analysisId))
    )
      throw new Error('Invalid chess analysis mode');
    const position =
      index === undefined
        ? importGame({ text, ply })
        : this.scanned?.result[Number.isInteger(index) ? index : -1]?.position;
    if (!position) throw new Error('Choose a chessboard');
    const trace = this.trace('analyse', {
      source: index === undefined ? 'local' : 'tracked',
      scanId: this.scanned?.scanId,
      boardIndex: index,
      mode: deep ? 'deep' : 'normal',
      autoMove: this.autoMove(),
    });
    return this.exclusive(async (signal) => {
      const result = await this.search(
        position,
        {
          signal,
          deep,
          onProgress:
            analysisId === undefined
              ? undefined
              : (result) => {
                  if (!signal.aborted) this.event({ analysisId, result, provisional: true });
                },
        },
        trace,
      );
      signal.throwIfAborted();
      this.last = { position, result };
      trace('completed', { ply: position.ply });
      return {
        fen: position.fen,
        ply: position.ply,
        count: position.count,
        result,
      };
    }, trace);
  }

  async announceReactions(watch, reactions) {
    if (!reactions.length) return false;
    const {
      trace,
      controller: { signal },
    } = watch;
    const facts = [];
    let engine;
    try {
      engine = await this.engine(signal, trace);
      for (const { position, checked, events, moveNumber } of reactions) {
        const verified = await engine.verifyPosition(position, { signal });
        signal.throwIfAborted();
        if (checked !== undefined && checked !== verified.checked)
          throw new Error('Stockfish check state did not match the observed game');
        facts.push({ events, checkers: verified.checkers, moveNumber });
      }
    } catch (error) {
      signal.throwIfAborted();
      trace('decision', { reason: 'reaction_unverified', ...chessFailure(error) });
      return false;
    }
    for (const [index, fact] of facts.entries()) {
      if (fact.events.some(({ type }) => ['start', 'draw', 'mate'].includes(type))) continue;
      try {
        const { lines } = await engine.analyse(reactions[index].position, { quick: true, signal });
        const line = lines?.[0];
        const score = line?.score;
        if (!score || line.depth < 8 || score.bound) continue;
        const decisive =
          score.type === 'mate'
            ? score.value !== 0
            : score.type === 'cp' && Math.abs(score.value) >= 160;
        if (decisive) fact.advantage = score.value > 0 ? 'w' : 'b';
        if (score.type === 'cp' && Math.abs(score.value) <= 45) fact.balanced = true;
      } catch {
        // A slow or unavailable evaluation can still leave the move facts usable.
        signal.throwIfAborted();
      }
    }
    signal.throwIfAborted();
    watch.reactionController ??= new AbortController();
    this.react(facts, AbortSignal.any([signal, watch.reactionController.signal]));
    return true;
  }

  async noteGameStart(watch, view, restarted = false) {
    const { position } = watch;
    if (
      !this.reactionsEnabled() ||
      !watch.verifiedPosition ||
      !position ||
      (position.initial ?? position.fen) !== DEFAULT_POSITION ||
      (position.moves?.length ?? 0) > 2 ||
      (!chessBotPage(view) && !view.computerSide)
    )
      return;
    const identity = view.game ?? view.windowId ?? view.token;
    if (!restarted && this.reactionGame === identity) return;
    if (await this.announceReactions(watch, [{ position, events: [{ type: 'start' }] }]))
      this.reactionGame = identity;
  }

  watch({
    index,
    orientation,
    corrected = false,
    waiting = false,
    analyse = false,
    text,
    deep = false,
  }) {
    if (!this.enabled() || this.operation) throw new Error('Chess is busy');
    if (
      !Number.isInteger(index) ||
      !['white', 'black'].includes(orientation) ||
      typeof corrected !== 'boolean' ||
      typeof waiting !== 'boolean' ||
      typeof analyse !== 'boolean' ||
      typeof deep !== 'boolean' ||
      (analyse && waiting) ||
      (text !== undefined && !analyse)
    )
      throw new Error('Choose a chessboard');
    const board = this.scanned?.result[index];
    if (
      !board ||
      (!waiting && !analyse && !this.last?.result.bestMove) ||
      (analyse && !board.watchable)
    )
      throw new Error('Analyse a board in an allowed page first');
    const pieces = orientPlacement(board.placement, orientation);
    const possible = waiting && board.watchable && board.reliable ? diagramPositions(pieces) : [];
    if (waiting && !possible.length) throw new Error('Choose a chessboard');
    const position = analyse
      ? text === undefined
        ? board.position
        : importGame({ text })
      : waiting
        ? null
        : this.last.position;
    if (analyse && !position) throw new Error('Choose a chessboard');
    if (position && !corrected && pieces !== placement(position.fen))
      throw new Error('The analysed position differs from the chessboard');
    this.stopWatch();
    const { id, revision, maximumEdge } = this.scanned;
    const controller = new AbortController();
    const trace = this.trace('watch', {
      source: id.startsWith('window:') ? 'window' : 'display',
      scanId: this.scanned.scanId,
      boardIndex: index,
      orientation,
      corrected,
      waiting,
      mode: deep ? 'deep' : 'normal',
      autoMove: this.autoMove(),
    });
    const watch = {
      controller,
      trace,
      frames: 0,
      probes: 0,
      recognitionPasses: 0,
      index,
      id,
      revision,
      maximumEdge,
      orientation,
      board: { ...board },
      pieces: position ? placement(position.fen) : pieces,
      possible,
      position,
      result: !waiting && !analyse ? this.last.result : null,
      needsAnalysis: analyse,
      verifiedPosition: !corrected && text === undefined,
      deep,
    };
    this.watchRun = watch;
    clearTimeout(this.idle);
    this.event({ watching: true, index });
    void this.track(watch)
      .catch((error) => {
        if (!controller.signal.aborted) {
          watch.failed = true;
          trace('failed', {
            ...chessFailure(error),
            reason: watch.failure,
            frames: watch.frames,
            probes: watch.probes,
            recognitionPasses: watch.recognitionPasses,
          });
          this.event({ watching: false, lost: true, index });
        }
      })
      .finally(() => {
        if (this.watchRun === watch) this.stopWatch(watch.failed ? null : 'completed');
      });
    return true;
  }

  async paintArrow(watch, frame, rect, result) {
    try {
      await this.capture.show(
        frame,
        rect,
        { uci: result.bestMove.uci, orientation: watch.orientation },
        watch.controller.signal,
      );
    } catch (error) {
      watch.failure = 'overlay_failed';
      throw error;
    }
    watch.trace('overlay', {
      visible: true,
      frames: watch.frames,
      width: rect.width,
      height: rect.height,
    });
  }

  async analyseWatched(watch, frame, rect) {
    const {
      controller: { signal },
      index,
      position,
      trace,
    } = watch;
    const deep = watch.deep;
    watch.deep = false;
    watch.needsAnalysis = false;
    let painting = Promise.resolve();
    let paintedMove;
    let paintFailure;
    const onProgress = (result) => {
      if (signal.aborted) return;
      this.event({
        watching: true,
        index,
        result,
        fen: position.fen,
        orientation: watch.orientation,
        provisional: true,
      });
      if (result.bestMove.uci === paintedMove) return;
      paintedMove = result.bestMove.uci;
      painting = painting
        .then(() => {
          if (!signal.aborted && !paintFailure) return this.paintArrow(watch, frame, rect, result);
        })
        .catch((error) => {
          paintFailure = error;
        });
    };
    let result;
    try {
      result = await this.search(position, { signal, deep, onProgress }, trace);
    } finally {
      await painting;
    }
    signal.throwIfAborted();
    if (paintFailure) throw paintFailure;
    watch.result = result;
    this.last = { position, result };
    this.event({
      watching: true,
      index,
      result,
      fen: position.fen,
      orientation: watch.orientation,
    });
    // A different final move is drawn after the next fresh board observation.
    return Boolean(result.bestMove && result.bestMove.uci === paintedMove);
  }

  shouldAutoMove(watch, view) {
    return Boolean(
      this.playScreenMove &&
        this.autoMove() &&
        chessBotPage(view) &&
        watch.verifiedPosition &&
        watch.result?.bestMove &&
        watch.attempted !== watch.position &&
        performance.now() >= (watch.retryMoveAt ?? 0) &&
        watch.position.fen.split(' ')[1] === watch.orientation[0],
    );
  }

  async autoPlay(watch, view, id, revision) {
    const {
      board,
      controller: { signal },
      result,
      position,
      trace,
    } = watch;
    const { uci } = result.bestMove;
    // Promotion opens a separate site dialog. Leave the suggestion visible for manual input.
    if (uci.length !== 4) {
      watch.attempted = position;
      trace('decision', { reason: 'auto_move_promotion', autoMove: true });
      return;
    }
    const expected = advancePosition(position, uci);
    const frame = await this.capture
      .frame(id, signal, { maximumEdge: watch.maximumEdge, view })
      .catch(() => {
        signal.throwIfAborted();
        return null;
      });
    if (
      frame?.revision !== revision ||
      !this.capture.inView(frame, board.rect, view) ||
      this.capture.fingerprint(frame, board.rect) !== board.fingerprint
    ) {
      watch.retryMoveAt = performance.now() + BROWSER_RECHECK_MS;
      trace('decision', { reason: 'auto_move_board_changed', autoMove: true });
      return;
    }
    if (!this.enabled() || !this.autoMove()) return;
    const [from, to] = this.capture.movePoints(frame, board.rect, uci, watch.orientation);
    try {
      await this.capture.prepareFlash?.(frame, board.rect, signal);
    } catch {
      signal.throwIfAborted();
    }
    if (!this.enabled() || !this.autoMove()) return;
    const onMovePressed = () => {
      if (signal.aborted) return;
      trace('decision', { reason: 'auto_move_pressed', autoMove: true });
      void this.capture
        .flashMove?.(frame, board.rect, { uci, orientation: watch.orientation }, signal)
        ?.catch(() => {});
    };
    let status, moveProbe, browserProbe;
    try {
      ({ status, moveProbe, browserProbe } = await this.playScreenMove({
        token: view.token,
        tabId: view.tabId,
        target: this.capture.center(frame, board.rect),
        from,
        to,
        signal,
        onMovePressed,
      }));
    } catch (error) {
      signal.throwIfAborted();
      status = 'uncertain';
    }
    signal.throwIfAborted();
    if (status === 'blocked') {
      watch.retryMoveAt = performance.now() + BROWSER_RECHECK_MS;
      trace('decision', { reason: 'auto_move_blocked', autoMove: true, moveProbe, browserProbe });
      return;
    }
    watch.attempted = position;
    watch.expectedMove = expected;
    trace('decision', {
      reason: status === 'sent' ? 'auto_move_sent' : 'auto_move_uncertain',
      autoMove: true,
      moveProbe,
    });
  }

  async waitForView(signal, target, watch) {
    const handoffUntil = Date.now() + 5000;
    let attempt = 0;
    for (;;) {
      attempt++;
      let reason;
      const view = await this.admittedView(signal, target, (details) => {
        reason = details.reason;
        if (attempt === 1 || Date.now() >= handoffUntil || details.reason === 'route_allowed')
          watch.trace('access', { ...details, attempt });
      });
      if (view) return view;
      if (Date.now() >= handoffUntil) {
        watch.failure = reason ?? 'no_browser_view';
        throw new Error('The chess source changed');
      }
      await delay(180, undefined, { signal });
    }
  }

  async bindScreen(watch, signal) {
    const { id, revision, board } = watch;
    if (!id.startsWith('window:')) {
      const frame = await this.capture.frame(id, signal, { maximumEdge: watch.maximumEdge });
      if (frame.revision !== revision) {
        watch.failure = 'display_changed';
        throw new Error('The chess source changed');
      }
      return {
        id,
        revision,
        view: await this.waitForView(signal, this.capture.center(frame, board.rect), watch),
      };
    }

    // Window thumbnails have no screen origin and may include content hidden by other windows.
    // Locate the same board in the visible page before assigning desktop coordinates.
    const view = await this.waitForView(signal, { hwnd: id.split(':')[1] }, watch);
    let match;
    for await (const source of this.capture.pageFrames(view, signal)) {
      const { frame, crop } = source;
      const items = await this.trackableBoards(frame, crop, view, watch.orientation, signal);
      for (const item of items) {
        const { rect } = item;
        const same = item.matches(orientPlacement(board.placement, watch.orientation));
        if (!same && !matchObservedPosition(watch, item)) continue;
        const visible = await this.admittedView(signal, this.capture.center(frame, rect));
        if (visible?.token !== view.token) continue;
        if (match) {
          watch.failure = 'board_ambiguous';
          throw new Error('The chess source changed');
        }
        match = {
          id: source.id,
          revision: frame.revision,
          rect,
          fingerprint: same && this.capture.fingerprint(frame, rect),
        };
      }
    }
    if (!match) {
      watch.failure = 'board_not_found';
      throw new Error('The chess source changed');
    }
    Object.assign(board, { rect: match.rect, fingerprint: match.fingerprint });
    return { id: match.id, revision: match.revision, view };
  }

  async track(watch) {
    const {
      controller: { signal },
      board,
      index,
      trace,
    } = watch;
    await this.capture.afterOverlay(signal);
    const { id, revision, view: initialView } = await this.bindScreen(watch, signal);
    if (board.view && !sameChessView(board.view, initialView)) {
      watch.failure = 'view_changed';
      throw new Error('The chess source changed');
    }
    trace('bound', { width: board.rect.width, height: board.rect.height });
    let shown = false,
      pendingBoard,
      waitedForBoard = false,
      lastFrame,
      boardSample,
      misses = 0,
      captureMisses = 0,
      unavailableSince = null,
      missingBoardSince = null,
      boundView = initialView,
      view = initialView,
      checkedAt = 0;
    const invalidateReading = () => {
      watch.reactionController?.abort();
      watch.reactionController = null;
      board.fingerprint = null;
      watch.result = null;
      watch.needsAnalysis = Boolean(watch.position);
    };
    if (board.view && initialView.token !== board.view.token) {
      invalidateReading();
      trace('access', { reason: 'view_rebound', frames: watch.frames });
    }
    const grace = chessBotPage(initialView) ? BOT_BOARD_GRACE_MS : 2500;
    const end = Date.now() + 20 * 60000;
    while (!signal.aborted && this.enabled() && Date.now() < end) {
      const liveReactions =
        this.reactionsEnabled() && (chessBotPage(boundView) || boundView.computerSide);
      const sample =
        view &&
        board.fingerprint &&
        lastFrame &&
        (await this.capture.boardSample?.(lastFrame, board.rect, signal, view));
      if (
        sample &&
        sample === boardSample &&
        !watch.needsAnalysis &&
        !this.shouldAutoMove(watch, view) &&
        (!this.capture.boardFrame || this.capture.frameVisible) &&
        performance.now() - checkedAt < BROWSER_RECHECK_MS
      ) {
        await delay(liveReactions ? 350 : 650, undefined, { signal });
        continue;
      }
      let viewDecision;
      let visibleLocation = true;
      if (unavailableSince !== null && lastFrame) {
        watch.probes++;
        view = await this.admittedView(
          signal,
          this.capture.center(lastFrame, pendingBoard?.rect ?? board.rect),
          (details) => {
            viewDecision = details;
          },
        );
        if (!view && boundView.hwnd) {
          view = await this.admittedView(signal, { hwnd: boundView.hwnd });
          visibleLocation = false;
        }
        if (!view) {
          if (Date.now() - unavailableSince >= grace) {
            watch.failure = viewDecision?.reason ?? 'window_disappeared';
            throw new Error('The chess source changed');
          }
          await delay(chessBotPage(boundView) ? 650 : 250, undefined, { signal });
          continue;
        }
        checkedAt = performance.now();
      }
      let frame;
      try {
        frame = await this.capture.frame(id, signal, { maximumEdge: watch.maximumEdge, view });
        captureMisses = 0;
      } catch (error) {
        signal.throwIfAborted();
        if (++captureMisses > 2) {
          watch.failure = 'tracking_unavailable';
          throw error;
        }
        await delay(180, undefined, { signal });
        continue;
      }
      lastFrame = frame;
      watch.frames++;
      if (frame.revision !== revision) {
        trace('decision', { reason: 'display_changed', frames: watch.frames });
        return;
      }
      // Reuse the last verified browser page only while the sampled board is unchanged.
      let inside = visibleLocation && this.capture.inView(frame, board.rect, view);
      let current = inside && this.capture.fingerprint(frame, board.rect);
      if (shown && current !== board.fingerprint) {
        trace('overlay', {
          visible: false,
          reason: 'position_changed',
          inView: inside,
          frames: watch.frames,
        });
        this.capture.hideArrow({ keepFrame: inside });
        shown = false;
      }
      if (
        !view ||
        (unavailableSince === null &&
          ((!shown &&
            (current !== board.fingerprint || watch.needsAnalysis || watch.result?.bestMove)) ||
            performance.now() - checkedAt >= BROWSER_RECHECK_MS))
      ) {
        watch.probes++;
        view = await this.admittedView(
          signal,
          this.capture.center(frame, pendingBoard?.rect ?? board.rect),
          (details) => {
            viewDecision = details;
          },
        );
        checkedAt = performance.now();
        const stillInside = this.capture.inView(frame, board.rect, view);
        if (inside !== stillInside)
          current = stillInside && this.capture.fingerprint(frame, board.rect);
        inside = stillInside;
      }
      if (!view) {
        this.capture.hideArrow();
        shown = false;
        if (unavailableSince === null) {
          unavailableSince = Date.now();
          invalidateReading();
          misses = Math.max(2, misses);
          waitedForBoard = false;
          boardSample = null;
          trace('paused', { ...viewDecision, frames: watch.frames, visible: false });
        }
        await delay(250, undefined, { signal });
        continue;
      }
      if (!sameChessView(boundView, view)) {
        watch.failure = 'view_changed';
        throw new Error('The chess source changed');
      }
      if (view.token !== boundView.token) {
        trace('access', { reason: 'view_rebound', frames: watch.frames });
        boundView = view;
        invalidateReading();
        watch.expectedMove = null;
        pendingBoard = boardSample = null;
        waitedForBoard = false;
        this.capture.hideArrow({ keepFrame: inside });
        shown = false;
      }
      if (visibleLocation && unavailableSince !== null) {
        trace('resumed', { frames: watch.frames });
        unavailableSince = null;
      }
      if (current && current === board.fingerprint) {
        await this.capture.showBoardFrame?.(frame, board.rect, signal);
        boardSample = sample;
        misses = 0;
        missingBoardSince = null;
        if (!watch.checkedOpening && watch.position) {
          watch.checkedOpening = true;
          await this.noteGameStart(watch, view);
        }
        if (watch.needsAnalysis) shown = await this.analyseWatched(watch, frame, board.rect);
        if (!shown && watch.result?.bestMove) {
          await this.paintArrow(watch, frame, board.rect, watch.result);
          shown = true;
        }
        pendingBoard = null;
        waitedForBoard = false;
      } else {
        boardSample = null;
        if (current && !waitedForBoard && !pendingBoard && !misses) {
          waitedForBoard = true;
          await delay(240, undefined, { signal });
          continue;
        }
        const recognitionStarted = performance.now();
        const crop = inside && misses < 2 ? board.rect : null;
        watch.recognitionPasses++;
        const matches = await this.trackableBoards(
          frame,
          crop,
          view,
          watch.orientation,
          signal,
          crop ? 1 : 3,
        );
        const same = matches.filter((item) => item.matches(watch.pieces));
        const nearby = matches.filter(({ rect }) =>
          ['x', 'y', 'width', 'height'].every(
            (key) => Math.abs(rect[key] - board.rect[key]) <= board.rect.width / 8,
          ),
        );
        const recovery = !nearby.length && misses >= 2 ? matches : nearby;
        const changed = same.length
          ? []
          : matches.flatMap((item) => {
              const position = matchObservedPosition(watch, item);
              return position ? [{ item, position }] : [];
            });
        if (
          chessBotPage(view) &&
          recovery.length === 1 &&
          !changed.length &&
          (!same.length || watch.result?.terminal || !board.fingerprint)
        ) {
          const opening = recognizeNewGame(recovery[0], watch.orientation);
          if (opening) {
            same.length = 0;
            changed.push(opening);
          }
        }
        if (!same.length && !changed.length) {
          if (recovery.length === 1) {
            const item = recovery[0];
            const { rect } = item;
            const marks = markedSquares(frame.bitmap.crop(rect));
            const position = readScreenPosition(item, view, marks);
            if (position && placement(position.fen) !== watch.pieces)
              changed.push({ item, position, recovered: true });
          }
        }
        let choice =
          same.length === 1
            ? { item: same[0], position: null }
            : !same.length && changed.length === 1
              ? changed[0]
              : null;
        if (choice && !crop) {
          const candidateView = await this.admittedView(
            signal,
            this.capture.center(frame, choice.item.rect),
          );
          if (!candidateView || !sameChessView(view, candidateView)) choice = null;
          else if (!visibleLocation) {
            view = candidateView;
            checkedAt = performance.now();
            unavailableSince = null;
            trace('resumed', { frames: watch.frames });
          }
        }
        if (!choice) {
          if (!visibleLocation && Date.now() - unavailableSince >= grace) {
            watch.failure = viewDecision?.reason ?? 'window_disappeared';
            throw new Error('The chess source changed');
          }
          misses++;
          missingBoardSince ??= Date.now();
          if (misses === 2) {
            invalidateReading();
            this.capture.hideArrow();
            shown = false;
          }
          if (misses === 1 || misses === 2 || misses === 8)
            trace('recognition', {
              reason: same.length > 1 || changed.length > 1 ? 'board_ambiguous' : 'board_not_found',
              frames: watch.frames,
              misses,
              matches: matches.length,
              changes: changed.length,
              recognitionMs: performance.now() - recognitionStarted,
            });
          if (misses >= 8 && (!chessBotPage(view) || Date.now() - missingBoardSince >= grace)) {
            watch.failure =
              same.length > 1 || changed.length > 1 ? 'board_ambiguous' : 'board_not_found';
            throw new Error('The chess source changed');
          }
          pendingBoard = null;
          await delay(misses >= 8 ? 1000 : 450, undefined, { signal });
          continue;
        }
        // Confirm rediscovery by the position and its bounds even when the board animates.
        const observation = {
          fen: choice.position?.fen ?? watch.position?.fen ?? watch.pieces,
          orientation: choice.orientation ?? watch.orientation,
          rect: choice.item.rect,
        };
        const fingerprint = this.capture.fingerprint(frame, choice.item.rect);
        if ((crop && current && !misses) || sameObservedBoard(pendingBoard, observation)) {
          misses = 0;
          missingBoardSince = null;
          trace('recognition', {
            reason: choice.newGame
              ? 'new_game'
              : choice.recovered
                ? 'position_recovered'
                : choice.position
                  ? 'position_changed'
                  : 'board_relocated',
            frames: watch.frames,
            matches: matches.length,
            changes: changed.length,
            recognitionMs: performance.now() - recognitionStarted,
          });
          Object.assign(board, { rect: choice.item.rect, fingerprint });
          await this.capture.showBoardFrame?.(frame, board.rect, signal);
          const scanned = this.scanned.result[index];
          scanned.view = view;
          if (!watch.id.startsWith('window:'))
            Object.assign(scanned, { rect: choice.item.rect, fingerprint });
          if (choice.position || watch.needsAnalysis) {
            if (choice.position) {
              const previous =
                watch.position ?? watch.possible.find(({ fen }) => fen === choice.position.initial);
              const previousOrientation = watch.orientation;
              const expected = watch.expectedMove;
              watch.expectedMove = null;
              if (
                expected &&
                !choice.newGame &&
                (choice.item.matches(placement(expected.fen)) ||
                  observedContinuation(expected, choice.item.pieces, {
                    confidence: choice.item.matchConfidence,
                  }))
              ) {
                trace('decision', { reason: 'auto_move_confirmed', applied: true });
              }
              if (choice.newGame) watch.attempted = null;
              watch.position = choice.position;
              watch.pieces = placement(watch.position.fen);
              watch.orientation = choice.orientation ?? watch.orientation;
              watch.verifiedPosition = true;
              watch.retryMoveAt = 0;
              if (choice.newGame) {
                watch.reactionController?.abort();
                watch.reactionController = null;
                watch.checkedOpening = true;
                await this.noteGameStart(
                  watch,
                  view,
                  previous?.fen !== watch.position.fen || previousOrientation !== watch.orientation,
                );
              } else if (
                this.reactionsEnabled() &&
                previous &&
                !choice.recovered &&
                (chessBotPage(view) || view.computerSide)
              ) {
                // Board orientation can be flipped independently of the player's color.
                const player = { b: 'w', w: 'b' }[view.computerSide];
                await this.announceReactions(
                  watch,
                  chessMoveReactions(previous, watch.position, player),
                );
              }
            }
            scanned.position = watch.position;
            scanned.orientation = watch.orientation;
            scanned.placement = orientPlacement(watch.pieces, watch.orientation);
            shown = await this.analyseWatched(watch, frame, board.rect);
          } else if (!shown && watch.result?.bestMove) {
            await this.paintArrow(watch, frame, board.rect, watch.result);
            shown = true;
          }
          pendingBoard = null;
          waitedForBoard = false;
        } else pendingBoard = observation;
      }
      if (current && current === board.fingerprint && this.shouldAutoMove(watch, view))
        await this.autoPlay(watch, view, id, revision);
      await delay(shown && !liveReactions ? 800 : 350, undefined, { signal });
    }
    trace('decision', {
      reason: this.enabled() ? 'expired' : 'skill_disabled',
      frames: watch.frames,
    });
  }

  scheduleIdle() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.closeModels(), 45000);
    this.idle.unref?.();
  }

  closeModels() {
    this.vision.close();
    if (this.stockfish) {
      this.engineExit = this.stockfish.close();
      this.stockfish = null;
    }
  }

  async removeEngine() {
    this.stop();
    await this.engineExit;
    return this.install.remove();
  }

  stopWatch(stage = 'cancelled') {
    if (!this.watchRun) return;
    if (stage)
      this.watchRun.trace(stage, {
        reason: stage === 'cancelled' ? 'stopped' : undefined,
        frames: this.watchRun.frames,
        probes: this.watchRun.probes,
        recognitionPasses: this.watchRun.recognitionPasses,
      });
    this.watchRun.controller.abort();
    this.watchRun = null;
    this.capture.drop();
    this.closeModels();
    this.event({ watching: false });
  }

  stop() {
    this.stopWatch();
    this.operation?.abort();
    clearTimeout(this.idle);
    this.capture.drop();
    this.closeModels();
    this.scanned = this.last = null;
  }

  close() {
    this.stop();
    this.install.cancel();
    this.capture.close();
  }
}
