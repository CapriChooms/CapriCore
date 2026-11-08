import { VoiceEffects } from './voice-effects.mjs';
import { VOICE_EFFECT_DEFAULTS, validateVoiceEffects } from './voice-effects-settings.mjs';
import { CALL_VOICE_VOLUME_DEFAULT, validateCallVoiceVolume } from './call-audio-settings.mjs';
import { isVerifiedSeparateCallCable } from './call-audio-route.mjs';

const validCallOutput = (id) =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 512 &&
  !/^[\s]*$|[\x00-\x1f\x7f]/.test(id) &&
  !['default', 'communications'].includes(id);
const unavailableCallMicrophone =
  'The selected microphone is unavailable. Choose a device in Menu → Microphone input.';

/** Float32 PCM stays in memory; generation and playback have separate lifetimes. */
export class VoicePlayer {
  constructor({
    onState,
    onError,
    onPlayback = () => {},
    contextFactory = () => new AudioContext(),
    callContextFactory = (deviceId) =>
      new AudioContext({ latencyHint: 'interactive', sinkId: deviceId }),
    enumerateCallOutputs = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'audiooutput',
      ),
    onCallOutputState = () => {},
    mediaDevices = globalThis.navigator?.mediaDevices,
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
    });
    this.speakers = {};
    this.output = this.speakers;
    this.callOutput = null;
    this.callVoiceVolume = CALL_VOICE_VOLUME_DEFAULT;
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
    this.speakers.context ??= this.contextFactory();
    await this.unlockOutput(this.speakers);
  }

  async unlockOutput(output) {
    const { context } = output;
    if (output !== this.speakers && !output.voiceGain && context.createGain) {
      output.voiceGain = context.createGain();
      output.voiceGain.gain.value = this.callVoiceVolume / 100;
      output.voiceGain.connect(output.mixer ?? context.destination);
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
    if (context.state === 'suspended') await context.resume();
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
    const output = this.callOutput;
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
        output.microphone.connect(mixer);
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
        typeof event.pcm !== 'string' ||
        event.pcm.length > 6000000 ||
        this.queue.length >= 100
      )
        throw new Error('Invalid audio');
      const raw = Uint8Array.from(atob(event.pcm), (character) => character.charCodeAt(0));
      if (!raw.length || raw.length % 4) throw new Error('Invalid PCM length');
      const view = new DataView(raw.buffer);
      const samples = new Float32Array(raw.length / 4);
      for (let index = 0; index < samples.length; index++) {
        const value = view.getFloat32(index * 4, true);
        if (!Number.isFinite(value)) throw new Error('Invalid PCM sample');
        samples[index] = value;
      }
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
      if (useCallOutput && this.speakers.context?.state === 'running') {
        const speakers = this.speakers.context;
        const mirror = speakers.createBufferSource();
        this.mirrorSources.add(mirror);
        mirror.buffer = buffer;
        mirror.connect(
          this.speakers.effects?.input ?? this.speakers.analyser ?? speakers.destination,
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
