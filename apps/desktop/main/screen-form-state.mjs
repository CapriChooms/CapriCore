// SPDX-License-Identifier: GPL-3.0-only
/** Only bounded form metadata crosses to settings; media tracks stay with the owner. */
export function screenFormState(value) {
  const text = (v, limit) => typeof v === 'string' && v.length <= limit;
  const statusFlags = ['blocked', 'active', 'analysing', 'skipped', 'changed'];
  if (
    !value ||
    !Array.isArray(value.sources) ||
    value.sources.length > 300 ||
    !value.sources.every(
      (s) =>
        s &&
        text(s.id, 300) &&
        ['', 'monitors', 'monitor', 'window'].includes(s.kind) &&
        text(s.label, 500),
    ) ||
    !text(value.sourceId, 300) ||
    !value.status ||
    !statusFlags.every((key) => typeof value.status[key] === 'boolean') ||
    (value.status.warning !== undefined && typeof value.status.warning !== 'boolean') ||
    (value.status.lastAnalysedAt !== null && !Number.isFinite(value.status.lastAnalysedAt)) ||
    !['active', 'ready', 'busy', 'canAsk'].every((k) => typeof value[k] === 'boolean') ||
    !Number.isFinite(value.interval) ||
    !Number.isFinite(value.duration) ||
    (value.error != null && !text(value.error, 2000)) ||
    (value.warning != null &&
      ![
        'The active model cannot read images or video frames.',
        'Enable vision for a compatible API model before sharing images.',
      ].includes(value.warning)) ||
    (value.png != null && (!text(value.png, 500) || !value.png.startsWith('blob:capri://desktop/')))
  )
    throw new Error('Invalid screen form state');
  return {
    sources: value.sources.map(({ id, kind, label }) => ({ id, kind, label })),
    sourceId: value.sourceId,
    status: {
      ...Object.fromEntries(statusFlags.map((key) => [key, value.status[key]])),
      lastAnalysedAt: value.status.lastAnalysedAt,
      warning: value.status.warning === true,
    },
    active: value.active,
    ready: value.ready,
    busy: value.busy,
    canAsk: value.canAsk,
    interval: value.interval,
    duration: value.duration,
    error: value.error ?? null,
    warning: value.warning ?? null,
    png: value.png ?? null,
  };
}
