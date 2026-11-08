// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerControl } from '../apps/desktop/computer-control.mjs';
import { computerVision } from '../apps/desktop/computer-vision.mjs';

function fixture() {
  const state = { allowed: true, turn: 'owner-1', visible: false, registered: false, calls: [] };
  state.bridge = async (command) => {
    state.calls.push(command);
    if (command.action === 'computer_state')
      return {
        ok: true,
        windowId: '123',
        processId: '456',
        startedAtTicks: '789',
        untrustedTitle: 'Owned fixture',
        untrustedControls: [{ id: 'field', untrustedName: 'Draft', x: 12, y: 34, editable: true }],
      };
    return { ok: true, confirmation: 'Fixture action completed.' };
  };
  const control = new ComputerControl({
    allowed: () => state.allowed,
    canStart: () => true,
    currentTurn: () => state.turn,
    bridge: (...args) => state.bridge(...args),
    capture: async () => ({
      png: Buffer.from('private transient fixture image'),
      width: 100,
      height: 100,
      bounds: { x: 1000, y: 200, width: 200, height: 100 },
    }),
    describe: async () => ({
      summary: 'Fixture screen.',
      targets: [{ label: 'Button', x: 70, y: 50 }],
    }),
    registerEscape: (stop) => {
      state.escape = stop;
      state.registered = true;
      return true;
    },
    unregisterEscape: () => {
      state.registered = false;
    },
    showBorder: async () => {
      state.visible = true;
    },
    hideBorder: () => {
      state.visible = false;
    },
  });
  return { state, control };
}

test('workflow ownership survives startup supervision without a chat, while revocation and lost Escape still stop it', async () => {
  for (const reason of ['permission', 'turn', 'escape']) {
    const { control, state } = fixture();
    let workflowTurn = 'reviewed-workflow';
    control.currentTurn = () => workflowTurn;
    control.canStart = () => Boolean(workflowTurn);
    let started, finish;
    const showing = new Promise((resolve) => {
      started = resolve;
    });
    control.showBorder = () =>
      new Promise((resolve) => {
        finish = () => {
          state.visible = true;
          resolve();
        };
        started();
      });
    const beginning = control.begin('Saved workflow without a chat turn');
    await showing;
    for (let tick = 0; tick < 4; tick++)
      assert.equal(control.supervise({ indicatorVisible: true, escapeAvailable: false }), true);
    finish();
    await beginning;
    assert.equal(control.supervise({ indicatorVisible: true, escapeAvailable: true }), true);
    await control.execute({ action: 'observe', vision: false });
    if (reason === 'permission') state.allowed = false;
    if (reason === 'turn') workflowTurn = null;
    assert.equal(
      control.supervise({ indicatorVisible: true, escapeAvailable: reason !== 'escape' }),
      false,
    );
    await control.stopping;
    assert.equal(state.visible, false);
    assert.equal(control.session, null);
  }
});

test('owner cancellation during indicator startup is immediate and is not reported as a visibility timeout', async () => {
  const { control, state } = fixture(),
    owner = new AbortController();
  let started;
  const showing = new Promise((resolve) => {
    started = resolve;
  });
  control.showBorder = () => {
    started();
    return new Promise(() => {});
  };
  const beginning = control.begin('Cancel a workflow during startup', { signal: owner.signal });
  await showing;
  owner.abort();
  await assert.rejects(beginning, /cancelled/);
  assert.equal(state.visible, false);
  assert.equal(control.session, null);
  state.visible = true;
  assert.equal(control.supervise({ indicatorVisible: true }), false);
  await control.stopping;
  assert.equal(state.visible, false);
});

test('task cleanup permits another session in the same turn, but Escape still blocks it', async () => {
  const { control, state } = fixture();
  await control.begin('First task');
  await control.stop({ blockTurn: false });
  assert.equal(state.visible, false);
  await control.begin('Second task');
  state.escape();
  await assert.rejects(control.begin('Retry after Escape'), /stopped for this turn/);
  state.turn = 'owner-2';
  await control.begin('New request');
  await control.stop();
});

test('stop clears an orphan indicator even without a session or when unregistering Escape fails', async () => {
  const { control, state } = fixture();
  state.visible = true;
  control.unregisterEscape = () => {
    throw new Error('Synthetic unregister failure');
  };
  assert.equal((await control.stop()).active, false);
  assert.equal(state.visible, false);
  state.visible = true;
  assert.equal((await control.stop()).active, false);
  assert.equal(state.visible, false);
});

