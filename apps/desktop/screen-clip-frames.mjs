import { randomUUID } from 'node:crypto';
import { snapshotBytes } from './visual-service.mjs';

/** A request cannot outlive its selected-source lease or accept another source's pixels. */
export class ScreenClipFrames {
  constructor({ current, emit }) {
    Object.assign(this, { current, emit });
    this.pending = new Map();
  }
  request(capture, signal) {
    signal.throwIfAborted();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pending.delete(requestId);
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(signal.reason ?? new Error('Capture cancelled'));
      const timer = setTimeout(
        () => finish(new Error('The selected view did not return a frame')),
        4000,
      );
      this.pending.set(requestId, { capture, finish });
      signal.addEventListener('abort', abort, { once: true });
      this.emit({ type: 'screen.clip-request', requestId, captureId: capture.id });
    });
  }
  accept(value) {
    const pending = this.pending.get(value?.requestId);
    if (!pending) return false;
    const capture = this.current();
    if (
      value.error ||
      capture !== pending.capture ||
      capture.id !== value.captureId ||
      capture.phase !== 'capturing' ||
      capture.expiresAt <= Date.now()
    ) {
      pending.finish(new Error('The selected source is no longer available'));
      return false;
    }
    try {
      pending.finish(null, snapshotBytes(value.png));
      return true;
    } catch (error) {
      pending.finish(error);
      return false;
    }
  }
}
