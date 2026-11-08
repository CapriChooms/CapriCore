// SPDX-License-Identifier: GPL-3.0-only
const owns = (value, key) => Object.hasOwn(value, key);
const schemaKeys = new Set([
  'type',
  'const',
  'enum',
  'anyOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'description',
]);

/** Validate every constraint used by Capri's own planner schemas after JSON decoding. */
export function matchesPlannerSchema(value, schema, depth = 0) {
  if (!schema || depth > 12 || Object.keys(schema).some((key) => !schemaKeys.has(key)))
    return false;
  if (
    schema.anyOf &&
    !schema.anyOf.some((branch) => matchesPlannerSchema(value, branch, depth + 1))
  )
    return false;
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (
    schema.type !== undefined &&
    (schema.type === 'integer'
      ? !Number.isSafeInteger(value)
      : Array.isArray(schema.type)
        ? !schema.type.includes(type)
        : schema.type !== type)
  )
    return false;
  if (owns(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity))
  )
    return false;
  if (typeof value === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))
      return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (Array.isArray(value)) {
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? Infinity) ||
      (schema.uniqueItems &&
        new Set(value.map((item) => JSON.stringify(item))).size !== value.length)
    )
      return false;
    return (
      !schema.items || value.every((item) => matchesPlannerSchema(item, schema.items, depth + 1))
    );
  }
  if (type === 'object') {
    if ((schema.required ?? []).some((key) => !owns(value, key))) return false;
    return Object.entries(value).every(([key, item]) =>
      owns(schema.properties ?? {}, key)
        ? matchesPlannerSchema(item, schema.properties[key], depth + 1)
        : typeof schema.additionalProperties === 'object'
          ? matchesPlannerSchema(item, schema.additionalProperties, depth + 1)
          : schema.additionalProperties !== false,
    );
  }
  return true;
}

/** Avoid duplicating large target/evidence enums already present in the observation. */
export function plannerJsonHint(schema) {
  const shapes = (schema.anyOf ?? [schema]).map((branch) => ({
    ...(branch.properties.action?.const ? { action: branch.properties.action.const } : {}),
    required: branch.required,
    optional: Object.keys(branch.properties).filter((key) => !branch.required.includes(key)),
  }));
  return (
    'Return exactly one JSON object matching one of these allowed action shapes: ' +
    JSON.stringify(shapes) +
    '. Use the action arguments described above. Copy targetId and toTargetId exactly from currentObservation.targets, including their bracketed suffix. Evidence must copy current observed text. Include the required checkpoint plan and only known checkpoint IDs when verifying. No extra fields, tool calls or prose outside the JSON object.'
  );
}

/** Only this known local decoder conflict permits a read-only format retry. */
export async function nativePlannerFormatError(response) {
  if (response.status !== 500 || !response.body?.getReader) return false;
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = '',
    bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 4096) {
        await reader.cancel();
        return false;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const packet = JSON.parse(text);
    return (
      typeof packet.error === 'string' &&
      packet.error.includes('llama-server chat error:') &&
      packet.error.includes(
        'The model produced output that does not match the expected peg-native format',
      )
    );
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}
