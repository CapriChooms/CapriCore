// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

export function runCommand(
  executable,
  args,
  { cwd, env, signal, output = () => {}, timeoutMs = 60 * 60 * 1000 } = {},
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '',
      finished = false,
      terminationError = null,
      terminationTimer;
    const kill = () => {
      if (child.exitCode !== null || !child.pid) return;
      if (process.platform === 'win32')
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).unref();
      else child.kill('SIGTERM');
    };
    const terminate = (error) => {
      if (terminationError) return;
      terminationError = error;
      kill();
      terminationTimer = setTimeout(
        () => finish(new Error('The owned installation command did not stop in time')),
        10000,
      );
    };
    const timeout = () => terminate(new Error('Installation component timed out'));
    let activeMs = 0,
      previousTick = Date.now();
    const timer = env?.CAPRI_INSTALL_PAUSE_FILE
      ? setInterval(
          () => {
            const now = Date.now();
            if (!existsSync(env.CAPRI_INSTALL_PAUSE_FILE)) activeMs += now - previousTick;
            previousTick = now;
            if (activeMs >= timeoutMs) timeout();
          },
          Math.min(250, timeoutMs),
        )
      : setTimeout(timeout, timeoutMs);
    const abort = () => {
      terminate(signal.reason ?? new Error('Installation cancelled'));
    };
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    }
    const emitLine = (line) => {
      const text = stripVTControlCharacters(line).trim();
      if (text) output(text.slice(0, 1000));
    };
    // Each pipe owns its decoder and unfinished line. Sharing either corrupts
    // split UTF-8 characters and interleaved stdout/stderr status messages.
    const streams = [child.stdout, child.stderr].map((stream) => ({ stream, buffer: '' }));
    const flush = (state) => {
      if (state.buffer) emitLine(state.buffer);
      state.buffer = '';
    };
    const receive = (state, text) => {
      tail = (tail + text).slice(-6000);
      state.buffer = (state.buffer + text).slice(-16000);
      let at;
      while ((at = state.buffer.search(/[\r\n]/)) >= 0) {
        emitLine(state.buffer.slice(0, at));
        state.buffer = state.buffer.slice(at + 1);
      }
    };
    const componentFailure = (code) => {
      const cleanTail = stripVTControlCharacters(tail);
      const error = new Error(`Component exited ${code}. ${cleanTail.slice(-2000)}`);
      error.exitCode = code;
      error.outputTail = cleanTail;
      return error;
    };
    for (const state of streams) {
      state.stream.setEncoding('utf8');
      state.stream.on('data', (text) => receive(state, text));
      state.stream.once('end', () => flush(state));
    }
    child.once('error', finish);
    child.once('close', (code) => {
      for (const state of streams) flush(state);
      finish(terminationError ?? (code === 0 ? null : componentFailure(code)));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
