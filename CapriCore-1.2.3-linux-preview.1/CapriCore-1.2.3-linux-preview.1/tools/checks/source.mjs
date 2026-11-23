import { checkDependencies } from './dependencies.mjs';
// SPDX-License-Identifier: GPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, nodePath, findExecutable } from '../../packages/runtime/src/index.mjs';
const files = [];
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (['__pycache__', 'node_modules', 'dist', '.venv'].includes(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) walk(file);
    else if (item.isFile()) files.push(file);
  }
}
for (const directory of ['apps', 'packages', 'integrations', 'scripts', 'tools', 'tests', 'config'])
  walk(path.join(root, directory));
let checked = 0;
for (const file of files) {
  if (/\.local\.json$/.test(file)) continue;
  if (/\.(?:mjs|cjs|js)$/.test(file)) {
    const result = spawnSync(nodePath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(path.relative(root, file) + '\n' + result.stderr);
    checked++;
  } else if (file.endsWith('.json')) JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
const python = findExecutable('python', {
  extra: [path.join(root, '.runtime/asr-venv/Scripts/python.exe')],
});
if (python) {
  const code =
    'import ast,json,sys,pathlib\nfor f in json.load(sys.stdin): ast.parse(pathlib.Path(f).read_text(encoding="utf-8-sig"),filename=f)';
  const result = spawnSync(python, ['-c', code], {
    input: JSON.stringify(files.filter((file) => file.endsWith('.py'))),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr);
} else if (process.argv.includes('--require-python'))
  throw new Error('Python is required for CI source checks');
if (process.platform === 'win32') {
  const parsed = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools/checks/powershell.ps1'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (parsed.status !== 0) throw new Error(parsed.stderr || parsed.stdout);
}
console.log(
  JSON.stringify({
    javascript: checked,
    jsonValid: true,
    pythonSyntax: python ? 'passed' : 'not installed; skipped',
  }),
);

checkDependencies();
