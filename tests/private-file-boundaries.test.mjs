import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FilePermissions, INSTALLATION_SCOPE_ID } from '../integrations/filesystem/permissions.mjs';
const parent = path.resolve('.runtime/0.6.2/private-file-tests');
mkdirSync(parent, { recursive: true });
test('private data and approval files stay inaccessible even through installation or full-drive model scopes', () => {
  const root = mkdtempSync(path.join(parent, 'case-')),
    state = path.join(root, 'data/desktop');
  mkdirSync(state, { recursive: true });
  writeFileSync(path.join(state, 'private-memory.enc.json'), 'encrypted fixture');
  const driveId = '11111111-1111-4111-8111-111111111111';
  const permissions = new FilePermissions(path.join(state, 'permissions.json'), {
    applicationRoot: root,
    privatePaths: [state],
    computerScopes: () => [{ id: driveId, root, write: true }],
  });
  for (const id of [INSTALLATION_SCOPE_ID, driveId]) {
    assert.throws(
      () => permissions.target(id, 'data/desktop/private-memory.enc.json'),
      /dedicated controls/,
    );
    assert.throws(
      () => permissions.target(id, 'data/desktop/user-tools.json', true),
      /dedicated controls/,
    );
    assert.throws(
      () => permissions.target(id, 'data/desktop/user-tools.json.pending.tmp', true),
      /dedicated controls/,
    );
    assert.equal(
      permissions.target(id, 'new-work.txt', true).path,
      path.join(root, 'new-work.txt'),
    );
  }
});
