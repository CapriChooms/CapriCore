// SPDX-License-Identifier: GPL-3.0-only
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  existsSync,
  readFileSync,
  statSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { readJson, noLinks } from '../../packages/installer/src/policy.mjs';
import { voiceRuntimeEnvironment } from '../../integrations/voice_runtime/environment.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { voiceDataPath, readVoiceSelections } from './voice-catalog-service.mjs';
import {
  readTrainingSettings,
  voiceOverridePath,
} from '../../packages/runtime/src/voice-settings.mjs';

const stages = new Set([
  'checking',
  'preparing',
  'caching',
  'training',
  'previewing',
  'review',
  'no-improvement',
  'failed',
]);
const jobIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function runVoiceTraining({ root, jobId, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const env = {};
    for (const name of [
      'SystemRoot',
      'WINDIR',
      'PATH',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'LOCALAPPDATA',
    ])
      if (process.env[name]) env[name] = process.env[name];
    Object.assign(env, voiceRuntimeEnvironment(root), {
      TEMP: path.join(root, '.runtime/tmp'),
      TMP: path.join(root, '.runtime/tmp'),
      HF_HUB_OFFLINE: '1',
      HF_HUB_DISABLE_TELEMETRY: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONUNBUFFERED: '1',
      TOKENIZERS_PARALLELISM: 'false',
      HF_HOME: path.join(root, 'data/speech/hf-cache'),
      TORCH_HOME: path.join(root, 'data/speech/torch-cache'),
    });
    noLinks(env.TEMP);
    mkdirSync(env.TEMP, { recursive: true });
    const child = spawn(
      path.join(root, '.runtime/voice-training-venv/Scripts/python.exe'),
      ['-m', 'integrations.voice_training.job', '--job', jobId],
      { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let pending = '';
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(stop, 4 * 60 * 60 * 1000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pending = (pending + chunk).slice(-16384);
      for (let end; (end = pending.indexOf('\n')) !== -1; ) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (stages.has(event.stage))
            onProgress({
              stage: event.stage,
              ...(Number.isInteger(event.epoch) && event.epoch >= 0 && event.epoch <= 50
                ? { epoch: event.epoch }
                : {}),
              ...(Number.isInteger(event.epochs) && event.epochs >= 1 && event.epochs <= 50
                ? { epochs: event.epochs }
                : {}),
            });
        } catch {}
      }
    });
    const clean = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
    };
    child.once('error', () => {
      clean();
      reject(new Error('The local voice training worker could not start.'));
    });
    child.once('close', (code) => {
      clean();
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0)
        reject(
          new Error(
            'Voice training failed. Check the recordings, installed voice runtime and free GPU memory.',
          ),
        );
      else resolve();
    });
  });
}

function voiceImportEnvironment() {
  const env = {
    PYTHONNOUSERSITE: '1',
    PYTHONUTF8: '1',
    HF_HUB_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
  };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA'])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}

function runVoiceDatasetDraft({ root, source, signal, transcribe }) {
  const python = path.join(
    root,
    transcribe ? '.runtime/asr-venv' : '.runtime/voice-training-venv',
    'Scripts/python.exe',
  );
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = execFile(
      python,
      transcribe
        ? [
            '-I',
            '-S',
            '-X',
            'utf8',
            '-B',
            '-u',
            path.join(root, 'integrations/asr_runtime/bootstrap.py'),
            '--transcribe-recordings',
          ]
        : ['-B', '-m', 'integrations.voice_training.review_recordings'],
      {
        cwd: root,
        env: { ...voiceImportEnvironment(), CAPRI_ASR_LANGUAGE: 'en' },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
        signal,
      },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          resolve(JSON.parse(stdout));
        } catch (failure) {
          reject(failure);
        }
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ source }));
  });
}

