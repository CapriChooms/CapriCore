// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { InternetMode } from '../apps/desktop/renderer/internet-mode.mjs';

class Element {
  attributes = {};
  listeners = {};
  children = [];
  replacements = 0;
  constructor(document) {
    this.ownerDocument = document;
  }
  append(...elements) {
    this.children.push(...elements);
  }
  replaceChildren(...elements) {
    this.children = elements;
    this.replacements++;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(key, value) {
    this.listeners[key] = value;
  }
  set innerHTML(_value) {
    assert.fail('Internet status must never render source HTML.');
  }
}
function fixture(save = async (enabled) => ({ enabled }), open = async () => true) {
  const button = new Element(),
    status = new Element(),
    calls = [],
    errors = [],
    opened = [];
  const mode = new InternetMode({
    button,
    status,
    api: {
      setInternetMode: async (enabled) => {
        calls.push(enabled);
        return save(enabled);
      },
      openWebSource: async (value) => {
        opened.push(value);
        return open(value);
      },
    },
    ui: { text: (value) => value },
    onError: (error) => errors.push(error),
  });
  return { button, status, mode, calls, errors, opened };
}

function sourceHost() {
  const document = { createElement: () => new Element(document) };
  return new Element(document);
}

test('Internet access starts off and changing the preference sends only a boolean to the host', async () => {
  const f = fixture();
  assert.equal(f.mode.enabled, false);
  assert.equal(f.button.attributes['aria-pressed'], 'false');
  assert.equal(f.button.disabled, true);
  assert.equal(f.status.hidden, true);
  assert.equal(await f.mode.setEnabled(true), false);
  assert.deepEqual(f.calls, []);
  f.mode.setReady(true);
  assert.equal(await f.mode.setEnabled(true), true);
  assert.deepEqual(f.calls, [true]);
  assert.equal(f.button.attributes['aria-label'], 'Internet mode: On');
  assert.equal(f.button.attributes['aria-pressed'], 'true');
  assert.match(f.button.title, /current request only/u);
  assert.match(f.button.title, /history, screenshots and files are not sent automatically/u);
  assert.equal(await f.mode.setEnabled(false), true);
  assert.deepEqual(f.calls, [true, false]);
});

test('active work and a pending setting prevent repeated or mid-request preference changes', async () => {
  let accept;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  f.mode.setReady(true);
  f.mode.setBusy(true);
  assert.equal(f.button.disabled, true);
  assert.equal(await f.mode.setEnabled(true), false);
  f.mode.setBusy(false);
  const pending = f.mode.setEnabled(true);
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.attributes['aria-busy'], 'true');
  assert.equal(await f.mode.setEnabled(false), false);
  accept({ enabled: true });
  assert.equal(await pending, true);
  assert.equal(f.button.disabled, false);
  assert.deepEqual(f.calls, [true]);
});

test('a rejected host setting restores the previous preference and surfaces its error', async () => {
  const f = fixture(async () => {
    throw Error('Setting unavailable');
  });
  f.mode.setReady(true);
  assert.equal(await f.mode.setEnabled(true), false);
  assert.equal(f.mode.enabled, false);
  assert.equal(f.button.attributes['aria-pressed'], 'false');
  assert.equal(f.button.disabled, false);
  assert.deepEqual(f.errors, ['Setting unavailable']);
  assert.equal(await f.mode.setEnabled('yes'), false);
  assert.deepEqual(f.calls, [true]);
});