test('Escape releases held input immediately and stop stays bounded if the native helper ignores abort', async () => {
  const f = fixture();
  f.control.cleanupTimeoutMs = 15;
  await f.control.begin('Hold a key in the owned fixture');
  const view = await f.control.execute({ action: 'observe', vision: false });
  let entered, finishNative, finishHide;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const base = f.state.bridge;
  f.state.bridge = (command, options) => {
    if (command.action !== 'computer_keys') return base(command, options);
    f.state.calls.push(command);
    entered();
    return new Promise((resolve) => {
      finishNative = resolve;
    });
  };
  const pending = f.control.execute({
    action: 'press_keys',
    observationId: view.observationId,
    keys: ['W'],
    holdMs: 2000,
  });
  await started;
  let hides = 0;
  f.control.hideBorder = () => {
    f.state.visible = false;
    if (++hides === 1)
      return new Promise((resolve) => {
        finishHide = resolve;
      });
  };
  const stopping = f.control.stop();
  assert.equal(f.state.visible, false);
  assert.equal(f.state.registered, true, 'Escape stays armed until the hide attempt completes');
  assert.ok(
    f.state.calls.some(
      (command) => command.action === 'computer_release' && command.keys.includes('W'),
    ),
  );
  finishHide();
  const result = await Promise.race([
    stopping,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Stop hung on a native promise')), 300),
    ),
  ]);
  assert.equal(result.active, false);
  assert.equal(f.state.registered, false);
  assert.ok(f.state.calls.filter((command) => command.action === 'computer_release').length >= 2);
  finishNative({ ok: true });
  await assert.rejects(pending, /stopped/);
});

test('callback failures cannot bypass held-input cleanup and native text entry has its own release record', async () => {
  const f = fixture();
  await f.control.begin('Enter text in the owned field');
  const view = await f.control.execute({ action: 'observe', vision: false });
  const base = f.state.bridge;
  f.state.bridge = (command, options) => {
    if (command.action !== 'computer_type') return base(command, options);
    throw new Error('Synthetic native type failure');
  };
  await assert.rejects(
    f.control.execute({
      action: 'enter_text',
      targetId: view.targets[0].targetId,
      text: 'fixture',
    }),
    /Synthetic native type failure/,
  );
  assert.ok(
    f.state.calls.some(
      (command) =>
        command.action === 'computer_release' &&
        command.button === 'left' &&
        command.keys.includes('CTRL'),
    ),
  );
  const releases = f.state.calls.filter((command) => command.action === 'computer_release');
  for (const key of ['CTRL', 'SHIFT', 'L', 'HOME', 'END'])
    assert.ok(releases.some((command) => command.keys.includes(key)));
  assert.ok(releases.every((command) => command.keys.length <= 4));
  f.control.hideBorder = () => {
    f.state.visible = false;
    throw new Error('Synthetic hide failure');
  };
  f.control.unregisterEscape = () => {
    f.state.registered = false;
    throw new Error('Synthetic unregister failure');
  };
  await f.control.stop();
  assert.equal(f.state.visible, false);
  assert.equal(f.state.registered, false);
});

test('failed Escape registration cannot leave a session or an old indicator alive', async () => {
  for (const register of [
    () => false,
    () => {
      throw new Error('Synthetic registration failure');
    },
    async () => false,
  ]) {
    const f = fixture();
    f.state.visible = true;
    f.control.registerEscape = register;
    await assert.rejects(
      f.control.begin('Do not start without emergency stop'),
      /Escape emergency stop is unavailable/,
    );
    assert.equal(f.control.snapshot().active, false);
    assert.equal(f.state.visible, false);
  }
});

