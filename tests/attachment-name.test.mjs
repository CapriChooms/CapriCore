// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentName, historyAttachments } from '../apps/desktop/attachment-history.mjs';

test('attachment names do not retain half of a supplementary character at the length boundary', () => {
  for (const character of ['😀', '𝄞', '𠀋']) {
    const result = attachmentName(character + 'a'.repeat(159));
    assert.equal(result, 'a'.repeat(159));
    assert.ok(result.isWellFormed());
    assert.ok(result.length <= 160);
  }
});

test('history metadata also keeps truncated attachment names well formed', () => {
  const [attachment] = historyAttachments([
    {
      id: '12345678-1234-4234-8234-123456789abc',
      name: '😀' + 'a'.repeat(159),
      kind: 'document',
      bytes: 12,
      preview: false,
    },
  ]);
  assert.equal(attachment.name, 'a'.repeat(159));
  assert.ok(attachment.name.isWellFormed());
});

test('a supplementary character that fits the existing code-unit limit is preserved', () => {
  const name = '😀' + 'a'.repeat(158);
  assert.equal(name.length, 160);
  assert.equal(attachmentName(name), name);
});

test('ordinary display-name cleanup and the existing 160-code-unit limit are unchanged', () => {
  assert.equal(attachmentName('folder/notes.txt'), 'notes.txt');
  assert.equal(attachmentName('folder\\notes.txt'), 'notes.txt');
  assert.equal(attachmentName('  e\u0301.txt\u202e '), 'é.txt');
  assert.equal(attachmentName('a'.repeat(200)), 'a'.repeat(160));
  assert.equal(attachmentName(''), 'Attachment');
  assert.equal(attachmentName(null), 'Attachment');
});
