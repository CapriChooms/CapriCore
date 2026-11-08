// SPDX-License-Identifier: GPL-3.0-only
// Native Chromium Web Audio DSP, synthetic PCM, no physical speakers, mic or VAC.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/call-audio-quality');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.cjs');
writeFileSync(
  entry,
  `
const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs');const path=require('node:path');
app.setPath('userData',${JSON.stringify(path.join(folder, 'profile'))});
protocol.registerSchemesAsPrivileged([{scheme:'capri',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 protocol.handle('capri',request=>{
  const url=new URL(request.url);
  if(url.pathname==='/quality.html')return new Response('<!doctype html><meta charset="utf-8"><title>Offline call audio verification</title>',{headers:{'content-type':'text/html','content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'none'"}});
  const name=url.pathname.slice(1);
  if(!['voice-player.mjs','voice-effects.mjs','voice-effects-settings.mjs','call-audio-settings.mjs'].includes(name))return new Response('',{status:404});
  return new Response(fs.readFileSync(path.join(${JSON.stringify(root)},'apps/desktop/renderer',name)),{headers:{'content-type':'text/javascript'}});
 });
 const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 window.webContents.setAudioMuted(true);
 await window.loadURL('capri://desktop/quality.html');
});app.on('window-all-closed',()=>app.quit());
`,
);
const report = {
  passed: false,
  ownerDataAccessed: false,
  physicalDevices: false,
  externalCalls: false,
  checks: [],
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
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const { VoicePlayer } = await import('./voice-player.mjs');
    const sink = 'capri-quality-synthetic-vac',
      duration = 1;
    let rate = 48000;
    const errors = [],
      contexts = [],
      factoryDevices = [];
    const devices = { addEventListener() {}, removeEventListener() {} };
    const outputs = async () => [{ kind: 'audiooutput', deviceId: sink, groupId: 'call-fixture' }];
    function tone(sampleRate, frequencies) {
      return Float32Array.from({ length: sampleRate * duration }, (_, i) =>
        frequencies.reduce(
          (sum, [hz, gain]) => sum + gain * Math.sin((2 * Math.PI * hz * i) / sampleRate),
          0,
        ),
      );
    }
    function clock(microphone = null) {
      const native = new OfflineAudioContext(1, Math.round(rate * 1.2), rate);
      let closed = false,
        currentSink = sink;
      const buffers = [];
      // Offline contexts have no sink/MediaStream API. Adapt only those boundaries;
      // all gains, analysers, compressor, sources and resampling remain native.
      const facade = new Proxy(native, {
        get(target, key) {
          if (key === 'state') return closed ? 'closed' : 'running';
          if (key === 'sinkId') return currentSink;
          if (key === 'setSinkId')
            return async (id) => {
              currentSink = id;
            };
          if (key === 'resume') return async () => {};
          if (key === 'close')
            return async () => {
              closed = true;
            };
          if (key === 'addEventListener' || key === 'removeEventListener') return () => {};
          if (key === 'createBuffer')
            return (...args) => {
              const buffer = target.createBuffer(...args);
              buffers.push({
                length: buffer.length,
                sampleRate: buffer.sampleRate,
                duration: buffer.duration,
              });
              return buffer;
            };
          if (key === 'createMediaStreamSource')
            return (stream) => {
              if (stream !== microphone) throw Error('Unexpected synthetic microphone.');
              const source = target.createBufferSource();
              source.buffer = target.createBuffer(1, stream.pcm.length, stream.rate);
              source.buffer.copyToChannel(stream.pcm, 0);
              source.start(0.01);
              return source;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const result = { native, facade, buffers };
      contexts.push(result);
      return result;
    }
    function microphone(sampleRate) {
      const frequencies = [
        [440, 0.06],
        ...(sampleRate >= 24000 ? [[8000, 0.025]] : []),
        ...(sampleRate >= 44100 ? [[12000, 0.025]] : []),
      ];
      const track = new EventTarget();
      Object.assign(track, {
        label: 'Synthetic physical microphone',
        readyState: 'live',
        getSettings: () => ({ sampleRate, groupId: 'physical-fixture' }),
      });
      return {
        rate: sampleRate,
        pcm: tone(sampleRate, frequencies),
        frequencies,
        getAudioTracks: () => [track],
      };
    }
    function magnitude(pcm, hz) {
      const first = Math.round(rate * 0.15),
        last = Math.round(rate * 0.85);
      let real = 0,
        imaginary = 0;
      for (let i = first; i < last; i++) {
        const angle = (2 * Math.PI * hz * i) / rate;
        real += pcm[i] * Math.cos(angle);
        imaginary -= pcm[i] * Math.sin(angle);
      }
      return (2 * Math.hypot(real, imaginary)) / (last - first);
    }
    function signal(pcm, hz) {
      let best = { hz: 0, amplitude: 0 };
      for (let delta = -3; delta <= 3; delta++) {
        const amplitude = magnitude(pcm, hz + delta);
        if (amplitude > best.amplitude) best = { hz: hz + delta, amplitude };
      }
      return best;
    }
    function activeDuration(pcm) {
      let first = -1,
        last = -1;
      for (let i = 0; i < pcm.length; i++)
        if (Math.abs(pcm[i]) > 0.002) {
          if (first < 0) first = i;
          last = i;
        }
      return first < 0 ? 0 : (last - first + 1) / rate;
    }
    const nativeAudio = window.AudioContext,
      options = [];
    try {
      window.AudioContext = function (value) {
        options.push(value);
        return clock().facade;
      };
      const defaultPlayer = new VoicePlayer({
        onState() {},
        onError: (error) => errors.push(String(error)),
        enumerateCallOutputs: outputs,
        mediaDevices: devices,
        contextFactory: () => clock().facade,
      });
      await defaultPlayer.enableCallOutput(sink);
      defaultPlayer.disableCallOutput();
    } finally {
      window.AudioContext = nativeAudio;
    }
    const rows = [];
    for (const outputRate of [44100, 48000]) {
      rate = outputRate;
      for (const [sourceRate, privatePreview, volume, liveChange = false] of [
        [16000, false],
        [24000, false],
        [44100, false],
        [48000, false],
        [48000, true],
        [0, false],
        [48000, false, 0],
        [48000, false, 25],
        [48000, false, 100],
        [48000, false, 25, true],
      ]) {
        const mic = sourceRate ? microphone(sourceRate) : null,
          call = clock(mic),
          speakers = clock();
        const started = [];
        const player = new VoicePlayer({
          onState() {},
          onError: (error) => errors.push(String(error)),
          onPlayback: (event) => {
            if (event.type === 'started') started.push(event);
          },
          contextFactory: () => speakers.facade,
          callContextFactory: (device) => {
            factoryDevices.push(device);
            return call.facade;
          },
          enumerateCallOutputs: outputs,
          mediaDevices: devices,
        });
        if (volume !== undefined && !liveChange) player.setCallVoiceVolume(volume);
        await player.enableCallOutput(sink, mic);
        await player.unlock();
        player.begin('quality-tone', { call: !privatePreview });
        const pcm = tone(24000, [[1230, 0.08]]),
          bytes = new Uint8Array(pcm.buffer);
        let encoded = '';
        for (let i = 0; i < bytes.length; i += 16000)
          encoded += String.fromCharCode(...bytes.subarray(i, i + 16000));
        player.accept({
          turnId: 'quality-tone',
          text: 'Synthetic tone only',
          sequence: 0,
          sampleRate: 24000,
          pcm: btoa(encoded),
        });
        for (let i = 0; i < 20 && !started.length; i++) await Promise.resolve();
        if (!started.length) throw Error('VoicePlayer did not schedule native TTS.');
        if (liveChange) player.setCallVoiceVolume(volume);
        player.finish('quality-tone');
        const [callAudio, speakerAudio] = await Promise.all([
          call.native.startRendering(),
          speakers.native.startRendering(),
        ]);
        const a = callAudio.getChannelData(0),
          b = speakerAudio.getChannelData(0);
        const row = {
          sourceRate,
          privatePreview,
          volume: volume ?? 50,
          liveChange,
          outputRate: callAudio.sampleRate,
          outputChannels: callAudio.numberOfChannels,
          destinationChannels: call.native.destination.channelCount,
          destinationMode: call.native.destination.channelCountMode,
          destinationMaximum: call.native.destination.maxChannelCount,
          callTts: signal(a, 1230),
          speakerTts: signal(b, 1230),
          speakerMic: signal(b, 440),
          callDuration: activeDuration(a),
          speakerDuration: activeDuration(b),
          scheduledTtsDurationMs: started[0].durationMs,
          ttsBuffers: call.buffers,
          microphoneSignals: mic
            ? mic.frequencies.map(([hz, gain]) => ({
                ...signal(a, hz),
                expectedHz: hz,
                inputAmplitude: gain,
              }))
            : [],
          peak: Math.max(...a.map(Math.abs)),
        };
        rows.push(row);
        player.stop();
        player.disableCallOutput();
      }
    }
    return { options, factoryDevices, rows, errors };
  });
  report.measurements = result;
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.options[0], {
    latencyHint: 'interactive',
    sinkId: 'capri-quality-synthetic-vac',
  });
  assert.ok(result.factoryDevices.every((value) => value === 'capri-quality-synthetic-vac'));
  report.checks.push(
    'The real default factory binds the selected sink at construction and leaves its preferred sample rate intact.',
  );
  assert.deepEqual([...new Set(result.rows.map((row) => row.outputRate))], [44100, 48000]);
  for (const row of result.rows) {
    assert.equal(row.outputChannels, 1);
    assert.equal(row.destinationChannels, 1);
    assert.equal(row.destinationMode, 'explicit');
    assert.ok(row.destinationChannels <= row.destinationMaximum);
    assert.equal(row.scheduledTtsDurationMs, 1000);
    for (const tone of row.microphoneSignals) {
      assert.ok(Math.abs(tone.hz - tone.expectedHz) <= 1);
      // Native cross-rate interpolation attenuates upper-band tones. Keep the
      // pitch and duration strict while allowing under 3.1 dB of that rolloff.
      const minimumGain = tone.expectedHz >= 8000 && row.sourceRate !== row.outputRate ? 0.7 : 0.8;
      assert.ok(
        tone.amplitude >= tone.inputAmplitude * minimumGain,
        'Microphone high-frequency content must survive native resampling: ' +
          JSON.stringify({ outputRate: row.outputRate, sourceRate: row.sourceRate, tone }),
      );
    }
    assert.ok(Math.abs(row.callDuration - 1) < 0.02);
    assert.ok(Math.abs(row.speakerDuration - 1) < 0.02);
    assert.ok(row.speakerTts.amplitude > 0.06 && Math.abs(row.speakerTts.hz - 1230) <= 1);
    assert.ok(
      row.speakerMic.amplitude < 0.0002,
      'The microphone must not echo into the local monitor.',
    );
    if (row.privatePreview)
      assert.ok(row.callTts.amplitude < 0.0002, 'A private preview must not reach the call.');
    else {
      const expected = row.volume / 100;
      const mixerGain = row.microphoneSignals.length
        ? row.microphoneSignals[0].amplitude / row.microphoneSignals[0].inputAmplitude
        : 1;
      assert.ok(
        Math.abs(row.callTts.amplitude / row.speakerTts.amplitude / mixerGain - expected) < 0.02,
        'Only Capri in the call must follow the volume, including live changes: ' +
          JSON.stringify(row),
      );
      if (row.volume > 0) assert.ok(Math.abs(row.callTts.hz - 1230) <= 1);
      assert.ok(
        row.ttsBuffers.some(
          (buffer) =>
            buffer.sampleRate === 24000 && buffer.length === 24000 && buffer.duration === 1,
        ),
      );
    }
    assert.ok(row.peak < 0.99);
  }
  for (const outputRate of [44100, 48000]) {
    const microphones = result.rows
      .filter(
        (row) => row.outputRate === outputRate && row.sourceRate === 48000 && !row.privatePreview,
      )
      .map((row) => row.microphoneSignals[0].amplitude);
    assert.ok(
      Math.max(...microphones) - Math.min(...microphones) < 0.003,
      'Changing Capri’s volume must not attenuate the microphone.',
    );
  }
  report.checks.push(
    '16k/24k/44.1k/48k microphones keep 440Hz pitch and 8–12kHz detail in both 44.1k and 48k mono mixers.',
  );
  report.checks.push(
    'One-second 24k TTS keeps 1230Hz pitch and duration while sharing the native mixer with microphone audio.',
  );
  report.checks.push(
    'Approved speech reaches call and local monitor; private previews remain local and the microphone is never echoed to speakers.',
  );
  report.checks.push(
    '0%, 25%, default 50% and 100% control only call TTS, including a live ramp; microphone pitch, level and local TTS stay unchanged.',
  );
  report.limitations = [
    'Native OfflineAudioContext renders the actual VoicePlayer DSP graph; only device clock/sink and MediaStream boundaries are synthetic.',
    'This does not measure a physical virtual-cable driver or an external call application.',
  ];
  report.passed = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks.length,
    folder,
    ...(report.error ? { error: report.error } : {}),
  }),
);
