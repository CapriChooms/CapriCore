// SPDX-License-Identifier: GPL-3.0-only

/** Only actual microphone preparation states show progress; a busy core alone does not. */
export function microphoneButtonState(
  microphone,
  { ready = false, backendPhase, commandListening = false } = {},
) {
  const loading = ['starting', 'arming'].includes(microphone?.status);
  // The header is the master switch, including a resident model without live capture.
  // Keep it cancellable during preparation, while preventing another composer start.
  const enabled = Boolean(microphone?.enabled || microphone?.modelLoaded || loading);
  const headerDisabled =
    !microphone?.available || (!enabled && (!ready || !['ready', 'asleep'].includes(backendPhase)));
  return {
    loading,
    enabled,
    headerDisabled,
    inputDisabled: headerDisabled || loading,
    inputPressed: commandListening === true && microphone?.status === 'listening',
  };
}

export function setMicrophoneButtonBusy(button, loading) {
  const value = String(loading === true);
  button.setAttribute('aria-busy', value);
  button.dataset.loading = value;
}