export function runVoiceDatasetImport({ root, source, importId, signal, reviewed, rawAtRoot }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(root, '.runtime/voice-training-venv/Scripts/python.exe'),
      ['-m', 'integrations.voice_training.import_dataset', '--id', importId],
      {
        cwd: root,
        env: voiceImportEnvironment(),
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    const stop = () => child.kill();
    const timer = setTimeout(stop, 2 * 60 * 1000);
    signal.addEventListener('abort', stop, { once: true });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ source, reviewed, rawAtRoot }));
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    };
    child.once('error', () => {
      cleanup();
      reject(
        new Error('Install the English Capri voice runtime before importing training recordings.'),
      );
    });
    child.once('close', (code) => {
      cleanup();
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0)
        reject(
          new Error(
            'Recordings did not pass checks. Use reviewed metadata.csv and lossless audio in raw/, with separate training, validation, test and neutral reference scenes.',
          ),
        );
      else resolve();
    });
  });
}

/** Owns the job and retains a listening candidate before changing the active voice. */
export class VoiceTrainingService {
  constructor({
    root,
    emit = () => {},
    before = async () => {},
    ready = async () => {},
    run = runVoiceTraining,
    importRun = runVoiceDatasetImport,
    draftRun = runVoiceDatasetDraft,
  }) {
    Object.assign(this, { root, emit, before, ready, run, importRun, draftRun });
    this.file = voiceDataPath(root, 'data/speech/voice-training-status.json');
    this.lock = voiceDataPath(root, '.runtime/voice-training-job.lock');
    this.value = {
      phase: 'idle',
      stage: null,
      jobId: null,
      error: null,
      epoch: null,
      epochs: null,
    };
    if (existsSync(this.file)) {
      const previous = readJson(this.file);
      if (jobIdPattern.test(previous.jobId ?? ''))
        this.value = {
          ...this.value,
          jobId: previous.jobId,
          phase: ['review', 'applied', 'no-improvement'].includes(previous.phase)
            ? previous.phase
            : 'interrupted',
        };
    }
    this.task = null;
    this.controller = null;
    this.applying = false;
  }
  availability() {
    try {
      const config = readTrainingSettings(this.root);
      if (
        config.engine !== 'chatterbox-turbo' ||
        config.language !== 'en' ||
        config.allowProvisionalTranscripts
      )
        return {
          available: false,
          reason: 'This training recipe requires reviewed English Capri recordings.',
        };
      if (!existsSync(path.join(this.root, '.runtime/voice-training-venv/Scripts/python.exe')))
        return { available: false, reason: 'Install the Capri English voice runtime first.' };
      const metadata = voiceDataPath(this.root, config.datasetDir + '/metadata.csv');
      if (!existsSync(metadata) || statSync(metadata).size < 100)
        return {
          available: false,
          reason:
            'Add reviewed Capri recordings and transcripts to the local training dataset first.',
        };
      return {
        available: true,
        modelId: 'chatterbox-turbo',
        language: 'en',
        requiresReviewedRecordings: true,
        minimumFreeVramGiB: config.training.minimumFreeVramGiB,
        trainingDevice: 'NVIDIA CUDA with BF16',
      };
    } catch {
      return {
        available: false,
        reason: 'The local Capri training dataset or configuration is unavailable.',
      };
    }
  }
  snapshot() {
    return { ...structuredClone(this.value), ...this.availability() };
  }
  publish(patch) {
    Object.assign(this.value, patch);
    noLinks(this.file);
    writeJsonAtomic(this.file, this.value);
    const result = this.snapshot();
    this.emit({ type: 'voice-training.status', ...result });
    return result;
  }
  acquire() {
    noLinks(this.lock);
    mkdirSync(path.dirname(this.lock), { recursive: true });
    if (existsSync(this.lock)) {
      const lock = readJson(this.lock);
      if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0)
        throw new Error('The voice training lock needs recovery.');
      try {
        process.kill(lock.pid, 0);
        throw new Error('A voice training job is already running.');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      unlinkSync(this.lock);
    }
    const handle = openSync(this.lock, 'wx', 0o600);
    try {
      writeFileSync(handle, JSON.stringify({ pid: process.pid }));
    } finally {
      closeSync(handle);
    }
  }
  busy() {
    return Boolean(this.task || this.applying);
  }
  chooseDataset(source) {
    if (this.busy()) throw new Error('Wait for the current voice operation to finish.');
    if (!existsSync(path.join(this.root, '.runtime/voice-training-venv/Scripts/python.exe')))
      throw new Error(
        'Install the English Capri voice runtime before importing training recordings.',
      );
    noLinks(source);
    const metadata = path.join(source, 'metadata.csv');
    noLinks(metadata);
    this.recordingDraft = null;
    if (existsSync(metadata))
      return this.importDataset({ source }).then((status) => ({ ...status, draft: null }));
    const { phase, stage } = this.value;
    const controller = (this.controller = new AbortController());
    this.publish({ phase: 'importing', stage: 'Preparing recordings…', error: null });
    this.task = this.prepareDraft(source, controller.signal, { phase, stage }).finally(() => {
      this.task = null;
      this.controller = null;
    });
    return this.task;
  }
  async prepareDraft(source, signal, previous) {
    const root = this.root;
    const draft = (transcribe) => this.draftRun({ root, source, signal, transcribe });
    try {
      let value;
      if (existsSync(path.join(root, '.runtime/asr-venv/Scripts/python.exe'))) {
        try {
          value = await draft(true);
        } catch {
          signal.throwIfAborted();
        }
      }
      value ??= await draft(false);
      signal.throwIfAborted();
      const id = randomUUID();
      this.recordingDraft = { ...value, source, id };
      return {
        ...this.publish({ ...previous, error: null }),
        draft: {
          id,
          clips: value.rows.map(({ file, text, split, referenceEligible }) => ({
            file: file.slice(4),
            text,
            reference: split === 'reference',
            referenceEligible: referenceEligible === true,
          })),
        },
      };
    } catch {
      return {
        ...this.publish({
          ...previous,
          error: signal.aborted
            ? null
            : 'Use four or more short WAV or FLAC recordings from separate takes, including a clean 6–15 second reference.',
        }),
        draft: null,
      };
    }
  }
  async recordingAudio({ id, index } = {}) {
    const draft = this.recordingDraft;
    const row = draft && draft.id === id && Number.isInteger(index) ? draft.rows[index] : null;
    if (!row) throw new Error('Choose the recordings folder again.');
    const file = path.join(draft.source, draft.rawAtRoot ? row.file.slice(4) : row.file);
    try {
      noLinks(file);
      const size = statSync(file).size;
      if (size <= 0 || size > 64 * 1024 * 1024) throw new Error();
      const audio = await readFile(file);
      if (createHash('sha256').update(audio).digest('hex') !== row.sha256) throw new Error();
      return {
        audio: Uint8Array.from(audio),
        flac: path.extname(file).toLowerCase() === '.flac',
      };
    } catch {
      throw new Error('A recording changed. Choose the recordings folder again.');
    }
  }
  async approveRecordings({ id, texts, reference } = {}) {
    const draft = this.recordingDraft;
    if (!draft || draft.id !== id) throw new Error('Choose the recordings folder again.');
    if (texts === null) {
      this.recordingDraft = null;
      return this.snapshot();
    }
    if (
      !Array.isArray(texts) ||
      texts.length !== draft.rows.length ||
      texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 2000)
    )
      throw new Error('Check the transcript for each recording.');
    if (!Number.isInteger(reference) || !draft.rows[reference]?.referenceEligible)
      throw new Error('Choose a neutral reference recording.');
    const reviewed = draft.rows.map((row, index) => ({
      ...row,
      text: texts[index].trim(),
      split: index === reference ? 'reference' : '',
      approved: 'yes',
    }));
    const status = await this.importDataset({
      source: draft.source,
      reviewed,
      rawAtRoot: draft.rawAtRoot,
    });
    this.recordingDraft = null;
    return status;
  }
  importDataset(input) {
    if (this.busy()) throw new Error('Wait for the current voice operation to finish.');
    this.task = this.importRecordings(input).finally(() => {
      this.task = null;
    });
    return this.task;
  }
  async importRecordings({ source, reviewed, rawAtRoot } = {}) {
    if (this.busy()) throw new Error('Wait for the current voice operation to finish.');
    if (typeof source !== 'string' || !path.isAbsolute(source) || source.length > 16000)
      throw new Error('Choose a local folder containing reviewed recordings.');
    noLinks(source);
    if (!statSync(source).isDirectory()) throw new Error('Choose a recordings folder.');
    this.acquire();
    this.applying = true;
    const controller = new AbortController(),
      importId = randomUUID();
    this.controller = controller;
    try {
      this.publish({ phase: 'importing', stage: 'checking', error: null });
      await this.importRun({
        root: this.root,
        source,
        importId,
        signal: controller.signal,
        reviewed,
        rawAtRoot,
      });
      controller.signal.throwIfAborted();
      const datasetDir = 'data/voices/capri/en/imports/' + importId;
      const receipt = readJson(voiceDataPath(this.root, datasetDir + '/import-receipt.json'));
      if (
        receipt.schemaVersion !== 1 ||
        receipt.importId !== importId ||
        receipt.reviewed !== true ||
        !Number.isInteger(receipt.clips) ||
        receipt.clips < 4 ||
        receipt.clips > 200 ||
        !Number.isFinite(receipt.seconds) ||
        receipt.seconds <= 0 ||
        receipt.seconds > 300
      )
        throw new Error('The imported recordings could not be verified.');
      const file = voiceOverridePath(this.root, 'voice-training');
      writeJsonAtomic(file, { schemaVersion: 1, datasetDir });
      return this.publish({ phase: 'idle', stage: null, jobId: null, error: null });
    } catch (error) {
      this.publish({
        phase: controller.signal.aborted ? 'cancelled' : 'error',
        stage: null,
        error: controller.signal.aborted
          ? null
          : 'Recordings did not pass checks. Import reviewed metadata.csv and lossless audio in raw/, with separate training, validation, test and neutral reference scenes.',
      });
      throw error;
    } finally {
      this.applying = false;
      this.controller = null;
      unlinkSync(this.lock);
    }
  }
  start({ modelId = 'chatterbox-turbo', language = 'en' } = {}) {
    if (modelId !== 'chatterbox-turbo' || language !== 'en')
      throw new Error(
        'This model uses Capri reference conditioning. A compatible fine-tuning recipe is required for weight training.',
      );
    if (this.task || this.applying)
      throw new Error('Wait for the current voice operation to finish.');
    const available = this.availability();
    if (!available.available) throw new Error(available.reason);
    this.acquire();
    const controller = new AbortController(),
      jobId = randomUUID();
    this.controller = controller;
    try {
      this.publish({
        phase: 'training',
        stage: 'checking',
        jobId,
        error: null,
        epoch: null,
        epochs: null,
      });
    } catch (error) {
      this.controller = null;
      unlinkSync(this.lock);
      throw error;
    }
    this.task = Promise.resolve()
      .then(async () => {
        await this.before(controller.signal);
        controller.signal.throwIfAborted();
        await this.run({
          root: this.root,
          jobId,
          signal: controller.signal,
          onProgress: (event) => this.publish(event),
        });
        controller.signal.throwIfAborted();
        if (this.value.stage === 'no-improvement')
          this.publish({ phase: 'no-improvement', stage: null });
        else {
          this.candidate();
          this.publish({ phase: 'review', stage: null });
        }
      })
      .catch(() =>
        this.publish({
          phase: controller.signal.aborted ? 'cancelled' : 'error',
          stage: null,
          error: controller.signal.aborted
            ? null
            : 'Voice training failed. Check reviewed recordings, the voice runtime and free GPU memory.',
        }),
      )
      .finally(() => {
        this.task = null;
        this.controller = null;
        try {
          noLinks(this.lock);
          unlinkSync(this.lock);
        } catch {}
      });
    return this.snapshot();
  }
  candidate() {
    const jobId = this.value.jobId;
    if (!jobIdPattern.test(jobId ?? '')) throw new Error('No trained voice is available.');
    const folder = voiceDataPath(this.root, 'data/speech/training-jobs/' + jobId);
    const candidate = readJson(
      voiceDataPath(this.root, 'data/speech/training-jobs/' + jobId + '/candidate.json'),
    );
    if (
      candidate.schemaVersion !== 1 ||
      candidate.jobId !== jobId ||
      candidate.modelId !== 'chatterbox-turbo' ||
      candidate.language !== 'en' ||
      candidate.preview !== 'preview.wav' ||
      candidate.quality !== 'requires-listening'
    )
      throw new Error('The trained voice candidate is invalid.');
    const config = readTrainingSettings(this.root);
    const expected = config.datasetDir + '/exports/capri-trained-' + jobId;
    if (candidate.profileDir !== expected)
      throw new Error('The trained voice candidate is invalid.');
    const profile = readJson(voiceDataPath(this.root, expected + '/voice-profile.json'));
    if (
      profile.engine !== 'chatterbox-turbo' ||
      profile.language !== 'en' ||
      !/^[a-f0-9]{64}$/.test(profile.adapterSha256 ?? '')
    )
      throw new Error('The trained voice profile is invalid.');
    return { ...candidate, folder };
  }
  preview() {
    if (this.value.phase !== 'review') throw new Error('Train a candidate before previewing it.');
    const candidate = this.candidate();
    const file = path.join(candidate.folder, 'preview.wav');
    noLinks(file);
    if (statSync(file).size > 12 * 1024 ** 2) throw new Error('The voice preview is too large.');
    const audio = readFileSync(file);
    if (audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE')
      throw new Error('The voice preview is invalid.');
    return { mimeType: 'audio/wav', audioBase64: audio.toString('base64') };
  }
  async apply() {
    if (this.task || this.applying || this.value.phase !== 'review')
      throw new Error('Preview a completed voice candidate first.');
    this.applying = true;
    try {
      const candidate = this.candidate(),
        file = voiceOverridePath(this.root, 'companion-voice');
      const previous = existsSync(file) ? readJson(file) : null;
      const selectionFile = voiceDataPath(this.root, 'data/speech/voice-selections.json');
      const previousSelections = existsSync(selectionFile) ? readJson(selectionFile) : null;
      const models = readJson(path.join(this.root, 'config/tts-catalog.json')).models;
      const languages = readVoiceSelections(this.root, models);
      await this.before();
      try {
        writeJsonAtomic(file, { schemaVersion: 1, profileDir: candidate.profileDir });
        writeJsonAtomic(selectionFile, {
          schemaVersion: 1,
          languages: { ...languages, en: 'chatterbox-turbo' },
        });
        await this.ready();
      } catch (error) {
        if (previous) writeJsonAtomic(file, previous);
        else if (existsSync(file)) unlinkSync(file);
        if (previousSelections) writeJsonAtomic(selectionFile, previousSelections);
        else if (existsSync(selectionFile)) unlinkSync(selectionFile);
        throw error;
      }
      return this.publish({ phase: 'applied', stage: null, error: null });
    } finally {
      this.applying = false;
    }
  }
  cancel() {
    this.controller?.abort(new Error('Voice training cancelled'));
    return this.snapshot();
  }
  async close() {
    this.cancel();
    await this.task;
  }
}
