// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(),
  parent = path.join(root, '.runtime/control-overlay-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const reportFile = path.join(folder, 'report.json');
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `import {app,BrowserWindow,screen} from 'electron';
import {writeFileSync} from 'node:fs';
import {ControlOverlay} from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main/control-overlay.mjs')).href)};
app.whenReady().then(async()=>{
const owner=new BrowserWindow({show:false,width:200,height:120});
const overlay=new ControlOverlay({BrowserWindow,screen,owner,url:${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/renderer/control-overlay.html')).href)}});
try {await overlay.show('CAPRI // CONTROL VERIFICATION');
const windows=overlay.windows.map(w=>({bounds:w.getBounds(),visible:w.isVisible(),fullscreen:w.isFullScreen(),focusable:w.isFocusable()}));
const displays=screen.getAllDisplays().map(d=>({bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor}));
const effects=[];
for(const theme of ['capri','blackwall']){
overlay.configure({enabled:true,intensity:75,theme,cursor:true,pointerDuration:260});
await overlay.windows[0].webContents.executeJavaScript('capriControl.pointer({x:innerWidth*0.62,y:innerHeight*0.56});capriControl.pulse("click")');
await new Promise(resolve=>setTimeout(resolve,180));
const png=await overlay.windows[0].webContents.capturePage();
const size=png.getSize(),bitmap=png.toBitmap();
if(bitmap[((Math.floor(size.height/2)*size.width+Math.floor(size.width/2))*4)+3]!==0)throw Error('Effects obscured the center of the display.');
if(bitmap[(((size.height-2)*size.width+Math.floor(size.width/2))*4)+3]===0)throw Error('The bottom border was not drawn.');
const file=${JSON.stringify(folder)}+'/'+theme+'.png';writeFileSync(file,png.toPNG());effects.push({theme,file,centerTransparent:true});}
writeFileSync(${JSON.stringify(reportFile)},JSON.stringify({passed:true,windows,displays,effects}));
}catch(error){writeFileSync(${JSON.stringify(reportFile)},JSON.stringify({passed:false,error:error.message}));process.exitCode=1;}
finally{overlay.hide();owner.destroy();app.quit();}});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), [entry], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (value) => {
  stderr = (stderr + value).slice(-4000);
});
child.stdout.resume();
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill();
    reject(Error('Overlay verification timed out.'));
  }, 30000);
  child.on('error', (e) => {
    clearTimeout(timer);
    reject(e);
  });
  child.on('exit', () => {
    clearTimeout(timer);
    resolve();
  });
});
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
assert(report.passed, report.error ?? stderr);
assert.equal(report.windows.length, report.displays.length);
report.windows.forEach((w, i) => {
  assert.deepEqual(w.bounds, report.displays[i].workArea);
  assert(w.visible);
  assert.equal(w.fullscreen, false);
  assert.equal(w.focusable, false);
});
console.log(JSON.stringify({ ...report, folder }));
