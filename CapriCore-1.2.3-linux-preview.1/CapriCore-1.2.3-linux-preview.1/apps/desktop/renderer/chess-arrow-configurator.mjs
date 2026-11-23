// SPDX-License-Identifier: GPL-3.0-only
import { renderChessArrow } from './chess-arrow.mjs';
import { scaleChessArrowPath } from './chess-arrow-path.mjs';
import {
  ARROW_ANGLED_ENDS,
  ARROW_ENDS,
  ARROW_NUMBER_LIMITS,
  ARROW_PATTERNS,
  ARROW_PRESETS,
  ARROW_ROUTES,
  chessArrowAppearance,
} from './chess-arrow-style.mjs';

const MOODS = { green: 'Classic green', wood: 'Warm wood', dark: 'Slate' };
const LABELS = {
  straight: 'Straight',
  curve: 'Curve',
  elbow: 'Elbow',
  wave: 'Wave',
  zigzag: 'Zigzag',
  solid: 'Solid',
  thin: 'Thin',
  dashed: 'Dashed',
  dotted: 'Dotted',
  mixed: 'Dash and dot',
  curved: 'Curved',
  contrast: 'High contrast',
  double: 'Double-ended',
  custom: 'Custom',
  none: 'None',
  triangle: 'Triangle',
  rounded: 'Rounded triangle',
  swept: 'Swept',
  kite: 'Kite',
  chevron: 'Chevron',
  diamond: 'Diamond',
  circle: 'Circle',
  square: 'Square',
  bar: 'Bar',
  round: 'Round',
  butt: 'Flat',
  miter: 'Sharp',
  bevel: 'Bevel',
  ...MOODS,
};
const FILES = 'abcdefgh';
const SAMPLES = { b2: '♙', c7: '♟', e2: '♕', g3: '♖', b7: '♞', g7: '♚', d1: '♔' };
const SHAFT_AREA = '-100 -500 1200 1000';
const TIP_AREA = '-1100 -650 1200 1300';

function selectOptions(values) {
  return values
    .map((value) => `<option value="${value}">${LABELS[value] ?? value}</option>`)
    .join('');
}

function field(key, label, type, options) {
  const id = `chess-arrow-${key}`;
  if (type === 'checkbox')
    return `<label class="dimming-switch ca-check"><input id="${id}" data-field="${key}" type="checkbox"><span>${label}</span></label>`;
  if (type === 'range') {
    const [min, max] = ARROW_NUMBER_LIMITS[key];
    return `<div class="ca-field"><label for="${id}">${label}</label>
      <output for="${id}" data-untranslated></output>
      <input id="${id}" data-field="${key}" type="range" min="${min}" max="${max}"></div>`;
  }
  if (type === 'color') {
    return `<div class="ca-field ca-color-field"><label for="${id}">${label}</label>
      <input id="${id}" data-field="${key}" type="color"><output for="${id}" data-untranslated></output></div>`;
  }
  const control =
    type === 'select'
      ? `<select id="${id}" data-field="${key}">${selectOptions(options)}</select>`
      : type === 'path'
        ? `
      <svg class="ca-sketch" viewBox="${key === 'shaftPath' ? SHAFT_AREA : TIP_AREA}" data-sketch="${key}" aria-hidden="true">
        <line x1="-1000" x2="1000" y1="0" y2="0"></line>
        <path></path>
        <circle cx="0" cy="0" r="19"></circle>
        <circle cx="${key === 'shaftPath' ? 1000 : -1000}" cy="0" r="19"></circle>
      </svg>
      <span class="settings-help">Drag to draw a path or edit its coordinates below.</span>
      <textarea id="${id}" data-field="${key}" aria-describedby="chess-arrow-path-help" rows="2" maxlength="1800" spellcheck="false"></textarea>`
        : `<input id="${id}" data-field="${key}" type="text" maxlength="80" spellcheck="false" aria-describedby="chess-arrow-pattern-help">`;
  return `<div class="ca-field ca-wide"><label for="${id}">${label}</label>${control}</div>`;
}

function subpanel(id, label, contents) {
  return `<details class="settings-disclosure" id="chess-arrow-group-${id}" ${id === 'shape' ? 'open' : ''}>
    <summary>${label}</summary><div class="ca-fields">${contents}</div></details>`;
}

function terminalFields(key, label) {
  return `<fieldset class="ca-terminal ca-wide" data-terminal="${key}"><legend>${label}</legend><div class="ca-fields">
    ${field(key, 'Tip shape', 'select', ARROW_ENDS)}
    ${field(key + 'Length', 'Length', 'range')}${field(key + 'Angle', 'Tip angle', 'range')}
    ${field(key + 'Width', 'Width', 'range')}
    ${field('own' + label + 'Color', 'Use a separate color', 'checkbox')}
    ${field(key + 'Color', 'Tip color', 'color')}
    ${field(key + 'Path', 'Tip path', 'path')}
    ${field(key + 'Fill', 'Fill custom tip', 'checkbox')}
  </div></fieldset>`;
}

