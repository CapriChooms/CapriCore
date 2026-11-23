// SPDX-License-Identifier: GPL-3.0-only
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { Temporal } from '@js-temporal/polyfill';

export const TIME_ACTIONS = [
  'clock',
  'list',
  'remind',
  'timer',
  'stopwatch',
  'status',
  'pause',
  'resume',
  'reset',
  'cancel',
  'snooze',
];
export const TIME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: TIME_ACTIONS },
    id: {
      type: 'string',
      description:
        'Existing object ID from list/status; omit only if exactly one matching object exists.',
    },
    title: { type: 'string', maxLength: 1000 },
    seconds: {
      type: 'number',
      description: 'Duration in seconds for remind/timer/snooze. Runtime calculates the deadline.',
    },
    at: {
      type: 'string',
      description:
        'For an absolute reminder: ISO date/time with offset, or local YYYY-MM-DDTHH:mm. Call clock if the current date is unknown. Do not guess vague morning/evening times.',
    },
  },
};
const duration = (value) => {
  if (
    !Number.isFinite(value) ||
    value < 1 ||
    value > 366 * 86400 ||
    value * 1000 !== Math.round(value * 1000)
  )
    throw new Error('Choose a duration between one second and one year.');
  return value * 1000;
};
export function reminderInstant(value, timeZone) {
  if (typeof value !== 'string' || value.length > 80)
    throw new Error('Choose an exact reminder date and time.');
  try {
    return /(?:Z|[+-]\d\d:\d\d)$/.test(value)
      ? Temporal.Instant.from(value).epochMilliseconds
      : Temporal.PlainDateTime.from(value).toZonedDateTime(timeZone, { disambiguation: 'reject' })
          .epochMilliseconds;
  } catch {
    throw new Error(
      'The reminder time is invalid or ambiguous in your time zone. Please choose an exact time.',
    );
  }
}
/** One writer, durable operations and an outbox. Model unloading never owns this service. */
export class TimeService {
  constructor({
    file,
    now = Date.now,
    monotonic = () => performance.now(),
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    deliver = async () => {},
    schedule = async () => {},
    changed = () => {},
  }) {
    Object.assign(this, { now, monotonic, timeZone, deliver, schedule, changed });
    for (
      let cursor = path.resolve(file);
      cursor !== path.dirname(cursor);
      cursor = path.dirname(cursor)
    )
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
        throw new Error('Time storage must not be linked.');
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1500; CREATE TABLE IF NOT EXISTS clocks(id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, state TEXT NOT NULL, due REAL, elapsed REAL NOT NULL DEFAULT 0, started REAL, relative INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS time_calls(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL); CREATE TABLE IF NOT EXISTS time_outbox(id TEXT PRIMARY KEY, object_id TEXT NOT NULL, due REAL NOT NULL, state TEXT NOT NULL);',
    );
    this.running = new Map();
    const wall = now(),
      tick = monotonic();
    for (const row of this.db.prepare("SELECT * FROM clocks WHERE state='running'").all())
      this.running.set(row.id, {
        tick,
        elapsed: row.elapsed + Math.max(0, wall - row.started),
        remaining: row.due === null ? null : Math.max(0, row.due - wall),
      });
  }
  snapshot() {
    const wall = this.now(),
      tick = this.monotonic();
    return this.db
      .prepare(
        "SELECT * FROM clocks ORDER BY CASE WHEN state IN ('running','paused') THEN 0 WHEN state='due' THEN 1 ELSE 2 END, created DESC LIMIT 2000",
      )
      .all()
      .map((row) => {
        const run = this.running.get(row.id);
        const delta = run ? Math.max(0, tick - run.tick) : 0;
        const elapsedMs = run ? run.elapsed + delta : row.elapsed;
        const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
        return {
          id: row.id,
          kind: row.kind,
          title: row.title,
          state: row.state,
          createdAt: row.created,
          dueAt: row.due,
          elapsedMs,
          elapsedSeconds,
          displayElapsed: [
            Math.floor(elapsedSeconds / 3600),
            Math.floor(elapsedSeconds / 60) % 60,
            elapsedSeconds % 60,
          ]
            .map((n) => String(n).padStart(2, '0'))
            .join(':'),
          sampledAt: wall,
          clockRevision: row.updated,
          remainingMs:
            row.state === 'running' && row.due !== null
              ? Math.max(0, row.relative && run ? run.remaining - delta : row.due - wall)
              : row.state === 'paused' && row.due !== null
                ? row.due
                : null,
        };
      });
  }
  select(id) {
    const rows = this.snapshot().filter(
      (row) => !['cancelled', 'acknowledged'].includes(row.state) && (!id || row.id === id),
    );
    if (rows.length !== 1)
      throw new Error(
        rows.length
          ? 'There are several timers or reminders. Choose one by ID or name.'
          : 'No matching timer, reminder or stopwatch is active.',
      );
    return rows[0];
  }
  async execute(callId, args) {
    if (this.closed) throw new Error('The time service is closed.');
    if (
      typeof callId !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(callId) ||
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      !TIME_ACTIONS.includes(args.action) ||
      Object.keys(args).some((key) => !Object.hasOwn(TIME_SCHEMA.properties, key))
    )
      throw new Error('Invalid time command.');
    if (args.id !== undefined && (typeof args.id !== 'string' || !/^[a-f0-9-]{36}$/.test(args.id)))
      throw new Error('Invalid timer ID.');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))),
        ),
      )
      .digest('hex');
    const prior = ['clock', 'list', 'status'].includes(args.action)
      ? null
      : this.db.prepare('SELECT * FROM time_calls WHERE id=?').get(callId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error('An operation ID cannot change its command.');
      return JSON.parse(prior.result);
    }
    if (args.action === 'clock')
      return {
        now: new Date(this.now()).toISOString(),
        local: new Intl.DateTimeFormat('sv-SE', {
          dateStyle: 'short',
          timeStyle: 'medium',
          timeZone: this.timeZone,
        }).format(this.now()),
        timeZone: this.timeZone,
      };
    if (args.action === 'list') return { objects: this.snapshot() };
    if (args.action === 'status')
      return args.id
        ? this.select(args.id)
        : {
            objects: this.snapshot().filter((row) =>
              ['running', 'paused', 'due'].includes(row.state),
            ),
          };
    if (this.db.prepare('SELECT count(*) AS n FROM time_calls').get().n >= 10000)
      throw new Error('The time operation journal is full.');
    const wall = this.now(),
      tick = this.monotonic();
    let id, nextRun, result;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (['remind', 'timer', 'stopwatch'].includes(args.action)) {
        if (
          this.snapshot().filter((row) => row.state === 'running' || row.state === 'paused')
            .length >= 1000
        )
          throw new Error('Too many active reminders.');
        if (args.id !== undefined) throw new Error('A new timer receives its own ID.');
        const title = args.title ?? '';
        if (
          typeof title !== 'string' ||
          title.length > 1000 ||
          /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(title)
        )
          throw new Error('Invalid reminder text.');
        if (args.action === 'remind' && !title.trim())
          throw new Error('What should Capri remind you about?');
        if (args.action === 'stopwatch' && (args.at !== undefined || args.seconds !== undefined))
          throw new Error('A stopwatch does not have a deadline.');
        if (args.at !== undefined && (args.action !== 'remind' || args.seconds !== undefined))
          throw new Error('Choose either a duration or an exact reminder time.');
        if (
          args.action === 'stopwatch' &&
          this.snapshot().some(
            (row) =>
              row.kind === 'stopwatch' && row.state === 'running' && row.title === title.trim(),
          )
        )
          throw new Error(
            'That stopwatch is already running. Ask its status, pause or cancel it before restarting.',
          );
        const due =
          args.action === 'stopwatch'
            ? null
            : args.at !== undefined
              ? reminderInstant(args.at, this.timeZone)
              : wall + duration(args.seconds);
        if (due !== null && (due <= wall || due - wall > 366 * 86400000))
          throw new Error('Choose a future reminder time within one year.');
        id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO clocks(id,kind,title,created,updated,state,due,started,relative) VALUES(?,?,?,?,?,'running',?,?,?)",
          )
          .run(
            id,
            args.action === 'remind' ? 'reminder' : args.action,
            title.trim(),
            wall,
            wall,
            due,
            wall,
            args.at === undefined ? 1 : 0,
          );
        nextRun = { tick, elapsed: 0, remaining: due === null ? null : due - wall };
      } else {
        if (
          args.at !== undefined ||
          args.title !== undefined ||
          (args.seconds !== undefined && args.action !== 'snooze')
        )
          throw new Error('Unexpected time command arguments.');
        const object = this.select(args.id);
        id = object.id;
        if (args.action === 'pause') {
          if (object.state !== 'running' || object.kind === 'reminder')
            throw new Error('Only a running timer or stopwatch can be paused.');
          this.db
            .prepare(
              "UPDATE clocks SET state='paused',elapsed=?,due=?,started=NULL,updated=? WHERE id=?",
            )
            .run(object.elapsedMs, object.remainingMs, wall, id);
        } else if (args.action === 'resume') {
          if (object.state !== 'paused') throw new Error('This object is not paused.');
          const remaining = object.remainingMs;
          this.db
            .prepare("UPDATE clocks SET state='running',due=?,started=?,updated=? WHERE id=?")
            .run(remaining === null ? null : wall + remaining, wall, wall, id);
          nextRun = { tick, elapsed: object.elapsedMs, remaining };
        } else if (args.action === 'reset') {
          if (object.kind !== 'stopwatch' || !['running', 'paused'].includes(object.state))
            throw new Error('Only an active stopwatch can be reset.');
          this.db
            .prepare('UPDATE clocks SET elapsed=0,started=?,updated=? WHERE id=?')
            .run(object.state === 'running' ? wall : null, wall, id);
          if (object.state === 'running') nextRun = { tick, elapsed: 0, remaining: null };
        } else if (args.action === 'cancel') {
          this.db
            .prepare(
              "UPDATE clocks SET state='cancelled',elapsed=?,started=NULL,updated=? WHERE id=?",
            )
            .run(object.elapsedMs, wall, id);
          this.db
            .prepare(
              "UPDATE time_outbox SET state='cancelled' WHERE object_id=? AND state='pending'",
            )
            .run(id);
        } else if (args.action === 'snooze') {
          if (object.kind === 'stopwatch') throw new Error('A stopwatch cannot be snoozed.');
          const remaining = duration(args.seconds ?? 300);
          this.db
            .prepare(
              "UPDATE clocks SET state='running',relative=1,due=?,elapsed=0,started=?,updated=? WHERE id=?",
            )
            .run(wall + remaining, wall, wall, id);
          this.db
            .prepare(
              "UPDATE time_outbox SET state='cancelled' WHERE object_id=? AND state='pending'",
            )
            .run(id);
          nextRun = { tick, elapsed: 0, remaining };
        }
      }
      result = { ok: true, action: args.action, id };
      this.db
        .prepare('INSERT INTO time_calls VALUES(?,?,?)')
        .run(callId, fingerprint, JSON.stringify(result));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.running.delete(id);
    if (nextRun) this.running.set(id, nextRun);
    result.object = this.snapshot().find((row) => row.id === id);
    this.db
      .prepare('UPDATE time_calls SET result=? WHERE id=?')
      .run(JSON.stringify(result), callId);
    this.changed(this.snapshot());
    try {
      await this.schedule(result.object);
    } catch {
      result.notificationWarning =
        'System scheduling is unavailable. Keep Capri running for notifications.';
    }
    return result;
  }
  async tick() {
    if (this.ticking || this.closed || this.suspended) return;
    this.ticking = true;
    try {
      let changed = false;
      for (const row of this.snapshot().filter(
        (item) => item.state === 'running' && item.remainingMs !== null && item.remainingMs <= 0,
      )) {
        changed = true;
        const deliveryId = createHash('sha256')
          .update(row.id + ':' + row.dueAt)
          .digest('hex');
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db
            .prepare(
              "UPDATE clocks SET state='due',elapsed=?,started=NULL,updated=? WHERE id=? AND state='running'",
            )
            .run(row.elapsedMs, this.now(), row.id);
          this.db
            .prepare("INSERT OR IGNORE INTO time_outbox VALUES(?,?,?,'pending')")
            .run(deliveryId, row.id, row.dueAt);
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
        this.running.delete(row.id);
      }
      for (const event of this.db
        .prepare("SELECT * FROM time_outbox WHERE state='pending' ORDER BY due LIMIT 20")
        .all()) {
        if (this.closed) break;
        const object = this.snapshot().find((row) => row.id === event.object_id);
        if (!object || object.state !== 'due') continue;
        await this.deliver({
          ...object,
          deliveryId: event.id,
          overdueMs: Math.max(0, this.now() - event.due),
        });
        if (!this.closed)
          this.db.prepare("UPDATE time_outbox SET state='notified' WHERE id=?").run(event.id);
      }
      if (!this.closed && changed) this.changed(this.snapshot());
    } finally {
      this.ticking = false;
    }
  }
  start() {
    this.suspended = false;
    if (!this.interval) {
      this.interval = setInterval(() => this.tick().catch(() => {}), 500);
      this.interval.unref?.();
    }
  }
  suspend() {
    this.suspended = true;
    clearInterval(this.interval);
    this.interval = null;
  }
  close() {
    if (this.closed) return;
    this.suspend();
    for (const row of this.snapshot().filter((item) => item.state === 'running'))
      this.db
        .prepare('UPDATE clocks SET elapsed=?,started=?,due=?,updated=? WHERE id=?')
        .run(
          row.elapsedMs,
          this.now(),
          row.remainingMs === null ? null : this.now() + row.remainingMs,
          this.now(),
          row.id,
        );
    this.closed = true;
    this.db.close();
  }
}
