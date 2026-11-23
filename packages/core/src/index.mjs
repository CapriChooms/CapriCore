// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { defineSkill, SkillError } from '../../skill-sdk/src/index.mjs';
export { coordinateTurn, TURN_HANDLED } from './turn-coordinator.mjs';

const promiseLike = (value) => value != null && typeof value.then === 'function';

/**
 * In-process coordinator for trusted, statically registered skills.
 * Actor identity and actual authority come from the host adapters.
 */
export class CapriCore {
  #skills = new Map();
  #listeners = new Set();
  #lifetime = new AbortController();
  #close;
  #authorize;
  #onEventError;
  #operationSignal;

  constructor({ authorize = () => {}, onEventError = () => {}, operationSignal = () => {} } = {}) {
    this.#authorize = authorize;
    this.#onEventError = onEventError;
    this.#operationSignal = operationSignal;
  }

  register(definition, availablePorts = {}) {
    this.#lifetime.signal.throwIfAborted();
    const { manifest, create } = defineSkill(definition);
    if (this.has(manifest.id)) throw new SkillError('duplicate_skill', 'Skill already registered.');
    const ports = Object.fromEntries(
      manifest.requires.map((key) => {
        if (!Object.hasOwn(availablePorts, key) || availablePorts[key] == null)
          throw new SkillError('missing_skill_port', 'A required skill capability is unavailable.');
        return [key, availablePorts[key]];
      }),
    );
    this.#skills.set(manifest.id, {
      manifest,
      create,
      ports: Object.freeze(ports),
      instance: null,
    });
  }

  has(id) {
    return this.#skills.has(id);
  }

  describeSkills() {
    return [...this.#skills.values()].map(({ manifest, instance }) => ({
      id: manifest.id,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      commands: Object.keys(manifest.commands),
      active: Boolean(instance),
      ...(manifest.ui ? { ui: manifest.ui } : {}),
    }));
  }

  subscribe({ skillId, event } = {}, listener) {
    this.#lifetime.signal.throwIfAborted();
    if (typeof listener !== 'function') throw new TypeError('A listener is required.');
    const subscription = { skillId, event, listener };
    this.#listeners.add(subscription);
    return () => this.#listeners.delete(subscription);
  }

  #publish(record, event, data, operation) {
    if (this.#lifetime.signal.aborted || operation?.signal?.aborted) return;
    const { manifest } = record;
    if (!Object.hasOwn(manifest.events, event) || !manifest.events[event](data))
      throw new SkillError('invalid_skill_event', 'Invalid skill event.');
    const envelope = Object.freeze({
      skillId: manifest.id,
      event,
      data,
      apiVersion: manifest.apiVersion,
      ...(operation ? { requestId: operation.requestId } : {}),
    });
    for (const item of [...this.#listeners]) {
      if (
        (item.skillId && item.skillId !== envelope.skillId) ||
        (item.event && item.event !== event)
      )
        continue;
      try {
        item.listener(envelope);
      } catch {
        try {
          this.#onEventError({ skillId: manifest.id, event });
        } catch {}
      }
    }
  }

  /**
   * Trusted compatibility adapters use call to preserve their original return
   * shape and exceptions. Dispatch exposes the stable safe result envelope.
   */
  call({ skillId, command, input, requestId = randomUUID() }, actor = {}) {
    this.#lifetime.signal.throwIfAborted();
    const record = this.#skills.get(skillId);
    if (!record) throw new SkillError('skill_unavailable', 'The skill is unavailable.');
    const { manifest } = record;
    if (!Object.hasOwn(manifest.commands, command))
      throw new SkillError('unknown_skill_command', 'Unknown skill command.');
    const contract = manifest.commands[command];
    if (
      typeof actor.source !== 'string' ||
      !actor.source ||
      (contract.sources && !contract.sources.includes(actor.source))
    )
      throw new SkillError('skill_access_denied', 'This source cannot invoke the skill command.');
    if (
      typeof requestId !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,160}$/u.test(requestId) ||
      !contract.input(input)
    )
      throw new SkillError('invalid_skill_input', 'Invalid skill input.');
    const signals = [this.#lifetime.signal];
    const skillSignal = this.#operationSignal({ skillId, command, input, source: actor.source });
    if (skillSignal) signals.push(skillSignal);
    if (actor.signal) signals.push(actor.signal);
    if (actor.deadline !== undefined) {
      const remaining = actor.deadline - Date.now();
      if (!Number.isSafeInteger(actor.deadline) || remaining > 2 ** 32 - 1)
        throw new SkillError('invalid_skill_input', 'Invalid skill deadline.');
      signals.push(
        remaining <= 0
          ? AbortSignal.abort(new DOMException('Skill deadline exceeded.', 'TimeoutError'))
          : AbortSignal.timeout(remaining),
      );
    }
    const signal = AbortSignal.any(signals);
    const operation = Object.freeze({
      source: actor.source,
      signal,
      requestId,
      deadline: actor.deadline,
      emit: (event, data) => this.#publish(record, event, data, operation),
    });
    signal.throwIfAborted();
    this.#authorize({ skillId, command, input, operation });
    signal.throwIfAborted();
    if (!record.instance) {
      const instance = record.create({
        ports: record.ports,
        emit: (event, data) => this.#publish(record, event, data),
      });
      if (typeof instance?.invoke !== 'function')
        throw new SkillError('invalid_skill', 'Invalid skill instance.');
      record.instance = instance;
    }
    const verify = (result) => {
      signal.throwIfAborted();
      if (!contract.output(result))
        throw new SkillError('invalid_skill_output', 'Invalid skill output.');
      return result;
    };
    const result = record.instance.invoke(command, input, operation);
    return promiseLike(result) ? Promise.resolve(result).then(verify) : verify(result);
  }

  async dispatch(request, actor) {
    try {
      return { status: 'ok', value: await this.call(request, actor) };
    } catch (error) {
      if (
        this.#lifetime.signal.aborted ||
        actor?.signal?.aborted ||
        ['AbortError', 'TimeoutError'].includes(error?.name)
      )
        return { status: 'cancelled' };
      if (error instanceof SkillError) {
        const status = error.code === 'skill_unavailable' ? 'unavailable' : 'failed';
        return { status, code: error.code };
      }
      return { status: 'failed', code: 'skill_failed' };
    }
  }

  close() {
    if (this.#close) return this.#close;
    const { promise, resolve } = Promise.withResolvers();
    this.#close = promise;
    this.#lifetime.abort();
    this.#listeners.clear();
    const records = [...this.#skills.values()].reverse();
    resolve(
      Promise.allSettled(
        records.map(async (record) => {
          try {
            await record.instance?.dispose?.();
          } finally {
            record.instance = null;
          }
        }),
      ),
    );
    return promise;
  }
}
