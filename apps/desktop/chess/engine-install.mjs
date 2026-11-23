// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fetchArtifact, fileHash } from '../../../packages/installer/src/download.mjs';
import { noLinks } from '../../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from '../../../packages/runtime/src/atomic-json.mjs';
import { Stockfish } from './uci.mjs';
import { chessFailure, silentChessTrace } from './diagnostics.mjs';

export const STOCKFISH_VERSION = '19';
const downloads = {
  x64: ['x86-64', 81431614, '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7'],
  arm64: ['arm64', 80190536, '8372ad3f0d7276deb2c70f801f541ec7db463219fc6d9c7592864e542aa4f401'],
};

export class ChessEngineInstall {
  constructor({ root, directory, progress = () => {}, trace = silentChessTrace }) {
    Object.assign(this, { root, directory: path.resolve(directory), progress, trace });
    this.file = path.join(this.directory, `stockfish-${STOCKFISH_VERSION}.exe`);
    this.receipt = this.file + '.json';
    this.state = { phase: 'idle', received: 0, total: 0 };
  }

  snapshot() {
    let installed = false;
    try {
      noLinks(this.file);
      noLinks(this.receipt);
      const record = JSON.parse(readFileSync(this.receipt, 'utf8'));
      installed =
        !this.repairNeeded &&
        record.version === STOCKFISH_VERSION &&
        record.arch === process.arch &&
        lstatSync(this.file).isFile();
    } catch {
      /* The user can install or repair the component. */
    }
    return {
      ...this.state,
      installed,
      version: STOCKFISH_VERSION,
      supported: process.platform === 'win32' && Boolean(downloads[process.arch]),
    };
  }

  async verifiedExecutable(signal) {
    if (!this.snapshot().installed) throw new Error('Install Stockfish first');
    const record = JSON.parse(readFileSync(this.receipt, 'utf8'));
    if ((await fileHash(this.file, signal)) !== record.sha256) {
      this.trace('analyse', { version: STOCKFISH_VERSION })('failed', { reason: 'invalid_engine' });
      this.repairNeeded = true;
      this.publish({ phase: 'idle', received: 0, total: 0 });
      throw new Error('Repair the Stockfish installation');
    }
    return this.file;
  }

  publish(state) {
    this.state = { ...this.state, ...state };
    this.progress(this.snapshot());
  }

  install() {
    const current = this.snapshot();
    if (!current.supported) throw new Error('Stockfish is unavailable on this platform');
    if (this.task) return this.task;
    const trace = this.trace('install', {
      version: STOCKFISH_VERSION,
      supported: current.supported,
    });
    if (current.installed) {
      trace('completed', { reason: 'already_installed', installed: true });
      return Promise.resolve(current);
    }
    const controller = new AbortController();
    this.controller = controller;
    this.task = this.download(controller.signal, trace)
      .then((value) => {
        trace(controller.signal.aborted ? 'cancelled' : 'completed', {
          installed: value.installed,
        });
        return value;
      })
      .catch((error) => {
        trace('failed', { phase: this.state.phase, ...chessFailure(error) });
        throw error;
      })
      .finally(() => {
        this.controller = null;
        this.task = null;
      });
    return this.task;
  }

  async download(signal, trace) {
    const [arch, bytes, sha256] = downloads[process.arch];
    const name = `stockfish-windows-${arch}-universal`;
    let stage, archive;
    try {
      noLinks(this.directory);
      noLinks(this.file);
      noLinks(this.receipt);
      mkdirSync(this.directory, { recursive: true });
      this.publish({ phase: 'downloading', received: 0, total: bytes });
      trace('progress', { phase: 'downloading', received: 0, total: bytes });
      let bucket = 0;
      archive = await fetchArtifact(
        {
          url: `https://github.com/official-stockfish/Stockfish/releases/download/sf_${STOCKFISH_VERSION}/${name}.zip`,
          bytes,
          sha256,
        },
        this.directory,
        {
          signal,
          progress: ({ received }) => {
            this.publish({ received });
            const next = Math.floor((received * 10) / bytes);
            if (next > bucket) {
              bucket = next;
              trace('progress', { phase: 'downloading', received, total: bytes });
            }
          },
        },
      );
      this.publish({ phase: 'checking' });
      trace('progress', { phase: 'checking', received: bytes, total: bytes });
      stage = mkdtempSync(path.join(this.directory, 'extract-'));
      await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(this.root, 'packages/installer/windows/archive.ps1'),
          '-Archive',
          archive,
          '-Destination',
          stage,
          '-MaximumBytes',
          '250000000',
        ],
        { signal, windowsHide: true, timeout: 60000 },
      );
      const binaries = [stage, path.join(stage, 'stockfish')].flatMap((dir) => {
        try {
          return readdirSync(dir)
            .filter((file) => file === `${name}.exe`)
            .map((file) => path.join(dir, file));
        } catch (error) {
          if (error.code === 'ENOENT') return [];
          throw error;
        }
      });
      if (binaries.length !== 1) throw new Error('Stockfish archive layout is unexpected');
      noLinks(binaries[0]);
      const hash = await fileHash(binaries[0], signal);
      const engine = new Stockfish(binaries[0]);
      try {
        await engine.init(signal);
      } finally {
        await engine.close();
      }
      signal.throwIfAborted();
      renameSync(binaries[0], this.file);
      writeJsonAtomic(this.receipt, {
        version: STOCKFISH_VERSION,
        arch: process.arch,
        sha256: hash,
      });
      this.repairNeeded = false;
      this.publish({ phase: 'ready' });
    } catch (error) {
      this.publish({ phase: signal.aborted ? 'idle' : 'failed' });
      if (!signal.aborted) throw error;
    } finally {
      // Only the exact mkdtemp child allocated above is disposable.
      if (
        stage &&
        path.dirname(stage) === this.directory &&
        /^extract-[A-Za-z0-9]{6}$/.test(path.basename(stage))
      ) {
        noLinks(stage);
        rmSync(stage, { recursive: true, force: true });
      }
      if (archive) unlinkSync(archive);
    }
    return this.snapshot();
  }

  cancel() {
    this.controller?.abort();
  }

  async remove() {
    const trace = this.trace('remove', {
      version: STOCKFISH_VERSION,
      installed: this.snapshot().installed,
    });
    try {
      this.cancel();
      await this.task?.catch(() => {});
      for (const file of [this.file, this.receipt]) {
        noLinks(file);
        try {
          unlinkSync(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      this.repairNeeded = false;
      this.publish({ phase: 'idle', received: 0, total: 0 });
      trace('completed', { installed: false });
      return this.snapshot();
    } catch (error) {
      trace('failed', chessFailure(error));
      throw error;
    }
  }
}
