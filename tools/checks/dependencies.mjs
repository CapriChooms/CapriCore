// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { createDesktopResources } from '../../apps/desktop/main/resources.mjs';
export function checkDependencies() {
  const resources = createDesktopResources({
    root,
    directory: path.join(root, 'apps/desktop'),
    catalog: { portraitFrames: [] },
    spriteFile: path.join(root, 'assets/default/avatar.png'),
  });
  const errors = [];
  let modules = 0;
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['__pycache__', 'node_modules', 'dist', '.venv'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!entry.isFile() || !/\.(?:mjs|cjs|js)$/.test(file)) continue;
      modules++;
      const name = path.relative(root, file).split(path.sep).join('/'),
        text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\1/g)) {
        const specifier = match[2];
        if (name.startsWith('apps/desktop/renderer/') && specifier.startsWith('node:'))
          errors.push(name + ': renderer imports Node');
        if (!specifier.startsWith('.')) continue;
        let target = path.resolve(path.dirname(file), specifier);
        if (name.startsWith('apps/desktop/renderer/')) {
          const served = new URL(specifier, 'capri://desktop/' + path.basename(file));
          const entry = resources.get(served.pathname);
          if (!entry) errors.push(name + ': renderer import is not served: ' + specifier);
          if (entry) target = entry.file;
        }
        const relative = path.relative(root, target).split(path.sep).join('/');
        if (!existsSync(target)) errors.push(name + ': missing ' + specifier);
        if (
          relative.startsWith('archive/') ||
          relative.startsWith('tools/') ||
          relative.startsWith('tests/') ||
          relative.startsWith('scripts/')
        )
          errors.push(name + ': production depends on ' + relative);
        if (
          name.startsWith('packages/runtime/src/') &&
          !relative.startsWith('packages/runtime/src/') &&
          relative !== 'config/memory-estimates.json'
        )
          errors.push(name + ': runtime depends on application code');
      }
    }
  }
  for (const directory of ['apps', 'packages/runtime/src', 'integrations'])
    walk(path.join(root, directory));
  if (errors.length) throw new Error('Dependency boundaries failed:\n' + errors.join('\n'));
  return { modules, boundaries: 'passed' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(checkDependencies()));
