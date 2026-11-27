// SPDX-License-Identifier: GPL-3.0-only
//
// Routes a turn toward the owner's enabled user tools before the model sees it.
// Small models rarely emit a tool call from a long tool list, so a turn whose
// words match a tool's keywords takes a route that offers that tool, or, for a
// context tool, keeps the output Capri has already fetched and sends the turn
// without the full tool list.

/** The enabled user tools a turn can be routed to, from the user-tool rows. */
export function localToolsFor(enabled, rows) {
  if (!enabled || !Array.isArray(rows)) return [];
  return rows
    .filter((row) => row.enabled && row.manifest)
    .map((row) => ({
      name: row.manifest.name,
      mode: row.manifest.mode,
      keywords: row.manifest.keywords,
    }));
}

const normalize = (value) => value.normalize('NFKC').toLowerCase();

/**
 * The names of the enabled tools whose keywords appear in this message. Matching
 * is case-insensitive substring matching, the same rule context tools use when
 * Capri fetches their output.
 */
export function localToolIntent(text, tools) {
  if (typeof text !== 'string' || !Array.isArray(tools)) return [];
  const value = normalize(text);
  const names = tools
    .filter((tool) => tool.keywords.some((keyword) => value.includes(normalize(keyword))))
    .map((tool) => tool.name);
  return [...new Set(names)];
}

/**
 * True when every matched tool is a context tool. Capri has already fetched the
 * answer for such a turn, so the model needs no tool schemas for it: the small
 * conversation route is enough, and the full tool route can overflow a small
 * model's context window.
 */
export function servedByContext(names, tools) {
  return (
    Array.isArray(names) &&
    names.length > 0 &&
    Array.isArray(tools) &&
    names.every((name) => tools.some((tool) => tool.name === name && tool.mode === 'context'))
  );
}

/** A system prompt line naming the tools to use for this turn. */
export function localToolInstruction(names, contextOnly = false) {
  if (!Array.isArray(names) || !names.length) return '';
  const many = names.length > 1;
  const head =
    'This request is for the owner-enabled tool' +
    (many ? 's ' : ' ') +
    names.map((name) => '"' + name + '"').join(' and ') +
    '. ' +
    (many ? 'Access to them is' : 'Access to it is') +
    ' enabled, so do not say that you cannot use ' +
    (many ? 'them.' : 'it.');
  if (contextOnly)
    return (
      head +
      ' Live results for this question appear below under "User context script output" when the tool returned any: answer from them directly, giving the actual figures. If none appear, say that the tool returned no result.'
    );
  return (
    head +
    ' If live results appear below under "User context script output", they were fetched for this question just now: answer from them directly. Otherwise call the tool now and answer from its result. If a result reports an error, say so.'
  );
}
