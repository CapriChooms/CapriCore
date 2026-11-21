// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCompanionSettings } from '../apps/desktop/companion-settings.mjs';
import { AvatarDetach } from '../apps/desktop/main/avatar-detach.mjs';
import { dragLightningGeometry } from '../apps/desktop/renderer/avatar-drag-tether.mjs';

const command = {
  from: { x: 25, y: 70 },
  to: { x: 630, y: 260 },
  intensity: 70,
  chaos: 80,
  seed: 123,
};

test('intensity changes the density of red trail effects while the main bolt stays locked to both endpoints', () => {
  const quiet = dragLightningGeometry({ ...command, intensity: 10 }, 5512, false);
  const dense = dragLightningGeometry(command, 5512, false);
  assert.equal(quiet.bolt, dense.bolt);
  assert.match(dense.bolt, /^M25\.0,70\.0L/);
  assert.match(dense.bolt, /L630\.0,260\.0$/);
  assert.ok(quiet.sparkCount < dense.sparkCount && quiet.branchCount < dense.branchCount);
  assert.notEqual(dense.sparks, dragLightningGeometry(command, 5573, false).sparks);
  assert.notEqual(dense.bolt, dragLightningGeometry({ ...command, chaos: 5 }, 5512, false).bolt);
  assert.equal(dragLightningGeometry({ ...command, intensity: 0 }, 5512, false), null);
});

test('adjacent monitors share the same seeded geometry and reduced motion stays still', () => {
  const shift = ({ x, y }) => ({ x: x - 800, y: y + 300 });
  const original = dragLightningGeometry(command, 5512, false);
  const translated = dragLightningGeometry(
    { ...command, from: shift(command.from), to: shift(command.to) },
    5512,
    false,
  );
  for (const key of ['bolt', 'branches', 'sparks', 'embers', 'faintEmbers']) {
    const shifted = original[key].replace(
      /([-\d.]+),([-\d.]+)/g,
      (_point, x, y) => `${(Number(x) - 800).toFixed(1)},${(Number(y) + 300).toFixed(1)}`,
    );
    assert.equal(translated[key], shifted);
  }
  const reduced = dragLightningGeometry(command, 5512, true);
  assert.deepEqual(reduced, dragLightningGeometry(command, 5900, true));
  assert.ok(reduced.sparkCount < original.sparkCount);
});

test('Chess shards fly to both sides of the tether with independent amount and travel controls', () => {
  const horizontal = { ...command, from: { x: 10, y: 100 }, to: { x: 610, y: 100 }, chaos: 0 };
  const sample = (amount, travel) =>
    dragLightningGeometry(
      { ...horizontal, effects: { teleportSparkAmount: amount, teleportSparkTravel: travel } },
      5512,
      false,
    );
  const noSparks = sample(0, 100);
  const fixedSparks = sample(100, 0);
  const spreadSparks = sample(100, 100);
  assert.equal(noSparks.bolt, spreadSparks.bolt);
  assert.equal(noSparks.sparkCount, 0);
  assert.equal(noSparks.embers + noSparks.faintEmbers + noSparks.sparks, '');
  assert.equal(fixedSparks.sparkCount, spreadSparks.sparkCount);
  assert.ok(spreadSparks.sparkCount <= 72);
  assert.match(spreadSparks.sparks, /Z/);
  const coordinates = ({ embers, faintEmbers }) =>
    [...(embers + faintEmbers).matchAll(/([-\d.]+),([-\d.]+)/g)].map((match) => Number(match[2]));
  assert.ok(Math.min(...coordinates(spreadSparks)) < Math.min(...coordinates(fixedSparks)) - 10);
  assert.ok(Math.max(...coordinates(spreadSparks)) > Math.max(...coordinates(fixedSparks)) + 10);
});

test('the attached tether forwards the saved lightning style to the desktop overlay', () => {
  const settings = validateCompanionSettings({
    avatarDragTether: true,
    avatarDragTetherIntensity: 92,
    avatarDragTetherChaos: 37,
    teleportColor: '#80fcff',
    teleportThickness: 175,
    teleportGlow: 12,
    teleportSparkAmount: 23,
    teleportSparkTravel: 100,
  });
  let command;
  AvatarDetach.prototype.trackAttachedTether.call(
    {
      phase: 'attached',
      getEffects: () => settings,
      drawDesktopTether: (value) => (command = value),
    },
    { point: { x: 20, y: 30 }, at: 200 },
    { x: 370, y: 152 },
    { x: 0, y: 0, width: 300, height: 500 },
    500,
  );
  assert.equal(command.intensity, 92);
  assert.equal(command.chaos, 37);
  for (const key of ['Color', 'Thickness', 'Glow', 'SparkAmount', 'SparkTravel']) {
    assert.equal(command.effects[`teleport${key}`], settings[`teleport${key}`]);
  }
});

test('stored older settings acquire a 30-pixel dead zone and both new controls are validated', () => {
  const previous = validateCompanionSettings({ avatarDragTetherIntensity: 72 });
  assert.equal(previous.avatarDragTetherIntensity, 72);
  assert.equal(previous.avatarDragTetherDeadZone, 30);
  assert.equal(previous.avatarDragTetherChaos, 55);
  assert.equal(previous.avatarTapGapSeconds, 10);
  assert.equal(validateCompanionSettings({ avatarTapGapSeconds: 5 }).avatarTapGapSeconds, 5);
  assert.equal(
    validateCompanionSettings({ avatarDragTetherDeadZone: 0 }).avatarDragTetherDeadZone,
    0,
  );
  assert.throws(() => validateCompanionSettings({ avatarDragTetherDeadZone: 121 }));
  assert.throws(() => validateCompanionSettings({ avatarDragTetherChaos: -1 }));
});