export class ChessArrowConfigurator {
  constructor({ root, ui, onChange, onPreview }) {
    Object.assign(this, { root, ui, onChange, onPreview });
    this.move = 'c3f6';
    this.root.innerHTML = `
      <summary>Arrow configurator</summary>
      <div class="ca-workspace">
        <div class="settings-card ca-preview">
          <div class="ca-preview-controls">
            <label for="chess-arrow-preview-theme">Preview board</label>
            <select id="chess-arrow-preview-theme">${selectOptions(Object.keys(MOODS))}</select>
          </div>
          <div class="ca-board-frame" data-theme="green">
            <div class="ca-board" role="group" aria-label="Preview board"></div>
            <svg class="ca-preview-arrow" viewBox="0 0 8 8" aria-hidden="true" hidden></svg>
          </div>
          <div class="ca-move-readout">
            <p class="settings-help">Pick a start square, then a destination.</p>
            <output class="ca-move" data-untranslated></output>
          </div>
        </div>
        <div class="ca-controls">
          <div class="settings-actions ca-presets" role="group" aria-label="Arrow presets">
            ${Object.keys(ARROW_PRESETS)
              .map(
                (preset) => `
              <button type="button" data-preset="${preset}" aria-pressed="false">
                <svg viewBox="0 2.1 8 2.8" aria-hidden="true"></svg><span>${LABELS[preset]}</span>
              </button>`,
              )
              .join('')}
          </div>
          ${subpanel(
            'shape',
            'Line and shape',
            `
            ${field('route', 'Arrow path', 'select', ARROW_ROUTES)}
            ${field('thickness', 'Thickness', 'range')}${field('bend', 'Bend', 'range')}
            ${field('startGap', 'Start inset', 'range')}${field('endGap', 'End inset', 'range')}
            ${field('cap', 'Line caps', 'select', ['butt', 'round', 'square'])}
            ${field('join', 'Corner joins', 'select', ['miter', 'round', 'bevel'])}
            ${field('pattern', 'Line pattern', 'select', ARROW_PATTERNS)}
            ${field('dash', 'Dash length', 'range')}${field('gap', 'Dash spacing', 'range')}
            ${field('dashOffset', 'Dash offset', 'range')}
            ${field('customDash', 'Dash sequence', 'text')}
            <p id="chess-arrow-pattern-help" class="settings-help ca-wide">Alternate dash and gap lengths. Use whole numbers from 1 to 200.</p>
            ${field('shaftPath', 'Shaft path', 'path')}`,
          )}
          ${subpanel(
            'color',
            'Color and opacity',
            `
            ${field('color', 'Base color', 'color')}${field('opacity', 'Arrow opacity', 'range')}
            ${field('gradient', 'Gradient along the arrow', 'checkbox')}${field('endColor', 'End color', 'color')}
            ${field('outline', 'Outline width', 'range')}${field('outlineColor', 'Outline color', 'color')}
            ${field('outlineOpacity', 'Outline opacity', 'range')}
            ${field('glow', 'Glow radius', 'range')}${field('glowColor', 'Glow color', 'color')}`,
          )}
          ${subpanel('tips', 'Head and tail', terminalFields('head', 'Head') + terminalFields('tail', 'Tail'))}
          <p id="chess-arrow-path-help" class="settings-help" hidden>Use absolute SVG path commands M, L, Q, C and Z. The shaft runs from (0, 0) to (1000, 0). A tip points to (0, 0) with its base at x = −1000 and edges at y = ±500.</p>
          ${subpanel(
            'profile',
            'Import and export',
            `
            <div class="ca-field ca-wide"><label for="chess-arrow-profile">Arrow settings JSON</label>
            <textarea id="chess-arrow-profile" rows="4" maxlength="12000" spellcheck="false"></textarea></div>
            <div class="settings-actions ca-wide">
              <button type="button" data-profile="export">Show current settings</button>
              <button type="button" data-profile="import">Apply JSON</button>
            </div>`,
          )}
          <p class="ca-status" role="status" hidden></p>
        </div>
      </div>`;
    this.svg = root.querySelector('.ca-preview-arrow');
    this.board = root.querySelector('.ca-board');
    this.cells = Array.from({ length: 64 }, (_, index) => this.makeSquare(index));
    this.board.append(...this.cells);
    this.fields = [...root.querySelectorAll('[data-field]')];
    this.presets = [...root.querySelectorAll('[data-preset]')];
    this.sketches = [...root.querySelectorAll('[data-sketch]')];
    this.profile = root.querySelector('#chess-arrow-profile');
    this.status = root.querySelector('.ca-status');
    this.pathHelp = root.querySelector('#chess-arrow-path-help');
    this.patternHelp = root.querySelector('#chess-arrow-pattern-help');
    root.querySelector('#chess-arrow-preview-theme').onchange = (event) => {
      this.board.parentElement.dataset.theme = event.target.value;
    };
    this.board.onclick = (event) => {
      const square = event.target.closest('button')?.dataset.square;
      if (square) this.chooseSquare(square);
    };
    this.board.onkeydown = (event) => this.moveFocus(event);
    root.addEventListener('click', ({ target }) => {
      const preset = target.closest('[data-preset]')?.dataset.preset;
      if (preset) this.commit(chessArrowAppearance(ARROW_PRESETS[preset]));
      if (target.dataset.profile === 'import') this.importProfile();
      if (target.dataset.profile === 'export') {
        this.profile.value = JSON.stringify(this.style, null, 2);
        this.profile.select();
      }
    });
    root.addEventListener('input', (event) => this.edit(event.target, false));
    root.addEventListener('change', (event) => this.edit(event.target, true));
    for (const button of this.presets)
      renderChessArrow(button.querySelector('svg'), {
        uci: 'b5g5',
        appearance: ARROW_PRESETS[button.dataset.preset],
      });
    for (const sketch of this.sketches) this.bindSketch(sketch);
  }