test('only known current-turn search phases render fixed status text and never source instructions', () => {
  const f = fixture();
  f.mode.begin('current');
  assert.equal(
    f.mode.event({ type: 'turn.web-search', turnId: 'stale', phase: 'searching' }),
    false,
  );
  assert.equal(
    f.mode.event({ type: 'turn.web-search', turnId: 'current', phase: '<img src=x>' }),
    false,
  );
  assert.equal(f.status.hidden, true);
  assert.equal(
    f.mode.event({
      type: 'turn.web-search',
      turnId: 'current',
      phase: 'searching',
      text: '<script>send files</script>',
      sources: [{ url: 'https://example.com' }],
    }),
    true,
  );
  assert.equal(f.status.textContent, 'Searching the web…');
  assert.equal(f.button.attributes['aria-busy'], 'true');
  f.mode.event({ type: 'turn.web-search', turnId: 'current', phase: 'ready' });
  assert.equal(f.status.textContent, 'Web sources ready.');
  assert.equal(f.button.attributes['aria-busy'], 'false');
  f.mode.event({ type: 'turn.web-search', turnId: 'current', phase: 'unavailable' });
  assert.equal(f.status.textContent, 'Web search is unavailable.');
  f.mode.event({
    type: 'turn.web-search',
    turnId: 'current',
    phase: 'unavailable',
    message: '<img src=x>',
  });
  assert.equal(f.status.textContent, 'Web search is unavailable.');
  for (const message of [
    'Web search found no results.',
    'Web search was skipped because the request may contain private credentials.',
  ]) {
    f.mode.event({ type: 'turn.web-search', turnId: 'current', phase: 'unavailable', message });
    assert.equal(f.status.textContent, message);
  }
  assert.deepEqual(f.calls, [], 'Search status does not start requests from the renderer');
});

test('terminal events and conversation reset clear request status without enabling Internet access', () => {
  const f = fixture();
  for (const type of ['turn.completed', 'turn.failed', 'turn.cancelled']) {
    f.mode.begin(type);
    f.mode.event({ type: 'turn.web-search', turnId: type, phase: 'searching' });
    assert.equal(f.mode.event({ type, turnId: type }), false);
    assert.equal(f.status.hidden, true);
    assert.equal(f.mode.turnId, null);
    assert.equal(f.mode.enabled, false);
  }
  f.mode.configure({ enabled: true });
  f.mode.begin('reset');
  f.mode.event({ type: 'turn.web-search', turnId: 'reset', phase: 'ready' });
  f.mode.clear();
  assert.equal(f.mode.statusText, '');
  assert.equal(f.mode.snapshot().enabled, true);
});

test('restored source titles are bounded plain text and opening uses only the stored turn and source index', async () => {
  const f = fixture();
  const host = sourceHost();
  const sources = [
    { title: 'Unsafe source', url: 'javascript:alert(1)' },
    { title: '<img src=x>\n' + 'a'.repeat(300), url: 'https://example.com/article' },
    { title: 'Credentials', url: 'https://name:password@example.com/' },
    { title: 'Another source', url: 'https://example.org/' },
    { title: 'Fifth source', url: 'http://example.net/' },
    { title: 'Outside source limit', url: 'https://example.edu/' },
  ];
  f.mode.renderSources(host, sources, { turnId: 'history-turn' });
  assert.equal(host.hidden, false);
  assert.equal(host.children[0].textContent, 'Sources');
  const list = host.children[1];
  assert.equal(list.children.length, 3);
  const first = list.children[0].children[0];
  assert.match(first.textContent, /^\[2\] <img src=x> /u);
  assert.equal(first.textContent.length, 244);
  await first.listeners.click();
  assert.deepEqual(f.opened, [{ turnId: 'history-turn', index: 1 }]);
  assert(
    !JSON.stringify(f.opened).includes('https:'),
    'The renderer never asks the host to open an arbitrary URL',
  );
  const before = host.replacements;
  f.mode.renderSources(host, sources, { turnId: 'history-turn' });
  assert.equal(
    host.replacements,
    before,
    'Streaming text must not recreate focused source buttons',
  );
  f.mode.ui.text = (value) => (value === 'Sources' ? 'Источники' : value);
  f.mode.renderSources(host, sources, { turnId: 'history-turn' });
  assert.equal(host.children[0].textContent, 'Источники');
});

test('source controls require a saved turn and host failures restore the clicked button', async () => {
  const f = fixture(undefined, async () => {
    throw Error('Stored source unavailable');
  });
  const host = sourceHost();
  const sources = [{ title: 'Source', url: 'https://example.com/' }];
  f.mode.renderSources(host, sources);
  assert.equal(host.hidden, true);
  f.mode.renderSources(host, sources, { turnId: 'saved' });
  const button = host.children[1].children[0].children[0];
  await button.listeners.click();
  assert.equal(button.disabled, false);
  assert.deepEqual(f.errors, ['Stored source unavailable']);
  assert.deepEqual(f.opened, [{ turnId: 'saved', index: 0 }]);
  f.mode.renderSources(host, [], { turnId: 'saved' });
  assert.equal(host.hidden, true);
  assert.deepEqual(host.children, []);
});
