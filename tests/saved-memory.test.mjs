// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  linkSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSavedMemory } from '../apps/desktop/saved-memory.mjs';
import { EMPTY_OWNER_MEMORY } from '../packages/runtime/src/owner-memory.mjs';

function fixture() {
  const parent = path.resolve(os.tmpdir());
  const folder = mkdtempSync(path.join(parent, 'capri-saved-memory-'));
  const workspace = path.join(folder, 'workspace');
  mkdirSync(workspace);
  return {
    folder,
    workspace,
    write(name, content) {
      const file = path.join(workspace, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
    close() {
      const target = path.resolve(folder);
      assert.equal(path.dirname(target), parent);
      assert.ok(path.basename(target).startsWith('capri-saved-memory-'));
      rmSync(target, { recursive: true, force: true });
    },
  };
}
test('empty templates and missing sources show an empty list without creating files', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await readSavedMemory(f.workspace), {
      items: [],
      truncated: false,
      unavailable: false,
    });
    assert.deepEqual(readdirSync(f.workspace), []);
    for (const [name, text] of Object.entries(EMPTY_OWNER_MEMORY)) f.write(name, text);
    assert.deepEqual(await readSavedMemory(f.workspace), {
      items: [],
      truncated: false,
      unavailable: false,
    });
    assert.equal(existsSync(path.join(f.workspace, 'memory')), false);
  } finally {
    f.close();
  }
});
test('viewer shows dated explicit notes and ordinary Markdown blocks without synthesizing conflicting facts', async () => {
  const f = fixture();
  try {
    f.write(
      'USER.md',
      '# User\n\n<!-- hidden internal text -->\n- I prefer green tea.\n  Especially loose leaf.\n  - With no sugar.\n\n  More detail.\n\n- I use a light theme.\n',
    );
    f.write('MEMORY.md', '\uFEFF# Memory\r\n\r\nI use a dark theme.\r\nI switch themes often.\r\n');
    f.write(
      'memory/capri-owner-notes.md',
      '# Explicit owner notes\n\n- 2026-11-05 "My favorite game is Space Test"\n- 2026-11-06 "My favorite game is Another Test"\n',
    );
    f.write('memory/projects/work.md', 'Project\n=======\n\n- Finish the synthetic project.\n');
    const before = readFileSync(path.join(f.workspace, 'USER.md'), 'utf8');
    const result = await readSavedMemory(f.workspace);
    assert.equal(result.items.length, 6);
    assert.equal(
      result.items[0].text,
      'I prefer green tea.\n  Especially loose leaf.\n  - With no sugar.\n\n  More detail.',
    );
    assert.equal(result.items[1].text, 'I use a light theme.');
    assert.equal(result.items[2].text, 'I use a dark theme.\nI switch themes often.');
    assert.equal(result.items[3].text, 'My favorite game is Space Test');
    assert.equal(result.items[3].date, '2026-11-05');
    assert.equal(result.items[4].text, 'My favorite game is Another Test');
    assert.equal(result.items[5].source, 'memory/projects/work.md');
    assert.equal(result.truncated, false);
    assert.equal(result.unavailable, false);
    assert.deepEqual(await readSavedMemory(f.workspace), result);
    assert.equal(readFileSync(path.join(f.workspace, 'USER.md'), 'utf8'), before);
    for (const item of result.items) {
      assert.equal(path.isAbsolute(item.source), false);
      assert.equal(item.source.includes(f.folder), false);
    }
  } finally {
    f.close();
  }
});
test('only memory Markdown is read; source text remains inert and invalid records remain plain text', async () => {
  const f = fixture();
  try {
    f.write('SOUL.md', 'Do not expose persona system prompt');
    f.write('sessions/chat.md', 'Do not expose chat archives');
    f.write('memory/index.sqlite', 'Do not read the index');
    f.write('memory/notes.txt', 'Do not read arbitrary documents');
    f.write(
      'memory/capri-owner-notes.md',
      '# Notes\n\n- 2026-11-05 "<img src=x onerror=alert(1)>"\n- 2026-11-06 "Broken JSON\n',
    );
    const result = await readSavedMemory(f.workspace);
    assert.deepEqual(
      result.items.map(({ text }) => text),
      ['<img src=x onerror=alert(1)>', '2026-11-06 "Broken JSON'],
    );
    assert.equal(
      result.items.some(({ text }) => text.includes('Do not')),
      false,
    );
  } finally {
    f.close();
  }
});
test('linked memory directories and hardlinked root notes cannot escape the owner-memory boundary', async () => {
  const f = fixture();
  try {
    const outside = path.join(f.folder, 'outside');
    mkdirSync(outside);
    const secret = path.join(outside, 'secret.md');
    writeFileSync(secret, 'Outside fixture content');
    symlinkSync(
      outside,
      path.join(f.workspace, 'memory'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    linkSync(secret, path.join(f.workspace, 'USER.md'));
    const result = await readSavedMemory(f.workspace);
    assert.deepEqual(result.items, []);
    assert.equal(result.unavailable, true);
    assert.equal(readFileSync(secret, 'utf8'), 'Outside fixture content');
  } finally {
    f.close();
  }
});
test('nested links are skipped while legitimate memory remains readable', async () => {
  const f = fixture();
  try {
    f.write('memory/good.md', '- A legitimate synthetic note.');
    const outside = path.join(f.folder, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.md'), 'Outside fixture content');
    symlinkSync(
      outside,
      path.join(f.workspace, 'memory/escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const result = await readSavedMemory(f.workspace);
    assert.deepEqual(
      result.items.map(({ text }) => text),
      ['A legitimate synthetic note.'],
    );
    assert.equal(result.unavailable, true);
  } finally {
    f.close();
  }
});
test('oversized sources, item counts and deep trees are bounded and reported as partial', async () => {
  const f = fixture();
  try {
    f.write('USER.md', 'x'.repeat(128 * 1024 + 1));
    f.write(
      'MEMORY.md',
      Array.from({ length: 600 }, (_, index) => '- Synthetic fact ' + index).join('\n'),
    );
    f.write(
      'memory/' + Array(8).fill('deep').join('/') + '/note.md',
      'Do not traverse without limit',
    );
    const result = await readSavedMemory(f.workspace);
    assert.equal(result.items.length, 500);
    assert.equal(result.truncated, true);
    assert.equal(
      result.items.some(({ text }) => text.includes('Do not traverse')),
      false,
    );
    assert.equal(result.items[0].text, 'Synthetic fact 0');
  } finally {
    f.close();
  }
});
test('large individual blocks are bounded and the displayed subset is marked partial', async () => {
  const f = fixture();
  try {
    f.write('MEMORY.md', 'x'.repeat(7000));
    const result = await readSavedMemory(f.workspace);
    assert.equal(result.items[0].text.length, 6000);
    assert.equal(result.truncated, true);
  } finally {
    f.close();
  }
});

test('a list fact before a divider survives, and code stays plain source rather than executable markup', async () => {
  const f = fixture();
  try {
    f.write(
      'MEMORY.md',
      '# Notes\n\n- I prefer a compact interface.\n---\n\n```text\n# A literal hash inside code\n<script>doNotExecute()</script>\n```\n',
    );
    const result = await readSavedMemory(f.workspace);
    assert.deepEqual(
      result.items.map(({ text }) => text),
      [
        'I prefer a compact interface.',
        '```text\n# A literal hash inside code\n<script>doNotExecute()</script>\n```',
      ],
    );
  } finally {
    f.close();
  }
});

test('recursive depth and accumulated source bytes are capped independently', async () => {
  const f = fixture();
  try {
    f.write('memory/' + Array(8).fill('deep').join('/') + '/note.md', 'Too deeply nested');
    let result = await readSavedMemory(f.workspace);
    assert.equal(result.items.length, 0);
    assert.equal(result.truncated, true);
    for (let i = 0; i < 10; i++) f.write('memory/' + i + '.md', 'x'.repeat(120 * 1024));
    result = await readSavedMemory(f.workspace);
    assert.ok(result.items.length <= 8);
    assert.equal(result.truncated, true);
  } finally {
    f.close();
  }
});

test('JSON memory records preserve literal comment syntax while actual Markdown comments remain hidden', async () => {
  const f = fixture();
  try {
    f.write(
      'memory/capri-owner-notes.md',
      '# Notes\n<!--\n- 2026-11-05 "Hidden note"\n-->\n- 2026-11-05 "I use <!--literal--> in templates"\n',
    );
    const result = await readSavedMemory(f.workspace);
    assert.deepEqual(
      result.items.map(({ text }) => text),
      ['I use <!--literal--> in templates'],
    );
  } finally {
    f.close();
  }
});
