// SPDX-License-Identifier: GPL-3.0-only
// Owned overlays, synthetic screens and direct renderer input only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parent = path.join(root, '.runtime/teleport-arrival');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
const baseline = process.argv.includes('--baseline');
const source = (name) => JSON.stringify(pathToFileURL(path.join(root, name)).href);
writeFileSync(
  entry,
  `
import {app,BrowserWindow,protocol} from 'electron';
import {AvatarDetach} from ${source('apps/desktop/main/avatar-detach.mjs')};
import {requireCapriAvatar} from ${source('apps/desktop/avatar-catalog.mjs')};
import {createDesktopResources} from ${source('apps/desktop/main/resources.mjs')};
import {resourceResponse} from ${source('apps/desktop/main/protocol.mjs')};
app.setPath('userData',${JSON.stringify(path.join(folder, 'profile'))});
protocol.registerSchemesAsPrivileged([{scheme:'capri',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
process.on('uncaughtException',error=>{console.error(error.stack);app.exit(1);});
process.on('unhandledRejection',error=>{console.error(error.stack);app.exit(1);});
app.whenReady().then(()=>{
const root=${JSON.stringify(root)},catalog=requireCapriAvatar(root);
const resources=createDesktopResources({root,directory:root+'/apps/desktop',catalog,spriteFile:catalog.sprites.find(s=>s.id===catalog.defaultId).file});
protocol.handle('capri',req=>resourceResponse(req,resources));
const owner=new BrowserWindow({show:false,x:50,y:50,width:450,height:600,webPreferences:{backgroundThrottling:false}});
const errors=[];
class OwnedOverlay {
 constructor(options){
  const view=new BrowserWindow(options);view.webContents.setAudioMuted(true);
  view.webContents.on('console-message',(_e,_l,msg)=>{if(/Uncaught|TypeError/.test(msg))errors.push(msg);});
  const execute=view.webContents.executeJavaScript.bind(view.webContents);
  view.webContents.executeJavaScript=async(source,...args)=>{
   if(source.startsWith('globalThis.capriAvatarDetach.prepare(')){
    const message=JSON.parse(source.slice('globalThis.capriAvatarDetach.prepare('.length,-1));
    if(${baseline}){message.interactiveArrival=false;source='globalThis.capriAvatarDetach.prepare('+JSON.stringify(message)+')';}
    await execute('('+function(m){
      globalThis.arrivalProbe={firstDraw:0,left:m.to.x-m.to.scale*(m.arrival?.anchor??m.anchor).x,top:m.to.y-m.to.scale*(m.arrival?.anchor??m.anchor).y,scale:m.to.scale};
      if(globalThis.arrivalProbeInstalled)return;globalThis.arrivalProbeInstalled=true;
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(image,...values){
        const probe=globalThis.arrivalProbe;
        if(this.canvas.id==='teleport-effect'&&image instanceof HTMLImageElement&&probe&&!probe.firstDraw&&Math.abs(values[0]-probe.left)<1&&Math.abs(values[1]-probe.top)<1&&Math.abs(values[2]-probe.scale)<1)probe.firstDraw=Date.now();
        return draw.call(this,image,...values);
      };
    }.toString()+')('+JSON.stringify(message)+')');
   }
   return execute(source,...args);
  };
  return view;
 }
}
const displays=[{id:1,workArea:{x:0,y:0,width:800,height:650}},{id:2,workArea:{x:800,y:0,width:800,height:650}}];
let syntheticCursor={x:0,y:0};
const screen={getDisplayMatching:()=>displays[0],getDisplayNearestPoint:p=>displays[p.x>=800?1:0],getAllDisplays:()=>displays,getCursorScreenPoint:()=>syntheticCursor};
const sprite={anchor:{x:620,y:1160},url:'capri://desktop/sprites/neutral.png'},canvas={width:1254,height:1254},mask={alpha:new Uint8Array(16).fill(255),imageSize:{width:4,height:4}};
const geometry={rect:{x:25,y:25,width:240,height:240},clip:{x:25,y:25,width:240,height:240}};
globalThis.runArrivalCase=async(crossing)=>{
 let next,dragDrops=0;
 const avatar=new AvatarDetach({BrowserWindow:OwnedOverlay,screen,owner,verification:false,watchRelease:()=>()=>{},getEffects:()=>({avatarDragTether:false,avatarDragTetherDeadZone:30}),onPhase(){},onDragDrop(cursor,offset){dragDrops++;next=avatar.hop(cursor,offset);}});
 try{
  const left=await avatar.leave(geometry,sprite,canvas,mask,{x:crossing?1150:500,y:450});
  const committed=Date.now(),initialView=avatar.overlay;
  const arrival=await initialView.webContents.executeJavaScript('({firstDraw:arrivalProbe.firstDraw,tailVisible:!document.getElementById("teleport-effect").hidden})');
  const rect=avatar.spriteRect(),grab={x:rect.x+rect.width*.4,y:rect.y+rect.height*.25};
  const ready=avatar.available&&avatar.canGrab(grab),sourceRetained=crossing?avatar.settlingOverlays.size>0:true;
  syntheticCursor={x:avatar.session.area.x+grab.x,y:avatar.session.area.y+grab.y};avatar.updatePointer();const pointerReady=avatar.acceptsPointer===true;
  initialView.webContents.emit('before-mouse-event',{}, {...grab,type:'mouseDown',button:'left'});
  const pressed=Boolean(avatar.press);
  const release={x:crossing?350:200,y:380},area=avatar.session.area;
  initialView.webContents.emit('before-mouse-event',{}, {type:'mouseUp',button:'left',x:release.x-area.x,y:release.y-area.y,globalX:release.x,globalY:release.y});
  const releasedAt=Date.now(),accepted=Boolean(next);
  const second=next?await next:false;
  const settledView=avatar.overlay,point={...avatar.desktopPoint},displayId=avatar.session?.displayId;
  const secondTail=await settledView.webContents.executeJavaScript('!document.getElementById("teleport-effect").hidden');
  await settledView.webContents.executeJavaScript('capriAvatarDetach.whenSettled()');
  const stable=avatar.available&&avatar.overlay===settledView&&avatar.desktopPoint.x===point.x&&avatar.desktopPoint.y===point.y;
  return{crossing,left,firstArrivalDelayMs:committed-arrival.firstDraw,firstDrawRecorded:arrival.firstDraw>0,firstTailVisible:arrival.tailVisible,ready,pointerReady,pressed,accepted,dragDrops,releaseBeforeOldTailEnd:releasedAt-arrival.firstDraw<480,second,secondTailVisible:secondTail,sourceRetained,stable,displayId,errors:[...errors]};
 }finally{avatar.reset();}
};
app.on('window-all-closed',()=>app.quit());
void owner.loadURL('about:blank');
});
`,
);

