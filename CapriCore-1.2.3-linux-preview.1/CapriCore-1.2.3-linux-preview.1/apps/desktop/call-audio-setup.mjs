// SPDX-License-Identifier: GPL-3.0-only
import { callOutputDevices } from './main/call-audio.mjs';

const setupPhases = new Set([
  'idle',
  'checking',
  'missing',
  'downloading',
  'installing',
  'reboot',
  'connecting',
  'ready',
  'error',
]);
const setupFailures = new Set([
  'feedback-loop',
  'microphone-unavailable',
  'microphone-permission',
  'microphone-invalid',
  'device-list-failed',
  'output-unavailable',
  'cable-required',
  'setup-unavailable',
  'install-failed',
  'timeout',
  'cancelled',
  'unknown',
]);
const setupFailureMessages = new Map([
  ['Use a call cable separate from your microphone.', 'feedback-loop'],
  [
    'The selected microphone is unavailable. Choose a device in Menu → Microphone input.',
    'microphone-unavailable',
  ],
  [
    'The selected microphone is unavailable. Choose a connected physical microphone in Microphone settings.',
    'microphone-unavailable',
  ],
  [
    'No physical microphone is available. Connect a microphone and check Windows microphone permissions.',
    'microphone-unavailable',
  ],
  [
    'The selected physical microphone could not start. Check that it is connected and available.',
    'microphone-unavailable',
  ],
  ['The selected physical microphone disconnected.', 'microphone-unavailable'],
  [
    'Microphone access is unavailable. Check Windows microphone permissions.',
    'microphone-permission',
  ],
  [
    'Microphone access was denied. Allow Capri to use the microphone in Windows privacy settings.',
    'microphone-permission',
  ],
  [
    'Select a physical microphone instead of a virtual cable or loopback device.',
    'microphone-invalid',
  ],
  ['Select a physical microphone before sharing it with a call.', 'microphone-invalid'],
  ['Microphones could not be listed. Check Windows microphone permissions.', 'device-list-failed'],
  ['Call output devices could not be listed.', 'device-list-failed'],
  ['Call audio output is unavailable.', 'output-unavailable'],
  ['The virtual microphone did not connect. Try again.', 'output-unavailable'],
  ['A virtual audio cable is needed. Install VB-CABLE to continue.', 'cable-required'],
  ['Open Voice calls in Settings.', 'setup-unavailable'],
  ['Open Voice calls in Settings to finish connecting.', 'setup-unavailable'],
  ['VB-CABLE could not be installed.', 'install-failed'],
  ['Call microphone setup timed out. Please try again.', 'timeout'],
  ['Call audio setup timed out.', 'timeout'],
  ['Call microphone setup was cancelled.', 'cancelled'],
]);

/** Fixed diagnostic vocabulary; endpoint names, IDs and raw errors never pass through. */
export function callSetupDiagnosticState(value = {}) {
  return {
    phase: value?.phase == null ? 'idle' : setupPhases.has(value.phase) ? value.phase : 'unknown',
    busy: value?.busy === true,
    cableFound: value?.cableFound === true,
    lastFailure:
      value?.lastFailure == null
        ? null
        : setupFailures.has(value.lastFailure)
          ? value.lastFailure
          : 'unknown',
  };
}

// Match both sides. A speaker with an inviting name alone is never a call cable.
export function virtualCallCable(devices) {
  if (!Array.isArray(devices) || devices.length > 128) return null;
  const inputs = callOutputDevices(
    devices
      .filter((device) => device?.kind === 'audioinput')
      .map((device) => ({
        ...device,
        kind: 'audiooutput',
      })),
  );
  const outputs = callOutputDevices(devices);
  for (const family of ['', '-A', '-B', '-C', '-D']) {
    const input = new RegExp('\\bCABLE' + family + ' Output\\b', 'i');
    const output = new RegExp('\\bCABLE' + family + ' Input\\b', 'i');
    const sources = inputs.filter((device) => input.test(device.label));
    const sinks = outputs.filter((device) => output.test(device.label));
    if (sources.length === 1 && sinks.length === 1)
      return {
        deviceId: sinks[0].deviceId,
        outputLabel: sinks[0].label,
        inputLabel: sources[0].label,
      };
  }
  return null;
}

export class CallAudioSetup {
  constructor({ devices, connect, installer, available, connected, emit = () => {}, wait }) {
    Object.assign(this, { devices, connect, installer, available, connected, emit });
    this.wait = wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.state = { phase: 'idle', busy: false };
    this.cableFound = false;
    this.lastFailure = null;
  }
  snapshot() {
    const ready = this.connected();
    return {
      ...this.state,
      ...(this.state.phase === 'ready' && !ready && { phase: 'idle' }),
      ready,
    };
  }
  diagnostics() {
    const { phase, busy } = this.snapshot();
    return callSetupDiagnosticState({
      phase,
      busy,
      cableFound: this.cableFound,
      lastFailure: this.lastFailure,
    });
  }
  publish(value) {
    this.state = { ...this.state, ...value };
    this.emit(this.snapshot());
  }
  progress(value) {
    if (this.state.busy) this.publish({ phase: value.phase });
  }
  async run(install = false) {
    if (this.state.busy) throw new Error('Virtual microphone setup is already running.');
    if (!this.available()) {
      this.lastFailure = 'setup-unavailable';
      throw new Error('Open Voice calls in Settings.');
    }
    this.cableFound = false;
    this.lastFailure = null;
    this.state = { phase: 'checking', busy: true };
    this.emit(this.snapshot());
    try {
      let cable = virtualCallCable(await this.devices());
      this.cableFound = Boolean(cable);
      if (!cable && !install) {
        this.publish({ phase: 'missing' });
        this.publish({ busy: false });
        return this.snapshot();
      }
      if (!cable) {
        const result = await this.installer.install();
        if (result.phase === 'error')
          throw new Error(result.error || 'VB-CABLE could not be installed.');
        this.publish({
          defaultsWarning: result.defaultsWarning === true,
          restartRecommended: true,
        });
        // Do not reboot automatically. Some Windows versions expose the new pair immediately.
        for (let attempt = 0; attempt < 10 && this.available(); attempt++) {
          cable = virtualCallCable(await this.devices());
          this.cableFound = Boolean(cable);
          if (cable) break;
          await this.wait(500);
        }
        if (!cable) {
          this.publish({ phase: 'reboot' });
          this.publish({ busy: false });
          return this.snapshot();
        }
      }
      if (!this.available()) throw new Error('Open Voice calls in Settings to finish connecting.');
      this.publish({ phase: 'connecting', cable });
      await this.connect(cable.deviceId);
      if (!this.connected()) throw new Error('The virtual microphone did not connect. Try again.');
      this.publish({ phase: 'ready' });
    } catch (error) {
      this.lastFailure = setupFailureMessages.get(error?.message) ?? 'unknown';
      this.publish({ phase: 'error', error: error.message });
    } finally {
      this.publish({ busy: false });
    }
    return this.snapshot();
  }
}
