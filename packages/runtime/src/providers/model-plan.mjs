// SPDX-License-Identifier: GPL-3.0-only
/** Resolve downloads without starting services or downloading any data. */
export function modelPlan(settings, args = []) {
  const embeddingOnly = args.includes('--embedding-only');
  const repairSelected = args.includes('--repair-selected');
  const selected = args.filter(
    (value) => !['--plan', '--embedding-only', '--repair-selected'].includes(value),
  );
  if (embeddingOnly && selected.length) throw new Error('Choose models or embeddings only');
  const models = [
    ...new Set([
      ...(embeddingOnly
        ? repairSelected && !/^capri-hf-/.test(settings.model)
          ? [settings.upstreamModel ?? settings.model]
          : []
        : selected.length
          ? selected
          : [settings.upstreamModel ?? settings.model]),
      'bge-m3:latest',
    ]),
  ];
  if (
    models.some(
      (name) =>
        typeof name !== 'string' || !/^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(name),
    )
  )
    throw new Error('Invalid model name');
  return {
    models,
    preview: args.includes('--plan'),
    ...(embeddingOnly ? { embeddingOnly } : {}),
    ...(repairSelected ? { repairSelected } : {}),
  };
}
