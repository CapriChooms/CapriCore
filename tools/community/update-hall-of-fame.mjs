// SPDX-License-Identifier: GPL-3.0-only
// Maintainer-only refresh: node tools/community/update-hall-of-fame.mjs
// Uses the existing GitHub CLI sign-in. Never called by the app or its build.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignEpithets, normalizeCreditNames } from '../../apps/desktop/credits-epithets.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_REPOSITORY = 'CapriChooms/Capri';
export const TEAM = Object.freeze([
  Object.freeze({ name: 'Overyx', role: 'Developer' }),
  Object.freeze({ name: 'v1rch', role: 'Discord developer' }),
  Object.freeze({ name: 'Leberrr', role: 'Discord moderator' }),
]);
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function validateRepository(repository) {
  if (typeof repository !== 'string') throw new Error('Invalid GitHub repository.');
  const parts = repository.split('/');
  if (
    parts.length !== 2 ||
    !loginPattern.test(parts[0]) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) ||
    ['.', '..'].includes(parts[1])
  )
    throw new Error('Expected a GitHub repository in OWNER/REPOSITORY form.');
  return repository;
}

export function normalizeSupporters(logins) {
  if (!Array.isArray(logins)) throw new Error('Expected a list of GitHub usernames.');
  const unique = new Map();
  for (const login of logins) {
    // Only public login strings enter the release snapshot. Reject malformed
    // pages rather than silently replacing a complete roster with partial data.
    if (typeof login !== 'string' || !loginPattern.test(login))
      throw new Error('GitHub returned an invalid public username.');
    const key = login.toLowerCase();
    if (!unique.has(key)) unique.set(key, login);
  }
  return [...unique.values()].sort((a, b) => collator.compare(a, b));
}

export function collaboratorArguments(repository, page) {
  validateRepository(repository);
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGES)
    throw new Error('Invalid collaborators page.');
  return [
    'api',
    '--hostname',
    'github.com',
    '--method',
    'GET',
    `repos/${repository}/collaborators?affiliation=all&per_page=${PAGE_SIZE}&page=${page}`,
    '--header',
    'Accept: application/vnd.github+json',
    '--header',
    'X-GitHub-Api-Version: 2026-03-10',
    '--jq',
    'map(.login)',
  ];
}

export function queryCollaboratorPage(repository, page) {
  const bundled = path.join(root, '.runtime/github-cli-2.103.3/bin/gh.exe');
  const executable = existsSync(bundled) ? bundled : process.platform === 'win32' ? 'gh.exe' : 'gh';
  const environment = { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };
  delete environment.GH_DEBUG;
  // shell:false and validated arguments prevent a repository value becoming a
  // command. gh filters the response before stdout; no API payload is saved.
  const result = spawnSync(executable, collaboratorArguments(repository, page), {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    env: environment,
  });
  if (result.error || result.status !== 0)
    throw new Error('Could not read GitHub collaborators. Check GitHub CLI sign-in and access.');
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('GitHub returned an unreadable collaborators page.');
  }
}

export function collectSupporters(repository, queryPage = queryCollaboratorPage) {
  validateRepository(repository);
  const logins = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const entries = queryPage(repository, page);
    normalizeSupporters(entries);
    if (entries.length > PAGE_SIZE) throw new Error('GitHub returned an oversized page.');
    logins.push(...entries);
    if (entries.length < PAGE_SIZE) return normalizeSupporters(logins);
  }
  throw new Error('Collaborators pagination did not finish.');
}

export function refreshHallOfFame({
  repository = DEFAULT_REPOSITORY,
  output = path.join(root, 'config/hall-of-fame.json'),
  queryPage = queryCollaboratorPage,
  now = new Date(),
  randomIndex,
} = {}) {
  // Complete and validate every request before touching the previous snapshot.
  const current = collectSupporters(repository, queryPage);
  let previous = [];
  let previousEpithets = {};
  let acknowledgements = {};
  try {
    const existing = JSON.parse(readFileSync(output, 'utf8'));
    if (
      existing?.schemaVersion !== 1 ||
      typeof existing.source !== 'string' ||
      existing.source.toLowerCase() !== repository.toLowerCase()
    )
      throw new Error('The existing snapshot has an incompatible schema or repository.');
    previous = normalizeSupporters(existing.supporters);
    if (Object.hasOwn(existing, 'epithets')) previousEpithets = existing.epithets;
    for (const group of ['majorSupporters', 'communityHelpers'])
      if (Object.hasOwn(existing, group))
        acknowledgements[group] = normalizeCreditNames(existing[group]);
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Could not validate the existing public snapshot.');
  }
  // Credits are permanent: a later loss of repository access does not remove a
  // supporter. Current results win only for GitHub's canonical capitalization.
  const supporters = normalizeSupporters([...current, ...previous]);
  const displayNames = [
    ...(acknowledgements.majorSupporters ?? []),
    ...(acknowledgements.communityHelpers ?? []),
  ];
  const epithets = assignEpithets(
    [...TEAM.map(({ name }) => name), ...supporters, ...displayNames],
    previousEpithets,
    randomIndex,
    displayNames,
  );
  const manifest = {
    schemaVersion: 1,
    team: TEAM.map(({ name, role }) => ({ name, role })),
    ...acknowledgements,
    supporters,
    epithets,
    snapshotDate: now.toISOString().slice(0, 10),
    source: repository,
  };
  mkdirSync(path.dirname(output), { recursive: true });
  const temporary = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length && (arguments_.length !== 2 || arguments_[0] !== '--repository')) {
    console.error('Usage: node tools/community/update-hall-of-fame.mjs [--repository OWNER/REPO]');
    process.exitCode = 1;
  } else {
    try {
      const manifest = refreshHallOfFame({ repository: arguments_[1] ?? DEFAULT_REPOSITORY });
      console.log(
        `Saved ${manifest.supporters.length} public usernames (${manifest.snapshotDate}).`,
      );
    } catch (error) {
      console.error(`${error.message} Existing snapshot was not changed.`);
      process.exitCode = 1;
    }
  }
}