test('arming registration and a loading indicator cannot expose observation or concurrent ready sessions', async () => {
  for (const phase of ['registration', 'indicator']) {
    const f = fixture();
    let release, entered;
    const waiting = new Promise((resolve) => {
      entered = resolve;
    });
    if (phase === 'registration')
      f.control.registerEscape = () =>
        new Promise((resolve) => {
          release = () => resolve(true);
          entered();
        });
    else
      f.control.showBorder = () =>
        new Promise((resolve) => {
          release = () => {
            f.state.visible = true;
            resolve();
          };
          entered();
        });
    const beginning = f.control.begin('Arm safely before observing');
    await waiting;
    assert.equal(f.control.snapshot().active, false);
    await assert.rejects(f.control.execute({ action: 'observe' }), /not ready/);
    await assert.rejects(f.control.begin('Concurrent request'), /current operation/);
    assert.equal(f.state.calls.length, 0);
    release();
    assert.equal((await beginning).active, true);
    await f.control.stop();
  }
});

test('an old failed registration cannot stop a newer session', async () => {
  const f = fixture();
  let finishOld;
  f.control.registerEscape = () =>
    new Promise((resolve) => {
      finishOld = resolve;
    });
  const old = f.control.begin('Old pending task');
  await f.control.stop({ blockTurn: false });
  f.state.turn = 'owner-2';
  f.control.registerEscape = () => true;
  await f.control.begin('New owner task');
  finishOld(false);
  await assert.rejects(old, /Escape emergency stop/);
  assert.equal(f.control.snapshot().active, true);
  assert.equal(f.state.visible, true);
  await f.control.stop();
});

test('an ended or aborted owner turn cannot reuse a session or keep native input authorized', async () => {
  for (const change of ['ended', 'aborted']) {
    const f = fixture();
    let cancelled = false;
    f.control.canStart = () => !cancelled;
    await f.control.begin('Owned fixture task');
    const view = await f.control.execute({ action: 'observe', vision: false });
    let allowedDuringInput;
    const base = f.state.bridge;
    f.state.bridge = (command, options) => {
      if (command.action === 'computer_keys') allowedDuringInput = options.stillAllowed;
      return base(command, options);
    };
    await f.control.execute({
      action: 'press_keys',
      observationId: view.observationId,
      keys: ['TAB'],
    });
    assert.equal(allowedDuringInput(), true);
    if (change === 'ended') f.state.turn = 'owner-2';
    else cancelled = true;
    assert.equal(allowedDuringInput(), false);
    await assert.rejects(f.control.execute({ action: 'observe', vision: false }), /stopped/);
    await f.control.stop();
    assert.equal(f.control.snapshot().active, false);
    assert.equal(f.state.visible, false);
  }
});

test('stop during indicator startup prevents queued or late indicator activation', async () => {
  const f = fixture();
  let shown = 0;
  f.control.showBorder = async () => {
    shown++;
    f.state.visible = true;
  };
  const beginning = f.control.begin('Cancel before the indicator opens');
  await f.control.stop({ blockTurn: false });
  await assert.rejects(beginning, /indicator|cancelled/);
  assert.equal(shown, 0);
  assert.equal(f.state.visible, false);

  const late = fixture();
  late.control.cleanupTimeoutMs = 15;
  let entered, finish;
  const starting = new Promise((resolve) => {
    entered = resolve;
  });
  late.control.showBorder = () =>
    new Promise((resolve) => {
      entered();
      finish = () => {
        late.state.visible = true;
        resolve();
      };
    });
  const pending = late.control.begin('Cancel a loading indicator');
  await starting;
  await late.control.stop();
  finish();
  await assert.rejects(pending, /indicator|cancelled/);
  assert.equal(late.state.visible, false);
});

test('drag uses two fresh app targets, rejects taskbar destinations and releases the mouse when cancelled', async () => {
  const f = fixture(),
    base = f.state.bridge;
  f.state.bridge = async (...args) => {
    const value = await base(...args);
    if (value.untrustedControls)
      value.untrustedControls.push({
        id: 'destination',
        untrustedName: 'Timeline',
        x: 80,
        y: 90,
        editable: false,
      });
    return value;
  };
  f.control.pointerDuration = () => 640;
  await f.control.begin('Drag the test clip');
  const view = await f.control.execute({ action: 'observe', vision: false });
  await assert.rejects(
    f.control.execute({ action: 'drag', targetId: view.targets[0].targetId, toTargetId: 'old' }),
    /two current/,
  );
  let entered;
  const started = new Promise((resolve) => (entered = resolve)),
    normal = f.state.bridge;
  f.state.bridge = (command, options = {}) => {
    if (command.action !== 'computer_drag') return normal(command, options);
    f.state.calls.push(command);
    entered();
    return new Promise((resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }),
    );
  };
  const pending = f.control.execute({
    action: 'drag',
    targetId: view.targets[0].targetId,
    toTargetId: view.targets[1].targetId,
  });
  await started;
  assert.equal(f.state.calls.at(-1).toControlId, 'destination');
  assert.equal(f.state.calls.at(-1).durationMs, 640);
  f.state.escape();
  await assert.rejects(pending, /stopped/);
  assert(f.state.calls.some((c) => c.action === 'computer_release' && c.button === 'left'));
});

