// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import path from 'node:path';
import { screenshotDimensions } from './screenshot-files.mjs';

const rectKeys = ['x', 'y', 'width', 'height'];
const handlePattern = /^[1-9]\d{0,18}$/;
const validEdge = (n) => Number.isInteger(n) && n > 0 && n <= 16384;
const dimensionsValid = (width, height) =>
  validEdge(width) && validEdge(height) && width * height <= 40000000;

// One serial, private binary pipe. Resizing and optional PNG encoding stay off Electron's main thread.
export class ScreenFrameWorker {
  constructor(root, { spawnImpl = spawn } = {}) {
    Object.assign(this, { root, spawnImpl });
    this.queue = Promise.resolve();
    this.pending = 0;
  }

  frame({
    region,
    windowClient,
    ownedWindow,
    displayWindow,
    limit = { width: 16384, height: 16384 },
    format = 'png',
    signal,
  } = {}) {
    signal?.throwIfAborted();
    if (this.disposed) throw new Error('Screen capture closed');
    const hasHandle = ownedWindow !== undefined || displayWindow !== undefined;
    if (
      (region &&
        (hasHandle ||
          !rectKeys.every((key) => Number.isSafeInteger(region[key])) ||
          !dimensionsValid(region.width, region.height))) ||
      (hasHandle && !handlePattern.test(ownedWindow ?? displayWindow)) ||
      (ownedWindow !== undefined && displayWindow !== undefined) ||
      (windowClient !== undefined &&
        (!region ||
          !handlePattern.test(windowClient?.hwnd) ||
          !/^[1-9]\d{0,9}$/.test(windowClient?.processId))) ||
      !validEdge(limit.width) ||
      !validEdge(limit.height) ||
      !['png', 'bgra'].includes(format)
    )
      throw new Error('Invalid screen frame request');
    if (this.pending >= 8) throw new Error('Screen capture is busy');
    const mode = windowClient
      ? 'window-region'
      : region
        ? 'region'
        : ownedWindow !== undefined
          ? 'owned'
          : 'foreground';
    const request =
      [
        mode,
        windowClient
          ? `${windowClient.hwnd}:${windowClient.processId}`
          : (ownedWindow ?? displayWindow ?? ''),
        ...rectKeys.map((key) => region?.[key] ?? 0),
        limit.width,
        limit.height,
        format,
      ].join('|') + '\n';
    this.pending++;
    const result = this.queue.then(() => {
      signal?.throwIfAborted();
      if (this.disposed) throw new Error('Screen capture closed');
      return this.run(request, { region, limit, format, signal });
    });
    this.queue = result
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
    return result;
  }

  start() {
    if (this.child) return this.child;
    const child = this.spawnImpl(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(this.root, 'integrations/perception/native/capture-display.ps1'),
        '-Worker',
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    this.child = child;
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    const failed = () => {
      if (this.child === child) this.close(new Error('Windows screen capture stopped'));
    };
    child.on('error', failed).on('close', failed);
    child.stdin.on('error', failed);
    return child;
  }

  run(request, { region, limit, format, signal }) {
    clearTimeout(this.idle);
    const child = this.start();
    return new Promise((resolve, reject) => {
      const header = Buffer.alloc(32);
      let headerBytes = 0,
        frame,
        pixels,
        received = 0;
      const finish = (error, value) => {
        this.finish = null;
        child.stdout.off('data', receive);
        clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
        if (this.child === child) {
          this.idle = setTimeout(() => this.close(), 15000);
          this.idle.unref?.();
        }
        error ? reject(error) : resolve(value);
      };
      const abort = () => this.close(signal.reason);
      const deadline = setTimeout(
        () => this.close(new Error('Windows screen capture timed out')),
        7000,
      );
      const receive = (chunk) => {
        try {
          if (!frame) {
            const length = Math.min(header.length - headerBytes, chunk.length);
            chunk.copy(header, headerBytes, 0, length);
            headerBytes += length;
            if (headerBytes < header.length) return;
            chunk = chunk.subarray(length);
            const bytes = header.readInt32LE(28);
            if (header.readInt32LE(0) === 1 && bytes === 0 && !chunk.length) {
              finish(new Error('Windows could not capture the selected screen'));
              return;
            }
            const bounds = Object.fromEntries(
              rectKeys.map((key, i) => [key, header.readInt32LE(4 + i * 4)]),
            );
            const width = header.readInt32LE(20),
              height = header.readInt32LE(24);
            if (
              header.readInt32LE(0) !== 0 ||
              !dimensionsValid(bounds.width, bounds.height) ||
              (region && !rectKeys.every((key) => bounds[key] === region[key])) ||
              !dimensionsValid(width, height) ||
              width > Math.min(limit.width, bounds.width) ||
              height > Math.min(limit.height, bounds.height) ||
              (format === 'bgra'
                ? bytes !== width * height * 4
                : bytes < 33 || bytes > 96 * 1024 * 1024)
            )
              throw new Error('Invalid frame header');
            frame = { bounds, width, height };
            pixels = Buffer.allocUnsafe(bytes);
          }
          if (received + chunk.length > pixels.length) throw new Error('Unexpected frame data');
          chunk.copy(pixels, received);
          received += chunk.length;
          if (received !== pixels.length) return;
          if (format === 'png') {
            const size = screenshotDimensions(pixels);
            if (size.width !== frame.width || size.height !== frame.height)
              throw new Error('Invalid frame image');
          }
          finish(null, { ...frame, [format]: pixels });
        } catch {
          this.close(new Error('Windows returned an invalid screen frame'));
        }
      };
      this.finish = finish;
      child.stdout.on('data', receive);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.write(request);
    });
  }

  close(error = new Error('Screen capture closed')) {
    clearTimeout(this.idle);
    const child = this.child;
    this.child = null;
    child?.kill();
    this.finish?.(error);
  }

  dispose() {
    this.disposed = true;
    this.close();
  }
}
