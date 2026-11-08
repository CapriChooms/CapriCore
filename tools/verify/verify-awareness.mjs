/** Observes only a generated native test window; no real desktop images or titles. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import { ensureAwareness } from '../../integrations/awareness/provision.mjs';
import { WindowsObserver } from '../../apps/desktop/windows-observer.mjs';
ensureAwareness();
const parent = path.join(root, '.runtime/awareness-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const source = path.join(folder, 'Fixture.cs'),
  executable = path.join(folder, 'Capri.EventFixture.exe');
writeFileSync(
  source,
  `using System;using System.Windows.Forms;using System.Drawing;using System.Runtime.InteropServices;class Fixture{[DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();[DllImport("user32.dll")]static extern bool AttachThreadInput(uint a,uint b,bool attach);static void Focus(Form form){uint p;uint thread=GetWindowThreadProcessId(GetForegroundWindow(),out p),own=GetCurrentThreadId();bool attached=thread!=own&&AttachThreadInput(own,thread,true);try{ShowWindow(form.Handle,5);SetForegroundWindow(form.Handle);form.Activate();}finally{if(attached)AttachThreadInput(own,thread,false);}}[STAThread]static void Main(){var form=new Form{Text="CAPRI OWNED EVENT FIXTURE",Width=420,Height=180,StartPosition=FormStartPosition.CenterScreen,TopMost=true};form.Controls.Add(new Label{Text="Capri event verification",AutoSize=true});var timer=new Timer{Interval=1200};int step=0;timer.Tick+=(s,e)=>{if(++step==1){form.Show();Focus(form);}if(step==3){form.FormBorderStyle=FormBorderStyle.None;form.Bounds=Screen.PrimaryScreen.Bounds;Focus(form);}if(step>=5){timer.Stop();form.Close();}};timer.Start();Application.Run(form);}}`,
);
execFileSync(
  path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  ),
  [
    '/nologo',
    '/target:winexe',
    '/out:' + executable,
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    source,
  ],
  { windowsHide: true },
);
const fixture = spawn(executable, [], { windowsHide: true, stdio: 'ignore' }),
  observer = new WindowsObserver({ root, verification: true });
const events = [],
  statuses = [];
let failure;
observer.on('observation', (value) => events.push(value));
observer.on('status', (value) => statuses.push(value.status));
observer.on('failure', (value) => {
  failure = value;
});
try {
  const ready = await observer.start({ filterProcessId: fixture.pid });
  assert.equal(ready.capturesImages, false);
  assert.equal(ready.capturesTitles, false);
  await new Promise((resolve, reject) => {
    fixture.on('error', reject);
    fixture.on('close', resolve);
  });
  assert.equal(failure, undefined);
  assert.ok(events.some((e) => e.kind === 'app.foreground' && e.processId === fixture.pid));
  assert.ok(
    events.some((e) => e.fullscreen === true),
    'Fullscreen changes of the same window must update suppression',
  );
  assert.ok(
    events.every(
      (e) =>
        !Object.hasOwn(e, 'title') &&
        !Object.hasOwn(e, 'image') &&
        (!e.processId || e.processId === fixture.pid),
    ),
  );
  observer.stop();
  assert.equal(observer.snapshot().active, false);
  const cancelled = observer.start({ filterProcessId: fixture.pid });
  observer.stop();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(observer.snapshot().status, 'off');
  writeFileSync(
    path.join(root, 'logs/awareness-verification.json'),
    JSON.stringify({ passed: true, folder, events, statuses, physicalCapture: false }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, events: events.length, fullscreen: true, folder }));
} finally {
  observer.stop();
  fixture.kill();
}
