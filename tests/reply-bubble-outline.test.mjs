// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { replyBubbleOutline } from '../apps/desktop/renderer/reply-bubble-outline.mjs';

function commands(path) {
  return [...path.matchAll(/([MLQZ])([^MLQZ]*)/g)].map((match) => ({
    type: match[1],
    values: match[2].trim() ? match[2].trim().split(/\s+/).map(Number) : [],
  }));
}

function tailBase(outline) {
  const parts = commands(outline.path),
    index = parts.findIndex(
      ({ type, values }) =>
        type === 'L' && values[0] === outline.tip.x && values[1] === outline.tip.y,
    );
  assert(index > 0);
  return [parts[index - 1].values, parts[index + 1].values];
}

function near(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-9, message ?? `${actual} != ${expected}`);
}

test('each side is a single closed body contour with a flush tail base', () => {
  const width = 240,
    height = 100;
  for (const [side, targetX, targetY] of [
    ['top', 120, -80],
    ['right', 350, 50],
    ['bottom', 120, 200],
    ['left', -100, 50],
  ]) {
    const outline = replyBubbleOutline({ width, height, targetX, targetY }),
      parts = commands(outline.path),
      [first, last] = tailBase(outline);
    assert.equal(outline.side, side);
    assert.equal(parts.filter(({ type }) => type === 'M').length, 1);
    assert.equal(parts.filter(({ type }) => type === 'Z').length, 1);
    assert.equal(parts.at(-1).type, 'Z');
    if (side === 'top' || side === 'bottom') {
      assert.equal(first[1], side === 'top' ? 0 : height);
      assert.equal(last[1], first[1]);
      near(Math.abs(first[0] - last[0]), 18);
      near(outline.tip.x, 120);
      near(outline.tip.y, side === 'top' ? -16 : height + 16);
    } else {
      assert.equal(first[0], side === 'left' ? 0 : width);
      assert.equal(last[0], first[0]);
      near(Math.abs(first[1] - last[1]), 18);
      near(outline.tip.x, side === 'left' ? -16 : width + 16);
      near(outline.tip.y, 50);
    }
  }
});

test('corner targets select the facing edge and keep both base vertices out of its corners', () => {
  for (const [targetX, targetY, side] of [
    [-100, -20, 'left'],
    [-10, -100, 'top'],
    [250, -100, 'top'],
    [400, -20, 'right'],
    [-100, 120, 'left'],
    [-10, 200, 'bottom'],
    [250, 200, 'bottom'],
    [400, 120, 'right'],
  ]) {
    const outline = replyBubbleOutline({ width: 240, height: 100, targetX, targetY }),
      [first, last] = tailBase(outline),
      horizontal = side === 'top' || side === 'bottom',
      axis = horizontal ? 0 : 1,
      edgeLength = horizontal ? 240 : 100,
      center = { x: (first[0] + last[0]) / 2, y: (first[1] + last[1]) / 2 },
      dx = outline.tip.x - center.x,
      dy = outline.tip.y - center.y;
    assert.equal(outline.side, side);
    assert(Math.min(first[axis], last[axis]) >= 9);
    assert(Math.max(first[axis], last[axis]) <= edgeLength - 9);
    near(Math.hypot(dx, dy), 16);
    near(dx * (targetY - center.y) - dy * (targetX - center.x), 0);
    assert(dx * (targetX - center.x) + dy * (targetY - center.y) > 0);
  }
});

test('optional anchors move and clamp only the base while the tip still aims at the face', () => {
  for (const [side, targetX, targetY, anchorX, anchorY, base] of [
    ['top', 120, -80, 60, 1000, { x: 60, y: 0 }],
    ['bottom', 120, 200, 180, -1000, { x: 180, y: 100 }],
    ['left', -100, 50, 1000, 25, { x: 0, y: 25 }],
    ['right', 350, 50, -1000, 75, { x: 240, y: 75 }],
    ['top', 120, -80, -1000, 0, { x: 18, y: 0 }],
    ['bottom', 120, 200, 1000, 0, { x: 222, y: 100 }],
    ['left', -100, 50, 0, -1000, { x: 0, y: 18 }],
    ['right', 350, 50, 0, 1000, { x: 240, y: 82 }],
  ]) {
    const outline = replyBubbleOutline({
        width: 240,
        height: 100,
        targetX,
        targetY,
        anchorX,
        anchorY,
      }),
      [first, last] = tailBase(outline),
      dx = outline.tip.x - base.x,
      dy = outline.tip.y - base.y;
    assert.equal(outline.side, side);
    assert.deepEqual(outline.base, base);
    near((first[0] + last[0]) / 2, base.x);
    near((first[1] + last[1]) / 2, base.y);
    near(Math.hypot(dx, dy), 16);
    near(dx * (targetY - base.y) - dy * (targetX - base.x), 0);
    assert(dx * (targetX - base.x) + dy * (targetY - base.y) > 0);
  }
});

test('nonfinite anchors use the face coordinate and cannot create a tail for an inside face', () => {
  for (const anchorX of [undefined, NaN, Infinity, -Infinity]) {
    const outside = replyBubbleOutline({
      width: 240,
      height: 100,
      targetX: 120,
      targetY: -80,
      anchorX,
    });
    assert.deepEqual(outside.base, { x: 120, y: 0 });
  }
  const inside = replyBubbleOutline({
    width: 240,
    height: 100,
    targetX: 120,
    targetY: 50,
    anchorX: -1000,
    anchorY: -1000,
  });
  assert.equal(inside.side, null);
  assert.equal(inside.base, null);
  assert.equal(inside.tip, null);
});

