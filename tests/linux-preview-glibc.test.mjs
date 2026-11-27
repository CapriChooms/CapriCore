import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the Linux preview states the glibc requirement of the prebuilt llama-server', () => {
  const preview = readFileSync(
    fileURLToPath(new URL('../LINUX-PREVIEW.md', import.meta.url)),
    'utf8',
  );
  assert.match(preview, /needs glibc 2\.38 or newer/);
  assert.match(preview, /glibc 2\.36, such as Debian 12 or Raspberry Pi OS/);
  assert.match(preview, /`version GLIBC_2\.38 not found`/);
  assert.match(preview, /CAPRI_LLAMA_PATH/);
});
