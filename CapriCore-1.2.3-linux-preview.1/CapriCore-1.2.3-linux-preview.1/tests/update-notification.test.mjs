// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateNotification } from '../apps/desktop/renderer/update-notification.mjs';

function fixture(callbacks = {}) {
  const doc = {
    createElement: (name) => new Element(name),
    createElementNS: (_namespace, name) => new Element(name),
  };
  class Element {
    constructor(name) {
      this.name = name;
      this.ownerDocument = doc;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.classes = new Set();
      this.classList = { add: (name) => this.classes.add(name) };
    }
    set innerHTML(_value) {
      assert.fail('The notification must never parse markup.');
    }
    append(...items) {
      this.children.push(...items);
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  }
  let language = 'en',
    layouts = 0;
  const errors = [],
    element = new Element('section');
  const ui = {
    text: (key, values = {}) => {
      let text = key.replace('{version}', values.version ?? '');
      return language === 'en' ? text : 'translated ' + text;
    },
  };
  const card = new UpdateNotification({
    element,
    ui,
    onUpdate: async () => {},
    onLater: async () => {},
    onError: (error) => errors.push(error),
    onLayout: () => layouts++,
    ...callbacks,
  });
  return {
    card,
    element,
    errors,
    layouts: () => layouts,
    translate: () => {
      language = 'test';
      card.refresh();
    },
  };
}
const available = (tag = 'v0.5.3') => ({ notification: { tag } });

test('only a bounded semantic version notification renders, without parsing network markup', () => {
  const { card, element, layouts } = fixture();
  assert.equal(element.hidden, true);
  for (const status of [
    null,
    {},
    { release: { tag: 'v0.5.3' } },
    available('<img src=x>'),
    available('v01.2.3'),
    available('v1.2.3-01'),
    available('v1.2.3-' + 'x'.repeat(81)),
  ]) {
    card.show(status);
    assert.equal(element.hidden, true);
    assert.equal(card.headline.textContent, '');
  }
  card.show(available('v1.2.3-beta.2+build'));
  assert.equal(element.hidden, false);
  assert.equal(card.headline.textContent, 'A new update is available: v1.2.3-beta.2+build');
  assert.equal(card.updateButton.disabled, false);
  assert.equal(element.dataset.panelCut, '10');
  assert.ok('hitRegion' in element.dataset);
  assert.ok(layouts() > 1);
  assert.equal(card.headline.attributes['aria-live'], 'polite');
  assert.equal(card.updateButton.type, 'button');
});

test('update invokes the host once, guards both buttons, and remains a restart invitation', async () => {
  let resolve,
    calls = [];
  const { card, element } = fixture({
    onUpdate: (tag) => {
      calls.push(tag);
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  card.show(available());
  const pending = card.updateButton.onclick();
  await card.updateButton.onclick();
  await card.laterButton.onclick();
  assert.deepEqual(calls, ['v0.5.3']);
  assert.equal(card.updateButton.disabled, true);
  assert.equal(card.laterButton.disabled, true);
  assert.equal(element.attributes['aria-busy'], 'true');
  assert.equal(card.updateButton.textContent, 'Downloading update...');
  resolve();
  await pending;
  assert.equal(card.updateButton.disabled, false);
  assert.equal(element.attributes['aria-busy'], 'false');
  assert.equal(element.hidden, false);
});

test('remind later awaits successful host dismissal and cannot resurface that tag in this run', async () => {
  let resolve;
  const { card, element } = fixture({
    onLater: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  card.show(available());
  const pending = card.laterButton.onclick();
  assert.equal(element.hidden, false);
  resolve();
  await pending;
  assert.equal(element.hidden, true);
  card.show(available());
  assert.equal(element.hidden, true);
  card.show(available('v0.5.4'));
  assert.equal(element.hidden, false);
});

test('failed host actions report the error, keep the invitation and permit retry', async () => {
  let attempts = 0;
  const { card, element, errors } = fixture({
    onLater: async () => {
      if (++attempts === 1) throw new Error('Synthetic failure');
    },
  });
  card.show(available());
  await card.laterButton.onclick();
  assert.deepEqual(errors, ['Synthetic failure']);
  assert.equal(element.hidden, false);
  assert.equal(card.laterButton.disabled, false);
  await card.laterButton.onclick();
  assert.equal(element.hidden, true);
});

test('an old in-flight dismissal cannot hide a newer notification', async () => {
  let resolve;
  const { card, element } = fixture({
    onLater: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  card.show(available());
  const pending = card.laterButton.onclick();
  card.show(available('v0.5.4'));
  resolve();
  await pending;
  assert.equal(element.hidden, false);
  assert.equal(card.headline.textContent, 'A new update is available: v0.5.4');
});

test('locale refresh updates all visible labels and preserves dismissal and busy state', async () => {
  let resolve;
  const f = fixture({
    onUpdate: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  f.card.show(available());
  const pending = f.card.updateButton.onclick();
  f.translate();
  assert.equal(f.card.label.textContent, 'translated Updates');
  assert.equal(f.card.headline.textContent, 'translated A new update is available: v0.5.3');
  assert.equal(f.card.updateButton.textContent, 'translated Downloading update...');
  assert.equal(f.card.laterButton.textContent, 'translated Remind me later');
  assert.equal(f.card.updateButton.disabled, true);
  resolve();
  await pending;
  assert.equal(f.card.updateButton.textContent, 'translated Update');
});
