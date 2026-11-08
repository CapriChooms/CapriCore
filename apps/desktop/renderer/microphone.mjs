/** Capture is user-initiated and stays in memory from AudioWorklet to private IPC. */
// Five seconds of 100ms PCM absorbs short UI/disk stalls without dropping words.
const MAX_QUEUED_PACKETS = 50;
const LOOPBACK_GAIN = 0.4;
const PLAYBACK_TAIL_SECONDS = 0.4;
export function microphoneConstraints(deviceId = '') {
  return {
    video: false,
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };
}
export class MicrophoneClient {
  constructor({ api, onState, onText, onInterrupt, onError, onLevel, onWake = () => {} }) {
    Object.assign(this, { api, onState, onText, onInterrupt, onError, onLevel, onWake });
    this.run = null;
    this.state = { status: 'off', enabled: false, available: false, autoSend: true };
    this.playbackState = { speaking: false, text: '' };
  }
  settings(value) {
    this.state = { ...this.state, ...value };
    if (value.status === 'off' && this.run?.id && value.stoppedSessionId === this.run.id)
      this.stop(false);
    this.onState(this.state);
  }
  toggle() {
    if (this.run) return this.stop();
    // The composer can stop capture while retaining the model. The header is
    // the master switch and must still release that idle worker in one click.
    if (this.state.modelLoaded)
      return this.api.stopMicrophone().catch((error) => this.onError(error.message));
    return this.start();
  }
  async start() {
    if (this.run || !this.state.available) return;
    const run = (this.run = { id: null, queue: [], sequence: 0, pumping: false });
    this.previewUtterance = -1;
    this.settings({ status: 'starting', enabled: true });
    try {
      try {
        run.context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      } catch {
        run.context = new AudioContext({ latencyHint: 'interactive' });
      }
      await run.context.resume();
      if (this.run !== run) return;
      const capture = await this.api.startMicrophone();
      run.id = capture.sessionId;
      if (this.run !== run) {
        this.api.stopMicrophone(run.id).catch(() => {});
        return;
      }
      // Keep AEC, but avoid clipping or removing quiet syllables through the
      // browser's additional gain and denoising stages. Recognition uses PCM.
      run.stream = await navigator.mediaDevices.getUserMedia(
        microphoneConstraints(capture.deviceId),
      );
      if (this.run !== run) {
        for (const track of run.stream.getTracks()) track.stop();
        return;
      }
      for (const track of run.stream.getAudioTracks())
        track.addEventListener('ended', () => {
          if (this.run === run) {
            this.stop();
            this.onError(
              'The microphone disconnected. Choose an available device in Menu → Microphone input.',
            );
          }
        });
      await run.context.audioWorklet.addModule(new URL('microphone-worklet.mjs', import.meta.url));
      if (this.run !== run) return;
      run.source = run.context.createMediaStreamSource(run.stream);
      run.micGain = run.context.createGain();
      run.worklet = new AudioWorkletNode(run.context, 'capri-microphone-pcm', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      run.silence = run.context.createGain();
      run.silence.gain.value = 0;
      run.worklet.port.onmessage = (event) => this.capturePacket(run, event.data);
      await this.api.microphoneReady(run.id);
      if (this.run !== run) return;
      run.worklet.connect(run.silence);
      run.silence.connect(run.context.destination);
      run.source.connect(run.micGain);
      run.micGain.connect(run.worklet);
      this.settings({
        ...capture,
        actualDeviceLabel: run.stream.getAudioTracks()[0]?.label,
        status: 'listening',
        enabled: true,
      });
      this.playback({ ...this.playbackState, outputBusy: this.loopbackPlayback });
    } catch (error) {
      if (this.run !== run) return;
      this.stop();
      this.onError(
        error.name === 'NotAllowedError'
          ? 'Microphone access was denied. Check Windows microphone access for desktop apps.'
          : ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(error.name)
            ? 'The selected microphone is unavailable. Choose a device in Menu → Microphone input.'
            : 'Speech recognition could not start. Check the selected language and setup-multilingual.cmd.',
      );
    }
  }
  async setSystemAudio(enabled, wake = false) {
    const run = this.run;
    if (!run?.id || !run.micGain || this.state.status !== 'listening') return false;
    if (!enabled) {
      this.stopSystemAudio(run);
      return true;
    }
    if (run.systemAudio || run.systemAudioRequest) return false;
    const request = (run.systemAudioRequest = {});
    this.settings({ systemAudioPending: true });
    const sameRequest = () => this.run === run && run.systemAudioRequest === request;
    const current = () => sameRequest() && !request.cancelled;
    let stream, source, gain;
    try {
      await this.api.prepareSystemAudio(run.id, wake);
      if (!current()) return false;
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: { restrictOwnAudio: true },
        systemAudio: 'include',
        selfBrowserSurface: 'include',
        video: { frameRate: { max: 1 } },
      });
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      if (!current()) return false;
      const tracks = stream.getAudioTracks();
      if (tracks.length !== 1 || tracks[0].readyState !== 'live')
        throw new Error('Loopback track unavailable');
      source = run.context.createMediaStreamSource(stream);
      gain = run.context.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(run.worklet);
      run.systemAudio = { stream, source, gain };
      tracks[0].addEventListener('ended', () => {
        if (this.run === run && run.systemAudio?.stream === stream) {
          this.stopSystemAudio(run);
          this.onError('System audio stopped. Enable it again to reconnect.');
        }
      });
      this.updateSystemAudioGain(run);
      this.settings({ systemAudioActive: true });
      return true;
    } catch {
      if (current())
        this.onError('System audio could not start. Microphone input is still active.');
      return false;
    } finally {
      if (run.systemAudio?.stream !== stream || !stream) {
        source?.disconnect();
        gain?.disconnect();
        for (const track of stream?.getTracks() ?? []) track.stop();
      }
      await this.api.cancelSystemAudio(run.id).catch(() => {});
      if (sameRequest()) {
        run.systemAudioRequest = null;
        this.settings({ systemAudioPending: false });
      }
    }
  }
  updateSystemAudioGain(run) {
    const audio = run.systemAudio;
    if (!audio) return;
    const time = run.context.currentTime;
    const audibleAt = this.loopbackPlayback ? null : Math.max(time, this.playbackTailUntil ?? time);
    for (const [param, muted, audible] of [
      [audio.gain.gain, 0, LOOPBACK_GAIN],
      [run.micGain.gain, 1, 1 - LOOPBACK_GAIN],
    ]) {
      param.cancelScheduledValues(time);
      param.setValueAtTime(audibleAt === time ? audible : muted, time);
      if (audibleAt !== null && audibleAt > time) param.setValueAtTime(audible, audibleAt);
    }
  }
  stopSystemAudio(run, publish = true) {
    if (run.systemAudioRequest) {
      run.systemAudioRequest.cancelled = true;
      this.api.cancelSystemAudio(run.id).catch(() => {});
    }
    const audio = run.systemAudio;
    run.systemAudio = null;
    if (audio) {
      audio.source.disconnect();
      audio.gain.disconnect();
      for (const track of audio.stream.getTracks()) track.stop();
      run.micGain.gain.cancelScheduledValues(run.context.currentTime);
      run.micGain.gain.setValueAtTime(1, run.context.currentTime);
    }
    if (publish)
      this.settings({
        systemAudioActive: false,
        systemAudioPending: Boolean(run.systemAudioRequest),
      });
  }
  capturePacket(run, value) {
    if (this.run !== run) return;
    this.onLevel(Math.min(1, value.rms * 10));
    run.queue.push(new Uint8Array(value.pcm));
    if (run.queue.length > MAX_QUEUED_PACKETS) {
      this.stop();
      this.onError('Microphone audio could not keep up. Enable the microphone to retry.');
      return;
    }
    void this.pump(run);
  }
  async pump(run) {
    if (run.pumping) return;
    run.pumping = true;
    try {
      while (this.run === run && run.queue.length) {
        // Catch up in bounded 200ms IPC packets. Never wait to fill a batch:
        // ordinary live input is still sent immediately in 100ms packets.
        const packets = run.queue.splice(0, 2);
        let pcm = packets[0];
        if (packets.length === 2) {
          pcm = new Uint8Array(packets[0].byteLength + packets[1].byteLength);
          pcm.set(packets[0]);
          pcm.set(packets[1], packets[0].byteLength);
        }
        const result = await this.api.microphoneAudio({
          sessionId: run.id,
          sequence: run.sequence++,
          pcm,
        });
        if (!result.accepted && this.run === run) {
          this.stop();
          break;
        }
      }
    } catch {
      if (this.run === run) {
        this.stop();
        this.onError('The speech recognizer stopped. Enable the microphone to retry.');
      }
    } finally {
      run.pumping = false;
    }
  }
  playback(value) {
    const run = this.run;
    const outputBusy = Boolean(value.outputBusy ?? value.speaking);
    if (run?.context && this.loopbackPlayback && !outputBusy)
      this.playbackTailUntil = run.context.currentTime + PLAYBACK_TAIL_SECONDS;
    this.loopbackPlayback = outputBusy;
    this.playbackState = { speaking: Boolean(value.speaking), text: value.text ?? '' };
    if (run?.systemAudio) this.updateSystemAudioGain(run);
    if (this.run?.id)
      this.api
        .microphonePlayback({ sessionId: this.run.id, ...this.playbackState })
        .catch(() => {});
  }
  stop(notify = true, { keepModelWarm = false } = {}) {
    const run = this.run;
    this.run = null;
    this.playbackTailUntil = null;
    if (run) {
      run.queue = [];
      this.stopSystemAudio(run, false);
      if (run.worklet) {
        run.worklet.port.onmessage = null;
        run.worklet.disconnect();
      }
      run.source?.disconnect();
      run.micGain?.disconnect();
      run.silence?.disconnect();
      for (const track of run.stream?.getTracks() ?? []) track.stop();
      run.context?.close().catch(() => {});
      if (notify) this.api.stopMicrophone(run.id ?? undefined, keepModelWarm).catch(() => {});
    }
    this.onLevel(0);
    this.state = {
      ...this.state,
      actualDeviceLabel: null,
      status: 'off',
      enabled: false,
      systemAudioActive: false,
      systemAudioPending: false,
      systemAudioReview: false,
      systemAudioWake: false,
      modelLoaded: notify && !keepModelWarm ? false : Boolean(this.state.modelLoaded),
    };
    this.onState(this.state);
  }
  event(event) {
    if (event.type === 'microphone.device-changed') {
      this.stop(false);
      this.settings({ deviceId: event.deviceId, deviceLabel: event.deviceLabel });
      if (event.restart) this.start();
      return true;
    }
    if (event.type === 'microphone.device-error') {
      this.onError(event.message);
      return true;
    }
    if (event.type === 'microphone.settings') {
      this.settings(event);
      return true;
    }
    if (event.type === 'microphone.wake') {
      if (this.run?.id && event.sessionId === this.run.id) this.onWake(event, this.run.context);
      return true;
    }
    if (event.type === 'microphone.partial') {
      if (event.sessionId === this.run?.id && event.utterance >= (this.previewUtterance ?? -1)) {
        this.previewUtterance = event.utterance;
        this.onText(event);
      }
      return true;
    }
    if (event.type === 'microphone.interrupt') {
      this.onInterrupt();
      return true;
    }
    if (event.type === 'microphone.error') {
      this.stop(false);
      this.onError(event.message);
      return true;
    }
    if (event.type === 'microphone.stop-request') {
      this.stop(false);
      return true;
    }
    if (event.type === 'microphone.toggle-request') {
      this.toggle();
      return true;
    }
    if (event.type === 'microphone.sent') {
      if (event.utterance === undefined || event.utterance >= (this.previewUtterance ?? -1))
        this.onText({ text: '', final: true });
      return true;
    }
    return false;
  }
}
