import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (file) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'));

test('the runtime package that loads koffi on Darwin declares it and the lockfile records it', () => {
  const declared = read('packages/runtime/package.json').dependencies?.koffi;
  const lock = read('package-lock.json');
  assert.equal(declared, '3.3.2');
  assert.equal(lock.packages['node_modules/koffi'].version, declared);
  assert.equal(lock.packages['packages/runtime'].dependencies?.koffi, declared);
});
