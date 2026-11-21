// SPDX-License-Identifier: GPL-3.0-only
import { applyChessArrowAppearance, renderChessArrow } from './chess-arrow.mjs';
import { clearChessMoveLightning, showChessMoveLightning } from './chess-move-lightning.mjs';
import { ChessFrameEffect } from './chess-frame-effect.mjs';
const instructions = document.querySelector('#instructions');
const selection = document.querySelector('#selection');
const board = document.querySelector('#board');
const arrow = document.querySelector('#arrow');
const lightning = document.querySelector('#lightning');
const boardFrame = new ChessFrameEffect(document.querySelector('#board-frame'), {
  inset: 0,
  strokeInset: 0,
});

globalThis.capriChessOverlay = {
  select(prompt) {
    document.body.classList.add('selecting');
    instructions.textContent = prompt;
    instructions.hidden = false;
    let start;
    let moving;
    let rect;
    return new Promise((resolve) => {
      const finish = (value) => {
        document.onkeydown =
          document.ondblclick =
          document.onpointerdown =
          document.onpointermove =
          document.onpointerup =
          document.onpointercancel =
            null;
        resolve(value);
      };
      document.onkeydown = (event) => {
        if (event.key === 'Escape') finish(null);
        if (event.key === 'Enter' && rect?.width >= 64) finish(rect);
      };
      document.ondblclick = (event) => {
        if (event.button === 0 && rect?.width >= 64) finish(rect);
      };
      document.onpointerdown = (event) => {
        if (event.button !== 0) return;
        const { clientX: x, clientY: y } = event;
        moving = null;
        if (
          rect &&
          x >= rect.x - 8 &&
          x <= rect.x + rect.width + 8 &&
          y >= rect.y - 8 &&
          y <= rect.y + rect.height + 8
        ) {
          const left = Math.abs(x - rect.x) <= 8,
            right = Math.abs(x - rect.x - rect.width) <= 8;
          const top = Math.abs(y - rect.y) <= 8,
            bottom = Math.abs(y - rect.y - rect.height) <= 8;
          if ((left || right) && (top || bottom))
            start = {
              x: left ? rect.x + rect.width : rect.x,
              y: top ? rect.y + rect.height : rect.y,
            };
          else {
            start = { x, y };
            moving = { ...rect };
          }
        } else {
          start = { x, y };
          rect = null;
          selection.hidden = true;
        }
        try {
          document.body.setPointerCapture(event.pointerId);
        } catch {
          /* The drag can still finish while the pointer is inside the selection window. */
        }
      };
      document.onpointermove = (event) => {
        if (!start) return;
        const x = Math.max(0, Math.min(event.clientX, innerWidth));
        const y = Math.max(0, Math.min(event.clientY, innerHeight));
        if (moving) {
          rect = {
            ...moving,
            x: Math.max(0, Math.min(innerWidth - moving.width, moving.x + x - start.x)),
            y: Math.max(0, Math.min(innerHeight - moving.height, moving.y + y - start.y)),
          };
        } else {
          const size = Math.min(Math.abs(x - start.x), Math.abs(y - start.y));
          rect = {
            x: x < start.x ? start.x - size : start.x,
            y: y < start.y ? start.y - size : start.y,
            width: size,
            height: size,
          };
        }
        Object.assign(selection.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        selection.hidden = false;
      };
      document.onpointerup = document.onpointercancel = () => {
        start = moving = null;
        if (!rect || rect.width < 64) {
          rect = null;
          selection.hidden = true;
        }
      };
    });
  },
  appearance(value) {
    applyChessArrowAppearance(arrow, value);
  },
  layout(inset) {
    board.style.inset = inset;
  },
  frame(visible, appearance) {
    if (visible) boardFrame.setAppearance(appearance);
    boardFrame.setVisible(visible);
  },
  frameAppearance(appearance) {
    boardFrame.setAppearance(appearance);
  },
  move(move) {
    renderChessArrow(arrow, move ?? undefined);
  },
  flash(move) {
    return showChessMoveLightning(lightning, move);
  },
  clearFlash() {
    clearChessMoveLightning(lightning);
  },
};
