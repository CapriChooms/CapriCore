// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packages = fileURLToPath(new URL('../packages/', import.meta.url));
const boundaries = [
  { name: 'skill-sdk', packages: ['skill-sdk'], builtins: [] },
  { name: 'core', packages: ['core', 'skill-sdk'], builtins: ['node:crypto'] },
  { name: 'skills', packages: ['skills', 'shared', 'skill-sdk'], builtins: ['node:net'] },
];
const sourceDirectory = (name) => path.join(packages, name, 'src');

function contains(root, file) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

test('skill packages keep Electron, host adapters, and third-party dependencies outside the core', () => {
  for (const boundary of boundaries) {
    const allowedDirectories = boundary.packages.map(sourceDirectory);
    const entries = readdirSync(sourceDirectory(boundary.name), {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.[cm]?js$/u.test(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      const source = readFileSync(file, 'utf8');
      const imports = source.matchAll(
        /\b(?:(?:import|require)\s*\(\s*|(?:import\s*|export\s+)(?:[^'";]*?\bfrom\s*)?)['"]([^'"]+)['"]/gu,
      );
      for (const [, target] of imports) {
        const relative = /^\.\.?\//u.test(target);
        const importedFile = relative && path.resolve(entry.parentPath, target);
        assert.ok(
          boundary.builtins.includes(target) ||
            (importedFile && allowedDirectories.some((root) => contains(root, importedFile))),
          path.relative(packages, file) + ' cannot import ' + target,
        );
      }
    }
  }
});