test('observed taskbar targets retain their shell identity and origin window, without allowing keyboard input to the shell', async () => {
  const f = fixture(),
    original = f.state.bridge;
  f.state.bridge = async (args) => {
    const result = await original(args);
    if (args.action === 'computer_state') {
      result.desktopSurfaces = [
        {
          kind: 'taskbar',
          windowId: '900',
          processId: '901',
          startedAtTicks: '902',
          x: 0,
          y: 1000,
          width: 1920,
          height: 80,
        },
      ];
      result.untrustedControls.push({
        id: 'discord',
        untrustedName: 'Discord',
        x: 500,
        y: 1040,
        editable: false,
        surface: 'taskbar',
        surfaceWindowId: '900',
        surfaceProcessId: '901',
        surfaceStartedAtTicks: '902',
      });
    }
    return result;
  };
  f.control.bridge = (...args) => f.state.bridge(...args);
  await f.control.begin('Open Discord from the taskbar.');
  const view = await f.control.execute({ action: 'observe', vision: false });
  const discord = view.targets.find((t) => t.untrustedLabel === 'Discord');
  assert.equal(discord.surface, 'taskbar');
  assert.equal(view.desktop.taskbarAvailable, true);
  await f.control.execute({ action: 'click', targetId: discord.targetId });
  const clicked = f.state.calls.find((c) => c.action === 'computer_click');
  assert.equal(clicked.windowId, '900');
  assert.equal(clicked.originWindowId, '123');
  assert.equal(clicked.originProcessId, '456');
  assert.equal(clicked.surface, 'taskbar');
  const fresh = await f.control.execute({ action: 'observe', vision: false });
  await f.control.execute({
    action: 'press_keys',
    observationId: fresh.observationId,
    keys: ['TAB'],
  });
  const keys = f.state.calls.find((c) => c.action === 'computer_keys');
  assert.equal(keys.windowId, '123');
  assert.equal(keys.surface, undefined);
  await f.control.stop();
});

test('computer sessions require full access, visible emergency stop and a fresh observation before input', async () => {
  const f = fixture();
  f.state.allowed = false;
  await assert.rejects(f.control.begin('Test the owned fixture'), /Full computer access/);
  f.state.allowed = true;
  await f.control.begin('Test the owned fixture');
  assert.equal(f.state.visible, true);
  assert.equal(f.state.registered, true);
  await assert.rejects(f.control.execute({ action: 'press_keys', keys: ['A'] }), /Observe/);
  const view = await f.control.execute({ action: 'observe' });
  assert.equal(view.screenAvailable, true);
  assert.equal(JSON.stringify(view).includes('private transient'), false);
  const button = view.targets.find((entry) => entry.untrustedLabel === 'Button');
  await f.control.execute({ action: 'click', targetId: button.targetId });
  assert.deepEqual(
    f.state.calls.find((c) => c.action === 'computer_click'),
    {
      action: 'computer_click',
      windowId: '123',
      processId: '456',
      startedAtTicks: '789',
      x: 1140,
      y: 250,
      button: 'left',
      clickCount: 1,
      durationMs: 220,
    },
  );
  await assert.rejects(
    f.control.execute({ action: 'click', targetId: button.targetId }),
    /Observe/,
  );
  await f.control.stop();
  assert.equal(f.state.visible, false);
  assert.equal(f.state.registered, false);
});

test('mouse hovering passes the observed native element so its current position can be resolved again', async () => {
  const f = fixture();
  await f.control.begin('Hover the draft field');
  const view = await f.control.execute({ action: 'observe', vision: false });
  await f.control.execute({ action: 'move_pointer', targetId: view.targets[0].targetId });
  assert.equal(f.state.calls.at(-1).action, 'computer_pointer');
  assert.equal(f.state.calls.at(-1).controlId, 'field');
  assert.equal(
    f.state.calls.some((call) => call.action === 'computer_click'),
    false,
  );
  await f.control.stop();
});

