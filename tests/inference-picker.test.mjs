// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferenceChoices,
  InferencePicker,
  localResidencyPresentation,
} from '../apps/desktop/renderer/inference-picker.mjs';

test('local allocation labels distinguish measured CPU/GPU from unloaded or unknown without untranslated prose', () => {
  const calls = [];
  const text = (key) => {
    calls.push(key);
    return `localized:${key}`;
  };
  for (const [status, label] of [
    ['cpu', 'CPU'],
    ['gpu', 'GPU'],
    ['partial', 'GPU + CPU'],
  ]) {
    const value = localResidencyPresentation({ status }, text);
    assert.equal(value.label, label);
    assert.equal(value.title, 'localized:Current model · ' + label);
  }
  for (const status of ['unloaded', 'unknown', 'constructor', '<img onerror=bad()>', undefined]) {
    const value = localResidencyPresentation({ status }, text);
    assert.deepEqual(value, { label: '—', title: 'localized:Unavailable' });
    assert.doesNotMatch(value.title, /CPU/);
  }
  assert(calls.every((key) => ['Current model', 'Unavailable'].includes(key)));
});

test('picker appends residency only to the active local row and preserves its reply-busy guard', () => {
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.attributes = {};
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren() {
      this.children = [];
    }
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try {
    for (const remote of [false, true]) {
      const picker = Object.create(InferencePicker.prototype);
      Object.assign(picker, {
        menu: new Element(),
        ui: { text: (key) => key },
        value: {
          localModel: 'selected-model',
          localResidency: { status: 'partial' },
          activeId: remote ? 'provider' : null,
          profiles: [{ id: 'provider', name: 'Saved API', model: 'api-model', canConnect: true }],
        },
        selecting: false,
        isBusy: () => true,
        position() {},
      });
      picker.render();
      const choices = picker.menu.children.filter(
        (row) => row.className === 'inference-picker-choice',
      );
      assert.equal(choices[0].children[2].textContent, remote ? '' : 'Active · GPU + CPU');
      assert.equal(choices[1].children[2].textContent, remote ? 'Active' : '');
      assert(choices.every((row) => row.disabled === true));
      assert.equal(picker.menu.children[1].textContent, 'Wait for the current reply to finish.');
      assert.equal(picker.menu.children[1].hidden, false);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('quick choices expose only presentation and opaque selection IDs, never keys or provider settings', () => {
  const choices = inferenceChoices({
    activeId: 'second',
    localModel: 'capri-local',
    profiles: [
      {
        id: 'first',
        name: '<img onerror=alert(1)>',
        model: 'a/model',
        baseUrl: 'https://provider.example/v1',
        canConnect: false,
        key: 'private-test-value',
      },
      {
        id: 'second',
        name: '',
        model: 'b/model',
        baseUrl: 'https://other.example/v1',
        canConnect: true,
        ciphertext: 'private-test-value',
      },
    ],
  });
  assert.deepEqual(choices, [
    { id: null, label: 'Local', model: 'capri-local', active: false, available: true },
    {
      id: 'first',
      label: '<img onerror=alert(1)>',
      model: 'a/model',
      active: false,
      available: false,
    },
    { id: 'second', label: 'other.example', model: 'b/model', active: true, available: true },
  ]);
  assert(!JSON.stringify(choices).includes('private-test-value'));
  assert.equal(inferenceChoices()[0].active, true);
  assert.equal(inferenceChoices({ setupRequired: true })[0].active, false);
});

function fixture({ models, current = false, fail = false } = {}) {
  const calls = [];
  const picker = Object.create(InferencePicker.prototype);
  Object.assign(picker, {
    selecting: false,
    request: 0,
    syncBusy() {},
    isBusy: () => false,
    items: () => [],
    menu: { setAttribute() {}, hidden: false },
    close: () => calls.push('close'),
    api: {
      modelStatus: async () => models,
      refreshModels: async () => {
        calls.push('inventory');
        return models;
      },
      openSettings: async (section) => calls.push(section),
      useInferenceApi: async (id) => {
        calls.push(id);
        if (fail) throw Error('Switch failed');
        return false;
      },
    },
    onError: (text) => calls.push(text),
  });
  return { picker, calls, choice: { id: null, available: true, active: current } };
}

test('local quick choice switches only the installed configured model, otherwise opens model selection', async () => {
  const ready = fixture({
    models: { profiles: [{ configured: true, installed: true, supported: true }] },
  });
  await ready.picker.select(ready.choice);
  assert.deepEqual(ready.calls, ['close', null]);
  assert.equal(ready.picker.selecting, false, 'A cancelled host confirmation releases the picker');
  for (const profile of [
    undefined,
    { configured: false, installed: true, supported: true },
    { configured: true, installed: false, supported: true },
    { configured: true, installed: true, supported: false },
  ]) {
    const value = fixture({ models: { profiles: profile ? [profile] : [] } });
    await value.picker.select(value.choice);
    assert(!value.calls.includes(null));
    assert(value.calls.includes('models'));
  }
});

test('closing the menu during local inventory lookup cancels the delayed switch', async () => {
  let resolve;
  const value = fixture();
  value.picker.api.modelStatus = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = value.picker.select(value.choice);
  value.picker.request++;
  value.picker.menu.hidden = true;
  resolve({ profiles: [{ configured: true, installed: true, supported: true }] });
  await pending;
  assert.deepEqual(value.calls, []);
  assert.equal(value.picker.selecting, false);
});

test('cancelled local lookup cannot refresh the inventory or report a late lookup failure', async () => {
  for (const failure of [false, true]) {
    let resolve, reject;
    const value = fixture();
    value.picker.api.modelStatus = () =>
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
    const pending = value.picker.select(value.choice);
    value.picker.request++;
    value.picker.menu.hidden = true;
    if (failure) reject(Error('Obsolete lookup failure'));
    else resolve({ profiles: [], inventoryUnavailable: true });
    await pending;
    assert.deepEqual(value.calls, []);
    assert.equal(value.picker.selecting, false);
  }
});

test('current, unavailable, repeated and busy choices never switch, and failures release the pending flag', async () => {
  const value = fixture();
  await value.picker.select({ id: 'one', active: true, available: true });
  assert.deepEqual(value.calls, ['close']);
  value.calls.length = 0;
  await value.picker.select({ id: 'one', active: false, available: false });
  value.picker.isBusy = () => true;
  await value.picker.select({ id: 'one', active: false, available: true });
  value.picker.isBusy = () => false;
  value.picker.selecting = true;
  await value.picker.select({ id: 'one', active: false, available: true });
  assert.deepEqual(value.calls, []);
  const failed = fixture({ fail: true });
  await failed.picker.select({ id: 'one', active: false, available: true });
  assert(failed.calls.includes('Switch failed'));
  assert.equal(failed.picker.selecting, false);
});
