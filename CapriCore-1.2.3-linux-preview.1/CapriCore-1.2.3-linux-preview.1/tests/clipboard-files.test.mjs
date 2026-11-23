// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { clipboardFiles, clipboardFilePayload } from '../apps/desktop/renderer/clipboard-files.mjs';

test('plain text and HTML remain text; file items are read once without consulting paths or URLs', () => {
  assert.deepEqual(clipboardFiles(null), []);
  assert.deepEqual(
    clipboardFiles({
      files: [],
      items: [{ kind: 'string', type: 'text/plain' }],
      getData: () => assert.fail('Do not read clipboard strings'),
    }),
    [],
  );
  const image = new File(['synthetic'], 'image.png', { type: 'image/png' });
  assert.deepEqual(
    clipboardFiles({
      files: [image],
      items: [{ kind: 'file', getAsFile: () => assert.fail('No duplicate items') }],
    }),
    [image],
  );
  assert.deepEqual(clipboardFiles({ items: [{ kind: 'file', getAsFile: () => image }] }), [image]);
  assert.deepEqual(clipboardFiles({ items: [{ kind: 'file', getAsFile: () => null }] }), []);
});

test('clipboard bitmaps get a usable image extension and forwarded names contain no directories', () => {
  const [screenshot] = clipboardFiles({ files: [new File(['png'], '', { type: 'image/png' })] });
  assert.equal(screenshot.name, 'clipboard-image.png');
  const [file] = clipboardFiles({ files: [new File(['notes'], 'folder/private/notes.txt')] });
  assert.equal(file.name, 'notes.txt');
  assert.equal(file.size, 5);
});

test('mini clipboard payload bounds files/bytes before allocation and leaves rejection warnings to the owner', async () => {
  const file = new File(['hello'], 'notes.txt');
  const result = await clipboardFilePayload([file, file, file, file, file]);
  assert.equal(result.files.length, 4);
  assert.equal(result.overflow, true);
  assert.deepEqual(Object.keys(result.files[0]), ['name', 'bytes']);
  assert.equal(new TextDecoder().decode(result.files[0].bytes), 'hello');
  for (const candidate of [
    { name: 'too-big.png', size: 8 * 1024 * 1024 + 1 },
    { name: 'too-big.mp4', size: 32 * 1024 * 1024 + 1 },
    { name: 'program.exe', size: 10 },
    { name: 'empty.txt', size: 0 },
  ]) {
    const result = await clipboardFilePayload([
      { ...candidate, arrayBuffer: () => assert.fail('Rejected files must not be read') },
    ]);
    assert.equal(result.files[0].bytes.byteLength, 0);
  }
});