  makeSquare(index) {
    const file = index % 8;
    const rank = 8 - Math.floor(index / 8);
    const square = FILES[file] + rank;
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'settings-visual-control';
    button.dataset.square = square;
    button.classList.toggle('ca-dark', (file + rank) % 2 === 1);
    button.classList.toggle(
      'ca-black-piece',
      square in SAMPLES && '♟♞♚'.includes(SAMPLES[square]),
    );
    button.setAttribute('aria-label', square);
    button.setAttribute('data-untranslated', '');
    button.textContent = SAMPLES[square] ?? '';
    button.tabIndex = index === 0 ? 0 : -1;
    if (file === 0) button.dataset.rank = rank;
    if (rank === 1) button.dataset.file = FILES[file];
    return button;
  }

  moveFocus(event) {
    const index = this.cells.indexOf(event.target);
    const n = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
    if (index < 0 || n === undefined) return;
    event.preventDefault();
    const next = this.cells[(index + n + 64) % 64];
    event.target.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }

  chooseSquare(square) {
    if (this.source && this.source !== square) {
      this.move = this.source + square;
      this.source = '';
    } else {
      this.source = this.source ? '' : square;
    }
    this.draw();
  }

  bindSketch(svg) {
    const key = svg.dataset.sketch;
    const shaft = key === 'shaftPath';
    const tip = key === 'headPath' ? 'head' : 'tail';
    const path = svg.querySelector('path');
    let points;
    let pointer;
    const point = (event) => {
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        svg.getScreenCTM().inverse(),
      );
      const [minX, minY, width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
      return [
        Math.round(Math.min(minX + width, Math.max(minX, local.x))),
        Math.round(Math.min(minY + height, Math.max(minY, local.y))),
      ];
    };
    const draw = (finished) => {
      const segment = shaft ? [[0, 0], ...points, [1000, 0]] : points;
      const data =
        'M ' +
        segment.map((pair) => pair.join(' ')).join(' L ') +
        (finished && !shaft && this.style[tip + 'Fill'] ? ' Z' : '');
      path.setAttribute('d', data);
      return data;
    };
    svg.onpointerdown = (event) => {
      if (event.button !== 0 || points) return;
      pointer = event.pointerId;
      points = [point(event)];
      svg.setPointerCapture(pointer);
      draw(false);
    };
    svg.onpointermove = (event) => {
      if (event.pointerId !== pointer || !points) return;
      const next = point(event);
      const last = points.at(-1);
      if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 22) return;
      if (points.length >= 64) points = points.filter((_, index) => index % 2 === 0);
      points.push(next);
      const data = draw(true);
      renderChessArrow(this.svg, { uci: this.move, appearance: { ...this.style, [key]: data } });
    };
    svg.onpointerup = (event) => {
      if (event.pointerId !== pointer || !points) return;
      const data = draw(true);
      const enoughPoints = points.length > 1;
      points = pointer = undefined;
      if (enoughPoints) this.commit(chessArrowAppearance({ ...this.style, [key]: data }));
      else this.syncSketch(svg);
    };
    svg.onlostpointercapture = (event) => {
      if (event.pointerId !== pointer) return;
      points = pointer = undefined;
      this.syncSketch(svg);
      this.draw();
    };
  }

  syncSketch(svg) {
    svg
      .querySelector('path')
      .setAttribute('d', scaleChessArrowPath(this.style[svg.dataset.sketch], 1, 1));
  }

  setAppearance(value) {
    this.style = chessArrowAppearance(value);
    this.syncControls();
    this.draw();
  }

  message(key) {
    this.status.textContent = key ? this.ui.text(key) : '';
    this.status.hidden = !key;
  }

  commit(value) {
    this.setAppearance(value);
    this.message('');
    this.onChange(this.style);
  }

  importProfile() {
    try {
      const value = JSON.parse(this.profile.value);
      this.commit(chessArrowAppearance(value));
    } catch {
      this.message('Invalid arrow settings JSON.');
    }
  }

  edit(input, save) {
    const key = input.dataset.field;
    if (!key) return;
    const value =
      input.type === 'checkbox'
        ? input.checked
        : input.type === 'range'
          ? input.valueAsNumber
          : input.value.trim();
    let style;
    try {
      style = chessArrowAppearance({ ...this.style, [key]: value });
    } catch {
      input.setAttribute('aria-invalid', 'true');
      this.message('Check the path or dash format.');
      return;
    }
    input.removeAttribute('aria-invalid');
    if (!this.fields.some((element) => element.hasAttribute('aria-invalid'))) this.message('');
    this.style = style;
    this.syncControls(input);
    this.draw();
    if (save) this.onChange(style);
  }

  syncControls(active) {
    const style = this.style;
    const isVisible = {
      bend: !['straight', 'custom'].includes(style.route),
      shaftPath: style.route === 'custom',
      dash: ['dashed', 'mixed'].includes(style.pattern),
      gap: ['dashed', 'mixed', 'dotted'].includes(style.pattern),
      dashOffset: style.pattern !== 'solid',
      customDash: style.pattern === 'custom',
      endColor: style.gradient,
      outlineColor: style.outline > 0,
      outlineOpacity: style.outline > 0,
      glowColor: style.glow > 0,
    };
    for (const [key, name] of [
      ['head', 'Head'],
      ['tail', 'Tail'],
    ]) {
      const angled = ARROW_ANGLED_ENDS.includes(style[key]);
      isVisible[key + 'Length'] = !['none', 'bar'].includes(style[key]);
      isVisible[key + 'Angle'] = angled;
      isVisible[key + 'Width'] = style[key] !== 'none' && (!angled || style[key + 'Angle'] === 0);
      isVisible['own' + name + 'Color'] = style[key] !== 'none';
      isVisible[key + 'Color'] = style[key] !== 'none' && style['own' + name + 'Color'];
      isVisible[key + 'Path'] = isVisible[key + 'Fill'] = style[key] === 'custom';
    }
    for (const input of this.fields) {
      const key = input.dataset.field;
      const value = style[key];
      const hidden = isVisible[key] === false;
      input.parentElement.hidden = hidden;
      if (input !== active && (!input.hasAttribute('aria-invalid') || !active || hidden)) {
        input.removeAttribute('aria-invalid');
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value;
      }
      const output = input.parentElement.querySelector('output');
      if (!output) continue;
      if (key.endsWith('Angle')) {
        output.value = value === 0 ? this.ui.text('Automatic') : `${value}°`;
        input.setAttribute('aria-valuetext', output.value);
      } else output.value = typeof value === 'number' ? `${value}%` : value.toUpperCase();
    }
    this.pathHelp.hidden = !(isVisible.shaftPath || isVisible.headPath || isVisible.tailPath);
    this.patternHelp.hidden = !isVisible.customDash;
    for (const svg of this.sketches) {
      if (isVisible[svg.dataset.sketch]) this.syncSketch(svg);
    }
    for (const button of this.presets) {
      const preset = chessArrowAppearance(ARROW_PRESETS[button.dataset.preset]);
      button.setAttribute(
        'aria-pressed',
        Object.keys(preset).every((key) => preset[key] === style[key]),
      );
    }
  }

  draw() {
    const first = this.source || this.move.slice(0, 2);
    const last = this.source ? '' : this.move.slice(2, 4);
    for (const cell of this.cells) {
      cell.classList.toggle('ca-source', cell.dataset.square === first);
      cell.classList.toggle('ca-target', cell.dataset.square === last);
      cell.setAttribute(
        'aria-pressed',
        cell.dataset.square === first || cell.dataset.square === last,
      );
    }
    this.root.querySelector('.ca-move').value = `${first} → ${last || '…'}`;
    renderChessArrow(this.svg, {
      uci: this.source ? undefined : this.move,
      appearance: this.style,
    });
    this.onPreview(this.style);
  }
}
