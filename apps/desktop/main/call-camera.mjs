// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { assertPrivatePath } from '../../../packages/runtime/src/safe-file.mjs';
import {
  CAMERA_FRAME_BYTES,
  CAMERA_RUNTIME_FOLDER,
  CALL_CAMERA_FILES,
} from '../call-camera-protocol.mjs';
import { CAMERA_BUNDLES_FOLDER, readCameraBundleReceipt } from './camera-bundle.mjs';

const startupFailure = 'Capri Camera could not start.';

export class CallCamera {
  constructor({ root, background, notify, spawnProcess = spawn, platform = process.platform }) {
    this.directory = path.join(root, CAMERA_RUNTIME_FOLDER);
    this.background = background;
    this.notify = notify;
    this.spawnProcess = spawnProcess;
    this.platform = platform;
  }

  snapshot() {
    return {
      supported: this.platform === 'win32',
      enabled: Boolean(this.session?.ready),
      pending: Boolean(this.starting || this.stopping),
      error: this.error ?? null,
      ...(this.background && { background: this.background.snapshot() }),
    };
  }

  publishState() {
    const state = this.snapshot();
    this.notify?.(state);
    return state;
  }

  executable() {
    try {
      const { bundleId } = readCameraBundleReceipt(this.directory);
      const candidates = bundleId
        ? [path.join(this.directory, CAMERA_BUNDLES_FOLDER, bundleId), this.directory]
        : [this.directory];
      for (const directory of candidates) {
        const complete = CALL_CAMERA_FILES.every((file) => {
          const candidate = path.join(directory, file);
          assertPrivatePath(candidate);
          const info = lstatSync(candidate, { throwIfNoEntry: false });
          return info?.isFile() && info.nlink === 1 && info.size > 0;
        });
        if (complete) return path.join(directory, CALL_CAMERA_FILES[0]);
      }
    } catch {
      // An invalid or linked runtime path must not be executed.
    }
    return null;
  }

  async setEnabled(enabled) {
    if (!enabled) return this.stop();
    if (this.platform !== 'win32') return this.snapshot();
    if (this.stopping) return this.snapshot();
    if (this.starting) {
      await this.starting;
      return this.snapshot();
    }
    if (this.session?.ready) return this.snapshot();
    this.error = null;
    const executable = this.executable();
    if (!executable) {
      this.error = 'Capri Camera is missing. Run Capri Setup to install it.';
      return this.publishState();
    }
    this.starting = this.start(executable).finally(() => {
      this.starting = null;
      this.publishState();
    });
    this.publishState();
    await this.starting;
    return this.snapshot();
  }

  async start(executable) {
    const child = this.spawnProcess(executable, [], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const status = Promise.withResolvers();
    const exited = Promise.withResolvers();
    const session = { child, executable, ready: false, exited: exited.promise };
    this.session = session;
    let line = '';
    child.stdout.on('data', (chunk) => {
      line = (line + chunk.toString('ascii')).slice(0, 128);
      const end = line.indexOf('\n');
      if (end !== -1) status.resolve(line.slice(0, end).trim());
    });
    child.stdin.on('error', () => {});
    child.on('error', () => status.resolve('UNAVAILABLE'));
    child.once('close', (code) => {
      exited.resolve(code);
      status.resolve('UNAVAILABLE');
      if (this.session !== session || this.stopping) return;
      this.session = null;
      if (session.ready) {
        this.error = startupFailure;
        this.publishState();
        if (code !== 0) this.cleanRegistration(executable);
      }
    });
    const reply = await Promise.race([status.promise, wait(5000, 'UNAVAILABLE', { ref: false })]);
    if (session.cancelled) return;
    if (reply === 'READY') {
      session.ready = true;
      return;
    }
    this.error = startupFailure;
    if (['IN_USE', 'REGISTRATION_FAILED'].includes(reply))
      console.warn('Capri Camera startup failed:', reply);
    await this.stop({ preserveError: true });
  }

  cleanRegistration(executable) {
    const child = this.spawnProcess(executable, ['--cleanup'], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  }

  async stop({ preserveError = false } = {}) {
    if (!preserveError) this.error = null;
    if (this.stopping) return this.stopping;
    const session = this.session;
    if (!session) return this.publishState();
    session.cancelled = true;
    this.session = null;
    this.stopping = (async () => {
      session.child.stdin.end();
      const code = await Promise.race([session.exited, wait(1500, 'timeout', { ref: false })]);
      if (code === 'timeout') {
        session.child.kill();
        await session.exited;
        this.cleanRegistration(session.executable);
      }
    })().finally(() => {
      this.stopping = null;
      this.publishState();
    });
    this.publishState();
    await this.stopping;
    return this.snapshot();
  }

  frame(bytes) {
    const session = this.session;
    if (!session?.ready || !(bytes instanceof Uint8Array) || bytes.length !== CAMERA_FRAME_BYTES)
      return false;
    const pipe = session.child.stdin;
    const now = performance.now();
    if (pipe.destroyed || pipe.writableNeedDrain || now - (session.lastFrame ?? -Infinity) < 50)
      return false;
    session.lastFrame = now;
    pipe.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return true;
  }
}
