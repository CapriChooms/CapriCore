// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { CallAudioSetup, virtualCallCable } from '../apps/desktop/call-audio-setup.mjs';
import {
  VirtualCableInstaller,
  VB_CABLE,
  cableInstallScript,
} from '../apps/desktop/virtual-cable-installer.mjs';

const pair = [
  { kind: 'audiooutput', deviceId: 'playback', label: 'CABLE Input (VB-Audio Virtual Cable)' },
  { kind: 'audioinput', deviceId: 'recording', label: 'CABLE Output (VB-Audio Virtual Cable)' },
];
const steamPair = pair.map((device) => ({
  ...device,
  deviceId: 'steam-' + device.deviceId,
  label: 'Steam Streaming Microphone',
}));
test('automatic cable selection requires an unambiguous matched playback and recording pair', () => {
  assert.equal(virtualCallCable(pair).deviceId, 'playback');
  assert.equal(virtualCallCable(pair).inputLabel, pair[1].label);
  assert.equal(virtualCallCable(pair.slice(0, 1)), null);
  assert.equal(virtualCallCable([pair[0], { ...pair[1], label: 'CABLE-A Output' }]), null);
  assert.equal(virtualCallCable([...pair, { ...pair[0], deviceId: 'duplicate' }]), null);
  assert.equal(virtualCallCable(pair.map((device) => ({ ...device, deviceId: 'default' }))), null);
  assert.equal(virtualCallCable(pair.map((device) => ({ ...device, label: 'Headphones' }))), null);
  assert.equal(virtualCallCable(steamPair), null);
  assert.equal(virtualCallCable([...steamPair, ...pair]).inputLabel, pair[1].label);
  assert.equal(
    virtualCallCable([...steamPair, ...pair, { ...pair[0], deviceId: 'duplicate' }]),
    null,
  );
  for (const family of ['-A', '-B', '-C', '-D']) {
    const familyPair = pair.map((device) => ({
      ...device,
      label: device.label.replace('CABLE ', 'CABLE' + family + ' '),
    }));
    assert.equal(virtualCallCable(familyPair).deviceId, 'playback');
    assert.equal(virtualCallCable([familyPair[0], pair[1]]), null);
  }
});
function fixture(patch = {}) {
  let connected = false,
    available = true,
    devices = pair;
  const events = [],
    installs = [];
  const setup = new CallAudioSetup({
    devices: async () => devices,
    connect: async (id) => {
      assert.equal(id, 'playback');
      connected = true;
    },
    installer: {
      install: async () => {
        installs.push(true);
        devices = pair;
        return { phase: 'reboot' };
      },
    },
    available: () => available,
    connected: () => connected,
    emit: (value) => events.push(value),
    wait: async () => {},
    ...patch,
  });
  return {
    setup,
    events,
    installs,
    setDevices: (value) => {
      devices = value;
    },
    hide: () => {
      available = false;
    },
    disconnect: () => {
      connected = false;
    },
  };
}
test('one click connects an existing cable without installing or enabling system audio', async () => {
  const f = fixture();
  assert.equal((await f.setup.run()).phase, 'ready');
  assert.equal(f.setup.snapshot().busy, false);
  assert.equal(f.installs.length, 0);
  f.disconnect();
  assert.equal(f.setup.snapshot().phase, 'idle');
});
test('missing cable requires a separate explicit install action', async () => {
  const f = fixture();
  f.setDevices([]);
  assert.equal((await f.setup.run()).phase, 'missing');
  assert.equal(f.installs.length, 0);
  assert.equal((await f.setup.run(true)).phase, 'ready');
  assert.equal(f.installs.length, 1);
});

