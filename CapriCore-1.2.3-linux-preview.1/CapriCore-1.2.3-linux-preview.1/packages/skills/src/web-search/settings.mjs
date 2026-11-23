// SPDX-License-Identifier: GPL-3.0-only
export function webSearchSettings(value) {
  const engine = ['wikipedia', 'duckduckgo'].includes(value?.engine) ? value.engine : 'duckduckgo';
  const sort = value?.sort === 'title' ? 'title' : 'relevance';
  const domains = typeof value?.domains === 'string' ? value.domains : '';
  const list = [
    ...new Set(
      domains
        .toLowerCase()
        .split(/[,\s]+/u)
        .filter(Boolean),
    ),
  ];
  if (
    domains.length > 512 ||
    list.length > 12 ||
    list.some((domain) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain))
  )
    throw new Error('Enter up to 12 website domains without paths or URLs.');
  return { engine, sort, domains: list.join(', '), exclude: value?.exclude === true };
}
