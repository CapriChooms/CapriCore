// SPDX-License-Identifier: GPL-3.0-only
import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js';

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
export const placement = (fen) => fen.split(' ', 1)[0];
const boardCells = (pieces) =>
  pieces.replaceAll('/', '').replace(/[1-8]/g, (n) => '.'.repeat(Number(n)));

export function loadPosition(fen) {
  if (typeof fen !== 'string' || fen.length > 120) throw new Error('Invalid chess position');
  const fields = fen.trim().split(/ +/);
  if (fields.length !== 6 || !/^[0-9]{1,5}$/.test(fields[4]) || !/^[0-9]{1,5}$/.test(fields[5]))
    throw new Error('Invalid chess position');
  const normalized = fields.join(' ');
  if (!validateFen(normalized).ok) throw new Error('Invalid chess position');
  const board = new Chess(normalized);
  const opposite = board.turn() === 'w' ? 'b' : 'w';
  const king = board.findPiece({ type: 'k', color: opposite })[0];
  if (board.isAttacked(king, board.turn())) throw new Error('Invalid chess position');
  for (const [right, kingSquare, rookSquare] of [
    ['K', 'e1', 'h1'],
    ['Q', 'e1', 'a1'],
    ['k', 'e8', 'h8'],
    ['q', 'e8', 'a8'],
  ]) {
    const color = right === right.toUpperCase() ? 'w' : 'b';
    const k = board.get(kingSquare),
      r = board.get(rookSquare);
    if (
      fields[2].includes(right) &&
      (k?.type !== 'k' || k.color !== color || r?.type !== 'r' || r.color !== color)
    )
      throw new Error('Invalid chess position');
  }
  return board;
}

export function importGame({ text, ply } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 64000)
    throw new Error('Invalid FEN or PGN');
  const clean = text.trim();
  if (clean.split(/\s+/, 1)[0].includes('/')) return { fen: loadPosition(clean).fen(), count: 0 };
  const game = new Chess();
  try {
    game.loadPgn(clean, { strict: true });
  } catch {
    throw new Error('Invalid FEN or PGN');
  }
  const moves = game.history({ verbose: true });
  if (moves.length > 1024 || (!moves.length && !game.getHeaders().FEN))
    throw new Error('Invalid FEN or PGN');
  const index = ply ?? moves.length;
  if (!Number.isInteger(index) || index < 0 || index > moves.length)
    throw new Error('Invalid PGN move number');
  const initial = moves[0]?.before ?? game.fen();
  loadPosition(initial);
  const fen = index === 0 ? initial : moves[index - 1].after;
  return {
    fen: loadPosition(fen).fen(),
    count: moves.length,
    ply: index,
    initial,
    moves: moves.slice(0, index).map(({ lan }) => lan),
  };
}

