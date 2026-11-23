// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPrivatePath,
  writePrivateBytesAtomic,
} from '../../packages/runtime/src/safe-file.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.runtime', 'graphify');
const venv = path.join(cache, 'venv');
const cli = path.join(venv, 'Scripts', 'graphify.exe');
const indexFile = path.join(cache, 'index.json');
const version = '0.9.106';
const sourceScopes = ['apps', 'packages', 'integrations', 'scripts', 'tools', 'tests'];
const sourceExtension = /\.(?:mjs|cjs|js|py|ps1|psm1|cs|lua)$/iu;
const snapshotName = /^snapshot-[a-z0-9]{6}$/iu;
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(?:GRAPHIFY_|PYTHONPATH$|PYTHONHOME$)/iu.test(key),
  ),
);
Object.assign(env, {
  GRAPHIFY_BACKEND: 'none',
  GRAPHIFY_QUERY_LOG_DISABLE: '1',
  GRAPHIFY_OUT: 'graphify-out',
  PYTHONUTF8: '1',
  PYTHONNOUSERSITE: '1',
});

function run(command, args, { cwd = root, capture = false, timeout = 120_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} exited with code ${result.status ?? result.signal}.`,
    );
  return result.stdout;
}

function currentSnapshot() {
  assertPrivatePath(indexFile);
  if (!existsSync(indexFile)) return null;
  const entry = JSON.parse(readFileSync(indexFile, 'utf8'));
  if (!snapshotName.test(entry.directory))
    throw new Error('The local Graphify index pointer is invalid.');
  return path.join(cache, entry.directory);
}

function removeSnapshot(folder) {
  if (!folder || !existsSync(folder)) return;
  assertPrivatePath(folder);
  const actual = realpathSync(folder);
  if (!snapshotName.test(path.basename(actual)) || path.dirname(actual) !== realpathSync(cache))
    throw new Error('The Graphify snapshot is outside its cache.');
  rmSync(actual, { recursive: true, force: true });
}

function build() {
  const started = performance.now();
  const previous = currentSnapshot();
  const snapshot = mkdtempSync(path.join(cache, 'snapshot-'));
  let copied = 0;
  try {
    const files = run('git', ['ls-files', '-z', '--cached', '--', ...sourceScopes], {
      capture: true,
    });
    for (const relative of new Set(files.split('\0'))) {
      if (!sourceExtension.test(relative) || /\.local\.[^/]+$/iu.test(relative)) continue;
      const source = path.resolve(root, relative);
      const target = path.resolve(snapshot, relative);
      if (
        path.isAbsolute(relative) ||
        relative.split('/').includes('..') ||
        !target.startsWith(snapshot + path.sep)
      )
        throw new Error('A tracked source path is outside the Graphify snapshot.');
      assertPrivatePath(source);
      if (!existsSync(source) || !lstatSync(source).isFile()) continue;
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
      copied++;
    }
    run(cli, ['extract', '.', '--code-only', '--max-workers', '4'], {
      cwd: snapshot,
      timeout: 300_000,
    });
    if (!existsSync(path.join(snapshot, 'graphify-out', 'graph.json')))
      throw new Error('Graphify did not produce an index.');
    writePrivateBytesAtomic(
      indexFile,
      Buffer.from(JSON.stringify({ directory: path.basename(snapshot), version }) + '\n'),
    );
  } catch (error) {
    removeSnapshot(snapshot);
    throw error;
  }
  try {
    removeSnapshot(previous);
  } catch (error) {
    console.warn('Previous Graphify snapshot could not be removed: ' + error.message);
  }
  console.log(
    `Prepared ${copied} tracked source files and built the graph in ${((performance.now() - started) / 1000).toFixed(2)} s.`,
  );
}

function exportHtml(snapshot, graph) {
  const { nodes, links } = JSON.parse(readFileSync(graph, 'utf8'));
  const groups = new Map();
  const degree = new Map();
  for (const { source, target } of links) {
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (!Number.isInteger(node.community) || node.community < 0) continue;
    if (!groups.has(node.community)) groups.set(node.community, []);
    groups.get(node.community).push(node);
  }
  const byDegree = (a, b) =>
    (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id);
  const labels = {};
  const used = new Set();
  for (const [id, members] of [...groups].sort(([a], [b]) => a - b)) {
    const files = new Map();
    for (const node of members) {
      if (typeof node.source_file !== 'string' || !sourceExtension.test(node.source_file)) continue;
      if (!files.has(node.source_file)) files.set(node.source_file, []);
      files.get(node.source_file).push(node);
    }
    const [file, moduleNodes] =
      [...files].sort(
        ([a, left], [b, right]) => right.length - left.length || a.localeCompare(b),
      )[0] ?? [];
    const moduleName = file ? path.basename(file) : '';
    const symbol = (moduleNodes ?? members)
      .filter(
        (node) =>
          typeof node.label === 'string' &&
          path.basename(node.label) !== moduleName &&
          !/^\.?constructor(?:\(\))?$/iu.test(node.label),
      )
      .sort(byDegree)[0]?.label;
    const label = [...new Set([moduleName, symbol].filter(Boolean))].join(' · ') || members[0].id;
    labels[id] = used.has(label) ? `${label} (#${id})` : label;
    used.add(labels[id]);
  }
  const labelsFile = path.join(path.dirname(graph), 'capri-community-labels.json');
  writePrivateBytesAtomic(labelsFile, Buffer.from(JSON.stringify(labels), 'utf8'));
  run(cli, ['export', 'html', '--graph', graph, '--labels', labelsFile], { cwd: snapshot });
  console.log(path.join(path.dirname(graph), 'graph.html'));
}

const [action, ...args] = process.argv.slice(2);
try {
  assertPrivatePath(cache);
  if (action === 'install' && !args.length) {
    mkdirSync(cache, { recursive: true });
    const python = path.join(venv, 'Scripts', 'python.exe');
    assertPrivatePath(python);
    if (!existsSync(python)) run('py', ['-3', '-m', 'venv', venv]);
    run(
      python,
      [
        '-m',
        'pip',
        '--isolated',
        'install',
        '--index-url',
        'https://pypi.org/simple',
        '--only-binary',
        ':all:',
        '--disable-pip-version-check',
        '--no-input',
        `graphifyy==${version}`,
      ],
      { timeout: 300_000 },
    );
  } else if (
    (['build', 'html'].includes(action) && !args.length) ||
    (action === 'query' && args.length === 1) ||
    (action === 'path' && args.length === 2)
  ) {
    assertPrivatePath(cli);
    if (!existsSync(cli)) throw new Error('Run npm run dev:graphify -- install first.');
    if (action === 'build') build();
    else {
      const snapshot = currentSnapshot();
      if (!snapshot) throw new Error('Run npm run dev:graphify -- build first.');
      const graph = path.join(snapshot, 'graphify-out', 'graph.json');
      assertPrivatePath(graph);
      if (!existsSync(graph)) throw new Error('The local Graphify index is missing. Rebuild it.');
      if (action === 'html') exportHtml(snapshot, graph);
      else run(cli, [action, ...args, '--graph', graph], { cwd: snapshot });
    }
  } else
    throw new Error(
      'Usage: npm run dev:graphify -- install | build | html | query "question" | path "from" "to"',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
