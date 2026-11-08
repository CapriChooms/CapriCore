// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  appendFileSync,
  openSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Preferences } from './preferences.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import {
  managedInstallation,
  runtimeUpgradeRequired,
} from '../../packages/updater/src/transaction.mjs';
import { listReleases, githubCredential } from '../../packages/updater/src/github.mjs';
import { selectRelease, releaseAsset, parseVersion } from '../../packages/updater/src/releases.mjs';
import { downloadUpdate } from '../../packages/updater/src/download.mjs';
import { stageUpdate } from '../../packages/updater/src/stage.mjs';
import { fileHash } from '../../packages/installer/src/download.mjs';
import { prepareUpdateHost } from '../../packages/updater/src/launcher.mjs';

export function validateUpdateSettings(value) {
  if (
    !value ||
    typeof value.experimental !== 'boolean' ||
    Object.keys(value).some((key) => key !== 'experimental')
  )
    throw new Error('Invalid update settings');
  return { experimental: value.experimental };
}
/** Download work does not block inference. Only an explicit install request closes Capri. */
export class UpdateService {
  constructor({
    root,
    state,
    node,
    emit = () => {},
    credential = githubCredential,
    releases = listReleases,
    download = downloadUpdate,
    stage = stageUpdate,
    launch = spawn,
    prepareHost = prepareUpdateHost,
    startupTimeoutMs = 15000,
  }) {
    Object.assign(this, {
      root,
      node,
      emit,
      credential,
      releases,
      download,
      stage,
      launch,
      prepareHost,
      startupTimeoutMs,
    });
    this.preferences = new Preferences(
      path.join(state, 'updates.json'),
      { experimental: false },
      validateUpdateSettings,
    );
    const metadata = JSON.parse(readFileSync(path.join(root, 'config/release.json'), 'utf8'));
    parseVersion(metadata.tag);
    this.current = metadata.tag;
    this.mode = 'installer';
    try {
      managedInstallation(root);
      this.mode = 'managed';
    } catch {
      /* A source checkout is never overwritten by the updater. */
    }
    this.value = {
      phase: 'idle',
      current: this.current,
      mode: this.mode,
      experimental: this.preferences.value.experimental,
      notification: null,
    };
    this.selected = null;
    this.prepared = null;
    this.controller = null;
    this.handoff = false;
    this.startupController = null;
    this.startupOperation = null;
    this.startupAttempted = false;
    this.startupSuperseded = false;
    this.notificationDeferred = false;
    this.closed = false;
  }
  snapshot() {
    return structuredClone(this.value);
  }
  publish(patch) {
    Object.assign(this.value, patch);
    this.emit({ type: 'updates.status', ...this.snapshot() });
    return this.snapshot();
  }
  busy() {
    return (
      Boolean(this.installOperation) ||
      ['checking', 'downloading', 'verifying', 'installing'].includes(this.value.phase)
    );
  }
  cancelStartup() {
    this.startupSuperseded = true;
    this.startupController?.abort(new Error('Startup update check cancelled'));
  }
  async optionalCredential() {
    try {
      const token = await this.credential(this.root);
      return typeof token === 'string' && token && !/[\x00-\x20\x7f]/.test(token) ? token : null;
    } catch {
      // Public updates still work if a saved private-preview credential cannot be decrypted.
      // Leave encrypted storage intact so its owner can reconnect or remove it in Settings.
      return null;
    }
  }
  checkOnStartup() {
    if (this.startupAttempted) return this.startupOperation ?? Promise.resolve(this.snapshot());
    this.startupAttempted = true;
    if (this.closed || this.startupSuperseded || this.busy() || this.value.phase !== 'idle')
      return Promise.resolve(this.snapshot());
    const controller = new AbortController();
    this.startupController = controller;
    const experimental = this.preferences.value.experimental;
    let onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timer = setTimeout(
      () => controller.abort(new Error('Startup update check timed out')),
      this.startupTimeoutMs,
    );
    timer.unref?.();
    const probe = async () => {
      const token = await this.optionalCredential();
      controller.signal.throwIfAborted();
      const items = await this.releases({
        token,
        signal: controller.signal,
        allowAnonymousFallback: true,
      });
      controller.signal.throwIfAborted();
      const selected = selectRelease(items, {
        current: this.current,
        experimental,
        kind: this.mode === 'managed' ? 'source' : 'installer',
      });
      if (!selected) return this.snapshot();
      this.selected = selected;
      this.prepared = null;
      return this.publish({
        phase: 'available',
        release: this.describeRelease(selected),
        error: null,
        progress: null,
        installerRequired: false,
        installerReason: null,
        needsAccess: false,
        checkedExperimental: experimental,
        notification: this.notificationDeferred ? null : { tag: selected.tag_name },
      });
    };
    this.startupOperation = Promise.race([probe(), cancelled])
      .catch(() => this.snapshot())
      .finally(() => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        if (this.startupController === controller) this.startupController = null;
        this.startupOperation = null;
      });
    return this.startupOperation;
  }
  describeRelease(selected) {
    return {
      tag: selected.tag_name,
      experimental: Boolean(selected.prerelease || parseVersion(selected.tag_name).pre.length),
      bytes: releaseAsset(selected, this.mode === 'managed' ? 'source' : 'installer').bytes,
    };
  }
  remindLater() {
    this.notificationDeferred = true;
    this.cancelStartup();
    return this.publish({ notification: null });
  }
  setSettings(value) {
    this.cancelStartup();
    if (this.busy()) throw new Error('Wait for the update operation to finish.');
    const settings = this.preferences.set(value);
    if (settings.experimental === this.value.checkedExperimental) return this.publish(settings);
    this.selected = null;
    this.prepared = null;
    return this.publish({
      ...settings,
      phase: 'idle',
      release: null,
      progress: null,
      error: null,
      installerRequired: false,
      installerReason: null,
      checkedExperimental: undefined,
      notification: null,
    });
  }
  async check(value) {
    this.cancelStartup();
    const experimental =
      value === undefined
        ? this.preferences.value.experimental
        : validateUpdateSettings(value).experimental;
    if (this.busy()) return this.snapshot();
    this.controller = new AbortController();
    this.publish({
      phase: 'checking',
      error: null,
      release: null,
      progress: null,
      installerRequired: false,
      installerReason: null,
      needsAccess: false,
      checkedExperimental: experimental,
      notification: null,
    });
    this.prepared = null;
    this.selected = null;
    try {
      const token = await this.optionalCredential();
      this.controller.signal.throwIfAborted();
      const items = await this.releases({
        token,
        signal: this.controller.signal,
        allowAnonymousFallback: true,
      });
      this.controller.signal.throwIfAborted();
      this.selected = selectRelease(items, {
        current: this.current,
        experimental,
        kind: this.mode === 'managed' ? 'source' : 'installer',
      });
      return this.publish({
        phase: this.selected ? 'available' : 'current',
        release: this.selected ? this.describeRelease(this.selected) : null,
      });
    } catch (error) {
      return this.publish({
        phase: this.controller.signal.aborted ? 'idle' : 'error',
        error: this.controller.signal.aborted ? null : error.message,
        needsAccess: !this.controller.signal.aborted && error.code === 'GITHUB_ACCESS_REQUIRED',
      });
    } finally {
      this.controller = null;
    }
  }
  async prepare() {
    this.cancelStartup();
    if (this.busy()) return this.snapshot();
    if (!this.selected) throw new Error('Check for updates first.');
    this.controller = new AbortController();
    this.publish({
      phase: 'downloading',
      error: null,
      progress: null,
      installerRequired: false,
      installerReason: null,
      notification: null,
    });
    const asset = releaseAsset(this.selected, this.mode === 'managed' ? 'source' : 'installer');
    try {
      const token = await this.optionalCredential();
      this.controller.signal.throwIfAborted();
      let archive = await this.download(asset, path.join(this.root, '.runtime/updates/downloads'), {
        token,
        signal: this.controller.signal,
        progress: (progress) => this.publish({ phase: 'downloading', progress }),
      });
      this.controller.signal.throwIfAborted();
      this.publish({ phase: 'verifying' });
      if (this.mode === 'managed') {
        let source, installerReason;
        try {
          source = await this.stage({
            root: this.root,
            archive,
            asset,
            tag: this.selected.tag_name,
          });
        } catch (error) {
          this.controller.signal.throwIfAborted();
          // Unknown future layouts use a separately verified installer. Hash,
          // path and malformed-manifest failures never downgrade verification.
          if (error.code !== 'UPDATE_INSTALLER_REQUIRED') throw error;
          installerReason = 'compatibility';
        }
        this.controller.signal.throwIfAborted();
        if (installerReason || runtimeUpgradeRequired(this.root, source)) {
          installerReason ??= 'runtimes';
          const installer = releaseAsset(this.selected, 'installer');
          if (!installer)
            throw new Error(
              'This release requires its full installer, but no verified installer was published.',
            );
          this.publish({ phase: 'downloading', progress: null });
          archive = await this.download(
            installer,
            path.join(this.root, '.runtime/updates/downloads'),
            {
              token,
              signal: this.controller.signal,
              progress: (progress) => this.publish({ phase: 'downloading', progress }),
            },
          );
          this.controller.signal.throwIfAborted();
          const executable = path.join(path.dirname(archive), installer.sha256 + '.exe');
          noLinks(executable);
          copyFileSync(archive, executable);
          this.prepared = { executable, asset: installer, archive };
          this.publish({ installerReason });
        } else this.prepared = { source, tag: this.selected.tag_name, asset, archive };
      } else {
        const executable = path.join(path.dirname(archive), asset.sha256 + '.exe');
        noLinks(executable);
        copyFileSync(archive, executable);
        this.prepared = { executable, asset, archive };
      }
      return this.publish({
        phase: 'ready',
        progress: null,
        installerRequired: Boolean(this.prepared.executable),
      });
    } catch (error) {
      this.prepared = null;
      return this.publish({
        phase: this.controller.signal.aborted ? 'available' : 'error',
        error: this.controller.signal.aborted ? null : error.message,
        progress: null,
      });
    } finally {
      this.controller = null;
    }
  }
  cancel() {
    this.cancelStartup();
    this.controller?.abort(new Error('Update cancelled'));
    return this.snapshot();
  }
  async install({ parentPid, language, shutdown }) {
    this.cancelStartup();
    if (this.busy() || this.installOperation) return false;
    if (!this.prepared || this.value.phase !== 'ready')
      throw new Error('Download the update first.');
    this.installOperation = true;
    this.publish({ phase: 'installing', error: null });
    try {
      return await this.performInstall({ parentPid, language, shutdown });
    } catch (error) {
      this.publish({ phase: 'ready', error: error.message });
      throw error;
    } finally {
      this.installOperation = false;
      if (!this.handoff) this.publish({ phase: 'ready' });
    }
  }
  async performInstall({ parentPid, language, shutdown }) {
    const prepared = this.prepared;
    if ((await fileHash(prepared.archive)) !== prepared.asset.sha256)
      throw new Error('Update checksum verification failed. Download it again.');
    if (prepared.executable) {
      if ((await fileHash(prepared.executable)) !== prepared.asset.sha256)
        throw new Error('Installer checksum verification failed.');
      const child = this.launch(prepared.executable, [], {
        cwd: this.root,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      if (this.mode === 'managed') {
        await shutdown();
        this.handoff = true;
      }
      return true;
    }
    this.publish({ phase: 'installing', error: null });
    const parent = path.join(this.root, '.runtime/updates/jobs');
    noLinks(parent);
    mkdirSync(parent, { recursive: true });
    const job = mkdtempSync(path.join(parent, 'update-'));
    const file = path.join(job, 'request.json');
    const request = {
      schemaVersion: 1,
      root: this.root,
      source: prepared.source,
      tag: prepared.tag,
      parentPid,
      language,
      node: this.node,
      ready: path.join(job, 'ready'),
      events: path.join(job, 'events.jsonl'),
      proceed: path.join(job, 'proceed'),
      cancel: path.join(job, 'cancel'),
    };
    writeJsonAtomic(file, request);
    const logs = path.join(this.root, 'logs');
    noLinks(logs);
    mkdirSync(logs, { recursive: true });
    const output = path.join(logs, 'update-ui.stdout.log');
    const errors = path.join(logs, 'update-ui.stderr.log');
    noLinks(output);
    noLinks(errors);
    const record = (event) => {
      try {
        appendFileSync(
          output,
          JSON.stringify({ ...event, at: new Date().toISOString(), job: path.basename(job) }) +
            '\n',
        );
      } catch {
        console.error('Could not save update launch diagnostics.');
      }
    };
    let child;
    try {
      record({ phase: 'launching', tag: prepared.tag });
      const host = await this.prepareHost(this.root);
      const descriptors = [];
      try {
        descriptors.push(openSync(output, 'a'));
        descriptors.push(openSync(errors, 'a'));
        child = this.launch(
          host,
          [path.join(prepared.source, 'packages/updater/windows/update.ps1'), file, output, errors],
          // Detach the windowed host, never powershell.exe: PowerShell can silently
          // exit under DETACHED_PROCESS, or share Capri's console without it.
          { cwd: this.root, detached: true, windowsHide: true, stdio: ['ignore', ...descriptors] },
        );
      } finally {
        for (const descriptor of descriptors) closeSync(descriptor);
      }
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null || child.signalCode) break;
        if (existsSync(request.ready)) {
          ready = true;
          break;
        }
        await delay(200);
      }
      if (!ready) throw new Error('The update window could not start. Capri is still running.');
      record({ phase: 'window-ready', pid: child.pid });
      await shutdown();
      writeFileSync(request.proceed, 'approved');
      record({ phase: 'handoff-approved' });
      this.handoff = true;
      return true;
    } catch (error) {
      writeFileSync(request.cancel, 'cancelled');
      record({
        phase: 'failed',
        message: error.message,
        exitCode: child?.exitCode,
        signal: child?.signalCode,
      });
      this.publish({ phase: 'ready', error: error.message });
      throw error;
    }
  }
  close() {
    this.closed = true;
    this.cancelStartup();
    if (!this.handoff) this.cancel();
  }
}
