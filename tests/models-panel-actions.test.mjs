// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelsPanel } from '../apps/desktop/renderer/models-panel.mjs';

function fixture(patch = {}) {
  const fields = new Map();
  const panel = Object.create(ModelsPanel.prototype);
  const profile = {
    id: 'minimal',
    supported: true,
    installed: false,
    configured: true,
    active: false,
    ...patch,
  };
  panel.value = {
    phase: 'idle',
    selected: null,
    remoteActive: true,
    inventoryUnavailable: true,
    profiles: [profile],
  };
  panel.setupRequired = true;
  panel.get = (name) => {
    if (!fields.has(name))
      fields.set(name, {
        value: name === 'choice' ? profile.id : '',
        hidden: false,
        disabled: false,
      });
    return fields.get(name);
  };
  panel.ui = { text: (key) => key };
  panel.size = () => '1.2 GB';
  panel.show = (value) => {
    panel.value = value;
    panel.details();
  };
  const calls = [];
  panel.api = {
    async prepareModel(id) {
      calls.push(['prepare', id]);
      return {
        ...panel.value,
        phase: 'ready',
        selected: id,
        inventoryUnavailable: false,
        profiles: [{ ...profile, installed: true, upstreamInstalled: true }],
      };
    },
    async applyModel() {
      calls.push(['apply']);
      return true;
    },
    async useInferenceApi(id) {
      calls.push(['provider', id]);
      return true;
    },
  };
  panel.onError = (error) => {
    throw Error(error);
  };
  return { panel, calls };
}

test('a clean API installation can download, prepare and select its first local model in one explicit action', async () => {
  const { panel, calls } = fixture();
  panel.details();
  assert.equal(panel.get('local').disabled, false);
  assert.equal(panel.get('prepare').disabled, false);
  assert.equal(await panel.useLocalModel(), true);
  assert.deepEqual(calls, [['prepare', 'minimal'], ['apply']]);
});

test('a missing configured model can be repaired while an installed active model stays selected', () => {
  const { panel } = fixture({ active: true });
  panel.setupRequired = false;
  panel.value.remoteActive = false;
  panel.details();
  assert.equal(panel.get('prepare').disabled, false);
  assert.equal(panel.get('local').disabled, false);
  panel.value.profiles[0].installed = true;
  panel.value.inventoryUnavailable = false;
  panel.details();
  assert.equal(
    panel.get('prepare').disabled,
    false,
    'An orphaned alias still needs its source model',
  );
  assert.equal(panel.get('local').disabled, false);
  panel.value.profiles[0].upstreamInstalled = true;
  panel.details();
  assert.equal(panel.get('local').disabled, true);
});

test('insufficient RAM and an active model operation remain explicit selection blockers', () => {
  const { panel } = fixture({ supported: false });
  panel.details();
  assert.equal(panel.get('local').disabled, true);
  assert.equal(panel.get('unavailable').hidden, false);
  panel.value.profiles[0].supported = true;
  panel.value.phase = 'downloading';
  panel.details();
  assert.equal(panel.get('local').disabled, true);
});
