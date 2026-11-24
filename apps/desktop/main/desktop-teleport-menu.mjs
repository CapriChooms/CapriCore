// SPDX-License-Identifier: GPL-3.0-only
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const key = 'HKCU\\Software\\Classes\\DesktopBackground\\shell\\Capri.Teleport';
const windowsRoot = () => process.env.SystemRoot || 'C:\\Windows';
const runRegistry = (args) =>
  spawnSync(path.win32.join(windowsRoot(), 'System32', 'reg.exe'), args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1000,
  });
const startHelper = (helper, token) =>
  spawn(helper, ['--watch', token], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });

// The helper is the Rust build in native/desktop-teleport (see
// scripts/build-desktop-teleport.mjs). The C#
// helper it replaces installed global mouse and keyboard hooks, so every mouse
// movement on the computer waited for it and the mouse froze whenever Capri was
// busy. The Rust helper polls button state instead and installs no input hook.
export const TELEPORT_HELPER = 'capri-teleport.exe';

export async function prepareDesktopTeleport(root) {
  const helper = path.join(root, '.runtime/desktop-teleport', TELEPORT_HELPER);
  // No fallback to the hooked C# helper: without the Rust build the menu is off.
  if (!existsSync(helper)) throw new Error('The desktop teleport helper is not installed.');
  return helper;
}

/** Registers the shell verb only while its native coordinate listener is ready. */
export class DesktopTeleportMenu {
  constructor(
    root,
    onTeleport,
    { run = runRegistry, prepare = prepareDesktopTeleport, start = startHelper } = {},
  ) {
    Object.assign(this, { root, onTeleport, run, prepare, start });
    this.owner = createHash('sha256')
      .update(path.win32.join(root, 'Capri.exe').toLowerCase())
      .digest('hex');
    this.watchSequence = 0;
  }

  async show(label) {
    this.label = label;
    if (this.session) {
      if (this.session.ready) this.register(this.session);
      return;
    }
    const session = { token: randomBytes(16).toString('hex') };
    this.session = session;
    const lost = () => {
      if (this.session === session) this.hide();
    };
    try {
      session.helper = await this.prepare(this.root);
      if (this.session !== session) return;
      session.process = this.start(session.helper, session.token);
      session.process.once('error', lost);
      session.process.once('close', lost);
      session.process.stdin.on('error', lost);
      session.lines = createInterface({ input: session.process.stdout });
      session.lines.on('line', (line) => {
        if (this.session !== session) return;
        if (!session.ready) {
          if (line !== 'ready') return;
          clearTimeout(session.timeout);
          session.ready = true;
          this.register(session);
          this.sendReleaseWatch();
          this.sendWindowWatch();
          return;
        }
        const match = /^(-?\d{1,10}) (-?\d{1,10})$/.exec(line);
        if (match && session.registeredLabel)
          this.onTeleport({ x: Number(match[1]), y: Number(match[2]) });
        const release = /^release (\d+) (-?\d{1,10}) (-?\d{1,10})$/.exec(line);
        const watch = this.releaseWatch;
        if (release && watch?.id === Number(release[1]))
          watch.callback({ x: Number(release[2]), y: Number(release[3]) });
        const position =
          /^anchor (\d+) (hidden|closed|unavailable|visible)(?: (-?\d{1,10}) (-?\d{1,10}) (\d{1,10}) (\d{1,10}))?$/.exec(
            line,
          );
        const anchor = this.windowWatch;
        if (position && anchor?.id === Number(position[1])) {
          const [, , state, x, y, width, height] = position;
          if (state !== 'visible') anchor.callback({ state });
          else if (Number(width) > 0 && Number(height) > 0)
            anchor.callback({
              state,
              x: Number(x),
              y: Number(y),
              width: Number(width),
              height: Number(height),
            });
        }
      });
      session.timeout = setTimeout(lost, 4000);
      session.timeout.unref();
    } catch {
      lost();
    }
  }

  watchRelease(handle, callback) {
    const windowHandle =
      handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
    const watch = { id: ++this.watchSequence, windowHandle, callback };
    this.releaseWatch = watch;
    this.sendReleaseWatch();
    return () => {
      if (this.releaseWatch !== watch) return;
      this.releaseWatch = undefined;
      this.sendReleaseWatch();
    };
  }

  sendReleaseWatch() {
    if (!this.session?.ready) return;
    const watch = this.releaseWatch;
    this.session.process.stdin.write(watch ? `${watch.windowHandle} ${watch.id}\n` : '0 0\n');
  }

  watchWindow(record, callback) {
    if (
      !/^\d{1,20}$/.test(record?.windowId) ||
      !/^\d{1,10}$/.test(record.processId) ||
      !/^\d{1,20}$/.test(record.startedAtTicks)
    )
      return () => {};
    const watch = { id: ++this.watchSequence, record, callback };
    this.windowWatch = watch;
    this.sendWindowWatch();
    return () => {
      if (this.windowWatch !== watch) return;
      this.windowWatch = undefined;
      this.sendWindowWatch();
    };
  }

  sendWindowWatch() {
    if (!this.session?.ready) return;
    const watch = this.windowWatch;
    this.session.process.stdin.write(
      watch
        ? `follow ${watch.id} ${watch.record.windowId} ${watch.record.processId} ${watch.record.startedAtTicks}\n`
        : 'follow 0 0 0 0\n',
    );
  }

  register(session) {
    if (session.registeredLabel === this.label) return;
    const add = (target, name, value) =>
      this.run(['add', target, ...name, '/t', 'REG_SZ', '/d', value, '/f']).status === 0;
    if (
      add(key, ['/v', 'CapriOwner'], this.owner) &&
      add(key, ['/v', 'CapriRoot'], this.root) &&
      add(key + '\\command', ['/ve'], `"${session.helper}" --teleport ${session.token}`) &&
      add(key, ['/ve'], this.label)
    )
      session.registeredLabel = this.label;
  }

  hide() {
    const session = this.session;
    this.session = undefined;
    if (session) {
      clearTimeout(session.timeout);
      session.lines?.close();
      session.process?.stdin.end();
    }
    const current = this.run(['query', key, '/v', 'CapriOwner']);
    const value = current.stdout?.match(/\bREG_SZ[ \t]+([a-f0-9]{64})\b/)?.[1];
    if (current.status === 0 && value === this.owner) this.run(['delete', key, '/f']);
  }
}
