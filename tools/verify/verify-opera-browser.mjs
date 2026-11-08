// SPDX-License-Identifier: GPL-3.0-only
// Real Win32/UIA contract tests in owned compiled fixtures only. No user browser,
// profile, network navigation or downloaded application is opened.
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureDesktopActions } from '../../integrations/desktop-actions/provision.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

assert.equal(process.platform, 'win32');
const root = process.cwd(),
  parent = path.join(root, '.runtime/opera-browser-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-')),
  children = [];
const report = {
  passed: false,
  folder,
  checks: [],
  actualOperaBrowser: false,
  ownerWindowsTouched: false,
  networkRequests: false,
};
const csc = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
function compile(file, unrelated = false) {
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/platform:x64',
      '/r:System.Windows.Forms.dll',
      '/r:System.Drawing.dll',
      ...(unrelated ? ['/define:UNRELATED'] : []),
      '/out:' + file,
      path.join(root, 'tests/fixtures/OperaBrowser.cs'),
    ],
    { windowsHide: true },
  );
}
async function bridge(request) {
  return callApplicationBridge(root, request, { stillAllowed: () => true });
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  for (let n = 0; n < 40 && child.exitCode === null; n++) await delay(25);
}
async function launch(file) {
  const child = spawn(file, [], { windowsHide: false, stdio: 'ignore' });
  children.push(child);
  for (let n = 0; n < 70; n++) {
    try {
      const view = await bridge({ action: 'catalog_inspect', executable: file });
      if (view.processId === child.pid && view.untrustedControls?.some((c) => c.editable))
        return { child, view };
    } catch {}
    await delay(60);
  }
  throw Error('Owned Opera contract window did not initialize.');
}
async function rejection(request, pattern) {
  await assert.rejects(bridge(request), pattern);
}
try {
  ensureDesktopActions(root);
  const opera = path.join(folder, 'opera.exe'),
    launcher = path.join(folder, 'launcher.exe');
  const unrelated = path.join(folder, 'unrelated/launcher.exe');
  compile(opera);
  compile(launcher);
  compile(unrelated, true);
  await rejection(
    { action: 'browser_input', executable: unrelated, text: 'must not run' },
    /supported browser/,
  );
  await rejection(
    { action: 'browser_open', executable: unrelated, url: 'https://example.com/' },
    /supported browser/,
  );
  assert(!existsSync(path.join(path.dirname(unrelated), 'launcher-ran.txt')));
  report.checks.push('Unrelated launcher branding is rejected before browser launch or input');
  for (const [name, file] of [
    ['same folder', opera],
    ['version child', path.join(folder, '1.2.3.4/opera.exe')],
  ]) {
    if (file !== opera) {
      mkdirSync(path.dirname(file), { recursive: true });
      copyFileSync(opera, file);
    }
    const run = await launch(file);
    const typed = await bridge({
      action: 'browser_input',
      executable: launcher,
      windowId: run.view.windowId,
      text: 'Capri owned contract ' + name,
    });
    assert.equal(typed.processId, run.child.pid);
    assert.equal(typed.typed, true);
    assert.equal(typed.submitted, false);
    assert.equal(typed.windowId, run.view.windowId);
    const inspected = await bridge({
      action: 'catalog_inspect',
      executable: launcher,
      windowId: run.view.windowId,
    });
    assert.equal(inspected.processId, run.child.pid);
    const field = inspected.untrustedControls.find((control) => control.editable);
    for (const mismatch of [{ processId: run.child.pid + 1 }, { startedAtTicks: '0' }])
      await rejection(
        {
          action: 'catalog_type',
          executable: launcher,
          windowId: run.view.windowId,
          processId: inspected.processId,
          startedAtTicks: inspected.startedAtTicks,
          controlId: field.id,
          text: 'must not type',
          mode: 'replace',
          ...mismatch,
        },
        /application window changed/,
      );
    report.checks.push(
      'Verified launcher binds only its ' + name + ' Opera process and types without Enter',
    );
    await stop(run.child);
  }
  for (const [name, file, badBrand] of [
    ['unrelated publisher', path.join(folder, '2.3.4.5/opera.exe'), true],
    [
      'cousin installation',
      path.join(folder, '../' + path.basename(folder) + '-cousin/opera.exe'),
      false,
    ],
    ['non-version child', path.join(folder, 'arbitrary/opera.exe'), false],
    ['deep descendant', path.join(folder, '3.4.5.6/nested/opera.exe'), false],
  ]) {
    if (badBrand) compile(file, true);
    else {
      mkdirSync(path.dirname(file), { recursive: true });
      copyFileSync(opera, file);
    }
    const run = await launch(file);
    await rejection(
      {
        action: 'browser_input',
        executable: launcher,
        windowId: run.view.windowId,
        text: 'must not type',
      },
      /Open the selected application|window changed|actual windowId/,
    );
    report.checks.push(name + ' is not treated as the launcher application');
    await stop(run.child);
  }
  const linked = path.join(folder, '4.5.6.7');
  symlinkSync(path.join(folder, '1.2.3.4'), linked, 'junction');
  await rejection(
    { action: 'browser_input', executable: path.join(linked, 'opera.exe'), text: 'must not type' },
    /Linked application paths/,
  );
  report.checks.push('Filesystem junctions cannot redirect a browser executable');
  assert(!existsSync(path.join(folder, 'launcher-ran.txt')));
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  for (const child of children) await stop(child);
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
