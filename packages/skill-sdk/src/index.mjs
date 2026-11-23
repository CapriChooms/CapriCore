// SPDX-License-Identifier: GPL-3.0-only
export const SKILL_API_VERSION = 1;

/** @typedef {(value: unknown) => boolean} SkillValidator */
/** @typedef {(event: string, data: unknown) => void} SkillEmit */

/**
 * @typedef {object} SkillOperation
 * @property {string} requestId
 * @property {string} source Host-assigned caller identity.
 * @property {AbortSignal} signal Cancels on caller abort, deadline, or core shutdown.
 * @property {number} [deadline] Deadline in epoch milliseconds.
 * @property {SkillEmit} emit Publishes an event correlated with this request.
 */

/**
 * @typedef {object} SkillCommand
 * @property {SkillValidator} input
 * @property {SkillValidator} output
 * @property {readonly string[]} [sources] Allowed caller identities.
 */

/**
 * @typedef {object} SkillManifest
 * @property {string} id Stable, namespaced skill identifier.
 * @property {string} version Skill implementation version.
 * @property {number} apiVersion Required SDK contract version.
 * @property {Readonly<Record<string, SkillCommand>>} commands
 * @property {Readonly<Record<string, SkillValidator>>} [events]
 * @property {readonly string[]} [requires] Host capabilities supplied to the factory.
 * @property {{sectionId: string, labelKey?: string}} [ui] Settings metadata.
 */

/**
 * @typedef {object} SkillInstance
 * @property {(command: string, input: unknown, operation: SkillOperation) => unknown} invoke
 * @property {() => void | Promise<void>} [dispose]
 */

/**
 * @template {Record<string, unknown>} [Ports=Record<string, unknown>]
 * @typedef {object} SkillDefinition
 * @property {SkillManifest} manifest
 * @property {(context: {ports: Readonly<Ports>, emit: SkillEmit}) => SkillInstance} create
 * The factory's emitter publishes background events without a request ID.
 */

export const isRecord = (value) =>
  value !== null &&
  typeof value === 'object' &&
  [null, Object.prototype].includes(Object.getPrototypeOf(value));

export const noInput = (value) => value === undefined;
export const anyOutput = () => true;

const name = /^[a-z][a-zA-Z0-9-]{0,63}$/u;
const skillId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const version = /^\d+\.\d+\.\d+$/u;

export class SkillError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkillError';
    this.code = code;
  }
}

/**
 * @template {Record<string, unknown>} Ports
 * @param {SkillDefinition<Ports>} definition
 */
export function defineSkill({ manifest, create }) {
  if (
    !isRecord(manifest) ||
    !skillId.test(manifest.id) ||
    !version.test(manifest.version) ||
    typeof create !== 'function'
  )
    throw new SkillError('invalid_skill', 'Invalid skill definition.');
  if (manifest.apiVersion !== SKILL_API_VERSION)
    throw new SkillError('unsupported_skill_api', 'Unsupported skill API version.');
  const { commands, events = {}, requires = [], ui } = manifest;
  if (
    !isRecord(commands) ||
    !Object.keys(commands).length ||
    !isRecord(events) ||
    !Array.isArray(requires) ||
    new Set(requires).size !== requires.length ||
    requires.some((key) => typeof key !== 'string' || !name.test(key)) ||
    (ui !== undefined && (!isRecord(ui) || !name.test(ui.sectionId)))
  )
    throw new SkillError('invalid_skill', 'Invalid skill manifest.');

  const descriptors = Object.entries(commands).map(([key, command]) => {
    if (
      !name.test(key) ||
      !isRecord(command) ||
      typeof command.input !== 'function' ||
      typeof command.output !== 'function' ||
      (command.sources !== undefined &&
        (!Array.isArray(command.sources) ||
          !command.sources.length ||
          command.sources.some((source) => typeof source !== 'string' || !name.test(source))))
    )
      throw new SkillError('invalid_skill', 'Invalid skill command contract.');
    return [
      key,
      Object.freeze({
        ...command,
        ...(command.sources ? { sources: Object.freeze([...command.sources]) } : {}),
      }),
    ];
  });
  if (Object.entries(events).some(([key, check]) => !name.test(key) || typeof check !== 'function'))
    throw new SkillError('invalid_skill', 'Invalid skill event contract.');
  return Object.freeze({
    manifest: Object.freeze({
      ...manifest,
      requires: Object.freeze([...requires]),
      commands: Object.freeze(Object.fromEntries(descriptors)),
      events: Object.freeze({ ...events }),
      ...(ui ? { ui: Object.freeze({ ...ui }) } : {}),
    }),
    create,
  });
}