test('a close target stops the tip at the face and long requested tails stay compact', () => {
  const close = replyBubbleOutline({ width: 240, height: 100, targetX: 120, targetY: -3 });
  assert.deepEqual(close.tip, { x: 120, y: -3 });
  assert.deepEqual(close.bounds, { x: 0, y: -3, width: 240, height: 103 });
  const far = replyBubbleOutline({
    width: 240,
    height: 100,
    targetX: 10000,
    targetY: 50,
    tailLength: 10000,
  });
  assert.deepEqual(far.tip, { x: 256, y: 50 });
});

test('inside, boundary, or unavailable targets leave a plain rounded rectangle', () => {
  for (const [targetX, targetY] of [
    [120, 50],
    [0, 0],
    [240, 100],
    [NaN, 50],
    [120, Infinity],
    [undefined, undefined],
  ]) {
    const outline = replyBubbleOutline({ width: 240, height: 100, targetX, targetY });
    assert.equal(outline.side, null);
    assert.equal(outline.tip, null);
    assert.equal(outline.base, null);
    assert.deepEqual(outline.bounds, { x: 0, y: 0, width: 240, height: 100 });
    assert.equal(commands(outline.path).filter(({ type }) => type === 'L').length, 4);
  }
});

test('a zero tail length keeps dialogue bubbles rectangular even with an outside face', () => {
  const outline = replyBubbleOutline({
    width: 240,
    height: 100,
    targetX: 120,
    targetY: 300,
    tailLength: 0,
  });
  assert.equal(outline.side, null);
  assert.equal(outline.tip, null);
  assert.equal(outline.base, null);
  assert.deepEqual(outline.bounds, { x: 0, y: 0, width: 240, height: 100 });
});

test('fractional body dimensions retain exact edge joins and outward bounds', () => {
  for (const [targetX, targetY, side] of [
    [100.25, -100, 'top'],
    [400, 60.125, 'right'],
    [100.25, 400, 'bottom'],
    [-100, 60.125, 'left'],
  ]) {
    const width = 240.375,
      height = 100.625,
      outline = replyBubbleOutline({ width, height, targetX, targetY }),
      [first, last] = tailBase(outline),
      horizontal = side === 'top' || side === 'bottom',
      edge = side === 'right' ? width : side === 'bottom' ? height : 0;
    assert.equal(outline.side, side);
    assert.equal(first[horizontal ? 1 : 0], edge);
    assert.equal(last[horizontal ? 1 : 0], edge);
    assert(outline.tip.x >= outline.bounds.x);
    assert(outline.tip.y >= outline.bounds.y);
    assert(outline.tip.x <= outline.bounds.x + outline.bounds.width);
    assert(outline.tip.y <= outline.bounds.y + outline.bounds.height);
  }
});

// Approximate each round corner, then check every pair of nonadjacent outline edges.
function polygon(path) {
  const points = [];
  for (const { type, values } of commands(path)) {
    if (type === 'M' || type === 'L') points.push(values);
    if (type === 'Q') {
      const [x, y] = points.at(-1),
        [cx, cy, endX, endY] = values;
      for (let step = 1; step <= 8; step++) {
        const t = step / 8,
          inverse = 1 - t;
        points.push([
          inverse * inverse * x + 2 * inverse * t * cx + t * t * endX,
          inverse * inverse * y + 2 * inverse * t * cy + t * t * endY,
        ]);
      }
    }
  }
  return points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 1e-10,
  );
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

test('small bodies and corner sweeps have finite coordinates and no crossing edges', () => {
  for (const [width, height, radius] of [
    [240, 100, 9],
    [21, 24, 9],
    [2, 3, 0],
    [0.25, 0.5, 9],
    [40, 20, 1000],
  ])
    for (const targetX of [-1000, -1, width / 2, width + 1, 1000])
      for (const targetY of [-1000, -1, height / 2, height + 1, 1000]) {
        const outline = replyBubbleOutline({ width, height, radius, targetX, targetY }),
          points = polygon(outline.path);
        assert(commands(outline.path).every(({ values }) => values.every(Number.isFinite)));
        if (
          points.length > 1 &&
          Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-10
        )
          points.pop();
        for (let i = 0; i < points.length; i++)
          for (let j = i + 2; j < points.length; j++) {
            if (i === 0 && j === points.length - 1) continue;
            const a = points[i],
              b = points[(i + 1) % points.length],
              c = points[j],
              d = points[(j + 1) % points.length];
            assert(
              !(
                cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12
              ),
              `Crossing outline for ${JSON.stringify({ width, height, radius, targetX, targetY })}`,
            );
          }
      }
});

test('invalid sizes and extreme target coordinates never emit NaN or Infinity', () => {
  for (const value of [
    {},
    { width: -10, height: 100 },
    { width: Infinity, height: NaN },
    { width: 240, height: 100, targetX: -Number.MAX_VALUE, targetY: Number.MAX_VALUE },
    { width: 240, height: 100, targetX: Number.MAX_VALUE, targetY: 50, tailWidth: 10000 },
  ]) {
    const outline = replyBubbleOutline(value);
    assert(commands(outline.path).every(({ values }) => values.every(Number.isFinite)));
    assert(Object.values(outline.bounds).every(Number.isFinite));
  }
});
