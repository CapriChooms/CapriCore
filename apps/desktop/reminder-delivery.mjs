// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './storage.mjs';

/** Persist speech separately from the clock outbox: a toast is not spoken delivery. */
export class ReminderDelivery {
  constructor({
    file,
    visual,
    ready,
    prepare,
    speak,
    cancelSpeech = () => {},
    notify = () => {},
    now = Date.now,
  }) {
    Object.assign(this, { file, visual, ready, prepare, speak, cancelSpeech, notify, now });
    this.items = [];
    this.closed = false;
    const load = (location) => {
      const bytes = readFileSync(location);
      if (bytes.length > 4 * 1024 * 1024) throw new Error('Delivery state too large');
      const saved = JSON.parse(bytes.toString('utf8'));
      if (
        saved.schemaVersion !== 1 ||
        !Array.isArray(saved.items) ||
        saved.items.length > 1200 ||
        !saved.items.every(
          (i) =>
            i &&
            typeof i.key === 'string' &&
            i.object &&
            typeof i.object.id === 'string' &&
            typeof i.object.title === 'string' &&
            typeof i.state === 'string',
        )
      )
        throw new Error('Invalid reminder delivery state');
      return saved.items.map((item) => ({
        ...item,
        state: ['preparing', 'speaking'].includes(item.state) ? 'pending' : item.state,
      }));
    };
    if (existsSync(file)) {
      try {
        this.items = load(file);
      } catch {
        this.warning = 'Reminder speech state could not be restored. Existing data was preserved.';
        this.file = file + '.recovered';
        if (existsSync(this.file)) {
          try {
            this.items = load(this.file);
          } catch {
            this.file += '-' + Date.now();
          }
        }
      }
    }
  }
  save() {
    const terminal = (i) => ['spoken', 'silent', 'cancelled'].includes(i.state);
    const finished = this.items.filter(terminal).slice(-100);
    this.items = [...this.items.filter((i) => !terminal(i)), ...finished];
    writeJsonAtomic(this.file, { schemaVersion: 1, items: this.items });
  }
  async enqueue(object) {
    const key = object.id + ':' + object.dueAt;
    if (this.items.some((item) => item.key === key)) return;
    if (
      this.items.filter((i) => !['spoken', 'silent', 'cancelled'].includes(i.state)).length >= 1000
    )
      throw new Error('Too many pending reminders');
    const item = {
      key,
      object: { id: object.id, kind: object.kind, title: object.title, dueAt: object.dueAt },
      state: 'pending',
      attempts: 0,
      nextAt: this.now(),
    };
    this.items.push(item);
    this.save();
    await this.visual(item.object);
    item.visualDelivered = true;
    this.save();
    void this.pump();
  }
  start() {
    if (!this.timer) {
      this.timer = setInterval(() => void this.pump(), 2000);
      this.timer.unref?.();
    }
  }
  snapshot() {
    return this.items.map(({ key, state, attempts, error, object }) => ({
      key,
      state,
      attempts,
      error,
      id: object.id,
    }));
  }
  retry(id) {
    const item = this.items.findLast((i) => i.object.id === id);
    if (!item || !['failed', 'silent', 'spoken'].includes(item.state)) return false;
    item.state = 'pending';
    item.attempts = 0;
    item.nextAt = this.now();
    delete item.error;
    this.save();
    void this.pump();
    return true;
  }
  async pump() {
    if (this.closed || this.active) return;
    const item = this.items.find((i) => i.state === 'pending' && i.nextAt <= this.now());
    if (!item) return;
    const gate = this.ready();
    if (gate === 'busy' || gate === 'locked') return;
    if (gate === 'silent') {
      item.state = 'silent';
      this.save();
      this.notify(item);
      return;
    }
    this.active = item;
    try {
      if (!item.visualDelivered) {
        await this.visual(item.object);
        item.visualDelivered = true;
      }
      item.state = 'preparing';
      item.attempts++;
      this.save();
      this.notify(item);
      await this.prepare();
      if (this.closed || item.state === 'cancelled') return;
      const currentGate = this.ready();
      if (currentGate !== 'ready') {
        item.state = currentGate === 'silent' ? 'silent' : 'pending';
        item.nextAt = this.now() + 2000;
        this.save();
        return;
      }
      item.state = 'speaking';
      this.save();
      this.notify(item);
      await this.speak(item.object);
      if (this.closed || item.state === 'cancelled') return;
      item.state = 'spoken';
      delete item.error;
      this.save();
      this.notify(item);
    } catch (error) {
      if (this.closed || item.state === 'cancelled') return;
      item.error = String(error.message).slice(0, 300);
      item.state = item.attempts >= 2 ? 'failed' : 'pending';
      item.nextAt = this.now() + 15000;
      this.save();
      this.notify(item);
    } finally {
      this.active = null;
    }
  }
  cancel(id) {
    for (const item of this.items)
      if (item.object.id === id) {
        item.state = 'cancelled';
        if (item === this.active) this.cancelSpeech();
      }
    this.save();
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    if (this.active) this.cancelSpeech();
  }
}
