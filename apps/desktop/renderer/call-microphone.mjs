// SPDX-License-Identifier: GPL-3.0-only

/** Calls keep the device's voice bandwidth; ASR resampling belongs to its own context. */
export function callMicrophoneConstraints(deviceId = '') {
  return {
    video: false,
    audio: {
      sampleRate: { ideal: 48000 },
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };
}

const specificDevice = (id) =>
  typeof id === 'string' &&
  /^[^\x00-\x1f\x7f]{1,512}$/.test(id) &&
  id.trim() &&
  !['default', 'communications'].includes(id);

// A cable's recording endpoint must never be mixed back into its playback endpoint.
const loopback =
  /\b(?:cable(?:[ -]?[a-d])?\s+(?:input|output)|vb[ -]?audio|voicemeeter|steam streaming|loopback|stereo mix|what u hear|wave out mix|virtual|obs[ -]?audio)\b/i;
const physicalLabel = (label) =>
  typeof label === 'string' && Boolean(label.trim()) && !loopback.test(label);
const livePhysicalTrack = (track) => track?.readyState === 'live' && physicalLabel(track.label);
const matchesPhysicalInput = (track, device, settings = track?.getSettings?.()) => {
  return Boolean(
    device &&
      livePhysicalTrack(track) &&
      specificDevice(settings?.deviceId) &&
      settings.deviceId === device.deviceId &&
      (!settings.groupId || !device.groupId || settings.groupId === device.groupId),
  );
};
const stopTracks = (stream) => {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
};

export function physicalCallInputs(devices) {
  if (!Array.isArray(devices) || devices.length > 128) return [];
  return devices.filter(
    (device) =>
      device?.kind === 'audioinput' &&
      specificDevice(device.deviceId) &&
      physicalLabel(device.label),
  );
}

/** An explicitly enabled call can share a physical mic without loading speech recognition. */
export class CallMicrophone {
  constructor({
    mediaDevices = globalThis.navigator?.mediaDevices,
    onLost = () => {},
    timeoutMs = 10000,
  } = {}) {
    Object.assign(this, { mediaDevices, onLost, timeoutMs });
    this.generation = 0;
    this.run = null;
    this.pending = null;
  }

  get stream() {
    return this.run?.stream ?? null;
  }

  get owned() {
    return this.run?.owned === true;
  }

  async start({ deviceId = '', shared = null } = {}) {
    this.stop();
    const generation = this.generation;
    let timer;
    const cancelled = new Promise((_, reject) => {
      const cancel = () => reject(new Error('Call microphone setup was cancelled.'));
      this.pending = { generation, cancel };
      timer = setTimeout(
        () => reject(new Error('Call microphone setup timed out. Please try again.')),
        this.timeoutMs,
      );
    });
    const current = () => this.generation === generation && this.pending?.generation === generation;
    const capture = async () => {
      if (!this.mediaDevices?.enumerateDevices)
        throw new Error('Microphone access is unavailable. Check Windows microphone permissions.');
      let devices;
      try {
        devices = await this.mediaDevices.enumerateDevices();
      } catch {
        throw new Error('Microphones could not be listed. Check Windows microphone permissions.');
      }
      if (!current()) throw new Error('Call microphone setup was cancelled.');
      const inputs = physicalCallInputs(devices);
      const defaultInput = devices.find(
        (device) => device?.kind === 'audioinput' && device.deviceId === 'default',
      );
      const preferred = inputs.find((device) => device.deviceId === deviceId);
      if (deviceId && !preferred)
        throw new Error(
          'The selected microphone is unavailable. Choose a connected physical microphone in Microphone settings.',
        );
      const physicalDefault = defaultInput?.groupId
        ? inputs.find((device) => device.groupId === defaultInput.groupId)
        : null;
      const selected = preferred ?? physicalDefault ?? inputs[0];
      if (!selected)
        throw new Error(
          'No physical microphone is available. Connect a microphone and check Windows microphone permissions.',
        );
      // Default tracks may retarget after hotplug without losing their old label.
      // Trust a borrowed track only after resolving today's concrete input, and
      // read its settings after enumeration rather than keeping a stale snapshot.
      const sharedTrack = shared?.getAudioTracks?.()[0];
      const sharedSettings = sharedTrack?.getSettings?.();
      if (
        matchesPhysicalInput(sharedTrack, selected, sharedSettings) &&
        shared.getAudioTracks().length === 1 &&
        Number.isFinite(sharedSettings?.sampleRate) &&
        sharedSettings.sampleRate >= 44100
      )
        return { stream: shared, track: sharedTrack, deviceId: selected.deviceId, owned: false };
      // Never retune an ASR-owned track: capture a separate exact physical input.
      if (!this.mediaDevices.getUserMedia)
        throw new Error('Microphone access is unavailable. Check Windows microphone permissions.');
      let stream;
      try {
        stream = await this.mediaDevices.getUserMedia(callMicrophoneConstraints(selected.deviceId));
      } catch (error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError')
          throw new Error(
            'Microphone access was denied. Allow Capri to use the microphone in Windows privacy settings.',
          );
        throw new Error(
          'The selected physical microphone could not start. Check that it is connected and available.',
        );
      }
      // A grant can arrive after Stop, a timeout, or a replacement setup request.
      if (!current()) {
        stopTracks(stream);
        throw new Error('Call microphone setup was cancelled.');
      }
      const track = stream.getAudioTracks()[0];
      if (!matchesPhysicalInput(track, selected) || stream.getAudioTracks().length !== 1) {
        stopTracks(stream);
        throw new Error(
          'Select a physical microphone instead of a virtual cable or loopback device.',
        );
      }
      return { stream, track, deviceId: selected.deviceId, owned: true };
    };
    try {
      const run = await Promise.race([capture(), cancelled]);
      if (!current()) {
        if (run.owned) stopTracks(run.stream);
        throw new Error('Call microphone setup was cancelled.');
      }
      this.run = run;
      run.ended = () => this.lose(run);
      run.changed = () => {
        void this.mediaDevices?.enumerateDevices?.().then(
          (devices) => {
            const device = physicalCallInputs(devices).find(
              (device) => device.deviceId === run.deviceId,
            );
            if (
              this.run === run &&
              run.deviceId &&
              (!device || !matchesPhysicalInput(run.track, device))
            )
              this.lose(run);
          },
          () => this.lose(run),
        );
      };
      run.track.addEventListener('ended', run.ended, { once: true });
      this.mediaDevices?.addEventListener?.('devicechange', run.changed);
      if (run.track.readyState !== 'live') {
        this.lose(run);
        throw new Error('The selected physical microphone disconnected.');
      }
      return run.stream;
    } finally {
      clearTimeout(timer);
      if (this.pending?.generation === generation) this.pending = null;
    }
  }

  sync(shared) {
    const run = this.run;
    if (
      run &&
      ((!run.owned && run.track !== shared?.getAudioTracks?.()[0]) ||
        run.track.readyState !== 'live')
    )
      this.lose(run);
    return Boolean(this.run);
  }

  lose(run) {
    if (this.run !== run) return;
    this.stop();
    this.onLost();
  }

  stop() {
    this.generation++;
    this.pending?.cancel();
    this.pending = null;
    const run = this.run;
    this.run = null;
    if (!run) return;
    run.track.removeEventListener('ended', run.ended);
    this.mediaDevices?.removeEventListener?.('devicechange', run.changed);
    if (run.owned) stopTracks(run.stream);
  }
}
