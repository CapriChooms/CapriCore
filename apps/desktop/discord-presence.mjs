// SPDX-License-Identifier: GPL-3.0-only
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { COMMUNITY_LINKS } from './community-links.mjs';

export function discordSettings(value) {
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    typeof value.applicationId !== 'string' ||
    !/^(?:[0-9]{17,22})?$/.test(value.applicationId) ||
    typeof value.assetKey !== 'string' ||
    !/^[a-zA-Z0-9_-]{0,64}$/.test(value.assetKey) ||
    Object.keys(value).some((key) => !['enabled', 'applicationId', 'assetKey'].includes(key))
  )
    throw new Error('Invalid Discord presence settings.');
  return { enabled: value.enabled, applicationId: value.applicationId, assetKey: value.assetKey };
}

export function discordFrame(opcode, body) {
  const data = Buffer.from(JSON.stringify(body));
  if (data.length > 65536) throw new Error('Discord frame is too large.');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}

/** Local RPC only: no account token and no conversation-dependent activity. */
export class DiscordPresence {
  constructor({
    preferences,
    onChange = () => {},
    connect = net.createConnection,
    now = Date.now,
    platform = process.platform,
    retryMs = 30000,
    communityLinks = COMMUNITY_LINKS,
  }) {
    Object.assign(this, { preferences, onChange, connect, now, platform, retryMs, communityLinks });
    this.phase = 'off';
    this.epoch = 0;
    this.started = Math.floor(now() / 1000);
    this.socket = null;
    this.retry = null;
  }
  snapshot() {
    return { ...this.preferences.snapshot(), phase: this.phase };
  }
  publish(phase) {
    this.phase = phase;
    this.onChange(this.snapshot());
  }
  configure(value, { active = true } = {}) {
    this.preferences.set(discordSettings(value));
    if (active) this.start();
    return this.snapshot();
  }
  activity() {
    const config = this.preferences.snapshot();
    return {
      details: 'Hanging out with Capri',
      timestamps: { start: this.started },
      ...(config.assetKey ? { assets: { large_image: config.assetKey, large_text: 'Capri' } } : {}),
      buttons: [
        { label: 'Get Capri', url: this.communityLinks.github },
        { label: 'Join Her Discord', url: this.communityLinks.discord },
      ],
      instance: false,
    };
  }
  send(opcode, body) {
    if (this.socket && !this.socket.destroyed) this.socket.write(discordFrame(opcode, body));
  }
  start() {
    this.close();
    const config = this.preferences.snapshot();
    if (!config.enabled) {
      this.publish('off');
      return;
    }
    if (!config.applicationId) {
      this.publish('setup-required');
      return;
    }
    if (this.platform !== 'win32') {
      this.publish('unavailable');
      return;
    }
    this.publish('connecting');
    this.tryPipe(0, this.epoch);
  }
  tryPipe(index, epoch) {
    if (epoch !== this.epoch) return;
    const socket = this.connect({ path: '\\\\?\\pipe\\discord-ipc-' + index });
    this.socket = socket;
    let buffer = Buffer.alloc(0),
      ended = false,
      ready = false;
    const disconnected = () => {
      if (ended) return;
      ended = true;
      socket.destroy();
      if (epoch !== this.epoch) return;
      this.socket = null;
      if (!ready && index < 9) {
        this.tryPipe(index + 1, epoch);
        return;
      }
      this.publish('waiting');
      this.retry = setTimeout(() => {
        this.retry = null;
        this.start();
      }, this.retryMs);
      this.retry.unref?.();
    };
    socket.setTimeout(2000, disconnected);
    socket.on('error', disconnected);
    socket.on('close', disconnected);
    socket.on('connect', () => {
      if (epoch !== this.epoch) {
        socket.destroy();
        return;
      }
      this.send(0, { v: 1, client_id: this.preferences.snapshot().applicationId });
    });
    socket.on('data', (chunk) => {
      if (epoch !== this.epoch || ended) return;
      if (buffer.length + chunk.length > 65544) {
        disconnected();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      try {
        while (buffer.length >= 8) {
          const opcode = buffer.readUInt32LE(0),
            size = buffer.readUInt32LE(4);
          if (size > 65536 || opcode > 4) throw new Error('Invalid Discord frame');
          if (buffer.length < size + 8) break;
          const body = JSON.parse(buffer.subarray(8, size + 8).toString('utf8'));
          buffer = buffer.subarray(size + 8);
          if (opcode === 3) {
            this.send(4, body);
            continue;
          }
          if (opcode === 2 || body?.evt === 'ERROR') {
            disconnected();
            return;
          }
          if (opcode === 1 && body?.evt === 'READY' && !ready) {
            ready = true;
            socket.setTimeout(0);
            this.publish('connected');
            this.send(1, {
              cmd: 'SET_ACTIVITY',
              args: { pid: process.pid, activity: this.activity() },
              nonce: randomUUID(),
            });
          }
        }
      } catch {
        disconnected();
      }
    });
  }
  close() {
    ++this.epoch;
    clearTimeout(this.retry);
    this.retry = null;
    if (this.socket && !this.socket.destroyed) {
      if (this.phase === 'connected')
        this.send(1, {
          cmd: 'SET_ACTIVITY',
          args: { pid: process.pid, activity: null },
          nonce: randomUUID(),
        });
      this.socket.end();
      const socket = this.socket;
      const timeout = setTimeout(() => socket.destroy(), 1000);
      timeout.unref?.();
      socket.once('close', () => clearTimeout(timeout));
    }
    this.socket = null;
    this.phase = 'off';
  }
}
