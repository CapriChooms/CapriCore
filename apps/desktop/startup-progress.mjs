// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './storage.mjs';
const estimates = { core: 15, models: 12, recognition: 8, voice: 25 };
const coreStartupMessages = Object.freeze({
  CAPRI_LLAMA_BUNDLE_INCOMPLETE:
    'Your saved data has been preserved. Repair Capri with the installer and try again.',
  CAPRI_GATEWAY_RUNTIME_MISSING:
    'Your saved data has been preserved. Repair Capri with the installer and try again.',
  CAPRI_MEMORY_MODEL_MISSING:
    'Your saved data has been preserved. Repair Capri with the installer and try again.',
  CAPRI_LOCAL_LANGUAGE_MODEL_MISSING: 'Choose a language model in Settings → Language model.',
  CAPRI_SERVICE_EXITED: 'Capri could not start.',
  CAPRI_SERVICE_STARTUP_TIMEOUT: 'The local core is not ready yet.',
  CAPRI_SERVICE_PORT_OCCUPIED: 'Could not reconnect. Check the local core.',
});

export function coreStartupFailure(error) {
  if (!Object.hasOwn(coreStartupMessages, error?.code))
    return { message: 'The local core is unavailable. Reconnect to try again.' };
  return { code: error.code, message: coreStartupMessages[error.code] };
}

/** Stage completion is measured; ETA is an explicitly approximate local estimate. */
export class StartupProgress {
  constructor({ file, emit, now = Date.now }) {
    Object.assign(this, { file, emit, now });
    this.stages = {};
    this.history = {};
    try {
      if (existsSync(file)) this.history = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* First start. */
    }
  }
  start(stages) {
    this.started = this.now();
    this.finished = false;
    this.stages = Object.fromEntries(
      stages.map((key) => [
        key,
        {
          state: 'waiting',
          estimate: Math.max(1, Math.min(600, Number(this.history[key]) || estimates[key])),
        },
      ]),
    );
    this.publish();
  }
  begin(key) {
    if (!this.stages[key]) return;
    this.stages[key].state = 'running';
    this.stages[key].started = this.now();
    this.publish();
  }
  end(key, failed = false) {
    const stage = this.stages[key];
    if (!stage) return;
    stage.state = failed ? 'failed' : 'ready';
    if (!failed && stage.started)
      this.history[key] = Math.max(1, (this.now() - stage.started) / 1000);
    this.publish();
  }
  snapshot() {
    const stages = Object.entries(this.stages).map(([id, value]) => ({ id, ...value }));
    return {
      type: 'startup.progress',
      started: this.started,
      stages,
      finished: this.finished ?? false,
    };
  }
  publish() {
    this.emit(this.snapshot());
  }
  finish() {
    this.finished = true;
    try {
      writeJsonAtomic(this.file, this.history);
    } catch {
      /* Optional timings. */
    }
    this.publish();
  }
}
