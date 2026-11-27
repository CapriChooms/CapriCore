// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_CPU_DEFAULTS,
  profileCpuThreads,
} from '../packages/runtime/src/hardware/cpu-execution.mjs';
import {
  PROFILES,
  recommendProfile,
  selectProfile,
} from '../packages/runtime/src/hardware/profiles.mjs';

const minimal = PROFILES.find((profile) => profile.id === 'minimal');
const quality = PROFILES.find((profile) => profile.id === 'quality');

test('minimal profile threads scale with half the logical cores up to eight', () => {
  for (const [cores, expected] of [
    [1, 1],
    [2, 1],
    [4, 2],
    [8, 4],
    [16, 8],
    [32, 8],
  ])
    assert.equal(profileCpuThreads(minimal, cores), expected, `${cores} logical threads`);
});

test('minimal profile threads fall back to one when the core count is unknown or zero', () => {
  assert.equal(profileCpuThreads(minimal, undefined), 1);
  assert.equal(profileCpuThreads(minimal, 0), 1);
});

test('non-minimal profiles keep their presets as ceilings, so their results do not change', () => {
  assert.equal(profileCpuThreads(quality, 32), PROFILE_CPU_DEFAULTS.quality);
  assert.equal(profileCpuThreads(quality, 4), 2);
  const balanced = PROFILES.find((profile) => profile.id === 'balanced');
  assert.equal(profileCpuThreads(balanced, 32), PROFILE_CPU_DEFAULTS.balanced);
  assert.equal(profileCpuThreads(balanced, 2), 1);
});

test('a 16-thread host gets an 8-thread minimal profile instead of the fixed 2-thread preset', () => {
  const hardware = { ramBytes: 8 * 2 ** 30, cpuThreads: 16, gpus: [] };
  assert.equal(recommendProfile(hardware).profile.id, 'minimal');
  assert.equal(recommendProfile(hardware).profile.cpuThreads, 8);
  assert.equal(selectProfile('minimal', hardware).cpuThreads, 8);
});

test('a 2-thread host still gets one thread for the minimal profile', () => {
  const hardware = { ramBytes: 8 * 2 ** 30, cpuThreads: 2, gpus: [] };
  assert.equal(selectProfile('minimal', hardware).cpuThreads, 1);
});
