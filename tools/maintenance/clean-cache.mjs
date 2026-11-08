/** Disposable development caches only. User data and installed runtimes are never targets. */
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = [
  'application-model-verification',
  'application-verification',
  'audio-device-probes',
  'audio-input-verification',
  'awareness-verification',
  'context-verification',
  'desktop-verification',
  'dialogue-style',
  'dimming-smoke',
  'file-access-verification',
  'filesystem-model-verification',
  'initiative-verification',
  'language-verification',
  'latency',
  'screen-verification',
  'screen-observation-verification',
  'clip-verification',
  'signal-design-check',
  'subtitle-verification',
  'test-data',
  'verification',
  'visual-context-verification',
  'visual-verification',
  'voice-effects-verification',
  'voice-integration-check',
  'vtuber-verification',
  'wake-verification',
];

function checked(workspace, relative) {
  const base = path.resolve(workspace),
    target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error('Cache target outside workspace');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    // Reject links in ancestors too: .runtime may not redirect deletion elsewhere.
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error(`Cache path contains a link: ${current}`);
  }
  return target;
}

function measure(target) {
  const stat = lstatSync(target);
  // Internal links are counted, never traversed. rmSync unlinks them without deleting targets.
  if (stat.isSymbolicLink()) return { bytes: 0, files: 1, links: 1 };
  if (!stat.isDirectory()) return { bytes: stat.size, files: 1, links: 0 };
  let bytes = 0,
    files = 0,
    links = 0;
  for (const name of readdirSync(target)) {
    const child = measure(path.join(target, name));
    bytes += child.bytes;
    files += child.files;
    links += child.links;
  }
  return { bytes, files, links };
}

export function cleanCaches(workspace = ROOT, { apply = false, packageCaches = false } = {}) {
  workspace = realpathSync(workspace);
  const candidates = [
    '.ruff_cache',
    '.pytest_cache',
    ...GENERATED.map((name) => `.runtime/${name}`),
  ];
  if (packageCaches) candidates.push('.downloads', '.runtime/uv-cache', '.runtime/npm-cache');
  // Root ASR recordings are reusable public/synthetic test fixtures, not disposable output.
  const asr = checked(workspace, '.runtime/asr-verification');
  if (existsSync(asr)) {
    for (const entry of readdirSync(asr, { withFileTypes: true })) {
      if (entry.name.startsWith('electron-'))
        candidates.push(`.runtime/asr-verification/${entry.name}`);
    }
  }
  // Bytecode is regenerated; only inspect maintained source, never owner datasets or models.
  function bytecode(relative) {
    const folder = checked(workspace, relative);
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      const child = `${relative}/${entry.name}`;
      if (entry.name === '__pycache__') candidates.push(child);
      else bytecode(child);
    }
  }
  for (const source of ['integrations', 'scripts', 'tests']) bytecode(source);
  // Validate the entire plan before the first deletion. Never accept arbitrary target arguments.
  const plan = candidates
    .map((relative) => ({ relative, target: checked(workspace, relative) }))
    .filter((item) => existsSync(item.target))
    .map((item) => ({ ...item, ...measure(item.target) }));
  if (apply) {
    for (const item of plan) {
      checked(workspace, item.relative);
      measure(item.target); // Refresh the no-follow inventory before removing the cache tree.
      rmSync(item.target, { recursive: true, force: false });
    }
  }
  return {
    applied: apply,
    logicalBytes: plan.reduce((sum, row) => sum + row.bytes, 0),
    files: plan.reduce((sum, row) => sum + row.files, 0),
    paths: plan.map(({ relative, bytes, files, links }) => ({
      path: relative,
      bytes,
      files,
      links,
    })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = new Set(process.argv.slice(2));
    if ([...args].some((arg) => !['--apply', '--package-caches'].includes(arg)))
      throw new Error('Usage: node scripts/clean-cache.mjs [--apply] [--package-caches]');
    console.log(
      JSON.stringify(
        cleanCaches(ROOT, {
          apply: args.has('--apply'),
          packageCaches: args.has('--package-caches'),
        }),
        null,
        2,
      ),
    );
    if (!args.has('--apply'))
      console.log(
        'Preview only. Add --apply to remove these caches. Stop verification/install jobs first.',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
