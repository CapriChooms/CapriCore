// SPDX-License-Identifier: GPL-3.0-only
import {
  CHESS_FRAME_FIELDS,
  DEFAULT_CHESS_FRAME,
  chessFrameAppearance,
} from './chess-frame-style.mjs';
import { ChessFrameEffect } from './chess-frame-effect.mjs';

export class ChessFrameConfigurator {
  constructor({ root, ui, onChange }) {
    this.root = root;
    this.ui = ui;
    root.innerHTML = `
      <summary>Frame appearance</summary>
      <div class="ca-workspace">
        <div class="settings-card ca-preview chess-frame-stage">
          <div class="chess-frame-preview" role="img" aria-label="Preview board">
            <div class="chess-frame-art" aria-hidden="true"></div>
          </div>
        </div>
        <div class="ca-controls">
          <div class="ca-fields">
            ${Object.entries(CHESS_FRAME_FIELDS)
              .map(([key, { label, min, max, value }]) => {
                const id = 'chess-frame-' + key;
                if (typeof value === 'boolean')
                  return `<label class="general-toggle ca-wide">
                    <input id="${id}" type="checkbox" role="switch" data-frame-field="${key}">
                    <span>${label}</span><span class="general-switch-track" aria-hidden="true"></span>
                  </label>`;
                return `<div class="ca-field"><label for="${id}">${label}</label>
                <input id="${id}" type="range" min="${min}" max="${max}" data-frame-field="${key}">
                <output for="${id}" data-untranslated></output></div>`;
              })
              .join('')}
          </div>
          <p class="chess-frame-status settings-help" role="status"></p>
        </div>
      </div>`;
    this.effect = new ChessFrameEffect(root.querySelector('.chess-frame-art'), {
      inset: 0,
      strokeInset: 0,
    });
    this.fields = [...root.querySelectorAll('[data-frame-field]')];
    this.status = root.querySelector('.chess-frame-status');
    const read = () =>
      chessFrameAppearance(
        Object.fromEntries(
          this.fields.map((field) => [
            field.dataset.frameField,
            field.type === 'checkbox' ? field.checked : field.valueAsNumber,
          ]),
        ),
      );
    root.addEventListener('input', (event) => {
      if (this.fields.includes(event.target)) this.set(read());
    });
    root.addEventListener('change', (event) => {
      if (this.fields.includes(event.target)) onChange(read());
    });
    this.set(DEFAULT_CHESS_FRAME);
  }

  set(value) {
    const style = (this.style = chessFrameAppearance(value));
    for (const input of this.fields) {
      const selected = style[input.dataset.frameField];
      if (input.type === 'checkbox') input.checked = selected;
      else {
        input.value = selected;
        input.nextElementSibling.value = input.value;
      }
    }
    this.effect.setAppearance(style);
  }

  message(key) {
    this.status.textContent = key ? this.ui.text(key) : '';
  }
}
