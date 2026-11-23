// SPDX-License-Identifier: GPL-3.0-only
// Real detached renderer and mouse routing, using synthetic replies only.
// No models, external network, owner history, audio or physical input devices.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';

const root = process.cwd();
const parent = path.join(root, '.runtime/reply-navigation-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const entry = path.join(folder, 'main.mjs');
const moduleUrl = (file) => JSON.stringify(pathToFileURL(path.join(root, file)).href);
writeFileSync(
  entry,
  `
import {app,BrowserWindow,protocol} from 'electron';
import {writeFileSync} from 'node:fs';
import {requireCapriAvatar} from ${moduleUrl('apps/desktop/avatar-catalog.mjs')};
import {createDesktopResources} from ${moduleUrl('apps/desktop/main/resources.mjs')};
import {resourceResponse} from ${moduleUrl('apps/desktop/main/protocol.mjs')};
import {AvatarDetach} from ${moduleUrl('apps/desktop/main/avatar-detach.mjs')};
app.setPath('userData',${JSON.stringify(path.join(folder, 'profile'))});
protocol.registerSchemesAsPrivileged([{scheme:'capri',privileges:{secure:true,standard:true,supportFetchAPI:true}}]);
process.on('uncaughtException',error=>{writeFileSync(${JSON.stringify(path.join(folder, 'fixture-error.txt'))},error.stack||error.message);app.exit(1)});
app.whenReady().then(async()=>{
 const root=${JSON.stringify(root)},catalog=requireCapriAvatar(root);
 const resources=createDesktopResources({root,directory:root+'/apps/desktop',catalog,spriteFile:catalog.sprites[0].file});
 if(!resources.has('/reply-pages.mjs'))throw Error('ReplyPages must be in the actual renderer resource allowlist.');
 protocol.handle('capri',request=>resourceResponse(request,resources));
 const window=new BrowserWindow({x:0,y:0,width:1000,height:900,frame:false,show:false,backgroundColor:'#08131d',webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 const fixture=globalThis.replyFixture={window,pointer:{x:0,y:0},clicks:0,pats:0,drags:0,updates:[],ignores:[]};
 const ignore=window.setIgnoreMouseEvents.bind(window);
 window.setIgnoreMouseEvents=(...args)=>{fixture.ignores.push(args[0]);return ignore(...args)};
 const area=()=>({x:0,y:0,...Object.fromEntries(['width','height'].map(key=>[key,window.getContentBounds()[key]]))});
 const control=fixture.control=new AvatarDetach({BrowserWindow,owner:window,screen:{getCursorScreenPoint:()=>fixture.pointer,getDisplayMatching:()=>({id:1,bounds:area(),workArea:area()})},verification:true,onPhase:()=>{},onClick:()=>fixture.clicks++,onHeadpat:()=>fixture.pats++,onDragDrop:()=>fixture.drags++});
 control.phase='detached';control.overlay=window;
 control.session={area:area(),point:{x:500,y:700,scale:600},anchor:{x:641/1254,y:1164/1254},mask:null};
 const update=control.updateParked.bind(control);
 control.updateParked=(method,value)=>{fixture.updates.push(method);fixture.pending=update(method,value);return fixture.pending};
 fixture.reply=async(value)=>{control.sendReply(value);await fixture.pending;};
 fixture.click=async(action)=>{const target=action==='toggle'?control.replyEdge:control.replyControls.find(item=>item.action===action);if(!target)throw Error('Missing enabled '+action+' target');const point={x:target.x+target.width/2,y:target.y+target.height/2};control.mouse({type:'mouseDown',button:'left',...point});control.mouse({type:'mouseUp',button:'left',...point});await fixture.pending;};
 fixture.park=async(point,width=1000,height=900)=>{window.setContentSize(width,height);control.session.area=area();control.session.point=point;await window.webContents.executeJavaScript('globalThis.capriAvatarDetach.park('+JSON.stringify({point,anchor:control.session.anchor,url:'capri://desktop/sprites/music-floor.png',dock:'ground'})+')');if(control.reply)await control.updateParked('setReply',{...control.reply,collapsed:control.replyCollapsed});};
 await window.loadURL('capri://desktop/avatar-detach.html');
 await fixture.park(control.session.point);
 window.showInactive();
 fixture.ready=true;
}).catch(error=>{writeFileSync(${JSON.stringify(path.join(folder, 'fixture-error.txt'))},error.stack||error.message);app.exit(1)});
app.on('window-all-closed',()=>app.quit());
`,
);

const report = {
  passed: false,
  checks: [],
  ownerDataAccessed: false,
  providerRequests: false,
  physicalInput: false,
};
const env = {
  ...process.env,
  TEMP: path.join(root, '.runtime/git-preparation/tmp'),
  TMP: path.join(root, '.runtime/git-preparation/tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(globalThis.capriAvatarDetach?.stepReply));
  await application.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.replyFixture?.ready) {
      if (Date.now() > deadline) throw new Error('The synthetic avatar did not finish parking.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  await application.evaluate(async () => {
    const f = globalThis.replyFixture;
    await f.reply({
      text: 'Third reply',
      turnId: '3',
      history: [
        { id: '1', text: 'First reply' },
        { id: '2', text: 'Second reply' },
        { id: '3', text: 'Third reply' },
      ],
    });
  });
  const text = () => page.locator('#avatar-reply-text').textContent();
  const click = (action) =>
    application.evaluate(
      async (_electron, action) => globalThis.replyFixture.click(action),
      action,
    );
  assert.equal(await text(), 'Third reply');
  assert.equal(await page.locator('#avatar-reply-next').isDisabled(), true);
  await click('previous');
  assert.equal(await text(), 'Second reply');
  await click('previous');
  assert.equal(await text(), 'First reply');
  assert.equal(await page.locator('#avatar-reply-previous').isDisabled(), true);
  assert.equal(
    await application.evaluate(() =>
      globalThis.replyFixture.control.replyControls.some((item) => item.action === 'previous'),
    ),
    false,
  );
  await page.evaluate(() => capriAvatarDetach.stepReply(-1));
  assert.equal(await text(), 'First reply');
  await click('next');
  assert.equal(await text(), 'Second reply');
  report.checks.push(
    'Native mouse down/up routing browses Third → Second → First → Second; disabled boundaries cannot move.',
  );

  const routing = await application.evaluate(() => {
    const f = globalThis.replyFixture,
      c = f.control,
      target = c.replyControls.find((item) => item.action === 'next');
    f.pointer = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    c.updatePointer();
    return { interactive: c.acceptsPointer, target: c.replyTarget(f.pointer) };
  });
  assert.deepEqual(routing, { interactive: true, target: 'next' });
  const bubble = await page.locator('#avatar-reply').boundingBox();
  assert.equal(
    await application.evaluate(
      (_electron, point) => {
        const f = globalThis.replyFixture;
        f.pointer = point;
        f.control.updatePointer();
        return f.control.acceptsPointer;
      },
      { x: bubble.x + 20, y: bubble.y + 10 },
    ),
    false,
  );
  report.checks.push(
    'Enabled arrows receive native input while the reply body passes clicks through.',
  );

  await click('toggle');
  assert.equal(await page.locator('#avatar-reply').isVisible(), false);
  await application.evaluate(async () => {
    const f = globalThis.replyFixture,
      c = f.control;
    f.pointer = { x: 0, y: 0 };
    c.updatePointer();
    const edge = c.replyEdge;
    f.pointer = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 };
    c.updatePointer();
    await f.pending;
  });
  await click('toggle');
  assert.equal(await text(), 'Second reply');
  await application.evaluate(async () => {
    const f = globalThis.replyFixture;
    await f.reply({
      text: 'Fourth live reply',
      turnId: '4',
      history: [
        { id: '1', text: 'First reply' },
        { id: '2', text: 'Second reply' },
        { id: '3', text: 'Third reply' },
        { id: '4', text: 'Fourth live reply' },
      ],
    });
  });
  assert.equal(await text(), 'Fourth live reply');
  assert.equal(await page.locator('#avatar-reply-next').isDisabled(), true);
  report.checks.push(
    'Collapsing and reopening preserves the selected page; a new reply resumes live following.',
  );
  await application.evaluate(async () => {
    const f = globalThis.replyFixture;
    await f.reply({
      text: 'Fourth live reply',
      turnId: '4',
      history: [{ id: '4', text: 'Fourth live reply ' + 'Following streamed detail. '.repeat(24) }],
    });
  });
  assert.equal(await text(), 'Fourth live reply');
  assert.equal(await page.locator('#avatar-reply-next').isDisabled(), false);
  await click('next');
  assert.ok((await text()).includes('streamed detail'));
  report.checks.push(
    'Growing history enables Next even when the current live cue has not changed.',
  );

  const unicode =
    '日本語の長い説明と絵文字 🛰️✨。 العربية نص تجريبي طويل. 한글 설명을 확인합니다. '.repeat(26);
  await application.evaluate(async (_electron, unicode) => {
    const f = globalThis.replyFixture;
    await f.park({ x: 250, y: 180, scale: 600 }, 600, 700);
    await f.reply({
      text: 'A short live cue.',
      turnId: 'live',
      history: [
        { id: 'long', text: unicode },
        { id: 'live', text: 'A short live cue.' },
      ],
    });
  }, unicode);
  await click('previous');
  const pages = [];
  for (let index = 0; index < 80; index++) {
    pages.push(
      await page.evaluate(() => {
        const bubble = document.getElementById('avatar-reply').getBoundingClientRect();
        const text = document.getElementById('avatar-reply-text');
        const nav = document.getElementById('avatar-reply-controls').getBoundingClientRect();
        const previous = document.getElementById('avatar-reply-previous');
        const next = document.getElementById('avatar-reply-next');
        const boxes = [previous, next].map((item) => item.getBoundingClientRect());
        return {
          text: text.textContent,
          clientHeight: text.clientHeight,
          scrollHeight: text.scrollHeight,
          bubble: {
            x: bubble.x,
            y: bubble.y,
            width: bubble.width,
            right: bubble.right,
            bottom: bubble.bottom,
          },
          nav: { right: nav.right, bottom: nav.bottom },
          buttons: boxes.map((rect) => ({ right: rect.right, bottom: rect.bottom })),
          previous: !previous.disabled,
          position: document.getElementById('avatar-reply-position').textContent,
        };
      }),
    );
    if (!pages.at(-1).previous) break;
    await click('previous');
  }
  assert.ok(pages.length > 3 && pages.length < 80, 'The complete long reply must be reachable.');
  assert.equal(
    [...pages]
      .reverse()
      .map((state) => state.text)
      .join('')
      .replace(/\s/gu, ''),
    unicode.replace(/\s/gu, ''),
    'History pagination must preserve every Unicode character.',
  );
  assert.ok(pages[0].bubble.width < 300, 'The fixture must exercise the narrow side placement.');
  for (const state of pages) {
    assert.ok(
      state.scrollHeight <= state.clientHeight + 1,
      'A Unicode page must not be vertically clipped.',
    );
    assert.ok(
      state.bubble.x >= 0 &&
        state.bubble.y >= 0 &&
        state.bubble.right <= 600 &&
        state.bubble.bottom <= 700,
    );
    assert.ok(state.nav.right <= state.bubble.right && state.nav.bottom <= state.bubble.bottom);
    for (const button of state.buttons)
      assert.ok(button.right <= state.bubble.right && button.bottom <= state.bubble.bottom);
  }
  await page.screenshot({ path: path.join(folder, 'unicode-navigation.png') });
  report.checks.push(
    `Long Unicode history is readable over ${pages.length} pages, with bottom-right controls inside the narrow reply bubble.`,
  );
  await application.evaluate(async () =>
    globalThis.replyFixture.reply({ text: '', turnId: '', history: [] }),
  );
  assert.equal(await page.locator('#avatar-reply').isVisible(), false);
  assert.deepEqual(
    await application.evaluate(() => globalThis.replyFixture.control.replyControls),
    [],
  );
  const actions = await application.evaluate(() => {
    const f = globalThis.replyFixture;
    return {
      clicks: f.clicks,
      pats: f.pats,
      drags: f.drags,
      press: f.control.press,
      replyPress: f.control.replyPress,
    };
  });
  assert.equal(actions.clicks, 0);
  assert.equal(actions.pats, 0);
  assert.equal(actions.drags, 0);
  assert.ok(!actions.press && !actions.replyPress);
  assert.deepEqual(errors, []);
  report.checks.push(
    'Clearing removes reply controls; navigation never triggers avatar grabs, head pats or dragging.',
  );
  report.passed = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report, folder }));