function playUci(board, uci) {
  if (typeof uci !== 'string' || !UCI_MOVE.test(uci)) throw new Error('Invalid chess move');
  return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

export function advancePosition(position, uci) {
  const board = loadPosition(position.fen);
  const move = playUci(board, uci);
  return {
    fen: move.after,
    count: 0,
    initial: position.initial ?? position.fen,
    moves: [...(position.moves ?? []), move.lan],
  };
}

export function chessMoveReactions(before, after, player) {
  const prior = before.moves ?? [];
  const history = after.moves ?? [];
  const moves = history.slice(prior.length);
  if (
    after.initial !== (before.initial ?? before.fen) ||
    moves.length < 1 ||
    moves.length > 2 ||
    !prior.every((uci, index) => uci === history[index])
  )
    return [];
  try {
    const board = loadPosition(before.fen);
    const reactions = [];
    for (const [index, uci] of moves.entries()) {
      const move = playUci(board, uci);
      const events = [];
      const facts = {
        san: move.san,
        color: move.color,
        piece: move.piece,
        ...(player && { side: move.color === player ? 'player' : 'opponent' }),
        ...(move.captured && { captured: move.captured }),
        ...(move.promotion && { promoted: move.promotion }),
      };
      if (move.captured) events.push({ type: 'capture', ...facts });
      if (move.isKingsideCastle() || move.isQueensideCastle())
        events.push({ type: 'castle', ...facts });
      if (move.promotion) events.push({ type: 'promotion', ...facts });
      if (board.isCheckmate()) events.push({ type: 'mate', ...facts });
      else if (board.isCheck()) events.push({ type: 'check', ...facts });
      const draw = board.isStalemate()
        ? 'stalemate'
        : board.isInsufficientMaterial()
          ? 'insufficient_material'
          : null;
      if (draw) events.push({ type: 'draw', reason: draw, ...facts });
      if (events.length)
        reactions.push({
          position: {
            fen: move.after,
            initial: after.initial,
            moves: history.slice(0, prior.length + index + 1),
          },
          checked: board.isCheck(),
          moveNumber: Number(move.before.split(' ')[5]),
          events,
        });
    }
    return board.fen() === after.fen ? reactions : [];
  } catch {
    return [];
  }
}

export function checkLine(fen, moves) {
  const board = loadPosition(fen);
  const line = [];
  for (const uci of moves) {
    try {
      const move = playUci(board, uci);
      line.push({ uci, san: move.san });
    } catch {
      break;
    }
  }
  return line;
}

export function observedMove(fen, observed, confidence) {
  const board = loadPosition(fen);
  const matches = matchingPlacement(observed, confidence);
  const candidates = board
    .moves({ verbose: true })
    .filter((move) => matches(placement(move.after)));
  return candidates.length === 1 ? { fen: candidates[0].after, move: candidates[0].lan } : null;
}

export function diagramPositions(pieces) {
  return ['w', 'b'].flatMap((side) => {
    try {
      return [{ fen: loadPosition(`${pieces} ${side} - - 0 1`).fen(), count: 0 }];
    } catch {
      return [];
    }
  });
}

// A screenshot can identify these opening positions without guessing castling rights.
let openingPositions;
export function openingPosition(pieces, confidence) {
  openingPositions ??= (() => {
    const initial = { fen: DEFAULT_POSITION, count: 0 };
    const positions = new Map([[placement(initial.fen), initial]]);
    const add = (position, move) => {
      const next = {
        fen: move.after,
        count: 0,
        initial: DEFAULT_POSITION,
        moves: [...(position.moves ?? []), move.lan],
      };
      const key = placement(next.fen);
      positions.set(key, positions.has(key) ? null : next);
      return next;
    };
    for (const move of new Chess().moves({ verbose: true })) {
      const next = add(initial, move);
      for (const response of new Chess(next.fen).moves({ verbose: true })) add(next, response);
    }
    return positions;
  })();
  if (openingPositions.has(pieces)) return openingPositions.get(pieces);
  if (!confidence) return null;
  const matches = matchingPlacement(pieces, confidence);
  let match;
  for (const [candidate, position] of openingPositions) {
    if (!matches(candidate)) continue;
    if (match || !position) return null;
    match = position;
  }
  return match ?? null;
}

export function matchingPlacement(pieces, confidence) {
  if (confidence?.length !== 64 || confidence.filter((score) => score >= 0.85).length < 48)
    return (candidate) => pieces === candidate;
  const cells = boardCells(pieces);
  if (cells.length !== 64) return () => false;
  return (candidate) => {
    const expected = boardCells(candidate);
    let uncertain = 0;
    for (let index = 0; index < 64; index++) {
      if (cells[index] === expected[index]) continue;
      // Correct piece identities only. The occupancy has to match exactly.
      if (
        cells[index] === '.' ||
        expected[index] === '.' ||
        confidence[index] >= 0.85 ||
        ++uncertain > 4
      )
        return false;
    }
    return true;
  };
}

export function observedContinuation(position, pieces, { replies = false, confidence } = {}) {
  const next = observedMove(position.fen, pieces, confidence);
  if (next) return advancePosition(position, next.move);
  if (!replies) return null;

  // A bot may reply within the same capture interval. Both moves must lead to
  // one legal history, and the first piece cannot still be on its origin square.
  const board = loadPosition(position.fen);
  const cells = boardCells(pieces);
  let match;
  for (const move of board.moves({ verbose: true })) {
    const index = (8 - Number(move.from[1])) * 8 + move.from.charCodeAt(0) - 97;
    const piece = move.color === 'w' ? move.piece.toUpperCase() : move.piece;
    if (cells[index] === piece) continue;
    const reply = observedMove(move.after, pieces, confidence);
    if (!reply) continue;
    if (match) return null;
    match = advancePosition(advancePosition(position, move.lan), reply.move);
  }
  return match ?? null;
}

export function positionFromMarks(positions, marked, orientation) {
  if (marked.length !== 2) return null;
  const squares = marked.map((value) => {
    const index = orientation === 'black' ? 63 - value : value;
    return 'abcdefgh'[index % 8] + (8 - Math.floor(index / 8));
  });
  for (const position of positions) {
    const after = loadPosition(position.fen);
    const from = squares.find((square) => !after.get(square));
    const to = squares.find((square) => after.get(square));
    if (!from || !to) return null;
    const piece = after.get(to);
    if (piece.color === after.turn()) continue;
    const before = after;
    before.remove(to);
    before.put(piece, from);
    if (piece.type === 'p' && from[0] !== to[0])
      before.put({ type: 'n', color: before.turn() }, to);
    try {
      const previous = loadPosition(`${placement(before.fen())} ${piece.color} - - 0 1`);
      const move = previous.move({ from, to });
      if (placement(move.after) === placement(position.fen))
        return { ...position, fen: move.after };
    } catch {
      // Color changes without a corresponding legal move are not turn evidence.
    }
  }
  return null;
}
