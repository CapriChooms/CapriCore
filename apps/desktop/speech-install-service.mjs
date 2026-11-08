// SPDX-License-Identifier: GPL-3.0-only
import {
  mkdirSync,
  appendFileSync,
  statSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import voiceDownload from '../../config/voice-model-download.json' with { type: 'json' };
import {
  installSpeechComponents,
  speechComponentSelection,
  SPEECH_GPU_UNSUPPORTED,
} from '../../packages/installer/src/speech-components.mjs';
import { noLinks, readJson } from '../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { privateLogRecord } from '../../packages/runtime/src/privacy-log.mjs';

/** Owns the installation lifetime; the renderer may close and reconnect without losing progress. */
export class SpeechInstallService {
  constructor({
    root,
    node,
    emit = () => {},
    install = installSpeechComponents,
    before = async () => {},
    ready = async () => {},
  }) {
    Object.assign(this, { root, node, emit, install, before, ready });
    this.file = path.join(root, '.runtime/installer/speech-status.json');
    this.log = path.join(root, 'logs/speech-install.log');
    this.value = {
      phase: 'idle',
      stage: null,
      selection: null,
      progress: null,
      error: null,
      errorCode: null,
    };
    try {
      noLinks(this.file);
      const old = readJson(this.file);
      if (old.phase === 'installing')
        this.value = {
          ...this.value,
          phase: 'interrupted',
          selection: speechComponentSelection(old.selection),
        };
    } catch {}
  }
  snapshot() {
    return structuredClone(this.value);
  }
  busy() {
    return Boolean(this.task) && this.value.phase === 'installing';
  }
  logMessage(message) {
    try {
      noLinks(this.log);
      mkdirSync(path.dirname(this.log), { recursive: true });
      try {
        const size = statSync(this.log).size;
        if (size > 2 * 1024 ** 2) {
          const fd = openSync(this.log, 'r'),
            tail = Buffer.alloc(65536);
          try {
            readSync(fd, tail, 0, tail.length, size - tail.length);
          } finally {
            closeSync(fd);
          }
          writeFileSync(this.log, tail);
        }
      } catch {}
      appendFileSync(
        this.log,
        JSON.stringify({
          ...privateLogRecord(message, { service: 'speech-install', stage: this.value.stage }),
          time: new Date().toISOString(),
        }) + '\n',
      );
    } catch {}
  }
  publish(patch) {
    Object.assign(this.value, patch);
    try {
      noLinks(this.file);
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeJsonAtomic(this.file, this.value);
    } catch {}
    this.emit({ type: 'speech-install.status', ...this.snapshot() });
    return this.snapshot();
  }
  start(value) {
    const selection = speechComponentSelection(value);
    if (this.busy()) throw new Error('A speech installation is already running.');
    if (this.task) throw new Error('Wait for the speech installer to finish stopping.');
    this.controller = new AbortController();
    const controller = this.controller;
    this.publish({
      phase: 'installing',
      stage: 'checking',
      selection,
      progress: null,
      error: null,
      errorCode: null,
      currentFile: null,
      transferState: null,
      failedStage: null,
    });
    this.task = Promise.resolve()
      .then(async () => {
        await this.before(controller.signal);
        controller.signal.throwIfAborted();
        await this.install(selection, {
          root: this.root,
          node: this.node,
          signal: controller.signal,
          emit: (event) => {
            if (event.stage !== this.value.stage) this.logMessage('Stage: ' + event.stage);
            if (event.message) this.logMessage(event.message);
            const percent = event.message?.match(/\b(\d{1,3})%/);
            const voiceFile =
              event.stage === 'voice-runtime'
                ? /^Voice model file \d+\/\d+: ([A-Za-z0-9][A-Za-z0-9_.-]{0,79})$/.exec(
                    event.message ?? '',
                  )?.[1]
                : null;
            const currentFile = Object.hasOwn(voiceDownload.files, voiceFile)
              ? voiceFile
              : event.stage === this.value.stage &&
                  event.message !== '100% overall | Voice model download verified.'
                ? this.value.currentFile
                : null;
            let transferState = currentFile ? this.value.transferState : null;
            if (currentFile) {
              if (event.message?.startsWith('Connecting: ' + currentFile + ' '))
                transferState = 'connecting';
              else if (event.message?.startsWith('Download interrupted: ' + currentFile + ' ('))
                transferState = 'retrying';
              else if (percent || voiceFile === currentFile) transferState = null;
            }
            this.publish({
              stage: event.stage,
              currentFile,
              transferState,
              progress: Object.hasOwn(event, 'progress')
                ? event.progress
                : percent && Number(percent[1]) <= 100
                  ? { received: Number(percent[1]), total: 100 }
                  : this.value.progress,
            });
          },
        });
        controller.signal.throwIfAborted();
        await this.ready(selection);
        this.publish({
          phase: 'ready',
          stage: null,
          progress: null,
          error: null,
          errorCode: null,
          currentFile: null,
          transferState: null,
        });
      })
      .catch((error) => {
        this.logMessage(String(error.stack ?? error));
        const known =
          error.message === SPEECH_GPU_UNSUPPORTED ||
          /^(Voice replies currently require|Not enough free space|GitHub access is unavailable|The included Capri voice pack is unavailable|Another installation process)/.test(
            error.message,
          );
        this.publish({
          phase: controller.signal.aborted ? 'cancelled' : 'error',
          failedStage: this.value.stage,
          stage: null,
          progress: null,
          transferState: null,
          errorCode:
            !controller.signal.aborted && error.message === SPEECH_GPU_UNSUPPORTED
              ? 'CAPRI_VOICE_GPU_UNSUPPORTED'
              : null,
          error: controller.signal.aborted
            ? null
            : known
              ? error.message
              : 'Voice installation failed. Retry or save a diagnostic report.',
        });
      })
      .finally(() => {
        this.task = null;
        this.controller = null;
      });
    return this.snapshot();
  }
  cancel() {
    this.controller?.abort(new Error('Speech installation cancelled'));
    return this.snapshot();
  }
  async close() {
    this.cancel();
    await this.task;
  }
}
