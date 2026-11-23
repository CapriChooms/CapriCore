// SPDX-License-Identifier: GPL-3.0-only
// Real owned overlays and synthetic cursor input; no desktop capture or physical input.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
const parent = path.join(root, '.runtime/minimal-dialogue');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
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
app.whenReady().then(()=>{
 const root=${JSON.stringify(root)},catalog=requireCapriAvatar(root);
 const resources=createDesktopResources({root,directory:root+'/apps/desktop',catalog,spriteFile:catalog.sprites.find(s=>s.id===catalog.defaultId).file});
 protocol.handle('capri',request=>resourceResponse(request,resources));
 const owner=new BrowserWindow({show:false,width:440,height:600});
 void owner.loadURL('about:blank');
 const display={id:1,workArea:{x:0,y:0,width:1000,height:760}};
 const screen={getDisplayMatching:()=>display,getDisplayNearestPoint:()=>display,getAllDisplays:()=>[display],getCursorScreenPoint:()=>({x:20,y:20})};
 let presentation='dialogue', moving, clicks=0;
 const avatar=new AvatarDetach({BrowserWindow,screen,owner,verification:true,onPhase(){},getPresentation:()=>presentation,getEffects:()=>({avatarDragTether:false,avatarDragTetherDeadZone:30}),onClick:()=>clicks++,onDragDrop:(point,offset)=>{moving=avatar.hop(point,offset);}});
 const sprite={anchor:{x:620,y:1160},url:'capri://desktop/sprites/neutral.png'},canvas={width:1254,height:1254},mask={alpha:new Uint8Array(16).fill(255),imageSize:{width:4,height:4}};
 globalThis.minimalDialogueFixture={avatar,setStyle:async style=>{presentation=style;await avatar.refreshPresentation();},start:()=>avatar.leave({rect:{x:20,y:20,width:240,height:240},clip:{x:20,y:20,width:240,height:240}},sprite,canvas,mask,{x:500,y:540}),drag:async()=>{
  const hud=avatar.replyPlacement.hud, area=avatar.session.area;
  const point={x:hud.x+hud.width/2,y:hud.y+Math.min(8,hud.height/2)};
  const before={...avatar.desktopPoint};
  avatar.mouse({type:'mouseDown',button:'left',...point});
  const pressed=Boolean(avatar.press);
  avatar.mouse({type:'mouseMove',x:point.x+90,y:point.y+40});
  avatar.mouse({type:'mouseUp',button:'left',x:point.x+90,y:point.y+40,globalX:area.x+point.x+90,globalY:area.y+point.y+40});
  const moved=moving?await moving:false;
  return{pressed,moved,dx:avatar.desktopPoint.x-before.x,dy:avatar.desktopPoint.y-before.y,clicks};
 }};
});
app.on('window-all-closed',()=>app.quit());
`,
);
const report = { passed: false, physicalInput: false, screenCaptured: false };
let application;
try {
  const env = { ...process.env, TEMP: parent, TMP: parent };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
    env,
  });
  await application.firstWindow();
  assert.equal(await application.evaluate(() => globalThis.minimalDialogueFixture.start()), true);
  await application.evaluate(async () => {
    const { avatar } = globalThis.minimalDialogueFixture;
    avatar.sendStatus({ text: 'ONLINE', color: '#8ef5ed' });
    avatar.sendReply({
      text: 'A quiet green signal. Still here, choom.',
      turnId: 'synthetic-dialogue',
    });
    await avatar.updateParked('setReply', {
      text: 'A quiet green signal. Still here, choom.',
      turnId: 'synthetic-dialogue',
    });
  });
  const page = application.windows().find((page) => page.url().includes('avatar-detach.html'));
  assert(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () =>
      document.body.dataset.presentation === 'dialogue' &&
      !document.getElementById('avatar-reply').hidden,
  );
  const state = await page.evaluate(() => ({
    sprite: getComputedStyle(document.getElementById('parked-avatar')).visibility,
    color: getComputedStyle(document.getElementById('avatar-reply')).borderTopColor,
    effectHidden: document.getElementById('teleport-effect').hidden,
  }));
  assert.equal(state.sprite, 'hidden');
  assert.equal(state.color, 'rgb(89, 237, 145)');
  assert.equal(state.effectHidden, true);
  await page.screenshot({ path: path.join(folder, 'dialogue-only.png'), omitBackground: true });
  await page.evaluate(() => {
    window.dialogueDrawCount = 0;
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      window.dialogueDrawCount++;
      return original.apply(this, args);
    };
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.dialogueDrawCount), 0);
  const drag = await application.evaluate(() => globalThis.minimalDialogueFixture.drag());
  assert.equal(drag.pressed, true);
  assert.equal(drag.moved, true);
  assert.equal(drag.dx, 90);
  assert.equal(drag.dy, 40);
  assert.equal(drag.clicks, 0);
  await application.evaluate(() => globalThis.minimalDialogueFixture.setStyle('character'));
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById('parked-avatar')).visibility === 'visible',
  );
  assert.deepEqual(errors, []);
  Object.assign(report, { passed: true, staticCanvasDraws: 0, drag, restoredCharacter: true });
} catch (error) {
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (application)
    await application
      .evaluate(() => globalThis.minimalDialogueFixture?.avatar.reset())
      .catch(() => {});
  await application?.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report, folder }));
