// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { CRTScreen } from '../apps/desktop/renderer/crt-screen.mjs';

test('the CRT keeps the last portrait during a sprite load and hides when it cannot draw', () => {
  const previous = {
    document: globalThis.document,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  Object.assign(globalThis, {
    document: { body: { dataset: {} } },
    innerWidth: 400,
    innerHeight: 300,
  });
  const calls = [];
  const gl = Object.fromEntries(
    [
      'viewport',
      'disable',
      'clearColor',
      'useProgram',
      'activeTexture',
      'bindTexture',
      'uniform1i',
      'uniform2f',
      'uniform1f',
      'enable',
      'scissor',
    ].map((name) => [name, () => {}]),
  );
  Object.assign(gl, {
    NO_ERROR: 0,
    getError: () => 0,
    clear: () => calls.push('clear'),
    texImage2D: (_target, _level, _internal, _format, _type, image) => calls.push(image.src),
    uniform4f: (location, ...rect) => {
      if (location === 'avatar') calls.push(rect);
    },
    drawArrays: () => calls.push('draw'),
  });
  const sprite = { src: 'first', complete: true, naturalWidth: 1254 };
  const canvas = { width: 400, height: 300, addEventListener() {}, getContext: () => null };
  try {
    const screen = new CRTScreen(canvas, sprite);
    Object.assign(screen, { initialized: true, ready: true, gl, uniforms: { avatar: 'avatar' } });
    const first = { x: 45, y: 55, width: 170, height: 170 };
    const second = { x: 65, y: 70, width: 210, height: 210 };
    const frame = { x: 20, y: 32, width: 280, height: 210 };
    const origin = { x: 5, y: 7 };
    const draw = (avatar, visible = true) => {
      calls.length = 0;
      screen.draw({
        now: 0,
        frame,
        avatar,
        origin,
        ratio: 1,
        surfaceHeight: 300,
        glitch: 0,
        reduced: true,
        visible,
      });
      return calls;
    };

    assert.deepEqual(draw(first), ['clear', 'first', [40, 48, 170, 170], 'draw']);
    assert.equal(document.body.dataset.crt, 'webgl');
    Object.assign(sprite, { src: 'second', complete: false, naturalWidth: 0 });
    assert.deepEqual(draw(second), ['clear', [40, 48, 170, 170], 'draw']);
    assert.equal(document.body.dataset.crt, 'webgl');
    assert.deepEqual(draw(second, false), []);
    assert.equal(document.body.dataset.crt, 'fallback');
    Object.assign(sprite, { complete: true, naturalWidth: 1254 });
    assert.deepEqual(draw(second), ['clear', 'second', [60, 63, 210, 210], 'draw']);
    Object.assign(sprite, { src: 'broken', naturalWidth: 0 });
    assert.deepEqual(draw(second), []);
    assert.equal(document.body.dataset.crt, 'fallback');
  } finally {
    Object.assign(globalThis, previous);
  }
});
