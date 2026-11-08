// SPDX-License-Identifier: GPL-3.0-only
/** Resting artwork does not claim that an offline service has unloaded its models. */
export function visuallySleeping(powerPhase, connectionPhase) {
  if (['notifying', 'voice-awake'].includes(powerPhase)) return false;
  return (
    ['sleeping', 'asleep'].includes(powerPhase) || ['offline', 'stopping'].includes(connectionPhase)
  );
}

export function avatarTapsSleeping(powerPhase, connectionPhase) {
  return (
    visuallySleeping(powerPhase, connectionPhase) ||
    powerPhase === 'waking' ||
    ['sleeping', 'asleep'].includes(connectionPhase)
  );
}
/** Explicit local commands only: quoted/discussed phrases are never power commands. */
export function isSleepCommand(text) {
  if (typeof text !== 'string') return false;
  const value = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[\s,!.?]+|[\s,!.?]+$/g, '')
    .replace(/^(?:(?:hey|эй)\s*[,!]?[\s]*)?(?:capri|капри)\s*[,!:.-]?\s*/u, '')
    .replace(/^(?:please|пожалуйста)[, ]+|[, ]+(?:please|пожалуйста)$/g, '')
    .replace(/\s+/g, ' ');
  return /^(?:sleep|go to sleep|you can (?:go to )?sleep|(?:it'?s |it is )?time to (?:go to )?sleep|take a nap|get some rest|иди спать|иди поспи|ложись спать|(?:тебе )?пора спать|можешь (?:идти спать|поспать|отдохнуть)|отдыхай)$/u.test(
    value,
  );
}

/** Serializes unload/reload: concurrent requests cannot start a second set of models. */
export class SleepService {
  constructor({ unload, reload, onChange = () => {} }) {
    Object.assign(this, { unload, reload, onChange });
    this.phase = 'awake';
    this.pending = null;
    this.closed = false;
  }
  set(phase) {
    this.phase = phase;
    if (!this.closed) this.onChange({ phase });
  }
  async sleep() {
    if (this.closed) throw new Error('Capri is shutting down');
    if (this.phase === 'asleep') return;
    if (this.phase === 'sleeping') return this.pending;
    if (['waking', 'notifying'].includes(this.phase)) {
      await this.pending;
      return this.sleep();
    }
    this.set('sleeping');
    this.pending = (async () => {
      try {
        await this.unload();
        this.set('asleep');
      } catch (error) {
        this.set('awake');
        throw error;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
  async wake() {
    if (this.closed) throw new Error('Capri is shutting down');
    if (this.phase === 'awake') return;
    if (this.phase === 'waking') return this.pending;
    if (this.phase === 'notifying') {
      await this.pending;
      return this.wake();
    }
    if (this.phase === 'sleeping') {
      await this.pending;
      return this.wake();
    }
    this.set('waking');
    this.pending = (async () => {
      try {
        await this.reload();
        this.set('awake');
      } catch (error) {
        this.set('asleep');
        throw error;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
  close() {
    this.closed = true;
  }
  async wakeForReminder(prepare) {
    if (this.closed) throw new Error('Capri is shutting down');
    if (['sleeping', 'waking', 'notifying'].includes(this.phase)) {
      await this.pending;
      return this.wakeForReminder(prepare);
    }
    if (['awake', 'voice-awake'].includes(this.phase)) return prepare();
    this.set('notifying');
    this.pending = (async () => {
      try {
        await prepare();
        this.set('voice-awake');
      } catch (error) {
        this.set('asleep');
        throw error;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
}

/** The first Z is the low bit: 000, 100, 010, 110, 001, 101, 011, 111. */
export function sleepCaption(elapsedMs) {
  const tick = Math.floor(Math.max(0, elapsedMs) / 500);
  const mask = Math.floor(tick / 3) % 8;
  return (
    [0, 1, 2].map((bit) => (mask & (1 << bit) ? 'Z' : 'z')).join('') + '.'.repeat((tick % 3) + 1)
  );
}