test('Steam-only devices are missing until a separate explicit VB-CABLE installation is requested', async () => {
  const f = fixture();
  f.setDevices(steamPair);
  const missing = await f.setup.run();
  assert.equal(missing.phase, 'missing');
  assert.equal(missing.ready, false);
  assert.equal(missing.busy, false);
  assert.equal(f.installs.length, 0);
  assert.equal(
    f.events.some((event) => event.phase === 'connecting'),
    false,
  );
  const installed = await f.setup.run(true);
  assert.equal(f.installs.length, 1);
  assert.equal(installed.phase, 'ready');
  assert.equal(installed.cable.inputLabel, pair[1].label);
  assert.equal(installed.cable.outputLabel, pair[0].label);
});
test('installation without endpoints asks for restart, never reboots or retries installation', async () => {
  const f = fixture({ devices: async () => [] });
  const result = await f.setup.run(true);
  assert.equal(result.phase, 'reboot');
  assert.equal(result.busy, false);
  assert.equal(f.installs.length, 1);
});
test('failure, concurrent setup and closing settings cannot leave an unreviewed connection', async () => {
  let unblock;
  const f = fixture({
    devices: () =>
      new Promise((resolve) => {
        unblock = resolve;
      }),
  });
  const task = f.setup.run();
  await assert.rejects(f.setup.run(true), /already running/);
  f.hide();
  unblock(pair);
  const result = await task;
  assert.equal(result.phase, 'error');
  assert.equal(result.ready, false);
  assert.equal(result.busy, false);
  await assert.rejects(f.setup.run(), /Settings/);
});

test('setup failure diagnostics keep the reason without raw errors or cable identity', async () => {
  let failed = true;
  const f = fixture({
    connect: async () => {
      if (failed) throw new Error('Use a call cable separate from your microphone.');
    },
    connected: () => !failed,
  });
  assert.deepEqual(f.setup.diagnostics(), {
    phase: 'idle',
    busy: false,
    cableFound: false,
    lastFailure: null,
  });
  const state = await f.setup.run();
  assert.equal(state.error, 'Use a call cable separate from your microphone.');
  assert.equal(state.cable.deviceId, 'playback');
  const receipt = f.setup.diagnostics();
  assert.deepEqual(receipt, {
    phase: 'error',
    busy: false,
    cableFound: true,
    lastFailure: 'feedback-loop',
  });
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /playback|recording|VB-Audio|Use a call cable|deviceId|label/,
  );
  failed = false;
  await f.setup.run();
  assert.deepEqual(f.setup.diagnostics(), {
    phase: 'ready',
    busy: false,
    cableFound: true,
    lastFailure: null,
  });
  receipt.phase = 'private mutation';
  assert.equal(f.setup.diagnostics().phase, 'ready');
});

test('unknown setup errors remain actionable in UI but never enter diagnostics', async () => {
  const f = fixture({
    connect: async () => {
      throw new Error('private driver identity');
    },
  });
  assert.equal((await f.setup.run()).error, 'private driver identity');
  assert.equal(f.setup.diagnostics().lastFailure, 'unknown');
  assert.doesNotMatch(JSON.stringify(f.setup.diagnostics()), /private|driver identity/);
  f.setDevices([]);
  await f.setup.run();
  assert.deepEqual(f.setup.diagnostics(), {
    phase: 'missing',
    busy: false,
    cableFound: false,
    lastFailure: null,
  });
});
test('driver installation is pinned, uses Windows elevation and isolates privileged staging', async () => {
  const script = cableInstallScript();
  assert.match(script, /-Verb RunAs/);
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /Defaults\]::Restore\(\$saved\)/);
  assert.equal(script.split(VB_CABLE.sha256).length - 1, 2);
  assert.ok(script.includes(VB_CABLE.url));
  assert.ok(Buffer.from(script, 'utf16le').toString('base64').length < 30000);
  assert.doesNotMatch(script, /Restart-Computer|Import-Certificate|SkipCertificateCheck/);
  const events = [];
  const installer = new VirtualCableInstaller({
    platform: 'win32',
    emit: (value) => events.push(value),
    run: async (_, progress) => {
      progress('installing');
      return { code: 0 };
    },
  });
  assert.equal((await installer.install()).phase, 'reboot');
  assert.deepEqual(
    events.map((value) => value.phase),
    ['downloading', 'installing', 'reboot', 'reboot'],
  );
  assert.equal(installer.snapshot().busy, false);
});
test('declined UAC and failed verification produce actionable errors, not success', async () => {
  for (const code of [20, 21, 22, 23, 24]) {
    const installer = new VirtualCableInstaller({ platform: 'win32', run: async () => ({ code }) });
    const result = await installer.install();
    assert.equal(result.phase, 'error');
    assert.equal(result.busy, false);
    assert.ok(result.error);
  }
  const installer = new VirtualCableInstaller({
    platform: 'linux',
    run: () => {
      throw Error('must not run');
    },
  });
  await assert.rejects(installer.install(), /Windows/);
});
