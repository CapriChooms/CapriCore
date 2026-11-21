import { VoiceEffects } from './voice-effects.mjs';
import { VOICE_EFFECT_DEFAULTS, validateVoiceEffects } from './voice-effects-settings.mjs';
import { CALL_VOICE_VOLUME_DEFAULT, validateCallVoiceVolume } from './call-audio-settings.mjs';
import { isVerifiedSeparateCallCable } from './call-audio-route.mjs';
import { MICROPHONE_GAIN, validateMicrophoneGain } from './speech-settings.mjs';
import { VOICE_VOLUME_DEFAULT, VOICE_VOLUME_MAX, validateVoiceVolume } from './voice-volume.mjs';
import {
  audioOutputDevice,
  bindAudioOutput,
  createAudioOutputContext,
  matchesAudioOutput,
  selectedAudioOutputError,
} from './local-audio-output.mjs';

const validCallOutput = (id) =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 512 &&
  !/^[\s]*$|[\x00-\x1f\x7f]/.test(id) &&
  !['default', 'communications'].includes(id);
const unavailableCallMicrophone =
  'The selected microphone is unavailable. Choose a device in Menu → Microphone input.';
const speakerReadyTimeoutMs = 3000;
const maximumSpeakerGain = VOICE_VOLUME_MAX / 100;
const speakerPeakCurve = Float32Array.from({ length: 4097 }, (_, index) => {
  const sample = (index / 2048 - 1) * maximumSpeakerGain;
  const level = Math.abs(sample);
  // Keep normal speech linear and compress only peaks near full scale.
  const knee = 0.9;
  const headroom = 0.09;
  return level <= knee
    ? sample
    : Math.sign(sample) * (knee + headroom * (1 - Math.exp(-(level - knee) / headroom)));
});

