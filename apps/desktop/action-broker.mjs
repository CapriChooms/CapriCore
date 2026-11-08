// SPDX-License-Identifier: GPL-3.0-only
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, unlinkSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './storage.mjs';

/** Fixed local tools only. Endpoint credentials never enter model or renderer data. */
export class ActionBroker {
  constructor({ root, execute }) {
    Object.assign(this, { root, execute });
    this.token = randomBytes(32).toString('hex');
    this.recentCalls = [];
  }
  diagnostics() {
    return this.recentCalls.map((call) => ({ ...call }));
  }
  record(input, started, value, failed = false) {
    // Record the bounded command shape, never file names, text, tokens or results.
    const action = [
      'status',
      'set',
      'request',
      'apps',
      'launch',
      'inspect',
      'type_text',
      'open_url',
      'browser_input',
      'trash',
      'journal',
      'find_app',
      'launch_executable',
      'begin_control',
      'run_task',
      'end_control',
      'control_status',
      'observe',
      'press_keys',
      'move_pointer',
      'click',
      'scroll',
      'enter_text',
      'list',
      'find',
      'read_text',
      'write_text',
      'replace_text',
      'create_directory',
      'copy',
      'move',
      'undo',
      'calculate',
      'focus',
      'volume',
      'mute',
      'pause',
      'resume',
      'next',
      'previous',
      'play',
      'search',
      'seek',
      'shuffle',
      'repeat',
      'toggle',
      'liked_songs',
      'queue',
      'queue_add',
      'library',
    ].includes(input.args?.action)
      ? input.args.action
      : 'other';
    const setting =
      input.tool === 'settings_control'
        ? [
            'glitchEnabled',
            'glitchStrength',
            'screenObservation',
            'fullComputerAccess',
            'notepad',
            'calculator',
            'spotify',
            'languages',
            'models',
          ].includes(input.args?.setting)
          ? input.args.setting
          : 'other'
        : undefined;
    this.recentCalls.push({
      at: started,
      tool: input.tool,
      action,
      ...(setting ? { setting } : {}),
      ...([
        'DESKTOP_PERMISSION_REQUIRED',
        'missing_app_id',
        'unknown_app_id',
        'window_changed',
        'inspection_expired',
        'missing_control_id',
        'action_failed',
      ].includes(value?.error?.code)
        ? { errorCode: value.error.code }
        : {}),
      outcome: failed
        ? 'failed'
        : value?.needsApproval
          ? 'pending'
          : value?.ok === false
            ? 'rejected'
            : 'completed',
      elapsedMs: Date.now() - started,
    });
    if (this.recentCalls.length > 24) this.recentCalls.shift();
    if (failed || (value?.ok === false && !value.needsApproval))
      console.warn('Capri desktop action failed:', JSON.stringify(this.recentCalls.at(-1)));
  }
  async start() {
    this.file = path.join(this.root, 'data/secrets/desktop-actions.json');
    for (let cursor = this.file; cursor !== path.dirname(cursor); cursor = path.dirname(cursor))
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
        throw new Error('Action endpoint must not be linked.');
    mkdirSync(path.dirname(this.file), { recursive: true });
    this.server = createServer(async (req, res) => {
      const supplied = Buffer.from(req.headers.authorization ?? ''),
        expected = Buffer.from('Bearer ' + this.token);
      if (
        req.method !== 'POST' ||
        req.url !== '/action' ||
        req.headers.host !== '127.0.0.1:' + this.server.address().port ||
        req.headers.origin ||
        req.socket.remoteAddress !== '127.0.0.1' ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        res.writeHead(403).end();
        req.resume();
        return;
      }
      try {
        let text = '';
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 384 * 1024) throw new Error('Action request is too large.');
        }
        const input = JSON.parse(text);
        if (
          !input ||
          (![
            'time_control',
            'settings_control',
            'desktop_control',
            'filesystem_control',
            'spotify_control',
            'application_control',
            'workflow_control',
          ].includes(input.tool) &&
            !/^capri_tool_(0[1-9]|1\d|20)$/.test(input.tool)) ||
          Object.keys(input).some((key) => !['tool', 'id', 'args'].includes(key)) ||
          typeof input.id !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.id)
        )
          throw new Error('Invalid action request.');
        if (input.tool !== 'filesystem_control' && Buffer.byteLength(text) > 32768)
          throw new Error('Action request is too large.');
        const controller = new AbortController();
        const disconnected = () => {
          if (!res.writableEnded) controller.abort(new Error('The action caller disconnected.'));
        };
        res.once('close', disconnected);
        const started = Date.now();
        let value;
        try {
          value = await this.execute({ ...input, signal: controller.signal });
          this.record(input, started, value);
        } catch (error) {
          this.record(input, started, { error: { code: error.code } }, true);
          throw error;
        }
        controller.signal.throwIfAborted();
        res
          .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify(value));
      } catch (error) {
        if (!res.destroyed)
          res
            .writeHead(400, { 'content-type': 'application/json' })
            .end(JSON.stringify({ ok: false, error: String(error.message).slice(0, 400) }));
      }
    });
    this.server.requestTimeout = 15000;
    this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    writeJsonAtomic(this.file, {
      schemaVersion: 1,
      pid: process.pid,
      url: 'http://127.0.0.1:' + this.server.address().port,
      token: this.token,
    });
  }
  close() {
    this.server?.closeAllConnections();
    this.server?.close();
    if (this.file && existsSync(this.file)) unlinkSync(this.file);
  }
}

