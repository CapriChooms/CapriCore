// SPDX-License-Identifier: GPL-3.0-only
// Real Chromium AudioWorklet + generated anti-phase stereo, with every OS media
// permission denied. No microphone, desktop loopback, user window or provider.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = process.cwd(),
  parent = path.join(root, '.runtime/music-capture-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const renderer = path.join(root, 'apps/desktop/renderer');
const entry = path.join(folder, 'main.cjs');
const paths = Object.fromEntries(
  ['system-music-capture.mjs', 'music-worklet.mjs', 'microphone-worklet.mjs'].map((name) => [
    '/' + name,
    path.join(renderer, name),
  ]),
);
const html = `<!doctype html><meta charset="utf-8"><title>Capri music capture verification</title><style>body{background:#07141b;color:#b4ffff;font:18px system-ui;padding:32px}button{background:#10313a;color:#b4ffff;border:1px solid #7ddbd7;padding:12px 20px}p{max-width:650px}</style><h1>System music capture</h1><p>Synthetic stereo only. OS microphone and display permissions are denied.</p><button id="start">Start synthetic stream</button><p id="status">off</p><p id="packets">0 packets</p><script type="module" src="/fixture.mjs"></script>`;
const fixtureModule = `
import { SystemMusicClient } from './system-music-capture.mjs';
const state = { packets:[], errors:[], states:[], microphoneRequests:0, displayRequests:0, hostStops:0, denied:false, session:0 };
let sourceContext, source, canvasTrack, audioTrack;
const client = new SystemMusicClient({
  api: {
    async musicAudioStart(){ return { sessionId:'synthetic-'+(++state.session),sampleRate:16000 }; },
    async prepareMusicAudio(){ return true; }, async cancelMusicAudio(){ return true; },
    async musicAudioReady(){ return { accepted:true }; }, async musicAudioStop(){ state.hostStops++; return true; },
    async musicAudioPacket(packet){
      const samples = new Float32Array(packet.pcm.buffer,packet.pcm.byteOffset,packet.pcm.byteLength/4);
      let energy=0;for(const sample of samples){if(!Number.isFinite(sample))throw Error('Nonfinite sample');energy+=sample*sample;}
      state.packets.push({sessionId:packet.sessionId,sequence:packet.sequence,bytes:packet.pcm.byteLength,rms:Math.sqrt(energy/samples.length)});
      document.getElementById('packets').textContent=state.packets.length+' packets';
      return state.packets.length===1?{accepted:false,ready:false}:{accepted:true};
    },
  },
  contextFactory:()=>new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),
  mediaDevices:{
    async getUserMedia(){state.microphoneRequests++;throw Error('OS microphone forbidden');},
    async getDisplayMedia(){
      state.displayRequests++;
      if(state.denied)throw Error('private-fixture-native-error');
      sourceContext=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});await sourceContext.resume();
      source=sourceContext.createOscillator();source.frequency.value=440;
      const left=sourceContext.createGain(),right=sourceContext.createGain();left.gain.value=0.25;right.gain.value=-0.25;
      const merger=sourceContext.createChannelMerger(2),destination=sourceContext.createMediaStreamDestination();
      source.connect(left).connect(merger,0,0);source.connect(right).connect(merger,0,1);merger.connect(destination);source.start();
      audioTrack=destination.stream.getAudioTracks()[0];
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
      canvasTrack=canvas.captureStream(1).getVideoTracks()[0];
      return new MediaStream([audioTrack,canvasTrack]);
    },
  },
  onState(value){state.states.push(value.status);document.getElementById('status').textContent=value.status;},
  onError(value){state.errors.push(value);},
});
window.fixture={state,client,tracks:()=>({video:canvasTrack?.readyState,audio:audioTrack?.readyState}),
  close:async()=>{client.stop();try{source?.stop();}catch{}await sourceContext?.close();}};
document.getElementById('start').onclick=()=>client.start();
`;
writeFileSync(
  entry,
  `const {app,BrowserWindow,protocol,session}=require('electron');
const {readFileSync}=require('node:fs');
const files=${JSON.stringify(paths)}, html=${JSON.stringify(html)}, fixture=${JSON.stringify(fixtureModule)};
globalThis.musicOsPermissions=0;
protocol.registerSchemesAsPrivileged([{scheme:'capri-music-verify',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(()=>{
session.defaultSession.setPermissionRequestHandler((_w,_p,respond)=>{globalThis.musicOsPermissions++;respond(false);});
session.defaultSession.setPermissionCheckHandler(()=>false);
protocol.handle('capri-music-verify',req=>{const name=new URL(req.url).pathname;const headers={'content-type':name.endsWith('.mjs')?'text/javascript':'text/html','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; media-src blob:; worker-src 'self' blob:"};if(name==='/')return new Response(html,{headers});if(name==='/fixture.mjs')return new Response(fixture,{headers});if(files[name])return new Response(readFileSync(files[name]),{headers});return new Response(null,{status:404});});
const win=new BrowserWindow({width:760,height:460,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
win.once('ready-to-show',()=>win.showInactive());win.loadURL('capri-music-verify://app/');
});app.on('window-all-closed',()=>app.quit());`,
);
const report = {
  passed: false,
  folder,
  actualAudioWorklet: true,
  capturedSystemAudio: false,
  physicalMicrophone: false,
  ownerHistoryChanged: false,
  checks: [],
};
let application;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.fixture));
  await page.locator('#start').click();
  await page.waitForFunction(() => window.fixture.state.packets.length >= 3, null, {
    timeout: 15000,
  });
  const first = await page.evaluate(() => ({
    packets: window.fixture.state.packets,
    tracks: window.fixture.tracks(),
    status: window.fixture.client.state.status,
  }));
  assert.equal(first.status, 'listening');
  assert.equal(first.tracks.video, 'ended');
  assert.equal(first.tracks.audio, 'live');
  assert(first.packets.every((packet) => packet.bytes === 32000));
  assert(first.packets.slice(1).every((packet) => packet.rms > 0.15 && packet.rms < 0.2));
  report.checks.push(
    'real AudioWorklet resamples generated anti-phase stereo to finite half-second 16k PCM',
  );
  report.checks.push('video discarded immediately; no microphone or audible monitoring');
  await page.evaluate(() => window.fixture.client.playback({ speaking: true }));
  const beforeVoice = await page.evaluate(() => window.fixture.state.packets.length);
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => window.fixture.state.packets.length), beforeVoice);
  await page.evaluate(() => window.fixture.client.playback({ speaking: false }));
  await page.waitForFunction(
    (before) => window.fixture.state.packets.length > before,
    beforeVoice,
    { timeout: 3000 },
  );
  report.checks.push('own speech and playback tail suppress packets without ending capture');
  const beforeHide = await page.evaluate(() => window.fixture.state.packets.length);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.waitForFunction((before) => window.fixture.state.packets.length > before, beforeHide, {
    timeout: 4000,
  });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  report.checks.push('capture graph continues while the own fixture window is hidden');
  await page.evaluate(() =>
    window.fixture.client.setState({ stoppedSessionId: window.fixture.client.run.id }),
  );
  assert.equal(await page.evaluate(() => window.fixture.client.state.status), 'off');
  assert.equal(await page.evaluate(() => window.fixture.tracks().audio), 'ended');
  assert.equal(await page.evaluate(() => window.fixture.state.hostStops), 0);
  report.checks.push('host stop revokes exact session and stops every generated track');
  await page.evaluate(() => {
    window.fixture.state.denied = true;
  });
  await page.locator('#start').click();
  await page.waitForFunction(() => window.fixture.state.errors.length > 0);
  const privateState = await page.evaluate(() => ({
    microphoneRequests: window.fixture.state.microphoneRequests,
    errors: window.fixture.state.errors,
    status: window.fixture.client.state.status,
  }));
  assert.equal(privateState.microphoneRequests, 0);
  assert.equal(privateState.status, 'off');
  assert(!JSON.stringify(privateState.errors).includes('private-fixture'));
  assert.equal(await application.evaluate(() => globalThis.musicOsPermissions), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(folder, 'capture-verification.png') });
  report.checks.push(
    'denied capture fails safely without private error text or OS permission requests',
  );
  report.packetCount = await page.evaluate(() => window.fixture.state.packets.length);
  await page.evaluate(() => window.fixture.close());
  report.passed = true;
} finally {
  await application?.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
