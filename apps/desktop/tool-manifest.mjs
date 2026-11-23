// SPDX-License-Identifier: GPL-3.0-only
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const schemaKeys = new Set([
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
]);
const plain = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const nameValid = (name) =>
  /^[a-z][a-z0-9_-]{0,39}$/.test(name) && !['constructor', 'prototype', '__proto__'].includes(name);
export function validateToolSchema(schema) {
  let nodes = 0;
  const walk = (value, depth) => {
    if (
      !plain(value) ||
      depth > 6 ||
      ++nodes > 120 ||
      !types.has(value.type) ||
      Object.keys(value).some((key) => !schemaKeys.has(key))
    )
      throw new Error(
        'Unsupported parameter schema. Use bounded JSON types without references or patterns.',
      );
    if (
      value.description !== undefined &&
      (typeof value.description !== 'string' || value.description.length > 500)
    )
      throw new Error('Parameter description is too long.');
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'])
      if (value[key] !== undefined && (!Number.isFinite(value[key]) || Math.abs(value[key]) > 1e9))
        throw new Error('Invalid parameter limit.');
    if (
      value.enum !== undefined &&
      (!Array.isArray(value.enum) ||
        value.enum.length > 30 ||
        value.enum.some(
          (item) => item !== null && !['boolean', 'number', 'string'].includes(typeof item),
        ))
    )
      throw new Error('Invalid parameter choices.');
    if (value.type === 'object') {
      if (
        !plain(value.properties ?? {}) ||
        Object.keys(value.properties ?? {}).length > 30 ||
        value.additionalProperties !== false
      )
        throw new Error('Object schemas must set additionalProperties to false.');
      if (
        !Array.isArray(value.required ?? []) ||
        (value.required ?? []).some((key) => !Object.hasOwn(value.properties ?? {}, key))
      )
        throw new Error('Invalid required parameters.');
      for (const [key, child] of Object.entries(value.properties ?? {})) {
        if (!nameValid(key)) throw new Error('Invalid parameter name.');
        walk(child, depth + 1);
      }
    }
    if (value.type === 'array') {
      if (!value.items) throw new Error('Specify array items.');
      walk(value.items, depth + 1);
    }
  };
  walk(schema, 0);
  if (schema.type !== 'object') throw new Error('Tool parameters must be a JSON object.');
  return structuredClone(schema);
}
export function validateToolArguments(value, schema, depth = 0) {
  if (depth > 6) throw new Error('Tool arguments are too deeply nested.');
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type === 'integer' ? !Number.isSafeInteger(value) : type !== schema.type)
    throw new Error('Tool argument type does not match its schema.');
  if (schema.enum && !schema.enum.includes(value))
    throw new Error('Choose a declared parameter value.');
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) || value < (schema.minimum ?? -1e9) || value > (schema.maximum ?? 1e9))
  )
    throw new Error('Tool argument is outside its allowed range.');
  if (
    typeof value === 'string' &&
    (value.length < (schema.minLength ?? 0) ||
      value.length > Math.min(8000, schema.maxLength ?? 8000))
  )
    throw new Error('Tool argument text is too long or too short.');
  if (Array.isArray(value)) {
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > Math.min(100, schema.maxItems ?? 100)
    )
      throw new Error('Too many tool argument items.');
    for (const item of value) validateToolArguments(item, schema.items, depth + 1);
  } else if (type === 'object') {
    if (
      !plain(value) ||
      Object.keys(value).length > 30 ||
      Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key)) ||
      (schema.required ?? []).some((key) => !Object.hasOwn(value, key))
    )
      throw new Error('Missing or unknown tool arguments.');
    for (const [key, item] of Object.entries(value))
      validateToolArguments(item, schema.properties[key], depth + 1);
  }
  if (depth === 0 && Buffer.byteLength(JSON.stringify(value)) > 16384)
    throw new Error('Tool arguments are too large.');
  return value;
}
export function toolManifest(value) {
  if (
    !plain(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'version',
          'name',
          'description',
          'parameters',
          'runtime',
          'entry',
          'arguments',
          'permissions',
          'timeoutMs',
          'mode',
          'keywords',
          'cacheSeconds',
        ].includes(key),
    ) ||
    value.version !== 1 ||
    !nameValid(value.name) ||
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    value.description.length > 1000 ||
    !['node', 'python', 'executable'].includes(value.runtime) ||
    typeof value.entry !== 'string' ||
    !/^[a-zA-Z0-9_./-]{1,200}$/.test(value.entry) ||
    value.entry.startsWith('/') ||
    value.entry.split('/').some((part) => part === '..' || !part)
  )
    throw new Error('Invalid tool manifest.');
  const parameters = validateToolSchema(value.parameters);
  const permissions = value.permissions;
  if (
    !plain(permissions) ||
    Object.keys(permissions).some((key) => !['network', 'files'].includes(key)) ||
    typeof permissions.network !== 'boolean' ||
    !['none', 'inputs'].includes(permissions.files)
  )
    throw new Error('Declare network (true/false) and files (none/inputs) permissions.');
  const mode = value.mode ?? 'tool',
    timeoutMs = value.timeoutMs ?? 10000;
  if (
    !['tool', 'context'].includes(mode) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60000
  )
    throw new Error('Invalid tool mode or timeout.');
  if (mode === 'context' && (parameters.required ?? []).length)
    throw new Error(
      'Context scripts cannot require model-supplied parameters. Use private tool settings instead.',
    );
  const args = value.arguments ?? [];
  if (
    !Array.isArray(args) ||
    args.length > 10 ||
    args.some((arg) => typeof arg !== 'string' || arg.length > 300 || /[\x00-\x1f]/.test(arg))
  )
    throw new Error('Use a fixed argument list, not a shell command.');
  const keywords = value.keywords ?? [],
    cacheSeconds = value.cacheSeconds ?? 30;
  if (
    !Array.isArray(keywords) ||
    keywords.length > 10 ||
    keywords.some((word) => typeof word !== 'string' || word.length < 2 || word.length > 40) ||
    (mode === 'context' && !keywords.length) ||
    !Number.isInteger(cacheSeconds) ||
    cacheSeconds < 0 ||
    cacheSeconds > 3600
  )
    throw new Error('Context scripts need 1–10 keywords and a bounded cache lifetime.');
  return {
    ...value,
    parameters,
    permissions: { ...permissions },
    mode,
    timeoutMs,
    arguments: [...args],
    keywords: [...keywords],
    cacheSeconds,
  };
}
