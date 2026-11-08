// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { runCommand } from '../../packages/installer/src/commands.mjs';
import {
  readSpotifyConfig,
  spotifyAccess,
  spotifyBridgeReady,
  saveSpotifyAccess,
} from '../../integrations/spotify/configuration.mjs';
export class SpotifySettings {
  constructor({ root, rt, agentId, node, readStatus, emit = () => {}, execute = runCommand }) {
    Object.assign(this, { root, rt, agentId, node, readStatus, emit, execute });
    this.phase = 'idle';
    this.error = null;
    this.controller = null;
    this.connection = null;
  }
  snapshot() {
    let enabled = false;
    try {
      enabled = spotifyAccess(readSpotifyConfig(this.rt.configPath), this.root, this.agentId);
    } catch {
      /* Not configured yet. */
    }
    return {
      enabled,
      prepared: spotifyBridgeReady(this.root),
      phase: this.phase,
      error: this.error,
      connection: this.connection,
    };
  }
  publish() {
    const value = this.snapshot();
    this.emit({ type: 'spotify.settings', settings: value });
    return value;
  }
  busy() {
    return Boolean(this.controller);
  }
  async setEnabled(enabled, { beforeCommit, restart }) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid Spotify permission.');
    if (this.busy()) throw new Error('Wait for Spotify setup to finish.');
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.phase = enabled ? 'preparing' : 'applying';
    this.error = null;
    this.connection = null;
    this.publish();
    let change;
    try {
      if (enabled && !spotifyBridgeReady(this.root)) {
        await this.execute(
          this.node,
          [path.join(this.root, 'integrations/spotify/provision.mjs')],
          {
            cwd: this.root,
            env: {
              ...Object.fromEntries(
                Object.entries(process.env).filter(([key]) =>
                  /^(SystemRoot|WINDIR|PATH|APPDATA|LOCALAPPDATA|USERPROFILE|TEMP|TMP)$/i.test(key),
                ),
              ),
              CAPRI_NODE_PATH: this.node,
            },
            windowsHide: true,
            signal,
            timeoutMs: 120000,
          },
        );
        if (!spotifyBridgeReady(this.root)) throw new Error('Spotify setup could not be verified.');
      }
      signal.throwIfAborted();
      this.phase = 'applying';
      this.publish();
      await beforeCommit();
      signal.throwIfAborted();
      change = saveSpotifyAccess({ root: this.root, rt: this.rt, agentId: this.agentId, enabled });
      await restart();
      this.phase = 'idle';
      return this.publish();
    } catch (error) {
      change?.restore();
      this.phase = 'error';
      this.error = error.message;
      this.publish();
      throw error;
    } finally {
      this.controller = null;
    }
  }
  async check() {
    if (this.busy()) return this.snapshot();
    const settings = this.snapshot();
    if (!settings.enabled || !settings.prepared) throw new Error('Enable Spotify control first.');
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(35000)]);
    let abortCheck;
    this.phase = 'checking';
    this.error = null;
    this.connection = null;
    this.publish();
    try {
      const aborted = new Promise((_, reject) => {
        abortCheck = () => reject(signal.reason);
        signal.addEventListener('abort', abortCheck, { once: true });
      });
      signal.throwIfAborted();
      const result = await Promise.race([
        aborted,
        Promise.resolve().then(() => this.readStatus(signal)),
      ]);
      signal.throwIfAborted();
      if (!result?.ok || typeof result.data?.running !== 'boolean')
        throw new Error(
          'Spotify connection could not be verified. Open Spotify and sign in, then check again.',
        );
      this.connection = result.data.running ? 'connected' : 'not-running';
      this.phase = 'idle';
      return this.publish();
    } catch (error) {
      this.phase = 'error';
      this.error = error.message;
      this.publish();
      throw error;
    } finally {
      if (abortCheck) signal.removeEventListener('abort', abortCheck);
      this.controller = null;
    }
  }
  close() {
    this.controller?.abort(new Error('Spotify setup cancelled'));
  }
}
