// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { BoundedDiagnosticLog } from '../../../packages/runtime/src/diagnostic-log.mjs';
import { chessDiagnosticRecord } from '../../../packages/runtime/src/chess-diagnostic-schema.mjs';

export const chessFailure = (error) => ({ exception: error?.name, errorCode: error?.code });

export const silentChessTrace = () => () => {};

export const chessUiDecisions = new Set([
  'awaiting_turn',
  'tracking_unavailable',
  'stockfish_missing',
]);

export class ChessDiagnostics {
  constructor(file) {
    this.log = new BoundedDiagnosticLog(file, {
      record: chessDiagnosticRecord,
      maximumBytes: 256 * 1024,
    });
  }

  start(operation, initial = {}) {
    const traceId = randomUUID();
    const started = performance.now();
    const trace = (stage, details) =>
      this.log.write({
        ...initial,
        ...details,
        event: 'chess-diagnostic',
        operation,
        stage,
        traceId,
        time: new Date().toISOString(),
        elapsedMs: performance.now() - started,
      });
    trace.id = traceId;
    trace('started');
    return trace;
  }

  flush() {
    return this.log.flush();
  }
}