let application;
try {
  const env = { ...process.env, TEMP: parent, TMP: parent };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
    env,
    timeout: 30000,
  });
  await application.firstWindow();
  const rows = [];
  for (const crossing of [false, true]) {
    const row = await application.evaluate(
      async (_, crossing) => globalThis.runArrivalCase(crossing),
      crossing,
    );
    rows.push(row);
    for (const name of [
      'left',
      'firstDrawRecorded',
      'ready',
      'pointerReady',
      'pressed',
      'accepted',
      'second',
      'stable',
    ])
      assert.equal(row[name], true, name + ': ' + JSON.stringify(row));
    if (baseline) {
      assert.ok(row.firstArrivalDelayMs >= 350, JSON.stringify(row));
      assert.equal(row.firstTailVisible, false);
    } else {
      for (const name of [
        'firstTailVisible',
        'releaseBeforeOldTailEnd',
        'secondTailVisible',
        'sourceRetained',
      ])
        assert.equal(row[name], true, name + ': ' + JSON.stringify(row));
      assert.ok(row.firstArrivalDelayMs < 80, JSON.stringify(row));
    }
    assert.equal(row.dragDrops, 1);
    assert.equal(row.displayId, 1);
    assert.deepEqual(row.errors, []);
  }
  writeFileSync(
    path.join(folder, 'report.json'),
    JSON.stringify({ passed: true, baseline, rows }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, baseline, folder, rows }));
} finally {
  await application?.close();
}
