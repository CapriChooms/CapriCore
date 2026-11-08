// SPDX-License-Identifier: GPL-3.0-only
/** Disposable Windows UIA fixtures. Never type in an existing user window. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { ActionApprovals } from '../../apps/desktop/action-broker.mjs';
import { FilePermissions } from '../../integrations/filesystem/permissions.mjs';
import { ensureDesktopActions } from '../../integrations/desktop-actions/provision.mjs';

if (process.platform !== 'win32') throw new Error('Windows UI Automation is required');
const parent = path.join(root, '.runtime/catalog-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'owned-'));
const children = [],
  report = { folder, checks: [] };
const catalog = new DesktopCatalog({
  root,
  state: path.join(folder, 'state'),
  filePermissions: new FilePermissions(path.join(folder, 'permissions.json')),
  trash: () => {
    throw new Error('No trash operation in this verification');
  },
});
const approvals = new ActionApprovals({ emit() {} });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  ensureDesktopActions();
  const exe = path.join(folder, 'Capri.EditFixture.exe');
  execFileSync(
    path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:winexe',
      '/r:System.Windows.Forms.dll',
      '/r:System.Drawing.dll',
      '/out:' + exe,
      path.join(root, 'tests/fixtures/DesktopEditor.cs'),
    ],
    { windowsHide: true },
  );
  const [entry] = catalog.add(exe);
  catalog.update({ id: entry.id, launch: true, inspect: true, text: true });
  for (let i = 0; i < 2; i++)
    children.push(spawn(exe, [], { windowsHide: false, stdio: 'ignore' }));
  let selection;
  for (let i = 0; i < 30; i++) {
    try {
      selection = await catalog.execute(
        'choose',
        { action: 'inspect', appId: entry.id },
        approvals,
      );
      if (selection.needsWindow && selection.windows.length === 2) break;
    } catch (error) {
      report.lastError = error.message;
    }
    await wait(200);
  }
  assert(
    selection?.needsWindow && selection.windows.length === 2,
    JSON.stringify({ selection, lastError: report.lastError }),
  );
  assert.equal(
    (await catalog.execute('missing', { action: 'inspect' }, approvals)).error.code,
    'missing_app_id',
  );
  report.checks.push('Missing appId is explicit; multiple windows require a real windowId');
  const inspection = await catalog.execute(
    'inspect',
    { action: 'inspect', appId: entry.id, windowId: selection.windows[0].windowId },
    approvals,
  );
  const field = inspection.untrustedControls.find((c) => c.editable);
  assert(field);
  const proposal = await catalog.execute(
    'replace',
    {
      action: 'type_text',
      appId: entry.id,
      inspectionId: inspection.inspectionId,
      controlId: field.id,
      text: 'Owned fixture only',
      mode: 'replace',
    },
    approvals,
  );
  const result = await approvals.respond(proposal.proposal.id, true);
  assert.equal(result.ok, true);
  assert.equal(
    (
      await catalog.execute(
        'reuse',
        {
          action: 'type_text',
          appId: entry.id,
          inspectionId: inspection.inspectionId,
          controlId: field.id,
          text: 'Must not repeat',
        },
        approvals,
      )
    ).error.code,
    'inspection_required',
  );
  report.checks.push(
    'Confirmed replacement in one exact window, verified by native ValuePattern; lease cannot be reused',
  );
  const chrome = path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe');
  if (existsSync(chrome)) {
    // A new private profile/window; inspection only. Existing Chrome windows are never typed into.
    const profile = path.join(folder, 'chrome-profile'),
      html = path.join(folder, 'chrome-fixture.html');
    writeFileSync(
      html,
      '<!doctype html><title>Capri owned Chrome fixture</title><label>Disposable draft<input aria-label="Capri disposable draft" value="Fixture"></label>',
    );
    const process = spawn(
      chrome,
      [
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--force-renderer-accessibility',
        '--new-window',
        html,
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    children.push(process);
    const app = catalog
      .add(chrome)
      .find((a) => a.executable.toLowerCase() === chrome.toLowerCase());
    catalog.update({ id: app.id, launch: true, inspect: true, text: false });
    let inspected;
    for (let i = 0; i < 30; i++) {
      try {
        inspected = await catalog.execute(
          'chrome-inspect',
          { action: 'inspect', appId: app.id },
          approvals,
        );
        if (inspected.needsWindow) {
          const owned = inspected.windows.find((w) =>
            w.untrustedTitle.includes('Capri owned Chrome fixture'),
          );
          if (owned)
            inspected = await catalog.execute(
              'chrome-owned',
              { action: 'inspect', appId: app.id, windowId: owned.windowId },
              approvals,
            );
        }
        if (inspected.untrustedControls?.some((c) => c.editable)) break;
      } catch {}
      await wait(200);
    }
    assert(
      inspected?.untrustedControls?.some((c) => c.editable),
      'Chrome did not expose an accessible editable control',
    );
    report.checks.push(
      'Real Chrome private fixture exposes editable controls without CDP or personal profile access',
    );
  } else report.chrome = 'not installed; skipped';
  report.passed = true;
} finally {
  for (const child of children)
    if (child.pid && child.exitCode === null) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {}
    }
  await catalog.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
