import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PrivateMemory } from '../apps/desktop/private-memory.mjs';
import { privateDialogue } from '../apps/desktop/private-dialogue.mjs';
const parent = path.resolve('.runtime/0.6.2/private-tests');
mkdirSync(parent, { recursive: true });
test('private notes and names are encrypted, authenticated, locked and isolated from ordinary transcripts', async () => {
  const file = path.join(mkdtempSync(path.join(parent, 'case-')), 'vault.json');
  let now = 0;
  const vault = new PrivateMemory({ file, now: () => now });
  try {
    await vault.unlock('test-only-password', { create: true });
    vault.add('synthetic-private-cake-secret');
    for (const candidate of [file, file + '.bak']) {
      const bytes = readFileSync(candidate, 'utf8');
      assert(!bytes.includes('synthetic-private'));
      assert(!bytes.includes('test-only-password'));
    }
    const reply = await vault.chat('What is private?', async ({ notes, history }) => {
      assert.equal(history.length, 0);
      return notes[0].text;
    });
    assert.match(reply.text, /synthetic-private/);
    vault.lock();
    assert.throws(() => vault.list());
    assert.deepEqual(vault.history, []);
    await assert.rejects(vault.unlock('wrong-password'));
    await assert.rejects(vault.unlock('test-only-password'), /Too many/);
    now = 60000;
    await vault.unlock('test-only-password');
    assert.equal(vault.list().length, 1);
    await vault.changePassword('test-only-password', 'new-test-password');
    vault.lock();
    now += 60000;
    await assert.rejects(vault.unlock('test-only-password'));
    now += 60000;
    await vault.unlock('new-test-password');
    assert.equal(vault.list().length, 1);
    const waiting = vault.chat('wait', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 'must not appear';
    });
    vault.lock();
    await assert.rejects(waiting);
    assert.deepEqual(vault.history, []);
  } finally {
    vault.close();
  }
});
test('private dialogue refuses external sharing by default and uses a direct bounded endpoint without gateway history', async () => {
  let remote = true,
    called = 0;
  const request = privateDialogue({
    url: 'http://127.0.0.1:54321',
    model: () => 'synthetic',
    remote: () => remote,
    fetchImpl: async (url, options) => {
      called++;
      assert.equal(url.pathname, '/api/chat');
      assert(!options.headers['x-openclaw-session-key']);
      assert.equal(JSON.parse(options.body).stream, false);
      return new Response(JSON.stringify({ message: { content: 'Private answer' } }));
    },
  });
  const args = { text: 'test', notes: [], history: [], signal: new AbortController().signal };
  await assert.rejects(request(args));
  assert.equal(called, 0);
  remote = false;
  assert.equal(await request(args), 'Private answer');
  assert.equal(called, 1);
});