test('Escape aborts held input, releases injected keys and cannot be undone by the same model turn', async () => {
  const f = fixture();
  await f.control.begin('Hold W in the owned fixture');
  const view = await f.control.execute({ action: 'observe' });
  let started;
  const beginning = new Promise((resolve) => {
    started = resolve;
  });
  const base = f.state.bridge;
  f.state.bridge = (command, { signal } = {}) => {
    if (command.action !== 'computer_keys') return base(command);
    f.state.calls.push(command);
    started();
    return new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  const pending = f.control.execute({
    action: 'press_keys',
    observationId: view.observationId,
    keys: ['W'],
    holdMs: 2000,
  });
  await beginning;
  f.state.escape();
  await assert.rejects(pending, /stopped/);
  assert.ok(f.state.calls.some((c) => c.action === 'computer_release' && c.keys[0] === 'W'));
  assert.equal(f.state.visible, false);
  await assert.rejects(f.control.begin('Resume without a new owner message'), /new owner request/);
  f.state.turn = 'owner-2';
  await f.control.begin('A new explicit owner request');
  await f.control.stop();
});

test('stale targets, unsupported keys and revoked permission cannot inject input', async () => {
  const f = fixture();
  await f.control.begin('Test fixture');
  const old = await f.control.execute({ action: 'observe' });
  const fresh = await f.control.execute({ action: 'observe' });
  await assert.rejects(
    f.control.execute({ action: 'click', targetId: old.targets[0].targetId }),
    /actual targetId/,
  );
  for (const keys of [['ESCAPE'], ['A', 'A'], ['COMMAND'], ['CTRL', 'SHIFT', 'ALT', 'WIN', 'A']])
    await assert.rejects(
      f.control.execute({ action: 'press_keys', observationId: fresh.observationId, keys }),
      /supported keys/,
    );
  f.state.allowed = false;
  await assert.rejects(
    f.control.execute({ action: 'scroll', observationId: fresh.observationId, amount: 1 }),
    /stopped/,
  );
  assert.equal(
    f.state.calls.filter((c) => /computer_(?:keys|click|scroll)/.test(c.action)).length,
    0,
  );
  assert.equal(f.state.visible, false);
});

test('computer vision is tool-free and rejects generated actions or out-of-frame click targets', async () => {
  let packet = {
    done: true,
    message: {
      content: JSON.stringify({
        summary: 'Owned fixture.',
        targets: [{ label: 'OK', x: 5, y: 5 }],
      }),
    },
  };
  const infer = computerVision({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.deepEqual(body.tools, []);
      assert.equal(body.messages.at(-1).images.length, 1);
      return new Response(JSON.stringify(packet));
    },
  });
  const args = { png: Buffer.from('fixture pixels'), width: 10, height: 10, goal: 'Test fixture' };
  assert.equal((await infer(args)).targets.length, 1);
  packet.message.tool_calls = [{ function: { name: 'click' } }];
  await assert.rejects(infer(args), /Incomplete/);
  delete packet.message.tool_calls;
  packet.message.content = JSON.stringify({
    summary: 'Fixture.',
    targets: [{ label: 'outside', x: 10, y: 1 }],
  });
  await assert.rejects(infer(args), /Invalid screen targets/);
});

test('key input carries the observed native focus identity so a changed field cannot receive Enter', async () => {
  const f = fixture();
  const base = f.state.bridge;
  f.state.bridge = async (...args) => {
    const result = await base(...args);
    if (result.untrustedControls)
      Object.assign(result.untrustedControls[0], { focused: true, browserAddress: true });
    return result;
  };
  await f.control.begin('Submit a search in the owned fixture');
  try {
    const view = await f.control.execute({ action: 'observe', vision: false });
    assert.equal(view.targets[0].focused, true);
    assert.equal(view.targets[0].browserAddress, true);
    await f.control.execute({
      action: 'press_keys',
      keys: ['ENTER'],
      observationId: view.observationId,
    });
    assert.equal(f.state.calls.find((c) => c.action === 'computer_keys').focusedControlId, 'field');
  } finally {
    await f.control.stop();
  }
});
