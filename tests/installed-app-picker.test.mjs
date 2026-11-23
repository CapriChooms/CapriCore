import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DesktopCatalog } from '../apps/desktop/desktop-catalog.mjs';
const parent = path.resolve('.runtime/0.6.2/app-picker-tests');
mkdirSync(parent, { recursive: true });
test('owner search caches discoveries without granting access and revalidates before an explicit launch grant', async () => {
  const state = mkdtempSync(path.join(parent, 'case-'));
  const exe = path.join(state, 'Spotify.exe');
  writeFileSync(exe, 'synthetic - never executed');
  let calls = 0,
    removed = false;
  const catalog = new DesktopCatalog({
    root: state,
    state,
    bridge: async () => {
      calls++;
      return { matches: removed ? [] : [{ name: 'Spotify', executable: exe }] };
    },
  });
  try {
    const [found] = await catalog.discoverForOwner('Spotify');
    await catalog.discoverForOwner('Spotify');
    assert.equal(calls, 1);
    assert.deepEqual(catalog.apps(), []);
    const [saved] = await catalog.grantDiscovered(found.id);
    assert.equal(calls, 2);
    assert.equal(saved.launch, true);
    assert.equal(saved.inspect, false);
    assert.equal(saved.text, false);
    assert.equal(catalog.allowed(saved.id, 'launch').executable, exe);
    catalog.update({ id: saved.id, remove: true });
    removed = true;
    await assert.rejects(catalog.grantDiscovered(found.id), /changed or was removed/);
  } finally {
    catalog.close();
  }
});
test('a selected packaged app can receive launch-only access without granting the whole computer', async () => {
  const state = mkdtempSync(path.join(parent, 'case-'));
  const packageId = 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App';
  const catalog = new DesktopCatalog({
    root: state,
    state,
    bridge: async () => ({ matches: [{ name: 'Notepad', packageId }] }),
  });
  try {
    const [found] = await catalog.discoverForOwner('Notepad');
    const [saved] = await catalog.grantDiscovered(found.id);
    assert.equal(catalog.allowed(saved.id, 'launch').packageId, packageId);
    assert.throws(() => catalog.allowed(saved.id, 'inspect'));
    assert.throws(() => catalog.update({ id: saved.id, inspect: true }));
    catalog.update({ id: saved.id, launch: false });
    assert.throws(() => catalog.allowed(saved.id, 'launch'));
  } finally {
    catalog.close();
  }
});
