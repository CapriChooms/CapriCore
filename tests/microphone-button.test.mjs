// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  microphoneButtonState,
  setMicrophoneButtonBusy,
} from '../apps/desktop/renderer/microphone-button.mjs';

const ready = { ready: true, backendPhase: 'ready' };

test('both microphone preparation phases remain cancellable in the header without allowing a duplicate composer start', () => {
  for (const status of ['starting', 'arming']) {
    const state = microphoneButtonState(
      { available: true, enabled: true, status },
      { ready: false, backendPhase: 'starting', commandListening: true },
    );
    assert.equal(state.loading, true);
    assert.equal(state.headerDisabled, false);
    assert.equal(state.inputDisabled, true);
    assert.equal(
      state.inputPressed,
      false,
      'Preparation cannot claim that a command is being heard',
    );
  }
});

test('ordinary readiness and wake listening replace the spinner only after capture becomes live', () => {
  const state = microphoneButtonState(
    { available: true, enabled: true, modelLoaded: true, status: 'listening' },
    { ...ready, commandListening: false },
  );
  assert.equal(state.loading, false);
  assert.equal(state.headerDisabled, false);
  assert.equal(state.inputDisabled, false);
  assert.equal(state.inputPressed, false);
  assert.equal(
    microphoneButtonState(
      { available: true, status: 'listening' },
      { ...ready, commandListening: true },
    ).inputPressed,
    true,
  );
});

test('a warm model is still unloadable from the header and restartable from the composer without a false loading animation', () => {
  const state = microphoneButtonState(
    { available: true, enabled: false, modelLoaded: true, status: 'off' },
    ready,
  );
  assert.equal(state.enabled, true);
  assert.equal(state.loading, false);
  assert.equal(state.headerDisabled, false);
  assert.equal(state.inputDisabled, false);
  assert.equal(state.inputPressed, false);
});

test('unavailable packs and an offline core do not create fake microphone progress', () => {
  const missing = microphoneButtonState({ available: false, status: 'off' }, ready);
  assert.equal(missing.loading, false);
  assert.equal(missing.headerDisabled, true);
  assert.equal(missing.inputDisabled, true);
  const offline = microphoneButtonState(
    { available: true, status: 'off' },
    { ready: true, backendPhase: 'offline' },
  );
  assert.equal(offline.loading, false);
  assert.equal(offline.inputDisabled, true);
});

test('busy accessibility attributes can return to a clear idle state after cancellation or failure', () => {
  const attributes = new Map();
  const button = { dataset: {}, setAttribute: (key, value) => attributes.set(key, value) };
  setMicrophoneButtonBusy(button, true);
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.equal(button.dataset.loading, 'true');
  setMicrophoneButtonBusy(button, false);
  assert.equal(attributes.get('aria-busy'), 'false');
  assert.equal(button.dataset.loading, 'false');
});
