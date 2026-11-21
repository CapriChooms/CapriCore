// SPDX-License-Identifier: GPL-3.0-only
import { Worker } from 'node:worker_threads';
import { scaleChessRect } from './source.mjs';

export class ChessVision {
  async scan(bitmap, { manual = false, limit = 1, signal } = {}) {
    signal?.throwIfAborted();
    if (this.pending) throw new Error('Chess recognition is busy');
    const size = bitmap.getSize();
    if (Math.min(size.width, size.height) < 96) return [];
    const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
    const image =
      scale < 1
        ? bitmap.resize({
            width: Math.round(size.width * scale),
            height: Math.round(size.height * scale),
          })
        : bitmap;
    const { width, height } = image.getSize();
    const bytes = Uint8Array.from(image.toBitmap());
    if (!this.worker) {
      this.worker = new Worker(new URL('./vision-worker.mjs', import.meta.url), { execArgv: [] });
      // The per-job listener propagates failures. Keep idle worker errors handled.
      this.worker.on('error', () => {});
    }
    const worker = this.worker;
    const candidates = await new Promise((resolve, reject) => {
      const fail = (error) => {
        finish(error);
        this.close();
      };
      const abort = () => fail(signal.reason);
      const exit = () => fail(new Error('Chess recognition stopped'));
      const receive = (result) =>
        result?.error ? fail(new Error('Chess recognition failed')) : finish(null, result);
      const timer = setTimeout(() => fail(new Error('Chess recognition timed out')), 12000);
      const finish = (error, value) => {
        this.pending = null;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        worker.off('message', receive).off('error', fail).off('exit', exit);
        if (error) reject(error);
        else resolve(value);
      };
      this.pending = fail;
      signal?.addEventListener('abort', abort, { once: true });
      worker.once('message', receive).once('error', fail).once('exit', exit);
      worker.postMessage({ bytes, width, height, manual, limit }, [bytes.buffer]);
    });
    const xScale = size.width / width,
      yScale = size.height / height;
    return candidates.map((item) => ({
      ...item,
      rect: scaleChessRect(item.rect, xScale, yScale),
    }));
  }

  close() {
    const worker = this.worker;
    this.worker = null;
    this.pending?.(new Error('Chess recognition stopped'));
    void worker?.terminate();
  }
}
