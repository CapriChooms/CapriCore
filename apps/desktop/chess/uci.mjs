// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { constants, setPriority } from 'node:os';
import { checkLine, loadPosition } from './position.mjs';

function enginePosition(position) {
  const board = loadPosition(position.fen);
  const fen = board.fen();
  if (!position.moves?.length)
    return { fen, terminal: board.isGameOver(), command: 'position fen ' + fen };
  const initial = loadPosition(position.initial).fen();
  const game = loadPosition(initial);
  const line = checkLine(initial, position.moves);
  if (line.length !== position.moves.length) throw new Error('Invalid chess move history');
  for (const { san } of line) game.move(san);
  if (game.fen() !== fen) throw new Error('Chess move history does not match the position');
  return {
    fen,
    terminal: game.isGameOver(),
    command: `position fen ${initial} moves ${position.moves.join(' ')}`,
  };
}

function engineInfo(line, fen) {
  const depth = /\bdepth (\d+)/.exec(line);
  const score = /\bscore (cp|mate) (-?\d+)(?: (upperbound|lowerbound))?/.exec(line);
  const variant = /\bpv (.+)$/.exec(line);
  if (!depth || !score || !variant) return null;
  const sign = fen.split(' ')[1] === 'b' ? -1 : 1;
  return {
    depth: Number(depth[1]),
    index: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1),
    score: {
      type: score[1],
      value: sign * Number(score[2]),
      bound:
        sign > 0 || !score[3] ? score[3] : score[3] === 'upperbound' ? 'lowerbound' : 'upperbound',
    },
    moves: variant[1].split(' ').slice(0, 12),
  };
}

export class Stockfish {
  constructor(executable, { spawnImpl = spawn } = {}) {
    this.child = spawnImpl(executable, [], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.exited = new Promise((resolve) => this.child.once('close', resolve));
    if (this.child.pid) {
      try {
        setPriority(this.child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // The child may already have exited or the host may deny priority changes.
      }
    }
    this.reader = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.reader.on('line', (line) => this.pending?.line(line));
    this.child.on('error', () => this.close());
    this.child.stdin.on('error', () => this.close());
    this.child.once('exit', () => this.close());
  }

  send(command) {
    if (this.closed) throw new Error('Stockfish stopped');
    this.child.stdin.write(command + '\n');
  }

  wait(command, accept, milliseconds, signal, stopOnAbort = false) {
    signal?.throwIfAborted();
    if (this.closed || this.pending) throw new Error('Stockfish is unavailable');
    return new Promise((resolve, reject) => {
      let stopTimer;
      const timer = setTimeout(() => this.close(), milliseconds);
      const finish = (error, value) => {
        clearTimeout(timer);
        clearTimeout(stopTimer);
        signal?.removeEventListener('abort', abort);
        this.pending = null;
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => {
        if (!stopOnAbort) {
          this.close();
          return;
        }
        // UCI still sends bestmove after stop. Drain it before starting another search.
        this.send('stop');
        stopTimer = setTimeout(() => this.close(), 1500);
      };
      this.pending = {
        fail: () => finish(signal?.reason ?? new Error('Stockfish stopped or timed out')),
        line: (line) => {
          try {
            const value = accept(line);
            if (value !== undefined) finish(signal?.aborted ? signal.reason : null, value);
          } catch (error) {
            finish(error);
            this.close();
          }
        },
      };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.send(command);
      } catch (error) {
        finish(error);
      }
    });
  }

  async init(signal) {
    let named = false;
    await this.wait(
      'uci',
      (line) => {
        if (/^id name Stockfish\b/.test(line)) named = true;
        if (line === 'uciok') {
          if (!named) throw new Error('Unexpected chess engine');
          return true;
        }
      },
      8000,
      signal,
    );
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 16');
    await this.wait('isready', (line) => (line === 'readyok' ? true : undefined), 8000, signal);
  }

  async verifyPosition(position, { signal } = {}) {
    const { command, fen } = enginePosition(position);
    if (this.pending) throw new Error('Stockfish is busy');
    signal?.throwIfAborted();
    this.send(command);
    let engineFen;
    return this.wait(
      'd',
      (line) => {
        if (line.startsWith('Fen: ')) engineFen = line.slice(5).trim();
        if (!line.startsWith('Checkers:')) return;
        // Both parsers may normalize an en passant square with no legal capture.
        const board = engineFen && loadPosition(engineFen);
        if (!board || board.fen() !== fen)
          throw new Error('Stockfish position did not match the observed game');
        const checkers = line.slice('Checkers:'.length).trim().split(/\s+/).filter(Boolean);
        const pieces = checkers.map((square) => {
          const piece = /^[a-h][1-8]$/.test(square) && board.get(square);
          if (!piece || piece.color === board.turn()) throw new Error('Invalid Stockfish checker');
          return piece.type;
        });
        return { checked: pieces.length !== 0, checkers: pieces };
      },
      1500,
      signal,
    );
  }

  async analyse(position, { deep = false, quick = false, signal, onProgress } = {}) {
    const { fen, terminal, command } = enginePosition(position);
    if (terminal) return { terminal: true };
    if (this.pending) throw new Error('Stockfish is busy');
    signal?.throwIfAborted();
    this.send('setoption name MultiPV value ' + (deep ? 3 : 1));
    this.send(command);
    const latest = new Map();
    const scoredLines = (depth) =>
      [...(latest.get(depth)?.values() ?? [])]
        .sort((a, b) => a.index - b.index)
        .map(({ moves, ...entry }) => ({ ...entry, moves: checkLine(fen, moves) }));
    let shownDepth = 0;
    let shownAt = -Infinity;
    const best = await this.wait(
      `go movetime ${quick ? 50 : deep ? 2500 : 500}`,
      (line) => {
        if (line.startsWith('bestmove ')) return line.split(' ')[1];
        if (!line.startsWith('info ')) return undefined;
        const info = engineInfo(line, fen);
        if (info) {
          const variations = latest.get(info.depth) ?? new Map();
          variations.set(info.index, info);
          latest.set(info.depth, variations);
          if (
            onProgress &&
            !signal?.aborted &&
            info.index === 1 &&
            info.depth > shownDepth &&
            performance.now() - shownAt >= 160
          ) {
            const lines = scoredLines(info.depth);
            const bestMove = lines[0]?.moves[0];
            if (bestMove) {
              shownDepth = info.depth;
              shownAt = performance.now();
              onProgress({ bestMove, lines });
            }
          }
        }
      },
      quick ? 300 : deep ? 8000 : 4000,
      signal,
      true,
    );
    const bestMove = checkLine(fen, [best])[0];
    if (!bestMove) throw new Error('Stockfish returned an invalid move');
    const depth = [...latest.keys()]
      .sort((a, b) => b - a)
      .find((level) => {
        const info = latest.get(level).get(1);
        return info?.moves[0] === best && (!quick || !info.score.bound);
      });
    return { bestMove, lines: scoredLines(depth) };
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.pending?.fail();
      this.reader.close();
      this.child.kill();
    }
    return this.exited;
  }
}
