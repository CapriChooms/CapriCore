// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCompanionSettings } from '../apps/desktop/companion-settings.mjs';
import {
  drawSandevistan,
  prepareSandevistan,
  sandevistanPosition,
  sandevistanStamps,
  sandevistanViewport,
} from '../apps/desktop/renderer/sandevistan-motion.mjs';

const motion = (effects) =>
  prepareSandevistan({
    from: { x: 0, y: 10, scale: 40 },
    to: { x: 640, y: 190, scale: 60 },
    anchor: { x: 0, y: 0 },
    effects,
  });

test('Sandevistan defaults to 650 ms with acceleration and deceleration', () => {
  const flight = motion();
  const duration = flight.travelMs;
  assert.equal(duration, 650);
  assert.deepEqual(sandevistanPosition(flight, 0), flight.start);
  assert.deepEqual(sandevistanPosition(flight, duration), flight.end);
  const passes = Array.from({ length: 5 }, (_, step) => {
    const { x } = sandevistanPosition(flight, (duration * step) / 4);
    return x;
  });
  assert.deepEqual(passes, [0, 100, 320, 540, 640]);
  assert.deepEqual(sandevistanViewport(flight, { width: 660, height: 240 }), {
    x: 0,
    y: 10,
    width: 660,
    height: 230,
  });
});

test('Sandevistan scales the flight and keeps the configured lifetime of each trail copy', () => {
  const flight = motion({ teleportTravelMs: 1200, sandevistanCopies: 3, sandevistanHoldMs: 500 });
  assert.deepEqual(
    flight.ghosts.map(({ bornMs }) => bornMs),
    [0, 400, 800],
  );
  assert.equal(sandevistanPosition(flight, 600).x, 320);
  assert.deepEqual(sandevistanPosition(flight, 1200), flight.end);
  assert.equal(flight.endMs, 1300);
});

test('snapshots retain their original positions and hues for their configured lifetime', () => {
  const flight = motion({
    sandevistanHoldMs: 2000,
    sandevistanCopies: 3,
    sandevistanHue: 5,
    sandevistanHueStep: -20,
  });
  assert.deepEqual(
    flight.ghosts.map(({ hue }) => hue),
    [5, 345, 325],
  );
  const rendered = [];
  const context = {
    globalAlpha: 1,
    save() {},
    restore() {
      this.globalAlpha = 1;
    },
    drawImage(image, x, y, size) {
      rendered.push({ image, x, y, size, opacity: this.globalAlpha });
    },
  };
  const stamps = [0, 1, 2];
  const at = (time) => {
    rendered.length = 0;
    drawSandevistan(context, flight, time, stamps);
    return [...rendered];
  };
  assert.equal(at(0).length, 1);
  assert.deepEqual(at(300)[1], at(1000)[1]);
  assert.deepEqual(
    at(2000).map(({ image }) => image),
    [1, 2],
  );
  assert.ok(at(flight.endMs - 80)[0].opacity < 0.8);
  assert.equal(at(flight.endMs).length, 0);
});

test('teleport settings preserve lightning defaults and validate Sandevistan bounds', () => {
  const defaults = validateCompanionSettings({});
  assert.equal(defaults.teleportStyle, 'lightning');
  assert.equal(defaults.teleportTravelMs, 650);
  assert.equal(defaults.sandevistanHoldMs, 500);
  assert.equal(defaults.sandevistanCopies, 12);
  assert.equal(defaults.sandevistanHueStep, 6);
  assert.equal(defaults.sandevistanTint, 50);
  assert.equal(
    validateCompanionSettings({ teleportStyle: 'afterimage' }).teleportStyle,
    'sandevistan',
  );
  assert.equal(
    validateCompanionSettings({ teleportStyle: 'sandevistan', sandevistanHoldMs: 100 })
      .sandevistanHoldMs,
    100,
  );
  assert.throws(() => validateCompanionSettings({ sandevistanHoldMs: 99 }));
  assert.throws(() => validateCompanionSettings({ sandevistanHoldMs: 2001 }));
  assert.throws(() => validateCompanionSettings({ sandevistanCopies: 25 }));
  assert.throws(() => validateCompanionSettings({ sandevistanHue: 360 }));
  assert.throws(() => validateCompanionSettings({ sandevistanTint: 101 }));
  assert.throws(() => validateCompanionSettings({ teleportStyle: 'glitch' }));
  for (const teleportTravelMs of [250, 1500])
    assert.equal(
      validateCompanionSettings({ teleportTravelMs }).teleportTravelMs,
      teleportTravelMs,
    );
  for (const teleportTravelMs of [200, 625, 1550, '650'])
    assert.throws(() => validateCompanionSettings({ teleportTravelMs }));
});

test('zero tint keeps the original sprite colors for every copy', () => {
  const sprite = {};
  const flight = motion({ sandevistanTint: 0, sandevistanCopies: 3 });
  assert.deepEqual(sandevistanStamps(sprite, flight), [sprite, sprite, sprite]);
});
