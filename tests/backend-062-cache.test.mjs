import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, statSync, utimesSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { DesktopCatalog } from '../apps/desktop/desktop-catalog.mjs';
import { sseData } from '../apps/desktop/chat-service.mjs';
const parent = path.resolve('.runtime/0.6.2/backend-tests');
mkdirSync(parent, { recursive: true });
test('cached catalog copies cannot mutate permissions and external changes invalidate it even with restored modification time', async () => {
  const state = mkdtempSync(path.join(parent, 'case-')),
    catalog = new DesktopCatalog({ root: state, state });
  try {
    const app = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Owned',
      executable: path.join(state, 'Owned.exe'),
      launch: true,
      inspect: false,
      text: false,
    };
    catalog.save([app]);
    catalog.apps()[0].inspect = true;
    assert.equal(catalog.apps()[0].inspect, false);
    const before = statSync(catalog.file);
    writeFileSync(
      catalog.file,
      JSON.stringify({ schemaVersion: 1, apps: [{ ...app, launch: false, inspect: true }] }),
    );
    utimesSync(catalog.file, before.atime, before.mtime);
    assert.equal(catalog.apps()[0].launch, false);
    assert.equal(catalog.apps()[0].inspect, true);
    unlinkSync(catalog.file);
    assert.deepEqual(catalog.apps(), []);
  } finally {
    await catalog.close();
  }
});
test('stream size counters reset between complete events and still reject oversized fragmented events', async () => {
  async function* body() {
    for (let i = 0; i < 100; i++) yield new TextEncoder().encode('data: Привет\r\n\r\n');
  }
  const rows = [];
  for await (const row of sseData(body())) rows.push(row);
  assert.equal(rows.length, 100);
  assert(rows.every((row) => row === 'Привет'));
  async function* huge() {
    for (let i = 0; i < 20000; i++)
      yield new TextEncoder().encode('data: ' + 'x'.repeat(1000) + '\n');
  }
  await assert.rejects(async () => {
    for await (const _ of sseData(huge())) {
    }
  }, /exceeds limit/);
});