/** A model can propose, never approve. One bounded proposal belongs to one UI session. */
export class ActionApprovals {
  constructor({ emit, now = Date.now }) {
    Object.assign(this, { emit, now });
    this.pending = null;
    this.queue = [];
    this.executing = false;
  }
  propose({ title, detail, kind, execute, voice = true }) {
    if (this.pending && this.pending.expiresAt <= this.now()) this.cancel();
    const existing = [this.pending, ...this.queue].find(
      (p) => p && p.title === title && p.detail === detail && p.kind === kind && p.voice === voice,
    );
    if (existing) {
      const { execute: run, ...proposal } = existing;
      return {
        ok: false,
        needsApproval: true,
        queued: existing !== this.pending,
        proposal,
        instruction:
          'This exact action is already waiting for owner confirmation. This is a pending result, not a failed tool call. Do not submit it again, try another tool or claim success. End your reply and wait for the owner.',
      };
    }
    if (this.queue.length >= 8) throw new Error('Too many pending permission requests.');
    const proposal = {
      id: randomUUID(),
      title,
      detail,
      kind,
      expiresAt: this.now() + 90000,
      voice,
    };
    const queued = Boolean(this.pending || this.executing);
    if (queued) this.queue.push({ ...proposal, execute });
    else {
      this.pending = { ...proposal, execute };
      this.emit({ type: 'action.approval', proposal });
    }
    return {
      ok: false,
      needsApproval: true,
      queued,
      proposal,
      instruction:
        'This is a pending approval, not a failed tool call. Ask the owner briefly to confirm this exact action, then end your reply and wait. Do not repeat the request, try other tools, inspect files or invent a command. The desktop executes only after owner confirmation.' +
        (voice
          ? ' The owner can use the approval buttons or reply yes or confirm.'
          : ' The owner must use the approval buttons; chat text cannot approve this action.'),
    };
  }
  async respond(id, accepted, source = 'ui') {
    const pending = this.pending;
    if (!pending || pending.id !== id || pending.expiresAt <= this.now()) {
      if (pending?.id === id) this.cancel();
      throw new Error('That permission request has expired. Ask again.');
    }
    if (typeof accepted !== 'boolean' || (accepted && source === 'voice' && !pending.voice))
      throw new Error('Use the confirmation buttons for this action.');
    this.executing = true;
    this.pending = null;
    this.emit({ type: 'action.approval', proposal: null });
    try {
      return accepted ? await pending.execute() : { ok: true, cancelled: true };
    } finally {
      this.executing = false;
      if (!this.pending && this.queue.length) {
        this.pending = this.queue.shift();
        this.pending.expiresAt = this.now() + 90000;
        const { execute, ...proposal } = this.pending;
        this.emit({ type: 'action.approval', proposal });
      }
    }
  }
  async text(text) {
    if (!this.pending) return null;
    if (this.pending.expiresAt <= this.now()) {
      this.cancel();
      return null;
    }
    const normalized = text
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, '')
      .trim();
    if (['no', 'cancel', 'нет', 'отмена', 'не надо'].includes(normalized))
      return this.respond(this.pending.id, false, 'voice');
    if (
      [
        'yes',
        'yes please',
        'go ahead',
        'allow',
        'confirm',
        'approve',
        'да',
        'давай',
        'разрешаю',
        'подтверждаю',
        'подтвердить',
        'включи',
      ].includes(normalized)
    ) {
      if (!this.pending.voice)
        return {
          ok: false,
          confirmation: 'Use the on-screen confirmation buttons for this action.',
        };
      return this.respond(this.pending.id, true, 'voice');
    }
    this.cancel();
    return null;
  }
  cancel() {
    this.queue = [];
    if (this.pending) {
      this.pending = null;
      this.emit({ type: 'action.approval', proposal: null });
    }
  }
}
