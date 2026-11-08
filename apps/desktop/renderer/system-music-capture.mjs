// SPDX-License-Identifier: GPL-3.0-only
// System loopback only. No getUserMedia, ASR, transcription or audible monitoring.
const PACKET_BYTES = 8000 * Float32Array.BYTES_PER_ELEMENT;
const defaultContext = () => {
  try {
    return new AudioContext({
      sampleRate: 16000,
      latencyHint: 'playback',
      sinkId: { type: 'none' },
    });
  } catch {
    return new AudioContext({ latencyHint: 'playback' });
  }
};
const defaultWorklet = (context) =>
  new AudioWorkletNode(context, 'capri-music-pcm', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 2,
    channelCountMode: 'explicit',
  });
const stopStream = (stream) => {
  for (const track of stream?.getTracks() ?? []) track.stop();
};

export class SystemMusicClient {
  constructor({
    api,
    onState = () => {},
    onError = () => {},
    mediaDevices = globalThis.navigator?.mediaDevices,
    contextFactory = defaultContext,
    workletFactory = defaultWorklet,
    now = () => performance.now(),
    clock = Date.now,
  }) {
    Object.assign(this, {
      api,
      onState,
      onError,
      mediaDevices,
      contextFactory,
      workletFactory,
      now,
      clock,
    });
    this.run = null;
    this.state = { status: 'off', enabled: false, sessionId: null };
    this.playbackBusy = false;
    this.tailUntil = 0;
  }
  publish(value) {
    this.state = { ...this.state, ...value };
    this.onState({ ...this.state });
  }
  /** Host-only classification/status data; it never starts browser capture. */
  setState(value = {}) {
    if (value.stoppedSessionId && value.stoppedSessionId === this.run?.id) this.stop(false);
    const { stoppedSessionId, ...metadata } = value;
    this.hostState = { ...this.hostState, ...metadata };
  }
  async start() {
    if (this.run) return false;
    const run = (this.run = { id: null, sequence: 0, pending: null, pumping: false });
    this.publish({ status: 'starting', enabled: true, sessionId: null });
    const current = () => this.run === run;
    try {
      // Resume inside the click's transient user activation, before private IPC.
      run.context = this.contextFactory();
      await run.context.resume();
      if (!current()) return false;
      const opened = await this.api.musicAudioStart();
      run.id = opened?.sessionId;
      if (typeof run.id !== 'string' || !run.id || run.id.length > 128)
        throw Error('Invalid music audio session.');
      if (!current()) {
        this.api.musicAudioStop(run.id).catch(() => {});
        return false;
      }
      await this.api.prepareMusicAudio(run.id);
      if (!current()) return false;
      const stream = await this.mediaDevices.getDisplayMedia({
        audio: { restrictOwnAudio: true, suppressLocalAudioPlayback: false },
        systemAudio: 'include',
        selfBrowserSurface: 'include',
        video: { frameRate: { max: 1 } },
      });
      // Drop the transient own-frame video source without reading a frame.
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      if (!current()) {
        stopStream(stream);
        return false;
      }
      run.stream = stream;
      const tracks = stream.getAudioTracks();
      if (tracks.length !== 1 || tracks[0].readyState !== 'live')
        throw Error('Loopback unavailable.');
      tracks[0].addEventListener('ended', () => {
        if (current()) {
          this.stop();
          this.onError('System audio stopped. Enable it again to reconnect.');
        }
      });
      await run.context.audioWorklet.addModule(new URL('music-worklet.mjs', import.meta.url));
      if (!current()) return false;
      run.source = run.context.createMediaStreamSource(stream);
      run.worklet = this.workletFactory(run.context);
      run.silence = run.context.createGain();
      run.silence.gain.value = 0;
      run.worklet.port.onmessage = (event) => this.packet(run, event.data);
      const receipt = await this.api.musicAudioReady(run.id);
      if (!current()) return false;
      if (receipt === false || receipt?.accepted === false)
        throw Error('Music audio session stopped.');
      run.source.connect(run.worklet);
      run.worklet.connect(run.silence);
      run.silence.connect(run.context.destination);
      this.publish({ status: 'listening', enabled: true, sessionId: run.id });
      return true;
    } catch {
      if (!current()) return false;
      this.stop();
      this.onError('Music listening could not start. Try again from Settings.');
      return false;
    } finally {
      if (run.id) await this.api.cancelMusicAudio(run.id).catch(() => {});
    }
  }
  packet(run, value) {
    if (
      this.run !== run ||
      !(value?.pcm instanceof ArrayBuffer) ||
      value.pcm.byteLength !== PACKET_BYTES
    )
      return;
    const sequence = run.sequence++;
    const lag =
      Number.isFinite(value.capturedTime) && Number.isFinite(run.context.currentTime)
        ? Math.max(0, Math.min(30, run.context.currentTime - value.capturedTime))
        : 0;
    if (this.playbackBusy || this.now() < this.tailUntil) {
      run.pending = null;
      return;
    }
    // Latest packet replaces at most one queued half-second block. A slow IPC
    // consumer cannot accumulate recordings or replay old music after recovery.
    run.pending = {
      sequence,
      capturedAt: this.clock() - lag * 1000,
      pcm: new Uint8Array(value.pcm),
    };
    void this.pump(run);
  }
  async pump(run) {
    if (run.pumping) return;
    run.pumping = true;
    try {
      while (this.run === run && run.pending) {
        const packet = run.pending;
        run.pending = null;
        const receipt = await this.api.musicAudioPacket({
          sessionId: run.id,
          ...packet,
        });
        if (this.run !== run) break;
        // Loading/busy workers may drop a packet without revoking the capture.
        if (receipt?.stop === true || receipt?.revoked === true) {
          this.stop(false);
          break;
        }
      }
    } catch {
      if (this.run === run) {
        this.stop();
        this.onError('Music listening stopped. Enable it again to retry.');
      }
    } finally {
      run.pumping = false;
    }
  }
  playback({ speaking = false, outputBusy = speaking } = {}) {
    const busy = Boolean(outputBusy || speaking);
    if (this.playbackBusy && !busy) this.tailUntil = this.now() + 400;
    this.playbackBusy = busy;
    if (busy && this.run) this.run.pending = null;
  }
  stop(notify = true) {
    const run = this.run;
    this.run = null;
    if (run) {
      run.pending = null;
      if (run.worklet) {
        run.worklet.port.onmessage = null;
        run.worklet.disconnect();
      }
      run.source?.disconnect();
      run.silence?.disconnect();
      stopStream(run.stream);
      run.context?.close().catch(() => {});
      if (run.id) {
        this.api.cancelMusicAudio(run.id).catch(() => {});
        if (notify) this.api.musicAudioStop(run.id).catch(() => {});
      }
    }
    this.publish({ status: 'off', enabled: false, sessionId: null });
  }
}
