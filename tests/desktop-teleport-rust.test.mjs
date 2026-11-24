// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DesktopTeleportMenu,
  TELEPORT_HELPER,
  prepareDesktopTeleport,
} from '../apps/desktop/main/desktop-teleport-menu.mjs';

const root = path.resolve('.');
const helper = path.join(root, '.runtime/desktop-teleport', TELEPORT_HELPER);
const built = existsSync(helper);
const windows = {
  skip:
    process.platform !== 'win32'
      ? 'Windows only'
      : built
        ? false
        : 'the Rust helper is not built: run npm run build:desktop-teleport first',
  timeout: 20000,
};

const scratch = () => mkdtempSync(path.join(tmpdir(), 'capri-teleport-'));

test('a helper placed in the runtime folder is the one the menu uses', async () => {
  const fake = scratch();
  try {
    const folder = path.join(fake, '.runtime/desktop-teleport');
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, TELEPORT_HELPER), 'not run in this test');
    assert.equal(await prepareDesktopTeleport(fake), path.join(folder, TELEPORT_HELPER));
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('without the Rust build there is no fallback to the hooked C# helper', async () => {
  const empty = scratch();
  try {
    await assert.rejects(prepareDesktopTeleport(empty), /not installed/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('the built helper is the one the menu uses', windows, async () => {
  assert.equal(await prepareDesktopTeleport(root), helper);
});

test('the built helper installs no input hook', windows, () => {
  const text = readFileSync(helper).toString('latin1');
  assert.ok(!text.includes('SetWindowsHookEx'));
  assert.ok(text.includes('GetAsyncKeyState'));
});

const waitFor = async (check, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out');
};

test(
  'Capri registers the menu entry only once the Rust helper is ready, and stops it on hide',
  windows,
  async () => {
    const registry = [];
    const menu = new DesktopTeleportMenu(root, () => {}, {
      run: (args) => {
        registry.push(args);
        return { status: 0, stdout: '' };
      },
    });
    await menu.show('Teleport Capri here');
    await waitFor(() => menu.session?.ready);
    const command = registry.find((args) => args[1].endsWith('\command'));
    assert.ok(command, 'command key written');
    assert.match(command.at(-2), new RegExp('capri-teleport\\.exe" --teleport [0-9a-f]{32}$'));
    assert.equal(menu.session.registeredLabel, 'Teleport Capri here');

    const child = menu.session.process;
    menu.hide();
    await waitFor(() => child.exitCode !== null, 3000);
    assert.equal(child.exitCode, 0, 'helper exits when Capri closes its input');
  },
);

test(
  "a followed window that does not exist is reported closed through Capri's parser",
  windows,
  async () => {
    const menu = new DesktopTeleportMenu(root, () => {}, {
      run: () => ({ status: 0, stdout: '' }),
    });
    await menu.show('Teleport Capri here');
    await waitFor(() => menu.session?.ready);
    const states = [];
    menu.watchWindow(
      { windowId: '999999', processId: '4', startedAtTicks: '638000000000000000' },
      (value) => states.push(value),
    );
    await waitFor(() => states.length);
    assert.deepEqual(states, [{ state: 'closed' }]);
    const child = menu.session.process;
    menu.hide();
    await waitFor(() => child.exitCode !== null, 3000);
  },
);