/** Float32 PCM stays in memory; generation and playback have separate lifetimes. */
export class VoicePlayer {
  constructor({
    onState,
    onError,
    onPlayback = () => {},
    contextFactory = createAudioOutputContext,
    callContextFactory = (deviceId) =>
      new AudioContext({ latencyHint: 'interactive', sinkId: deviceId }),
    enumerateCallOutputs = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'audiooutput',
      ),
    onCallOutputState = () => {},
    mediaDevices = globalThis.navigator?.mediaDevices,
    enumerateSpeakerOutputs = () => mediaDevices?.enumerateDevices?.(),
  }) {
    Object.assign(this, {
      onState,
      onError,
      onPlayback,
      contextFactory,
      callContextFactory,
      enumerateCallOutputs,
      onCallOutputState,
      mediaDevices,
      enumerateSpeakerOutputs,
    });
    this.speakers = {};
    this.speakerDevice = '';
    this.output = this.speakers;
    this.callOutput = null;
    this.callVoiceVolume = CALL_VOICE_VOLUME_DEFAULT;
    this.microphoneGain = MICROPHONE_GAIN.default;
    this.speakerVolume = VOICE_VOLUME_DEFAULT;
    this.turnId = null;
    this.queue = [];
    this.source = null;
    this.mirrorSources = new Set();
    this.revision = 0;
    this.generated = false;
    this.sequence = 0;
    this.effectsSettings = { ...VOICE_EFFECT_DEFAULTS };
    this.tailTimer = null;
  }

  get context() {
    return this.speakers.context;
  }

  async unlock() {
    while (true) {
      const context = this.context ?? this.openSpeakerContext();
      const deviceId = this.speakerDevice;
      await (this.speakerRoute?.promise ?? this.routeSpeakerOutput());
      if (!this.context && this.speakerDevice === deviceId) throw selectedAudioOutputError();
      if (context !== this.context || this.speakerRoute || this.speakerDevice !== deviceId)
        continue;
      try {
        await this.unlockOutput(this.speakers);
      } catch (error) {
        if (this.speakerRoute || this.speakerDevice !== deviceId) continue;
        if (deviceId && this.context === context) this.releaseSpeakerContext(context, false);
        throw error;
      }
      if (
        context === this.context &&
        !this.speakerRoute &&
        matchesAudioOutput(context, this.speakerDevice)
      )
        return;
    }
  }

  async setSpeakerDevice(value = '') {
    this.speakerDevice = audioOutputDevice(value);
    if (this.speakerDevice === this.callOutput?.deviceId) this.stopMirrors();
    if (this.context) await this.routeSpeakerOutput();
  }

  connectSpeakers(connected) {
    const output = this.speakers;
    const source = output.peakLimiter ?? output.voiceGain;
    if (!source || Boolean(output.connected) === connected) return;
    if (connected) source.connect(output.context.destination);
    else source.disconnect(output.context.destination);
    output.connected = connected;
  }

  routeSpeakerOutput() {
    const deviceId = this.speakerDevice;
    const previous = this.speakerRoute;
    if (previous?.deviceId === deviceId) return previous.promise;
    if (
      !previous &&
      this.speakers.verifiedDevice === deviceId &&
      matchesAudioOutput(this.context, deviceId)
    ) {
      this.connectSpeakers(!this.speakers.deviceProbe);
      return;
    }
    // Changing the sink is asynchronous. Keep local replies and call monitors
    // disconnected until Chromium confirms the latest exact route.
    this.connectSpeakers(false);
    const route = { deviceId };
    this.speakers.deviceProbe = null;
    this.speakerRoute = route;
    route.promise = Promise.resolve(previous?.promise)
      .catch(() => {})
      .then(async () => {
        if (this.speakerRoute !== route || !this.context) return;
        // A constructor option is reflected in sinkId before Chromium opens the
        // device. An old saved ID must not start a silent playback turn.
        if (deviceId) {
          let devices;
          try {
            devices = await this.enumerateSpeakerOutputs();
          } catch {
            // A failed inventory query cannot establish whether a sink vanished.
          }
          if (this.speakerRoute !== route || !this.context) return;
          if (
            Array.isArray(devices) &&
            !devices.some((device) => device.kind === 'audiooutput' && device.deviceId === deviceId)
          ) {
            this.releaseSpeakerContext(this.context, Boolean(this.playing));
            throw selectedAudioOutputError();
          }
        }
        const context = this.context;
        try {
          await bindAudioOutput(context, deviceId);
        } catch (error) {
          if (this.speakerRoute !== route || this.context !== context) return;
          // Some devices need their own clock. Reopening a sink after an
          // unsuccessful live switch lets the browser negotiate that format.
          this.releaseSpeakerContext(context, Boolean(this.playing));
          try {
            await bindAudioOutput(this.openSpeakerContext(), deviceId);
          } catch {
            if (this.speakerRoute === route && this.context)
              this.releaseSpeakerContext(this.context, Boolean(this.playing));
            throw error;
          }
        }
        if (this.speakerRoute === route && this.context) {
          this.speakers.verifiedDevice = deviceId;
          this.connectSpeakers(true);
        }
      })
      .finally(() => {
        if (this.speakerRoute === route) this.speakerRoute = null;
      });
    return route.promise;
  }

  openSpeakerContext() {
    const output = this.speakers;
    const context = (output.context = this.contextFactory(this.speakerDevice));
    const lost = () => {
      if (context !== this.context) return;
      const report = this.output === output && Boolean(this.turnId);
      this.releaseSpeakerContext(context);
      if (report) this.onError(selectedAudioOutputError());
    };
    output.renderError = () => lost();
    output.sinkChange = () => {
      if (
        context.state === 'closed' ||
        (!this.speakerRoute && !matchesAudioOutput(context, this.speakerDevice))
      )
        lost();
    };
    output.deviceChange = async () => {
      const deviceId = this.speakerDevice;
      if (!deviceId || this.speakerRoute) return;
      const probe = (output.deviceProbe = {});
      this.connectSpeakers(false);
      try {
        const devices = await this.enumerateSpeakerOutputs();
        if (
          Array.isArray(devices) &&
          output.deviceProbe === probe &&
          deviceId === this.speakerDevice &&
          !this.speakerRoute &&
          !devices.some((device) => device.kind === 'audiooutput' && device.deviceId === deviceId)
        )
          lost();
      } catch {
        // A failed inventory refresh cannot establish whether a sink was removed.
      } finally {
        if (this.context === context && output.deviceProbe === probe) {
          output.deviceProbe = null;
          if (
            !this.speakerRoute &&
            output.verifiedDevice === this.speakerDevice &&
            matchesAudioOutput(context, this.speakerDevice)
          )
            this.connectSpeakers(true);
        }
      }
    };
    context.addEventListener?.('sinkchange', output.sinkChange);
    context.addEventListener?.('statechange', output.sinkChange);
    context.addEventListener?.('error', output.renderError);
    this.mediaDevices?.addEventListener?.('devicechange', output.deviceChange);
    return context;
  }

  releaseSpeakerContext(context, stopTurn = true) {
    const output = this.speakers;
    this.connectSpeakers(false);
    if (stopTurn && this.output === output && this.turnId) this.stop({ resetEffects: false });
    else this.stopMirrors();
    context.removeEventListener?.('sinkchange', output.sinkChange);
    context.removeEventListener?.('statechange', output.sinkChange);
    context.removeEventListener?.('error', output.renderError);
    this.mediaDevices?.removeEventListener?.('devicechange', output.deviceChange);
    output.effects?.destroy();
    output.analyser?.disconnect();
    if (output.peakLimiter) {
      output.voiceGain.disconnect();
      output.limiterInput.disconnect();
    }
    Object.assign(output, {
      context: null,
      voiceGain: null,
      limiterInput: null,
      peakLimiter: null,
      analyser: null,
      meter: null,
      effects: null,
      connected: false,
      verifiedDevice: null,
      sinkChange: null,
      renderError: null,
      deviceChange: null,
      deviceProbe: null,
    });
    if (context.state !== 'closed') void context.close?.().catch(() => {});
  }

  async unlockOutput(output) {
    const { context } = output;
    if (!output.voiceGain && context.createGain) {
      output.voiceGain = context.createGain();
      output.voiceGain.gain.value =
        (output === this.speakers ? this.speakerVolume : this.callVoiceVolume) / 100;
      if (output === this.speakers) {
        if (context.createWaveShaper) {
          output.limiterInput = context.createGain();
          output.limiterInput.gain.value = 1 / maximumSpeakerGain;
          output.peakLimiter = context.createWaveShaper();
          output.peakLimiter.curve = speakerPeakCurve;
          // WaveShaper input spans [-1, 1]. Scale the boosted signal into
          // that range before applying the curve defined in speaker levels.
          output.voiceGain.connect(output.limiterInput).connect(output.peakLimiter);
        }
        this.connectSpeakers(
          !this.speakerRoute &&
            !output.deviceProbe &&
            output.verifiedDevice === this.speakerDevice &&
            matchesAudioOutput(context, this.speakerDevice),
        );
      } else output.voiceGain.connect(output.mixer ?? context.destination);
    }
    const destination = output.voiceGain ?? output.mixer ?? context.destination;
    if (!output.analyser && context.createAnalyser) {
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      analyser.connect(destination);
      output.analyser = analyser;
      output.meter = new Float32Array(analyser.fftSize);
    }
    if (output === this.speakers && this.speakerDevice && context.state !== 'running') {
      let timeout;
      try {
        await Promise.race([
          context.resume(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(selectedAudioOutputError()), speakerReadyTimeoutMs);
          }),
        ]);
        if (context.state !== 'running') throw selectedAudioOutputError();
      } catch (error) {
        throw error?.code === 'CAPRI_SPEAKER_OUTPUT' ? error : selectedAudioOutputError(error);
      } finally {
        clearTimeout(timeout);
      }
    } else if (context.state === 'suspended') await context.resume();
    if (!output.effects && context.createGain && context.state !== 'closed') {
      output.effects = new VoiceEffects(context, output.analyser ?? destination);
      output.effects.configure(
        output === this.speakers
          ? (this.turnEffects ?? this.effectsSettings)
          : this.effectsSettings,
      );
    }
  }

  callOutputState() {
    return {
      deviceId: this.callOutput?.deviceId ?? '',
      active: Boolean(this.callOutput),
      available: this.callOutput?.available === true,
      mixingMic:
        this.callOutput?.available === true && this.callOutput.micTrack?.readyState === 'live',
      shareReplies: this.callOutput?.available === true && this.callOutput.shareReplies === true,
    };
  }

  setCallVoiceVolume(value = CALL_VOICE_VOLUME_DEFAULT) {
    this.callVoiceVolume = validateCallVoiceVolume(value);
    this.applyVolume(this.callOutput, this.callVoiceVolume);
  }

  setMicrophoneGain(value = MICROPHONE_GAIN.default) {
    const gain = validateMicrophoneGain(value);
    if (gain === this.microphoneGain) return;
    this.microphoneGain = gain;
    const output = this.callOutput;
    if (output?.micGain && output.context.state !== 'closed')
      output.micGain.gain.setTargetAtTime(gain / 100, output.context.currentTime, 0.015);
  }

  setSpeakerVolume(value = VOICE_VOLUME_DEFAULT) {
    const volume = validateVoiceVolume(value);
    if (volume === this.speakerVolume) return;
    this.speakerVolume = volume;
    this.applyVolume(this.speakers, this.speakerVolume);
  }

  applyVolume(output, value) {
    if (output?.voiceGain && output.context?.state !== 'closed') {
      const gain = output.voiceGain.gain,
        now = output.context.currentTime;
      // A short ramp avoids clicks while changing a live reply, including mute.
      gain.cancelAndHoldAtTime(now);
      gain.linearRampToValueAtTime(value / 100, now + 0.02);
    }
  }

  async hasCallOutput(deviceId) {
    const devices = await this.enumerateCallOutputs();
    return devices.some(
      (device) => device.deviceId === deviceId && !/\bsteam streaming\b/i.test(device.label ?? ''),
    );
  }

  async enableCallOutput(deviceId, microphone = null) {
    if (!validCallOutput(deviceId)) throw new Error('Choose a specific call output device.');
    this.disableCallOutput();
    const micTrack = microphone?.getAudioTracks()[0];
    if (microphone && micTrack?.readyState !== 'live') throw new Error(unavailableCallMicrophone);
    if (
      micTrack &&
      /\b(?:stereo mix|what u hear|cable output|loopback|steam streaming microphone)\b/i.test(
        micTrack.label,
      )
    )
      throw new Error('Select a physical microphone before sharing it with a call.');
    const output = { deviceId, available: false, micTrack };
    this.callOutput = output;
    try {
      const devices = await this.enumerateCallOutputs();
      const device = devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device) throw new Error('Call audio output is unavailable.');
      // Remote Play microphone transport is not a general-purpose virtual cable.
      if (/\bsteam streaming\b/i.test(device.label ?? ''))
        throw new Error('A virtual audio cable is needed. Install VB-CABLE to continue.');
      if (this.callOutput !== output) return this.callOutputState();
      // Enumeration is asynchronous: unplugging can end the track while the
      // output list is pending. Diagnose that before comparing device groups.
      if (microphone && micTrack.readyState !== 'live') throw new Error(unavailableCallMicrophone);
      const microphoneSettings = micTrack?.getSettings?.();
      const microphoneGroup = microphoneSettings?.groupId;
      if (microphoneGroup && microphoneGroup === device.groupId) {
        const microphoneLabel = micTrack.label;
        let currentDevices;
        try {
          currentDevices = await this.mediaDevices?.enumerateDevices?.();
        } catch {
          // Unknown routes retain the conservative feedback-loop refusal.
        }
        if (this.callOutput !== output) return this.callOutputState();
        if (micTrack.readyState !== 'live') throw new Error(unavailableCallMicrophone);
        const currentSettings = micTrack.getSettings?.();
        if (
          currentSettings?.deviceId !== microphoneSettings.deviceId ||
          currentSettings?.groupId !== microphoneGroup ||
          micTrack.label !== microphoneLabel ||
          !isVerifiedSeparateCallCable(currentDevices, {
            output: device,
            microphone: {
              deviceId: currentSettings?.deviceId,
              groupId: currentSettings?.groupId,
              label: micTrack.label,
              readyState: micTrack.readyState,
            },
          })
        )
          throw new Error('Use a call cable separate from your microphone.');
      }
      // Validate the route before allocating a sink or a microphone mixer.
      // Bind the hardware sink and clock together: changing a silent context's
      // sink after creation can negotiate a different endpoint sample rate.
      const context = (output.context = this.callContextFactory(deviceId));
      if (!context.setSinkId) throw new Error('Call audio output is unavailable.');
      if (context.sinkId !== deviceId) await context.setSinkId(deviceId);
      if (this.callOutput !== output) return this.callOutputState();
      if (context.sinkId !== deviceId) throw new Error('Call audio output is unavailable.');
      // Both voice sources are mono. Some virtual endpoints report a mono
      // maximum while their Web Audio destination initially defaults to stereo.
      context.destination.channelCount = 1;
      context.destination.channelCountMode = 'explicit';
      if (microphone) {
        if (micTrack.readyState !== 'live') throw new Error(unavailableCallMicrophone);
        const mixer = (output.mixer = context.createDynamicsCompressor());
        mixer.threshold.value = -6;
        mixer.knee.value = 12;
        mixer.ratio.value = 4;
        mixer.attack.value = 0.003;
        mixer.release.value = 0.06;
        mixer.connect(context.destination);
        output.microphone = context.createMediaStreamSource(microphone);
        output.micGain = context.createGain();
        output.micGain.gain.value = this.microphoneGain / 100;
        output.microphone.connect(output.micGain);
        output.micGain.connect(mixer);
        output.micEnded = () => this.loseCallOutput(output);
        micTrack.addEventListener('ended', output.micEnded, { once: true });
        if (micTrack.readyState !== 'live') throw new Error(unavailableCallMicrophone);
      }
      if (context.state === 'suspended') await context.resume();
      if (this.callOutput !== output) return this.callOutputState();
      if (microphone && micTrack.readyState !== 'live') throw new Error(unavailableCallMicrophone);
      if (context.state !== 'running') throw new Error('Call audio output is unavailable.');
      // Unlock the optional local monitor during the setup gesture, rather than
      // letting its autoplay state block a later, already approved VAC reply.
      void this.unlock().catch(() => {});
      output.available = true;
      // Connecting the call output explicitly starts a session of shared replies.
      // Voice previews keep their separate, local-only begin() path.
      output.shareReplies = true;
      output.deviceChange = () => {
        void this.hasCallOutput(deviceId).then(
          (available) => {
            if (!available || (micTrack && micTrack.readyState !== 'live'))
              this.loseCallOutput(output);
          },
          () => this.loseCallOutput(output),
        );
      };
      output.sinkChange = () => {
        if (context.sinkId !== deviceId || context.state === 'closed') this.loseCallOutput(output);
      };
      this.mediaDevices?.addEventListener?.('devicechange', output.deviceChange);
      context.addEventListener?.('sinkchange', output.sinkChange);
      context.addEventListener?.('statechange', output.sinkChange);
      this.onCallOutputState(this.callOutputState());
      return this.callOutputState();
    } catch (error) {
      if (this.callOutput !== output) return this.callOutputState();
      this.disableCallOutput();
      throw new Error(
        [
          'Use a call cable separate from your microphone.',
          'A virtual audio cable is needed. Install VB-CABLE to continue.',
          unavailableCallMicrophone,
        ].includes(error?.message)
          ? error.message
          : 'Call audio output is unavailable.',
      );
    }
  }

  closeCallOutput(output) {
    output.available = false;
    if (this.output === output) this.stop({ resetEffects: false });
    const { context, deviceChange, sinkChange } = output;
    if (deviceChange) this.mediaDevices?.removeEventListener?.('devicechange', deviceChange);
    if (sinkChange) {
      context.removeEventListener?.('sinkchange', sinkChange);
      context.removeEventListener?.('statechange', sinkChange);
    }
    if (output.micEnded) output.micTrack.removeEventListener('ended', output.micEnded);
    output.microphone?.disconnect();
    output.micGain?.disconnect();
    output.mixer?.disconnect();
    output.voiceGain?.disconnect();
    output.effects?.destroy();
    Object.assign(output, { context: null, effects: null, deviceChange: null, sinkChange: null });
    if (context?.state !== 'closed') void context?.close?.().catch(() => {});
  }

  syncCallMicrophone(stream) {
    const track = this.callOutput?.micTrack;
    if (track && (track !== stream?.getAudioTracks()[0] || track.readyState !== 'live'))
      this.disableCallOutput();
  }

  loseCallOutput(output) {
    if (this.callOutput !== output || !output.available) return;
    this.closeCallOutput(output);
    this.onCallOutputState(this.callOutputState());
  }

  disableCallOutput() {
    const output = this.callOutput;
    if (output) {
      this.callOutput = null;
      this.closeCallOutput(output);
      this.onCallOutputState(this.callOutputState());
    }
    return this.callOutputState();
  }

  setCallReplySharing(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid call reply setting.');
    const output = this.callOutput;
    if (!output?.available) throw new Error('Call audio output is unavailable.');
    output.shareReplies = enabled;
    if (!enabled && this.sharedReply && this.output === output) this.stop();
    this.onCallOutputState(this.callOutputState());
    return this.callOutputState();
  }

  beginReply(turnId) {
    const share = this.callOutputState().shareReplies;
    this.begin(turnId, { call: share });
    this.sharedReply = share;
  }

  setEffects(value) {
    this.effectsSettings = validateVoiceEffects(value);
    if (!this.turnEffects) this.speakers.effects?.configure(this.effectsSettings);
    if (this.callOutput?.available) this.callOutput.effects?.configure(this.effectsSettings);
  }
  burst() {
    this.output?.effects?.burst(true);
  }
  get level() {
    const { analyser, meter } = this.output ?? {};
    if (!analyser || !this.source) return 0;
    analyser.getFloatTimeDomainData(meter);
    let sum = 0;
    for (const sample of meter) sum += sample * sample;
    return Math.sqrt(sum / meter.length);
  }
  begin(turnId, { call = false, effects } = {}) {
    const turnEffects = effects !== undefined && !call ? validateVoiceEffects(effects) : null;
    this.stop();
    this.turnEffects = turnEffects;
    if (turnEffects) this.speakers.effects?.configure(turnEffects);
    this.output = call ? this.callOutput : this.speakers;
    this.turnId = turnId;
    this.generated = false;
    this.sequence = 0;
    this.firstPlayback = true;
  }
  get playbackElapsedMs() {
    if (!this.playing) return 0;
    const currentTime = this.output?.context?.currentTime;
    const elapsed = Number.isFinite(currentTime)
      ? (currentTime - this.playing.audioStartedAt) * 1000
      : performance.now() - this.playing.startedAt;
    return Math.max(0, Math.min(this.playing.durationMs, elapsed));
  }
  stop({ resetEffects = true } = {}) {
    const turnId = this.turnId;
    this.revision++;
    this.queue = [];
    this.turnId = null;
    this.sharedReply = false;
    this.generated = false;
    clearTimeout(this.tailTimer);
    if (resetEffects) this.output?.effects?.reset();
    if (this.output !== this.speakers) this.speakers.effects?.reset();
    this.clearTurnEffects();
    this.stopMirrors();
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* Already ended. */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = null;
    this.output = this.speakers;
    if (turnId) this.onPlayback({ type: 'stopped', turnId });
    this.onState({ busy: false });
  }
  stopMirrors() {
    for (const mirror of this.mirrorSources) {
      mirror.onended = null;
      try {
        mirror.stop();
      } catch {
        /* Already ended. */
      }
      mirror.disconnect();
    }
    this.mirrorSources.clear();
  }
  finish(turnId) {
    if (turnId === this.turnId) {
      this.generated = true;
      if (!this.source && !this.queue.length) this.endPlayback();
    }
  }
  clearTurnEffects() {
    if (!this.turnEffects) return;
    this.turnEffects = null;
    this.speakers.effects?.configure(this.effectsSettings);
  }
  endPlayback() {
    const revision = this.revision,
      effects = this.output?.effects,
      tail = effects?.tailSeconds ?? 0;
    clearTimeout(this.tailTimer);
    effects?.speaking(false);
    if (this.output !== this.speakers) this.speakers.effects?.speaking(false);
    if (tail && this.generated) {
      this.onState({ busy: true });
      this.tailTimer = setTimeout(() => {
        if (revision === this.revision && !this.source && !this.queue.length) {
          this.clearTurnEffects();
          this.onState({ busy: false });
        }
      }, tail * 1000);
    } else {
      if (this.generated) this.clearTurnEffects();
      this.onState({ busy: !this.generated, waiting: !this.generated });
    }
  }
  accept(event) {
    if (event.turnId !== this.turnId || event.sequence !== this.sequence) return;
    this.sequence++;
    try {
      if (
        event.sampleRate !== 24000 ||
        !(event.pcm instanceof Uint8Array) ||
        event.pcm.byteLength > 24000 * 4 * 45 ||
        this.queue.length >= 100
      )
        throw new Error('Invalid audio');
      const raw = event.pcm;
      if (!raw.byteLength || raw.byteLength % 4 || raw.byteOffset % 4)
        throw new Error('Invalid PCM length');
      const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
      for (const sample of samples)
        if (!Number.isFinite(sample)) throw new Error('Invalid PCM sample');
      this.queue.push({ text: event.text, samples, sequence: event.sequence });
      this.play();
    } catch (error) {
      this.stop();
      this.onError(error);
    }
  }
  async play() {
    if (this.source || !this.queue.length || !this.turnId) return;
    clearTimeout(this.tailTimer);
    const revision = this.revision;
    const output = this.output;
    const useCallOutput = output !== this.speakers;
    const checkOutput = () => {
      if (
        !output?.available ||
        this.callOutput !== output ||
        output.context?.sinkId !== output.deviceId ||
        output.context.state === 'closed'
      )
        throw new Error('Call audio output is unavailable.');
    };
    // Mark a pending resume so a second packet cannot start overlapping audio.
    this.source = { stop() {}, disconnect() {} };
    try {
      if (useCallOutput) {
        checkOutput();
        await this.unlockOutput(output);
      } else await this.unlock();
      if (revision !== this.revision) return;
      if (useCallOutput) checkOutput();
      const { context, analyser, effects } = output;
      const item = this.queue.shift();
      const buffer = context.createBuffer(1, item.samples.length, 24000);
      buffer.copyToChannel(item.samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(
        effects?.input ?? analyser ?? output.voiceGain ?? output.mixer ?? context.destination,
      );
      this.source = source;
      effects?.speaking(true);
      const leadTime = useCallOutput ? 0.01 : 0;
      if (
        useCallOutput &&
        this.speakers.context?.state === 'running' &&
        this.speakerDevice !== output.deviceId &&
        !this.speakerRoute &&
        matchesAudioOutput(this.speakers.context, this.speakerDevice)
      ) {
        const speakers = this.speakers.context;
        const mirror = speakers.createBufferSource();
        this.mirrorSources.add(mirror);
        mirror.buffer = buffer;
        mirror.connect(
          this.speakers.effects?.input ??
            this.speakers.analyser ??
            this.speakers.voiceGain ??
            speakers.destination,
        );
        mirror.onended = () => {
          mirror.disconnect();
          this.mirrorSources.delete(mirror);
        };
        this.speakers.effects?.speaking(true);
        mirror.start(speakers.currentTime + leadTime);
      }
      if (this.firstPlayback) {
        effects?.burst(true);
        if (useCallOutput) this.speakers.effects?.burst(true);
        this.firstPlayback = false;
      }
      source.onended = () => {
        source.disconnect();
        if (revision !== this.revision) return;
        this.onPlayback({ ...this.playing, type: 'ended' });
        this.playing = null;
        this.source = null;
        if (this.queue.length) this.play();
        else this.endPlayback();
      };
      const audioStartedAt = context.currentTime + leadTime;
      source.start(audioStartedAt);
      this.playing = {
        turnId: this.turnId,
        sequence: item.sequence,
        text: item.text,
        durationMs: (item.samples.length / 24000) * 1000,
        startedAt: performance.now(),
        audioStartedAt,
      };
      this.onPlayback({ ...this.playing, type: 'started' });
      this.onState({ busy: true, text: item.text, startedAt: performance.now() });
    } catch (error) {
      if (revision === this.revision) {
        this.stop();
        this.onError(error);
      }
    }
  }
}
