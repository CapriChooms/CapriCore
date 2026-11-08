// SPDX-License-Identifier: GPL-3.0-only
// Actual Electron surface, synthetic cursor/state and an isolated verification profile.
// No user applications, desktop screenshots, files, providers or audio devices are accessed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/avatar-composer-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const scaleOption = process.argv.slice(2);
if (scaleOption.some((arg) => !/^--scale-factor=(?:1|1\.25|1\.5|2)$/.test(arg)))
  throw new Error('Supported option: --scale-factor=1,1.25,1.5,2');
if (scaleOption.length > 1) throw new Error('Choose only one verification scale.');
const temporary = path.join(root, '.runtime/git-preparation/tmp');
mkdirSync(temporary, { recursive: true });
const report = {
  passed: false,
  requestedScaleFactor: scaleOption.length ? Number(scaleOption[0].split('=')[1]) : null,
  ownerDataAccessed: false,
  ownerApplicationsTouched: false,
  screenshotsCaptured: false,
  cursorMoved: false,
  checks: [],
};
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let application;
const check = (name, details = {}) => report.checks.push({ name, ...details });
const assertNativeBounds = (actual, expected) => {
  for (const key of ['x', 'y', 'width', 'height'])
    assert(
      Math.abs(actual[key] - expected[key]) <= 1,
      `Native ${key} differs by more than one DIP after physical-pixel rounding.`,
    );
};
try {
  const env = {
    ...process.env,
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
    TEMP: temporary,
    TMP: temporary,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [
      path.join(root, 'apps/desktop/main.mjs'),
      '--verification',
      ...scaleOption.map((arg) => '--force-device-' + arg.slice(2)),
    ],
    env,
    timeout: 60000,
  });
  const owner = await application.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const setup = await application.evaluate(
    async ({ BrowserWindow, ipcMain, screen }, sourceRoot) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(sourceRoot + '/package.json');
      const { AvatarComposer, avatarComposerBounds } = require(
        sourceRoot + '/apps/desktop/main/avatar-composer.mjs',
      );
      const { sanitizeAvatarComposerState, validateAvatarComposerAction } = require(
        sourceRoot + '/apps/desktop/main/avatar-composer-bridge.mjs',
      );
      for (const view of BrowserWindow.getAllWindows()) view.hide();
      const workArea = screen.getPrimaryDisplay().workArea;
      const body = {
        x: workArea.x + Math.round(workArea.width / 2) - 75,
        y: workArea.y + Math.round(workArea.height / 2) - 160,
        width: 150,
        height: 200,
      };
      const fixture = {
        workArea,
        body,
        pointer: { x: workArea.x - 1000, y: workArea.y - 1000 },
        calls: [],
        errors: [],
        actions: [],
        actionPayloads: [],
        initialFocusedId: BrowserWindow.getFocusedWindow()?.id ?? null,
        snapshot() {
          const view = this.composer.window;
          return {
            loaded: this.composer.loaded === true,
            lifecycle: this.composer.visibleWanted === true,
            presentation: this.composer.presentationVisible === true,
            interactive: this.composer.mouseInteractive === true,
            focused: view?.isFocused() === true,
            nativeVisible: view?.isVisible() === true,
            nativeBounds: view?.getBounds() ?? null,
            targetBounds: this.composer.targetBounds,
            focusedWindowId: BrowserWindow.getFocusedWindow()?.id ?? null,
            calls: this.calls.slice(),
            errors: this.errors.slice(),
          };
        },
      };
      function FixtureWindow(options) {
        const view = new BrowserWindow(options);
        for (const method of [
          'setIgnoreMouseEvents',
          'showInactive',
          'setBounds',
          'setPosition',
          'moveTop',
          'setOpacity',
          'focus',
        ]) {
          const original = view[method].bind(view);
          view[method] = (...args) => {
            fixture.calls.push({ method, args, at: Date.now() });
            return original(...args);
          };
        }
        return view;
      }
      fixture.composer = new AvatarComposer({
        BrowserWindow: FixtureWindow,
        screen: {
          getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
          getCursorScreenPoint: () => fixture.pointer,
        },
        onError: (error) => fixture.errors.push(String(error?.message ?? error)),
      });
      fixture.composer.setMode('text');
      fixture.state = sanitizeAvatarComposerState({
        canSend: true,
        canAttach: true,
        microphone: { disabled: false },
        labels: { placeholder: 'Synthetic verification message' },
      });
      fixture.setState = (patch = {}) => {
        fixture.state = sanitizeAvatarComposerState({
          canSend: true,
          canAttach: true,
          microphone: { disabled: false },
          labels: { placeholder: 'Synthetic verification message' },
          ...patch,
        });
        fixture.composer.sendState(fixture.state);
        return fixture.snapshot();
      };
      fixture.sync = (patch = {}) => {
        fixture.composer.sync({
          visible: true,
          phase: 'detached',
          body: fixture.body,
          workArea: fixture.workArea,
          pointer: fixture.pointer,
          ...patch,
        });
        return fixture.snapshot();
      };
      const handlers = {
        'capri:avatar-composer-bootstrap': () => ({
          ...fixture.state,
          mode: fixture.composer.mode,
          composerVisible: fixture.composer.presentationVisible,
        }),
        'capri:avatar-composer-resize': (_event, height) =>
          fixture.pauseResize ? false : fixture.composer.setHeight(height),
        'capri:avatar-composer-hide': () => fixture.composer.hide(),
        'capri:avatar-composer-action': async (_event, value) => {
          const action = validateAvatarComposerAction(value);
          fixture.actions.push(action.type);
          fixture.actionPayloads.push(action);
          if (action.type === 'keyboard')
            fixture.composer.setMode(fixture.composer.mode === 'text' ? 'compact' : 'text');
          if (action.type === 'menu')
            fixture.composer.setMode(fixture.composer.mode === 'expanded' ? 'compact' : 'expanded');
          if (action.type === 'paste-files') {
            if (fixture.holdPaste)
              await new Promise((resolve) => {
                fixture.releasePaste = resolve;
              });
            fixture.setState({
              ...fixture.state,
              attachments: action.files
                .filter((file) => file.bytes.byteLength)
                .map((file, index) => ({ id: `clipboard-${index}`, name: file.name })),
            });
          }
          if (action.type === 'edit')
            fixture.setState({ draft: action.draft, draftRevision: action.revision });
          if (action.type === 'thinking')
            fixture.setState({
              thinking: {
                enabled: action.enabled,
                label: `Thinking mode: ${action.enabled ? 'On' : 'Off'}`,
                hint: 'Take more time to check difficult answers.',
              },
            });
          return { ...fixture.state, composerVisible: fixture.composer.presentationVisible };
        },
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (event, ...args) => {
          if (!fixture.composer.owns(event)) throw new Error('Unexpected verification sender.');
          return handler(event, ...args);
        });
      }
      fixture.expectedBounds = (sourceBody = fixture.body) =>
        avatarComposerBounds({
          body: sourceBody,
          workArea: fixture.workArea,
          height: fixture.composer.height,
        });
      globalThis.avatarComposerVerifier = fixture;
      fixture.setState();
      const hidden = fixture.sync();
      const bounds = fixture.expectedBounds();
      fixture.pointer = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      fixture.sync();
      await fixture.composer.ready;
      return {
        hidden,
        shown: fixture.snapshot(),
        scaleFactor: screen.getPrimaryDisplay().scaleFactor,
      };
    },
    root,
  );
  assert.equal(setup.hidden.lifecycle, true);
  report.scaleFactor = setup.scaleFactor;
  if (report.requestedScaleFactor !== null)
    assert.equal(setup.scaleFactor, report.requestedScaleFactor);
  assert.equal(setup.hidden.presentation, false);
  assert.equal(setup.hidden.nativeVisible, false);
  assert.equal(setup.shown.loaded, true);
  assert.equal(setup.shown.presentation, true);
  assert.equal(setup.shown.nativeVisible, true);
  assert.equal(setup.shown.interactive, true);
  assert.equal(
    setup.shown.calls.some((item) => item.method === 'focus'),
    false,
  );
  assert.equal(setup.shown.focused, false);
  check(
    'Far pointer leaves the surface closed; proximity shows the real surface without autofocus.',
  );

  const page = application
    .windows()
    .find((window) => window.url().includes('avatar-composer.html'));
  assert(page, 'The actual composer renderer must exist.');
  await page.waitForFunction(
    () => document.querySelector('#mini-composer')?.dataset.visible === 'true',
  );
  await page.waitForTimeout(210);
  const initial = await page.evaluate(() => ({
    opacity: Number(getComputedStyle(document.querySelector('#mini-composer')).opacity),
    active: document.activeElement?.id,
  }));
  assert.equal(initial.opacity, 1);
  assert.notEqual(initial.active, 'message');

  assert.equal(await page.locator('#thinking-toggle').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => document.getElementById('thinking-toggle').click());
  await page.waitForFunction(
    () => document.getElementById('thinking-toggle').getAttribute('aria-pressed') === 'true',
  );
  assert.equal(
    await application.evaluate(() => globalThis.avatarComposerVerifier.state.thinking.enabled),
    true,
  );
  const miniLayout = await page.evaluate(() => {
    const ids = ['message', 'attachment-open', 'thinking-toggle', 'input-microphone', 'send'];
    return ids.map((id) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return { id, left: rect.left, right: rect.right, width: rect.width };
    });
  });
  assert.ok(miniLayout.find((item) => item.id === 'message').width >= 100);
  const miniOrdered = [...miniLayout].sort((a, b) => a.left - b.left);
  for (let index = 1; index < miniOrdered.length; index++)
    assert.ok(miniOrdered[index].left >= miniOrdered[index - 1].right);
  check(
    'The mini thinking button toggles host intent without overlapping text, file, mic or send controls.',
  );

  const fading = await application.evaluate(() => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.pointer = { x: fixture.workArea.x - 1000, y: fixture.workArea.y - 1000 };
    return fixture.sync();
  });
  assert.equal(fading.presentation, false);
  assert.equal(fading.interactive, false);
  assert.equal(fading.nativeVisible, true, 'Native hiding must wait for the CSS transition.');
  const lastIgnore = fading.calls.filter((item) => item.method === 'setIgnoreMouseEvents').at(-1);
  assert.deepEqual(lastIgnore.args, [true, { forward: true }]);
  await page.waitForTimeout(60);
  const fadingOpacity = await page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('#mini-composer')).opacity),
  );
  assert(
    fadingOpacity >= 0 && fadingOpacity < 1,
    'CSS must fade while native input is passed through.',
  );
  await page.waitForTimeout(160);
  const hidden = await application.evaluate(() => globalThis.avatarComposerVerifier.snapshot());
  assert.equal(hidden.nativeVisible, false);
  check(
    'Far pointer immediately passes input through, animates CSS opacity and then hides natively.',
    {
      sampledOpacity: fadingOpacity,
    },
  );

  const pinned = [];
  for (const [name, patch] of [
    ['draft', { draft: 'Synthetic verification draft' }],
    ['attachment', { attachments: [{ id: 'fixture', name: 'synthetic.txt' }] }],
    ['microphone listening', { microphone: { disabled: false, listening: true } }],
    ['microphone loading', { microphone: { disabled: false, loading: true } }],
  ]) {
    const result = await application.evaluate((_electron, patch) => {
      const fixture = globalThis.avatarComposerVerifier;
      fixture.setState(patch);
      return fixture.sync();
    }, patch);
    assert.equal(result.presentation, true, name);
    assert.equal(result.nativeVisible, true, name);
    assert.equal(result.interactive, true, name);
    pinned.push(name);
  }
  const kept = await application.evaluate(() => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.setState();
    return fixture.sync({ keepVisible: true });
  });
  assert.equal(kept.presentation, true);
  const alias = await application.evaluate(() =>
    globalThis.avatarComposerVerifier.sync({ interactiveBusy: true }),
  );
  assert.equal(alias.presentation, true);
  check('Draft, attachment, microphone and open-action pins keep the far-pointer surface usable.', {
    pins: [...pinned, 'keepVisible', 'interactiveBusy'],
  });

  const focus = await application.evaluate(async () => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.sync({ keepVisible: true });
    fixture.composer.window.focus();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const nativeFocused = fixture.composer.window.isFocused();
    // Windows may deny foreground activation while the user is in another app.
    // Do not retry or fight focus: exercise the same native event handler explicitly.
    if (!nativeFocused) fixture.composer.window.emit('focus');
    const pinned = fixture.sync();
    const view = fixture.composer.window;
    const deadline = Date.now() + 300;
    const blurDeadline = Date.now() + 100;
    view.blur();
    while (view.isFocused() && Date.now() < blurDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    let focusLossMethod = 'blur';
    if (view.isFocused()) {
      // A sole focusable window can retain native focus after blur() on Windows.
      // Hiding this owned fixture once releases it without focusing another app.
      focusLossMethod = 'hide-once';
      view.hide();
    }
    while (view.isFocused() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const nativeFocusLost = !view.isFocused();
    if (nativeFocusLost) view.emit('blur');
    const unpinned = fixture.sync();
    return { nativeFocused, nativeFocusLost, focusLossMethod, pinned, unpinned };
  });
  assert.equal(focus.pinned.presentation, true);
  assert.equal(focus.nativeFocusLost, true, 'The owned fixture must actually lose native focus.');
  assert.equal(focus.unpinned.presentation, false);
  check('Focus pins editing and blur releases the pin without repeated foreground requests.', {
    nativeFocusGranted: focus.nativeFocused,
    focusEventFallback: !focus.nativeFocused,
    nativeFocusLost: focus.nativeFocusLost,
    focusLossMethod: focus.focusLossMethod,
  });

  // Dispatch only event-local synthetic files; never read or alter the OS clipboard.
  const paste = (files = [], text = '') =>
    page.evaluate(
      ({ files, text }) => {
        const input = document.getElementById('message');
        input.focus({ preventScroll: true });
        const data = new DataTransfer();
        for (const file of files)
          data.items.add(
            new File([new Uint8Array(file.bytes ?? file.size)], file.name, {
              type: file.type ?? 'text/plain',
            }),
          );
        if (text) data.setData('text/plain', text);
        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        });
        input.dispatchEvent(event);
        return { prevented: event.defaultPrevented, focused: document.activeElement === input };
      },
      { files, text },
    );
  const pastedActions = (count = 0) =>
    application.evaluate(async (_electron, count) => {
      const fixture = globalThis.avatarComposerVerifier;
      const deadline = Date.now() + 3000;
      while (
        fixture.actionPayloads.filter((action) => action.type === 'paste-files').length < count &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      return fixture.actionPayloads
        .filter((action) => action.type === 'paste-files')
        .map((action) => ({
          keys: Object.keys(action),
          type: action.type,
          overflow: action.overflow,
          files: action.files.map((file) => ({
            keys: Object.keys(file),
            name: file.name,
            bytes: Array.from(file.bytes),
          })),
        }));
    }, count);
  const resetPasteState = async (patch = {}) => {
    await application.evaluate((_electron, patch) => {
      const fixture = globalThis.avatarComposerVerifier;
      fixture.setState(patch);
      fixture.sync({ keepVisible: true });
    }, patch);
    await page.waitForFunction(
      (disabled) => document.getElementById('attachment-open').disabled === disabled,
      Boolean(patch.busy || patch.canAttach === false),
    );
  };
  await resetPasteState();
  const png = Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const txt = Array.from(Buffer.from('Synthetic clipboard note.\n'));
  const mixedPaste = await paste([
    { name: 'C:\\synthetic\\clipboard-picture.png', type: 'image/png', bytes: png },
    { name: 'clipboard-note.txt', bytes: txt },
  ]);
  assert.deepEqual(mixedPaste, { prevented: true, focused: true });
  const mixedActions = await pastedActions(1);
  assert.equal(mixedActions.length, 1, 'FileList and file items must produce one intent.');
  assert.deepEqual(mixedActions[0], {
    keys: ['type', 'files', 'overflow'],
    type: 'paste-files',
    overflow: false,
    files: [
      { keys: ['name', 'bytes'], name: 'clipboard-picture.png', bytes: png },
      { keys: ['name', 'bytes'], name: 'clipboard-note.txt', bytes: txt },
    ],
  });
  await page.waitForFunction(() =>
    document.getElementById('attachment-list').textContent.includes('clipboard-note.txt'),
  );
  assert.equal(await page.locator('#attachment-list').locator('button').count(), 2);
  assert.equal((await page.locator('#attachment-list').textContent()).includes('C:'), false);
  check(
    'Focused file paste sends one validated PNG/TXT byte intent and renders filename-only chips.',
  );

  const actionsBeforeText = await application.evaluate(
    () => globalThis.avatarComposerVerifier.actions.length,
  );
  assert.deepEqual(await paste([], 'Ordinary synthetic text'), {
    prevented: false,
    focused: true,
  });
  await page.waitForTimeout(30);
  assert.equal(
    await application.evaluate(() => globalThis.avatarComposerVerifier.actions.length),
    actionsBeforeText,
  );
  for (const patch of [{ busy: true }, { canAttach: false }]) {
    await resetPasteState(patch);
    assert.equal((await paste([{ name: 'blocked.txt', bytes: txt }])).prevented, true);
    await page.waitForTimeout(30);
    assert.equal((await pastedActions()).length, 1);
  }
  check(
    'Plain text keeps normal paste behavior; busy and disabled attachment states block file intents.',
  );

  await resetPasteState();
  await application.evaluate(() => {
    globalThis.avatarComposerVerifier.holdPaste = true;
  });
  assert.equal((await paste([{ name: 'pending.txt', bytes: txt }])).prevented, true);
  assert.equal((await pastedActions(2)).length, 2);
  assert.equal((await paste([{ name: 'duplicate.txt', bytes: txt }])).prevented, true);
  assert.equal(await page.locator('#attachment-open').isDisabled(), true);
  assert.equal(await page.locator('#send').isDisabled(), true);
  await page.evaluate(() => {
    document
      .getElementById('message')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
  });
  await page.waitForTimeout(30);
  assert.equal((await pastedActions()).length, 2);
  assert.equal(
    await application.evaluate(() => globalThis.avatarComposerVerifier.actions.includes('submit')),
    false,
  );
  await application.evaluate(() => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.holdPaste = false;
    fixture.releasePaste();
    delete fixture.releasePaste;
  });
  await page.waitForFunction(() => !document.getElementById('attachment-open').disabled);
  check('An in-flight paste blocks duplicate paste and submit, then restores attachment controls.');

  await resetPasteState();
  assert.equal(
    (await paste(Array.from({ length: 5 }, (_, index) => ({ name: `${index}.txt`, bytes: txt }))))
      .prevented,
    true,
  );
  const overflow = (await pastedActions(3)).at(-1);
  assert.equal(overflow.overflow, true);
  assert.deepEqual(
    overflow.files.map((file) => file.name),
    ['0.txt', '1.txt', '2.txt', '3.txt'],
  );
  await page.waitForFunction(() => !document.getElementById('attachment-open').disabled);
  await resetPasteState();
  assert.equal(
    (
      await paste([
        { name: 'oversized.txt', size: 8 * 1024 * 1024 + 1 },
        { name: 'unsupported.exe', bytes: [1, 2, 3] },
      ])
    ).prevented,
    true,
  );
  const rejected = (await pastedActions(4)).at(-1);
  assert.equal(rejected.overflow, false);
  assert.deepEqual(rejected.files, [
    { keys: ['name', 'bytes'], name: 'oversized.txt', bytes: [] },
    { keys: ['name', 'bytes'], name: 'unsupported.exe', bytes: [] },
  ]);
  await page.waitForFunction(() => !document.getElementById('attachment-open').disabled);
  check(
    'File paste caps transport at four and preserves size/type rejection through empty placeholders.',
  );
  await page.evaluate(() => document.getElementById('message').blur());
  await resetPasteState();

  for (const patch of [
    { visible: false },
    { phase: 'framed' },
    { focusMode: true },
    { sessionLocked: true },
  ]) {
    const lifecycle = await application.evaluate((_electron, patch) => {
      const fixture = globalThis.avatarComposerVerifier;
      fixture.setState({ draft: 'Pinned synthetic draft' });
      fixture.sync({ keepVisible: true });
      const snapshot = fixture.sync({ keepVisible: true, ...patch });
      return snapshot;
    }, patch);
    assert.equal(lifecycle.presentation, false);
    assert.equal(lifecycle.nativeVisible, false);
    assert.equal(lifecycle.interactive, false);
  }
  check('Lifecycle, framed mode, focus mode and screen lock immediately override every pin.');

  const recovery = await application.evaluate(async () => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.setState();
    fixture.sync({ keepVisible: true });
    const view = fixture.composer.window;
    const oversizedWidth = Math.max(800, fixture.workArea.width);
    fixture.pauseResize = true;
    view.setBounds({ ...view.getBounds(), width: oversizedWidth });
    await view.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const nativeBefore = view.getBounds();
    const painted = await view.webContents.executeJavaScript(
      '(({width,height})=>({width,height}))(document.getElementById("mini-composer").getBoundingClientRect())',
    );
    fixture.pauseResize = false;
    // The fixture deliberately discarded renderer resize requests while the
    // native width was forced. Restore the latest content height as well.
    fixture.composer.setHeight(Math.ceil(painted.height));
    fixture.sync({ keepVisible: true });
    return {
      nativeBefore,
      paintedWidth: painted.width,
      nativeAfter: view.getBounds(),
      target: fixture.composer.targetBounds,
    };
  });
  assert(recovery.nativeBefore.width > 344, 'Exercise an actually enlarged native window.');
  assert(recovery.paintedWidth <= 344, 'A native resize must not stretch the painted input.');
  report.nativeRecovery = recovery;
  assertNativeBounds(recovery.nativeAfter, recovery.target);
  check('An enlarged native surface keeps a compact input and recovers its requested bounds.');

  const tracking = await application.evaluate(async () => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.setState();
    fixture.sync({ keepVisible: true });
    await fixture.composer.window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    fixture.sync({ keepVisible: true });
    const firstCall = fixture.calls.length;
    const samples = [];
    const started = performance.now();
    await new Promise((resolve) => {
      let frame = 0;
      const timer = setInterval(() => {
        frame += 1;
        const body = { ...fixture.body, x: fixture.body.x + frame * 2, y: fixture.body.y + frame };
        fixture.sync({ keepVisible: true, body });
        samples.push({
          at: performance.now() - started,
          actual: fixture.composer.bounds,
          expected: fixture.expectedBounds(body),
        });
        if (frame >= 20) {
          clearInterval(timer);
          resolve();
        }
      }, 16);
    });
    const calls = fixture.calls.slice(firstCall);
    return { samples, calls, errors: fixture.errors };
  });
  assert.equal(tracking.samples.length, 20);
  report.trackingSizes = tracking.samples.map(({ actual, expected }) => ({
    actual: { width: actual.width, height: actual.height },
    expected: { width: expected.width, height: expected.height },
  }));
  for (const sample of tracking.samples) assertNativeBounds(sample.actual, sample.expected);
  assert.equal(new Set(tracking.samples.map((item) => JSON.stringify(item.actual))).size, 20);
  const boundsCalls = tracking.calls.filter((item) => item.method === 'setBounds');
  const positionCalls = tracking.calls.filter((item) => item.method === 'setPosition');
  assert.equal(boundsCalls.length, 20);
  assert.equal(positionCalls.length, 0, 'Following must not round-trip native DIP sizes.');
  assert.equal(
    tracking.calls.some((item) => item.method === 'setOpacity'),
    false,
  );
  assert.equal(
    tracking.calls.some((item) => item.method === 'focus'),
    false,
  );
  assert(
    tracking.calls.filter((item) => item.method === 'moveTop').length <= 1,
    'Only the 750 ms recovery timer may raise, never each tracking frame.',
  );
  assert.equal(
    tracking.calls.some((item) => item.method === 'setIgnoreMouseEvents'),
    false,
  );
  assert.deepEqual(tracking.errors, []);
  check(
    'Twenty 16 ms movements update native bounds exactly without repeated input/layer/opacity changes.',
    {
      frames: tracking.samples.length,
      durationMs: Math.round(tracking.samples.at(-1).at),
      nativeBoundsUpdates: positionCalls.length + boundsCalls.length,
      positionOnlyUpdates: positionCalls.length,
      moveTopCalls: tracking.calls.filter((item) => item.method === 'moveTop').length,
    },
  );

  const cancelled = await application.evaluate(async () => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.sync();
    fixture.composer.hide();
    await new Promise((resolve) => setTimeout(resolve, 220));
    return fixture.snapshot();
  });
  assert.equal(cancelled.lifecycle, false);
  assert.equal(cancelled.presentation, false);
  assert.equal(cancelled.nativeVisible, false);
  assert.deepEqual(cancelled.errors, []);
  check('Explicit hide cancels pending fade work and cannot reopen the surface.');
  await application.evaluate(() => {
    const fixture = globalThis.avatarComposerVerifier;
    fixture.composer.setMode('compact');
    fixture.setState({ draft: 'Draft survives compact mode' });
    fixture.sync({ keepVisible: true });
  });
  await page.waitForFunction(
    () => document.getElementById('mini-composer').dataset.mode === 'compact',
  );
  assert.equal(await page.locator('#message').isVisible(), false);
  assert.equal(await page.locator('#mini-actions button:visible').count(), 3);
  assert.deepEqual(
    await page
      .locator('#mini-actions button')
      .evaluateAll((buttons) => buttons.map((button) => button.id)),
    ['input-microphone', 'mini-keyboard', 'mini-menu'],
  );
  const compactLayout = await page.evaluate(() => {
    const panel = document.getElementById('mini-composer');
    const actions = document.getElementById('mini-actions');
    const bounds = panel.getBoundingClientRect();
    return {
      height: bounds.height,
      viewportHeight: innerHeight,
      outerBorder: getComputedStyle(panel).borderTopWidth,
      innerBorder: getComputedStyle(actions).borderTopWidth,
      clippedButtons: [...actions.querySelectorAll('button')].some((button) => {
        const box = button.getBoundingClientRect();
        return box.top < bounds.top || box.bottom > bounds.bottom || box.bottom > innerHeight;
      }),
    };
  });
  assert.equal(compactLayout.height, 44);
  assert(parseFloat(compactLayout.outerBorder) > 0);
  assert.equal(compactLayout.innerBorder, '0px');
  assert.equal(compactLayout.clippedButtons, false);
  check(
    'The compact panel has one complete frame and all three buttons fit its 44 DIP surface.',
    compactLayout,
  );
  await page.screenshot({ path: path.join(folder, 'compact-three-icons.png') });
  await page.locator('#mini-keyboard').click();
  await page.waitForFunction(
    () => document.getElementById('mini-composer').dataset.mode === 'text',
  );
  assert.equal(await page.locator('#message').inputValue(), 'Draft survives compact mode');
  await page.screenshot({ path: path.join(folder, 'compact-text-open.png') });
  await page.locator('#mini-menu').click();
  await page.waitForFunction(
    () => document.getElementById('mini-composer').dataset.mode === 'expanded',
  );
  assert.equal(await page.locator('#message').isVisible(), false);
  await page.locator('#mini-keyboard').click();
  await page.waitForFunction(
    () => document.getElementById('mini-composer').dataset.mode === 'text',
  );
  assert.equal(await page.locator('#message').inputValue(), 'Draft survives compact mode');
  check(
    'Compact mode has exactly microphone, keyboard and menu, retains the draft and expands without recreating its renderer.',
  );
  await application.evaluate(() => globalThis.avatarComposerVerifier.setState({ draft: '' }));
  await page.waitForFunction(() => !document.getElementById('message').value);
  await page.screenshot({ path: path.join(folder, 'compact-text-empty.png') });
  report.passed = true;
} catch (error) {
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (application) {
    await application
      .evaluate(() => globalThis.avatarComposerVerifier?.composer.destroy())
      .catch(() => {});
    await application.close().catch(() => {});
  }
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, folder }));
if (!report.passed) console.error(report.error);
