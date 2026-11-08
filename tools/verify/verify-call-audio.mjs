// SPDX-License-Identifier: GPL-3.0-only
/** Exercise real call controls. Live VB-CABLE use requires closed calls. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const virtualOutput = 'capri-synthetic-call-cable';
const windowsCable = process.argv.includes('--windows-cable');
const steamCable = process.argv.includes('--steam-cable');
if (steamCable) throw new Error('Steam transport is not supported. Use a paired VB-CABLE device.');
if (windowsCable && process.platform !== 'win32') throw new Error('Windows is required.');
const cableLabel = windowsCable ? 'CABLE' : 'CABLE Input (VB-Audio Virtual Cable)';
const samples = windowsCable ? 12000 : 2400;
const assistantReply = 'This is the reviewed test reply.';
const parent = path.join(root, '.runtime', 'call-audio-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'test-main.mjs');
const state = path.join(folder, 'desktop');
mkdirSync(state, { recursive: true });
writeFileSync(path.join(state, 'voice.json'), '{"enabled":true}');
writeFileSync(
  entry,
  `
import { BrowserWindow } from 'electron';
import { VoiceService } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/voice-service.mjs')).href)};
import { ASRWorker } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/asr-worker.mjs')).href)};
const visible = new WeakSet();
BrowserWindow.prototype.show = BrowserWindow.prototype.showInactive = function () { visible.add(this); };
BrowserWindow.prototype.isVisible = function () { return visible.has(this); };
Object.defineProperty(VoiceService.prototype, 'ready', { get: () => true, set: () => {} });
const fixture = globalThis.callAudioFixture = { previews: [], callPrompts: [] };
ASRWorker.prototype.send = async function () { this.child = {}; };
ASRWorker.prototype.close = function () { this.child = null; };
const fetchNative = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (String(url).endsWith('/api/chat') && typeof options?.body === 'string') {
    const request = JSON.parse(options.body);
    if (request.format?.properties?.route && request.messages.length === 2) {
      const input = request.messages[1].content;
      fixture.callPrompts.push(input);
      const reply = input.includes('private') ? 'For you only.' : 'Hello, everyone.';
      const route = input.includes('private') ? 'owner' : 'owner-and-call';
      return Promise.resolve(Response.json({ message: { content: JSON.stringify({ route, reply }) } }));
    }
  }
  return fetchNative(url, options);
};
const syntheticAudio = (service, turnId, text) => {
  setTimeout(() => {
    const pcm = Buffer.alloc(${samples} * 4);
    if (${windowsCable})
      for (let index = 0; index < ${samples}; index++)
        pcm.writeFloatLE(0.18 * Math.sin(2 * Math.PI * 1230 * index / 24000), 4 * index);
    service.emit({
      type: 'voice.audio', turnId, text, sequence: 0, sampleRate: 24000,
      pcm: pcm.toString('base64'),
    });
    service.emit({ type: 'voice.generated', turnId });
  }, 15);
};
VoiceService.prototype.preview = function (turnId, text) {
  fixture.previews.push(text);
  syntheticAudio(this, turnId, text);
};
VoiceService.prototype.onChat = function (event) {
  if (event.type === 'turn.completed' && this.enabled)
    syntheticAudio(this, event.turnId, event.assistant.text);
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);

const server = createServer((request, response) => {
  if (request.url === '/v1/models') return response.end('{"data":[]}');
  if (request.url === '/v1/chat/completions') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    return response.end(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: assistantReply } }] }) +
        '\n\ndata: [DONE]\n\n',
    );
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '1',
};
delete env.ELECTRON_RUN_AS_NODE;

let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 30000,
  });
  const companion = await application.firstWindow();
  const errors = [];
  companion.on('pageerror', (error) => errors.push(error.message));
  await application.evaluate(({ BrowserWindow }, useCable) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'capri://desktop/index.html',
    );
    window.showInactive();
    if (!useCable) window.webContents.setAudioMuted(true);
    window.webContents.setBackgroundThrottling(false);
  }, windowsCable);
  await companion.waitForFunction(() => document.body.dataset.phase === 'ready');
  await companion.evaluate(
    ({ deviceId, windowsCable, cableLabel, samples }) => {
      const fixture = (window.callAudioFixture = {
        deviceId,
        connected: true,
        destinations: [],
        micDestinations: [],
      });
      const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      const getInput = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      if (windowsCable) {
        // Use the actual cable while keeping every other fixture audio context inaudible.
        window.AudioContext = new Proxy(AudioContext, {
          construct: (target, [options], newTarget) =>
            Reflect.construct(
              target,
              [
                options?.sinkId === fixture.deviceId
                  ? options
                  : { ...options, sinkId: { type: 'none' } },
              ],
              newTarget,
            ),
        });
        navigator.mediaDevices.enumerateDevices = async () => {
          const devices = await enumerate();
          const specific = devices.filter(
            ({ deviceId }) => deviceId && !['default', 'communications'].includes(deviceId),
          );
          let pair;
          for (const family of ['', '-A', '-B', '-C', '-D']) {
            const inputs = specific.filter(
              ({ kind, label }) =>
                kind === 'audioinput' &&
                new RegExp('\\bCABLE' + family + ' Output\\b', 'i').test(label),
            );
            const outputs = specific.filter(
              ({ kind, label }) =>
                kind === 'audiooutput' &&
                new RegExp('\\bCABLE' + family + ' Input\\b', 'i').test(label),
            );
            if (inputs.length === 1 && outputs.length === 1) {
              pair = { input: inputs[0], output: outputs[0] };
              break;
            }
          }
          if (!pair) throw new Error('No unambiguous paired VB-CABLE device.');
          fixture.pair = pair;
          fixture.deviceId = pair.output.deviceId;
          return devices.filter((device) => {
            const virtual = /cable|steam streaming|voicemeeter|virtual/i.test(device.label);
            return (
              !virtual ||
              (fixture.connected &&
                [pair.input.deviceId, pair.output.deviceId].includes(device.deviceId))
            );
          });
        };
        fixture.startCableProbe = async () => {
          const input = fixture.pair?.input;
          if (!input)
            throw new Error(
              'The native test requires the selected paired virtual recording endpoint.',
            );
          const stream = await getInput({
            video: false,
            audio: {
              deviceId: { exact: input.deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          const tracks = stream.getAudioTracks();
          const actualInput = tracks[0]?.getSettings?.()?.deviceId;
          if (tracks.length !== 1 || (actualInput && actualInput !== input.deviceId)) {
            for (const track of stream.getTracks()) track.stop();
            throw new Error('Virtual capture endpoint verification failed.');
          }
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0;
          context.createMediaStreamSource(stream).connect(analyser).connect(context.destination);
          await context.resume();
          const frequencies = new Float32Array(analyser.frequencyBinCount);
          const peaks = (hz) => {
            const center = Math.round((hz * analyser.fftSize) / context.sampleRate);
            return Math.max(frequencies[center - 1], frequencies[center], frequencies[center + 1]);
          };
          const timer = setInterval(() => {
            analyser.getFloatFrequencyData(frequencies);
            fixture.cableMicLevel = peaks(440);
            fixture.cableReplyLevel = peaks(1230);
            fixture.cableContext = context.state;
            // Require a narrow peak, not just energy in a bin: resampling noise or
            // other software sharing the endpoint must not look like our test voice.
            fixture.cableMic =
              peaks(440) > -54 && peaks(440) > Math.max(peaks(340), peaks(540)) + 10;
            fixture.cableReply =
              peaks(1230) > -54 && peaks(1230) > Math.max(peaks(1130), peaks(1330)) + 10;
            fixture.cableMixed ||= fixture.cableMic && fixture.cableReply;
          }, 20);
          fixture.stopCableProbe = () => {
            clearInterval(timer);
            for (const track of stream.getTracks()) track.stop();
            void context.close();
          };
        };
      } else {
        const NativeAudioContext = window.AudioContext;
        window.AudioContext = new Proxy(NativeAudioContext, {
          construct: (target, [options], newTarget) => {
            const syntheticCall = options?.sinkId === deviceId;
            const context = Reflect.construct(
              target,
              syntheticCall ? [{ ...options, sinkId: { type: 'none' } }] : options ? [options] : [],
              newTarget,
            );
            if (syntheticCall) context.callTestSink = deviceId;
            return context;
          },
        });
        navigator.mediaDevices.enumerateDevices = async () => [
          { kind: 'audiooutput', deviceId: 'default', label: 'Default output' },
          { kind: 'audioinput', deviceId: 'physical-mic', label: 'Synthetic physical microphone' },
          { kind: 'audioinput', deviceId: 'steam-recording', label: 'Steam Streaming Microphone' },
          { kind: 'audiooutput', deviceId: 'steam-playback', label: 'Steam Streaming Microphone' },
          ...(fixture.connected
            ? [
                {
                  kind: 'audioinput',
                  deviceId: 'call-recording',
                  label: 'CABLE Output (VB-Audio Virtual Cable)',
                },
              ]
            : []),
          ...(fixture.connected ? [{ kind: 'audiooutput', deviceId, label: cableLabel }] : []),
        ];
        AudioContext.prototype.setSinkId = async function (id) {
          if (id !== deviceId || !fixture.connected) throw new Error('Wrong output');
          this.callTestSink = id;
        };
        const realSink = Object.getOwnPropertyDescriptor(AudioContext.prototype, 'sinkId').get;
        Object.defineProperty(AudioContext.prototype, 'sinkId', {
          get() {
            return this.callTestSink ?? realSink.call(this);
          },
        });
      }
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const source = new AudioContext();
        const oscillator = source.createOscillator();
        const gain = source.createGain();
        gain.gain.value = 0.1; // A realistic microphone level, avoiding driver/limiter clipping.
        const destination = source.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await source.resume();
        fixture.physical = destination.stream;
        const track = fixture.physical.getAudioTracks()[0];
        Object.defineProperty(track, 'label', { value: 'Synthetic physical microphone' });
        const physicalId =
          constraints?.audio?.deviceId?.exact ||
          (windowsCable
            ? (await enumerate()).find(
                ({ kind, deviceId, label }) =>
                  kind === 'audioinput' &&
                  !['default', 'communications'].includes(deviceId) &&
                  !/cable|steam|virtual|loopback|stereo mix/i.test(label),
              )?.deviceId
            : 'physical-mic');
        track.getSettings = () => ({ deviceId: physicalId, sampleRate: 48000, channelCount: 1 });
        return fixture.physical;
      };
      const connect = MediaStreamAudioSourceNode.prototype.connect;
      MediaStreamAudioSourceNode.prototype.connect = function (...args) {
        if (this.mediaStream === fixture.physical)
          fixture.micDestinations.push(
            typeof this.context.sinkId === 'string' ? this.context.sinkId : '',
          );
        return connect.apply(this, args);
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.buffer?.length === samples && this.buffer?.sampleRate === 24000)
          fixture.destinations.push(
            typeof this.context.sinkId === 'string' ? this.context.sinkId : '',
          );
        if (windowsCable) start.apply(this, args);
        else queueMicrotask(() => this.onended?.());
      };
    },
    { deviceId: virtualOutput, windowsCable, cableLabel, samples },
  );
  assert.equal(await companion.locator('#call-speak').isVisible(), false);
  await assert.rejects(
    companion.evaluate(
      (deviceId) => window.capri.callAudioCommand({ action: 'output-on', deviceId }),
      virtualOutput,
    ),
    /Open Voice calls in Settings/,
  );
  assert.deepEqual(await companion.evaluate(() => window.capri.callAudioDevices()), []);

  const settings = await settingsView(application, 'calls');
  const waitCable = async (condition, stage) =>
    companion.waitForFunction(condition).catch(async (error) => {
      const details = await companion.evaluate(() => ({
        mic: window.callAudioFixture.physical?.getAudioTracks()[0].readyState,
        micLevel: window.callAudioFixture.cableMicLevel,
        replyLevel: window.callAudioFixture.cableReplyLevel,
        context: window.callAudioFixture.cableContext,
        call: !document.getElementById('call-output-stop').hidden,
        destinations: window.callAudioFixture.destinations.length,
      }));
      throw new Error(stage + ': ' + JSON.stringify(details), { cause: error });
    });
  settings.on('pageerror', (error) => errors.push(error.message));
  assert.equal(await settings.locator('#call-voice-volume').inputValue(), '50');
  await assert.rejects(
    companion.evaluate(() =>
      window.capri.callAudioCommand({ action: 'voice-volume', volume: 100 }),
    ),
    /Open Voice calls in Settings/,
  );
  // Volume is independent of connecting a cable and never arms a microphone.
  await settings.locator('#call-voice-volume').evaluate((input) => {
    input.value = '17';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settings.waitForFunction(
    async () => (await window.capri.callAudioCommand({ action: 'state' })).callVoiceVolume === 17,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(state, 'call-audio.json'), 'utf8')).settings.callVoiceVolume,
    17,
  );
  assert.equal((await companion.evaluate(() => window.capri.bootstrap())).callVoiceVolume, 17);
  assert.equal(await companion.evaluate(() => Boolean(window.callAudioFixture.physical)), false);
  await settings.locator('#call-voice-volume').evaluate((input) => {
    for (const value of ['0', '100', '25']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settings.waitForFunction(
    async () => (await window.capri.callAudioCommand({ action: 'state' })).callVoiceVolume === 25,
  );
  assert.equal(await settings.locator('#call-voice-volume-value').innerText(), '25%');
  const output = settings.locator('#call-output-device');
  assert.equal(await settings.locator('#call-output-mix-mic').isChecked(), true);
  // The primary setup works before enabling speech recognition or loading its model.
  await assert.rejects(
    companion.evaluate(() => window.capri.callAudioSetup('install')),
    /Settings/,
  );
  if (!windowsCable) {
    await companion.evaluate(() => {
      window.callAudioFixture.connected = false;
    });
    await settings.locator('#call-setup-connect').click();
    await settings.locator('#call-setup-install-options').waitFor({ state: 'visible' });
    assert.equal(await output.locator('option[value="steam-playback"]').count(), 0);
    assert.equal(await settings.locator('#call-setup-recording').isVisible(), false);
    assert.equal(await settings.locator('#call-setup-install').isDisabled(), true);
    await settings.locator('#call-setup-consent').check();
    assert.equal(await settings.locator('#call-setup-install').isDisabled(), false);
    await settings.screenshot({ path: path.join(folder, 'install-virtual-microphone.png') });
    await companion.evaluate(() => {
      window.callAudioFixture.connected = true;
    });
  }
  await settings.locator('#call-setup-connect').click();
  await settings
    .waitForFunction(() => document.getElementById('call-setup-status').dataset.phase === 'ready')
    .catch(async (error) => {
      throw new Error(
        JSON.stringify({
          state: await settings.evaluate(() => window.capri.callAudioSetup('state')),
          status: await settings.locator('#call-setup-status').innerText(),
          errors,
        }),
        { cause: error },
      );
    });
  assert.match(await settings.locator('#call-setup-recording-name').innerText(), /CABLE Output/);
  assert.notEqual(
    (await companion.evaluate(() => window.capri.bootstrap())).microphone.status,
    'listening',
  );
  await settings.screenshot({ path: path.join(folder, 'automatic-voice-calls.png') });
  await settings.locator('#call-output-disable').click();
  assert.equal(
    await companion.evaluate(() => window.callAudioFixture.physical.getAudioTracks()[0].readyState),
    'ended',
  );
  await companion.evaluate(() => {
    window.callAudioFixture.micDestinations = [];
  });
  await settings.locator('#call-output-advanced > summary').click();
  await companion.locator('#microphone-toggle').evaluate((button) => button.click());
  await settings.waitForFunction(() => !document.getElementById('call-system-enable').disabled);
  await settings.locator('#call-output-refresh').click();
  const cable = output.locator('option').filter({ hasText: cableLabel });
  await cable.waitFor({ state: 'attached' });
  assert.equal(await output.locator('option[value="default"]').count(), 0);
  const outputId = await cable.getAttribute('value');
  await companion.evaluate((id) => {
    window.callAudioFixture.deviceId = id;
  }, outputId);
  await output.selectOption(outputId);
  await settings.locator('#call-output-enable').click();
  await settings.waitForFunction(() =>
    document.getElementById('call-output-status').textContent.includes('live'),
  );
  assert.equal(await settings.locator('#call-output-share-replies').isChecked(), true);
  await settings.locator('#call-output-share-replies').uncheck();
  await settings.waitForFunction(
    () => !document.getElementById('call-output-share-replies').disabled,
  );
  if (windowsCable) {
    await companion.evaluate(() => window.callAudioFixture.startCableProbe());
    await companion
      .waitForFunction(
        () => window.callAudioFixture.cableMic && !window.callAudioFixture.cableReply,
      )
      .catch(async (error) => {
        throw new Error(
          JSON.stringify(
            await companion.evaluate(async () => ({
              output: (await window.capri.bootstrap()).callAudio,
              mic: window.callAudioFixture.physical.getAudioTracks()[0].readyState,
              micLevel: window.callAudioFixture.cableMicLevel,
              replyLevel: window.callAudioFixture.cableReplyLevel,
              context: window.callAudioFixture.cableContext,
              callButton: !document.getElementById('call-output-stop').hidden,
            })),
          ),
          { cause: error },
        );
      });
  }
  await assert.rejects(
    companion.evaluate(() =>
      window.capri.speakInCall({
        id: crypto.randomUUID(),
        text: 'Unauthorized inference',
        model: true,
      }),
    ),
    /Enable model-selected replies/,
  );
  await settings.locator('#call-output-allow-model').check();
  await settings.locator('#settings-window-close').click();

  const callButton = companion.locator('#call-speak');
  const composer = companion.locator('#message');
  const spokenText = 'Testing an approved call sentence.';
  await composer.fill(spokenText);
  await callButton.click();
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 2);
  if (windowsCable) {
    await waitCable(() => window.callAudioFixture.cableMixed, 'approved reply mixed');
    await waitCable(
      () => window.callAudioFixture.cableMic && !window.callAudioFixture.cableReply,
      'microphone after reply',
    );
    await companion.evaluate(() => {
      window.callAudioFixture.cableMixed = false;
    });
  }
  assert.deepEqual(await companion.evaluate(() => window.callAudioFixture.micDestinations), [
    '',
    outputId,
  ]);
  assert.deepEqual(await application.evaluate(() => globalThis.callAudioFixture.previews), [
    spokenText,
  ]);

  await composer.fill('Give me the test reply.');
  await composer.press('Enter');
  await companion.waitForSelector('.message[data-role="assistant"][data-status="complete"]', {
    state: 'attached',
  });
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 3);
  if (windowsCable) {
    await companion.waitForTimeout((samples / 24000) * 1000 + 250);
    assert.deepEqual(
      await companion.evaluate(() => {
        const { cableMic, cableMixed, stopCableProbe } = window.callAudioFixture;
        stopCableProbe();
        return { cableMic, cableMixed };
      }),
      { cableMic: true, cableMixed: false },
      'Ordinary replies must leave the physical microphone by itself on the actual cable',
    );
  }
  assert.deepEqual(await companion.evaluate(() => window.callAudioFixture.destinations), [
    '',
    outputId,
    '',
  ]);
  await companion.locator('#call-speak-last').click();
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 5);
  assert.deepEqual(await application.evaluate(() => globalThis.callAudioFixture.previews), [
    spokenText,
    assistantReply,
  ]);
  await companion.evaluate(() => window.capri.previewVoice());
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 6);
  assert.deepEqual(await companion.evaluate(() => window.callAudioFixture.destinations), [
    '',
    outputId,
    '',
    '',
    outputId,
    '',
  ]);

  await composer.fill('Reply to me in private.');
  await companion.locator('#call-ask').click();
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 7);
  await composer.fill('Say hello to everyone in the call.');
  await companion.locator('#call-ask').click();
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 9);
  assert.deepEqual(await companion.evaluate(() => window.callAudioFixture.destinations.slice(6)), [
    '',
    '',
    outputId,
  ]);
  assert.deepEqual(await application.evaluate(() => globalThis.callAudioFixture.callPrompts), [
    'Reply to me in private.',
    'Say hello to everyone in the call.',
  ]);

  await settingsView(application, 'calls');
  await settings.locator('#call-output-share-replies').check();
  await settings.waitForFunction(
    () => !document.getElementById('call-output-share-replies').disabled,
  );
  await settings.locator('#settings-window-close').click();
  await composer.fill('Give me the shared test reply.');
  await companion.waitForFunction(() => !document.getElementById('send').disabled);
  await composer.press('Enter');
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 11);
  assert.deepEqual(await companion.evaluate(() => window.callAudioFixture.destinations.slice(9)), [
    '',
    outputId,
  ]);
  await settingsView(application, 'calls');
  await settings.locator('#call-output-share-replies').uncheck();
  await settings.waitForFunction(
    () => !document.getElementById('call-output-share-replies').disabled,
  );
  await settings.locator('#settings-window-close').click();
  await composer.fill('Give me the private test reply.');
  await companion.waitForFunction(() => !document.getElementById('send').disabled);
  await composer.press('Enter');
  await companion.waitForFunction(() => window.callAudioFixture.destinations.length === 12);
  assert.equal(await companion.evaluate(() => window.callAudioFixture.destinations.at(-1)), '');

  await companion.evaluate(() => {
    window.callAudioFixture.connected = false;
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  await composer.fill('This must stay silent.');
  await companion.waitForFunction(() => {
    const button = document.getElementById('call-speak');
    return button.hidden || button.disabled || !button.getClientRects().length;
  });
  assert.equal(await companion.evaluate(() => window.callAudioFixture.destinations.length), 12);
  assert.equal(
    await companion.evaluate(() => window.callAudioFixture.physical.getAudioTracks()[0].readyState),
    'live',
  );
  assert.deepEqual(errors, []);
  console.log(
    windowsCable
      ? JSON.stringify({
          passed: true,
          nativeCable: true,
          physicalMicrophoneOpened: false,
          pcmSaved: false,
        })
      : 'PASS selected microphone feed, dual speech, isolated model routing, local previews and output loss.',
  );
} catch (error) {
  const owner =
    application &&
    (await application.windows()).find((page) => page.url() === 'capri://desktop/index.html');
  if (owner)
    console.error(
      JSON.stringify(
        await owner.evaluate(() => {
          return {
            destinations: window.callAudioFixture?.destinations?.length ?? 0,
            sendDisabled: document.getElementById('send').disabled,
            phase: document.body.dataset.phase,
          };
        }),
      ),
    );
  if (windowsCable) {
    console.error(JSON.stringify({ passed: false, nativeCable: true, failureCode: 1 }));
    process.exitCode = 1;
  } else throw error;
} finally {
  if (windowsCable && application) {
    const owner = application.windows().find((page) => page.url() === 'capri://desktop/index.html');
    await owner?.evaluate(() => window.callAudioFixture?.stopCableProbe?.()).catch(() => {});
  }
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
