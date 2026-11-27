import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('every shell script tracked by git is recorded as executable', () => {
  const listing = execFileSync('git', ['ls-files', '-s', '--', '*.sh'], {
    cwd: root,
    encoding: 'utf8',
  });
  const modes = listing
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ mode: line.split(' ')[0], file: line.split('\t')[1] }));
  assert.ok(modes.some(({ file }) => file === 'start-capri.sh'));
  for (const { mode, file } of modes) assert.equal(mode, '100755', file);
});
