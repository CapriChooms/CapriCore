// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../../packages/runtime/src/atomic-json.mjs';

// Real PowerShell update UI and parent-exit handoff. The update worker/launcher
// only write fixture markers; no user installation, model or shortcut is changed.
if (process.platform !== 'win32') throw Error('Windows update UI verification requires Windows');
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'update-handoff-'));
const target = path.join(folder, 'Обновление Capri');
const source = path.join(target, '.runtime/updates/staged/fixture');
const suppliedScript = process.argv[2];
mkdirSync(path.join(source, 'packages/updater/windows'), { recursive: true });
mkdirSync(path.join(source, 'packages/updater/bin'), { recursive: true });
mkdirSync(path.join(source, 'packages/installer/windows'), { recursive: true });
mkdirSync(path.join(source, 'config'), { recursive: true });
for (const relative of [
  'packages/installer/windows/localization.ps1',
  'config/installer-shell-text.json',
])
  copyFileSync(path.join(root, relative), path.join(source, relative));
copyFileSync(
  suppliedScript ?? path.join(root, 'packages/updater/windows/update.ps1'),
  path.join(source, 'packages/updater/windows/update.ps1'),
);
writeJsonAtomic(path.join(target, '.capri-install.json'), {
  schemaVersion: 1,
  productId: 'capri.desktop',
  root: target,
  version: '0.4.0',
  installId: randomUUID(),
});
writeJsonAtomic(path.join(target, 'config/release.json'), { tag: 'v0.4.0' });
writeFileSync(
  path.join(folder, 'launcher.cs'),
  `using System; using System.IO; using System.Reflection; class Probe { static void Main() { File.WriteAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "restarted.txt"), "fixture only"); } }`,
);
const compile = spawnSync(
  path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  ),
  [
    '/nologo',
    '/target:winexe',
    '/out:' + path.join(target, 'Capri.exe'),
    path.join(folder, 'launcher.cs'),
  ],
  { windowsHide: true, encoding: 'utf8' },
);
assert.equal(compile.status, 0, compile.stdout + compile.stderr);
writeFileSync(
  path.join(source, 'packages/updater/bin/apply.mjs'),
  `
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const job=JSON.parse(readFileSync(process.argv[2], 'utf8'));
writeFileSync(path.join(job.root, 'worker-started.json'), JSON.stringify({pid:process.pid}));
let complete=false;
for(let i=0;i<300;i++) {
  if(existsSync(job.cancel)) throw Error('Fixture cancelled');
  if(existsSync(job.proceed)) {
    try { process.kill(job.parentPid,0); }
    catch(error) { if(error.code!=='ESRCH') throw error; complete=true; break; }
  }
  await delay(100);
}
if(!complete) throw Error('Parent did not exit');
writeFileSync(path.join(job.root,'applied-after-exit.json'), JSON.stringify({parentPid:job.parentPid,shutdown:existsSync(path.join(job.root,'shutdown.txt'))}));
writeFileSync(job.events,JSON.stringify({phase:'complete'})+'\\n');
`,
);
const archive = path.join(folder, 'fixture.zip');
writeFileSync(archive, 'fixture update bytes; never unpacked');
const asset = { sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
writeFileSync(
  path.join(folder, 'owner.mjs'),
  `
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { UpdateService } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/update-service.mjs')).href)};
const root=${JSON.stringify(target)};
const service=new UpdateService({root,state:path.join(root,'data/desktop'),node:process.execPath});
service.prepared=${JSON.stringify({ source, archive, asset, tag: 'v0.4.1' })};
service.value.phase='ready';
const result=await service.install({parentPid:process.pid,language:${JSON.stringify(suppliedScript ? 'en' : 'ar')},shutdown:async()=>writeFileSync(path.join(root,'shutdown.txt'),'only after UI ready')});
writeFileSync(path.join(root,'handoff.json'),JSON.stringify({result,handoff:service.handoff}));
`,
);
const owner = spawn(process.execPath, [path.join(folder, 'owner.mjs')], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '',
  uiPid;
owner.stderr.on('data', (bytes) => {
  stderr = (stderr + bytes).slice(-8000);
});
owner.stdout.resume();
const exited = new Promise((resolve, reject) => {
  owner.once('error', reject);
  owner.once('exit', (code) => resolve(code));
});
let timer;
try {
  const code = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Owner did not complete handoff: ' + stderr)), 30000);
    }),
  ]);
  clearTimeout(timer);
  assert.equal(code, 0, stderr);
  const uiLog = readFileSync(path.join(target, 'logs/update-ui.stdout.log'), 'utf8');
  const events = uiLog
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    });
  uiPid = events.find((event) => event.phase === 'window-ready')?.pid;
  assert(uiPid, 'UI readiness must be recorded');
  assert.deepEqual(JSON.parse(readFileSync(path.join(target, 'handoff.json'))), {
    result: true,
    handoff: true,
  });
  for (let i = 0; i < 200 && !existsSync(path.join(target, 'restarted.txt')); i++) await delay(100);
  assert(
    existsSync(path.join(target, 'restarted.txt')),
    'Independent update UI must restart the fixture after its owner exits',
  );
  if (!suppliedScript)
    assert(
      events.some((event) => event.phase === 'ui-shown' && event.language === 'ar' && event.rtl),
      'Independent update UI must use the requested Arabic interface and RTL layout',
    );
  assert.deepEqual(JSON.parse(readFileSync(path.join(target, 'applied-after-exit.json'))), {
    parentPid: owner.pid,
    shutdown: true,
  });
  const report = {
    folder,
    passed: true,
    ownerExited: true,
    appliedAfterExit: true,
    restarted: true,
  };
  writeJsonAtomic(path.join(folder, 'report.json'), report);
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(timer);
  if (owner.exitCode === null) owner.kill();
  if (uiPid)
    spawnSync('taskkill.exe', ['/PID', String(uiPid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
}
