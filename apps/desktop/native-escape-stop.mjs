// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import path from 'node:path';
import { applicationBridgeExecutable } from '../../integrations/desktop-actions/service.mjs';

/** Separate, read-only Escape polling remains independent of input/UIA helpers. */
export class NativeEscapeStop {
  constructor({
    root,
    spawnImpl = spawn,
    executable = applicationBridgeExecutable,
    parentPid = process.pid,
    armTimeoutMs = 3000,
    durationMs = 600000,
    env = process.env,
  }) {
    Object.assign(this, { root, spawnImpl, executable, parentPid, armTimeoutMs, durationMs, env });
    this.current = null;
  }
  get armed() {
    return Boolean(this.current?.armed && !this.current.closed);
  }
  get active() {
    return this.armed;
  }
  start({ onEscape = () => {}, onFailure = () => {} } = {}) {
    this.stop();
    const state = { armed: false, closed: false, onEscape, onFailure, output: '', bytes: 0 };
    this.current = state;
    return new Promise((resolve) => {
      state.resolve = resolve;
      const finish = (reason) => {
        if (this.current !== state || state.closed) return;
        const armed = state.armed;
        this.close(state);
        const callback = reason === 'escape' ? onEscape : armed ? onFailure : null;
        if (callback) {
          try {
            void Promise.resolve(callback()).catch(() => {});
          } catch {}
        }
      };
      state.finish = finish;
      try {
        const executable =
          typeof this.executable === 'function' ? this.executable(this.root) : this.executable;
        if (
          typeof executable !== 'string' ||
          !path.isAbsolute(executable) ||
          !Number.isInteger(this.parentPid) ||
          this.parentPid <= 0 ||
          !Number.isInteger(this.durationMs) ||
          this.durationMs < 1000 ||
          this.durationMs > 600000
        )
          throw new Error('Invalid Escape watcher configuration');
        const windows = this.env.SystemRoot ?? 'C:\\Windows';
        const child = this.spawnImpl(executable, [], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            SystemRoot: windows,
            WINDIR: windows,
            PATH: path.join(windows, 'System32'),
            TEMP: path.join(this.root, '.runtime/tmp'),
            TMP: path.join(this.root, '.runtime/tmp'),
          },
        });
        state.child = child;
        state.armTimer = setTimeout(
          () => finish('arm_timeout'),
          Math.min(3000, Math.max(1, this.armTimeoutMs)),
        );
        child.on('error', () => finish('process_error'));
        child.on('close', () => finish('process_closed'));
        child.stdin.on('error', () => finish('request_error'));
        child.stderr.on('data', () => finish('unexpected_diagnostic'));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          if (state.closed || this.current !== state) return;
          state.bytes += Buffer.byteLength(chunk);
          if (state.bytes > 4096) return finish('output_limit');
          state.output += chunk;
          for (;;) {
            const end = state.output.indexOf('\n');
            if (end < 0) break;
            const line = state.output.slice(0, end).trim();
            state.output = state.output.slice(end + 1);
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              return finish('invalid_event');
            }
            if (event?.ok !== true) return finish('native_failure');
            if (event.event === 'armed' && !state.armed) {
              state.armed = true;
              clearTimeout(state.armTimer);
              state.lifeTimer = setTimeout(() => finish('lifetime'), this.durationMs + 1000);
              state.resolve(true);
              state.resolve = null;
            } else if (event.event === 'escape' && state.armed) return finish('escape');
            else return finish('watcher_lost');
          }
        });
        child.stdin.end(
          JSON.stringify({
            action: 'computer_watch_escape',
            parentPid: this.parentPid,
            durationMs: this.durationMs,
          }) + '\n',
        );
      } catch {
        finish('start_failed');
      }
    });
  }
  close(state) {
    if (state.closed) return;
    state.closed = true;
    clearTimeout(state.armTimer);
    clearTimeout(state.lifeTimer);
    if (this.current === state) this.current = null;
    state.resolve?.(false);
    state.resolve = null;
    try {
      state.child?.kill();
    } catch {}
  }
  stop() {
    if (this.current) this.close(this.current);
  }
}
