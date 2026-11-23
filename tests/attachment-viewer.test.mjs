// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AttachmentViewer } from '../apps/desktop/main/attachment-viewer.mjs';

function fixture({ delayed = false } = {}) {
  const id = randomUUID(),
    views = [];
  let retained = true;
  class View extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openHandler = handler;
      };
      this.webContents.executeJavaScript = async (source) => {
        this.script = source;
        return true;
      };
      views.push(this);
    }
    setMenu(value) {
      this.menu = value;
    }
    loadURL(value) {
      this.url = value;
      return delayed
        ? new Promise((resolve) => {
            this.finishLoad = resolve;
          })
        : Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    show() {
      this.shown = true;
    }
    focus() {
      this.focused = true;
    }
  }
  const bounds = { x: -1920, y: 0, width: 1920, height: 1080 };
  const host = new AttachmentViewer({
    BrowserWindow: View,
    screen: {
      getDisplayMatching: () => ({ bounds }),
      getPrimaryDisplay: () => assert.fail('Use the owner display.'),
    },
    history: {
      metadata: (requested) =>
        requested === id ? { id, preview: true, name: 'test" ); unsafe(); //.png' } : null,
      read: (requested) =>
        retained && requested === id ? Buffer.from('owned synthetic image') : null,
    },
    getOwner: () => ({
      isDestroyed: () => false,
      getBounds: () => bounds,
      isAlwaysOnTop: () => true,
    }),
    getTheme: () => ({ preset: 'capri' }),
    getLabels: () => ({
      preview: 'Preview',
      close: 'Close',
      fit: 'Fit to screen',
      actual: 'Actual size',
      unavailable: 'Image preview unavailable',
    }),
  });
  return {
    host,
    id,
    views,
    bounds,
    evict: () => {
      retained = false;
    },
  };
}

test('the fullscreen viewer is a read-only sandbox on the owner display without preload or filename URLs', async () => {
  const f = fixture();
  assert.equal(await f.host.open('../secret'), false);
  assert.equal(f.views.length, 0);
  assert.equal(await f.host.open(f.id), true);
  const view = f.views[0];
  assert.deepEqual(
    Object.fromEntries(Object.keys(f.bounds).map((key) => [key, view.options[key]])),
    f.bounds,
  );
  assert.equal(view.options.fullscreen, true);
  assert.equal(view.options.webPreferences.preload, undefined);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.equal(view.options.webPreferences.contextIsolation, true);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal(view.options.webPreferences.webSecurity, true);
  assert.equal(view.options.title, 'Capri · Preview');
  assert.equal(view.url, 'capri://desktop/attachment-viewer.html');
  assert.equal(view.menu, null);
  assert.deepEqual(view.openHandler(), { action: 'deny' });
  const payload = JSON.parse(
    view.script.slice('globalThis.capriAttachmentViewer.show('.length, -1),
  );
  assert.equal(payload.id, f.id);
  assert.equal(payload.name, 'test" ); unsafe(); //.png');
  assert.ok(view.shown && view.focused);
  for (const type of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    view.webContents.emit(type, {
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true, type);
  }
  let prevented = false;
  view.webContents.emit(
    'before-input-event',
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    { key: 'Escape' },
  );
  assert.ok(prevented && view.destroyed);
  assert.equal(f.host.window, null);
});

test('clearing, shutdown or replacement during loading cannot show a late viewer', async () => {
  const f = fixture({ delayed: true });
  const first = f.host.open(f.id);
  const view = f.views[0];
  f.host.close();
  view.finishLoad();
  assert.equal(await first, false);
  assert.ok(view.destroyed && !view.shown);
  const second = f.host.open(f.id);
  const replacement = f.views[1];
  f.evict();
  f.host.closeIfUnavailable();
  replacement.finishLoad();
  assert.equal(await second, false);
  assert.ok(replacement.destroyed && !replacement.shown);
  assert.equal(await f.host.open(f.id), false);
  assert.equal(f.views.length, 2);
});
