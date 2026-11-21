// SPDX-License-Identifier: GPL-3.0-only
import { scaleChessArrowPath } from './chess-arrow-path.mjs';
import {
  ARROW_ANGLED_ENDS,
  ARROW_NUMBER_LIMITS,
  chessArrowAppearance,
  chessArrowDashes,
} from './chess-arrow-style.mjs';

const svgNamespace = 'http://www.w3.org/2000/svg';
const arrows = new WeakMap();
let nextId = 0;

const endPaths = {
  triangle: 'M 0 0 L -1000 -500 L -1000 500 Z',
  rounded: 'M 0 0 L -820 -410 Q -1000 -500 -1000 -320 L -1000 320 Q -1000 500 -820 410 Z',
  swept: 'M 0 0 L -1000 -500 L -690 0 L -1000 500 Z',
  kite: 'M 0 0 L -760 -500 L -1000 0 L -760 500 Z',
  chevron: 'M -1000 -500 L 0 0 L -1000 500',
  diamond: 'M 0 0 L -500 -500 L -1000 0 L -500 500 Z',
  circle: 'M 0 0 C 0 -667 -1000 -667 -1000 0 C -1000 667 0 667 0 0 Z',
  square: 'M 0 -500 L -1000 -500 L -1000 500 L 0 500 Z',
  bar: 'M 0 -500 L 0 500',
};
const widestPoint = { diamond: 0.5, kite: 0.76 };

function squareCenter(square, orientation) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return orientation === 'black' ? [7.5 - file, rank - 0.5] : [file + 0.5, 8.5 - rank];
}

function terminal(style, key, position, available) {
  const shape = style[key];
  if (shape === 'none') return null;
  const angle = style[`${key}Angle`];
  const ratio = ARROW_ANGLED_ENDS.includes(shape)
    ? 2 * (widestPoint[shape] ?? 1) * Math.tan((angle * Math.PI) / 360)
    : 0;
  const maxWidth = ARROW_NUMBER_LIMITS[`${key}Width`][1] / 100;
  const length = Math.min(
    available * 0.44,
    style[`${key}Length`] / 100,
    ratio ? maxWidth / ratio : Infinity,
  );
  const width = ratio ? length * ratio : style[`${key}Width`] / 100;
  return {
    path: scaleChessArrowPath(
      shape === 'custom' ? style[`${key}Path`] : endPaths[shape],
      length / 1000,
      width / 1000,
    ),
    transform: `translate(${position} 0)${key === 'tail' ? ' rotate(180)' : ''}`,
    open: shape === 'bar' || shape === 'chevron' || (shape === 'custom' && !style[`${key}Fill`]),
    length,
    clip: shape !== 'custom' && shape !== 'bar',
    joinDepth: shape === 'swept' ? length * 0.69 : length,
  };
}

function shaftPath(style, start, end) {
  const length = end - start;
  const x = (fraction) => start + length * fraction;
  const bend = (style.bend * Math.min(length, 4)) / 230;
  const first = `M ${start} 0`;
  switch (style.route) {
    case 'curve':
      return `${first} C ${x(0.28)} 0 ${x(0.1)} ${bend} ${x(0.5)} ${bend} S ${x(0.72)} 0 ${end} 0`;
    case 'elbow':
      return `${first} H ${x(0.23)} V ${bend} H ${x(0.77)} V 0 H ${end}`;
    case 'wave':
      return `${first} C ${x(0.22)} 0 ${x(0.12)} ${bend} ${x(0.32)} ${bend} S ${x(0.57)} ${-bend} ${x(0.68)} ${-bend} S ${x(0.78)} 0 ${end} 0`;
    case 'zigzag':
      return `${first} H ${x(0.16)} L ${x(0.32)} ${bend} ${x(0.68)} ${-bend} ${x(0.84)} 0 H ${end}`;
    case 'custom':
      return scaleChessArrowPath(style.shaftPath, length / 1000, Math.min(length, 4) / 1000, start);
    default:
      return `${first} H ${end}`;
  }
}

export function chessMoveCenters(uci, orientation) {
  if (
    typeof uci !== 'string' ||
    !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) ||
    uci.slice(0, 2) === uci.slice(2, 4)
  )
    return null;
  return [squareCenter(uci.slice(0, 2), orientation), squareCenter(uci.slice(2, 4), orientation)];
}

export function chessArrowGeometry(uci, orientation, style) {
  const centers = chessMoveCenters(uci, orientation);
  if (!centers) return null;
  const [[x1, y1], [x2, y2]] = centers;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const start = Math.min(style.startGap / 100, length * 0.37);
  const end = length - Math.min(style.endGap / 100, length * 0.37);
  const head = terminal(style, 'head', end, end - start);
  const tail = terminal(style, 'tail', start, end - start);
  // Stock tip contours clip the shaft. Custom tips keep their authored overlap.
  const inset = (tip) =>
    tip && !tip.clip ? Math.min((end - start) * 0.16, style.thickness / (tip.open ? 400 : 160)) : 0;
  return {
    transform: `translate(${x1} ${y1}) rotate(${angle})`,
    path: shaftPath(style, start + inset(tail), end - inset(head)),
    start,
    end,
    head,
    tail,
    promotion: uci[4]?.toUpperCase() ?? '',
    promotionX: x2 < 7.5 ? x2 + 0.19 : x2 - 0.42,
    promotionY: y2 - 0.19,
  };
}

function attrs(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) element.removeAttribute(name);
    else if (element.getAttribute(name) !== String(value)) element.setAttribute(name, value);
  }
}

function arrowParts(svg) {
  const create = (name, parent) =>
    parent.appendChild(svg.ownerDocument.createElementNS(svgNamespace, name));
  const id = `capri-arrow-${++nextId}`;
  const defs = create('defs', svg);
  const clip = create('clipPath', defs);
  attrs(clip, { id: `${id}-shaft`, clipPathUnits: 'userSpaceOnUse' });
  const shaftClip = {
    body: create('rect', clip),
    head: create('path', clip),
    tail: create('path', clip),
  };
  const gradient = create('linearGradient', defs);
  attrs(gradient, { id: `${id}-gradient`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, y2: 0 });
  const start = create('stop', gradient);
  const end = create('stop', gradient);
  end.setAttribute('offset', '1');
  const group = create('g', svg);
  const outline = create('g', group);
  const fill = create('g', group);
  const paths = (layer) => ({
    shaft: create('path', layer),
    head: create('path', layer),
    tail: create('path', layer),
  });
  const promotion = create('text', svg);
  attrs(promotion, {
    'font-family': 'system-ui, sans-serif',
    'font-size': 0.34,
    'font-weight': 'bold',
    'paint-order': 'stroke',
  });
  return {
    id,
    gradient,
    start,
    end,
    group,
    outline,
    shaftClip,
    upper: paths(fill),
    lower: paths(outline),
    promotion,
  };
}

function clipShaft(parts, { start, end, head, tail }) {
  if (!head?.clip && !tail?.clip) return null;
  // The custom shaft coordinates are bounded to ±3 move lengths. Allow the
  // whole route between the tips, then retain only their silhouettes at the ends.
  const extent = 32;
  const left = tail?.clip ? start + tail.joinDepth : -extent;
  const right = head?.clip ? end - head.joinDepth : extent;
  attrs(parts.shaftClip.body, { x: left, y: -extent, width: right - left, height: extent * 2 });
  for (const [key, tip] of [
    ['head', head],
    ['tail', tail],
  ]) {
    attrs(parts.shaftClip[key], {
      d: tip?.clip ? tip.path : '',
      transform: tip?.clip ? tip.transform : null,
    });
  }
  return `url(#${parts.id}-shaft)`;
}

function drawTip(element, tip, color, thickness, outline) {
  attrs(element, {
    d: tip?.path ?? '',
    transform: tip?.transform,
    fill: tip?.open ? 'none' : color,
    stroke: outline || tip?.open ? color : 'none',
    'stroke-width': (tip?.open ? thickness : 0) + outline * 2,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  });
}

function draw(svg, state) {
  const { uci, orientation, style } = state;
  const geometry = chessArrowGeometry(uci, orientation, style);
  svg.toggleAttribute('hidden', !geometry);
  if (!geometry) return;
  const parts = (state.parts ??= arrowParts(svg));
  const width = style.thickness / 100;
  const outline = style.outline / 100;
  const finalColor = style.gradient ? style.endColor : style.color;
  const headColor = style.ownHeadColor ? style.headColor : finalColor;
  const tailColor = style.ownTailColor ? style.tailColor : style.color;
  const dash = {
    dashed: [style.dash, style.gap],
    dotted: [1, style.gap],
    mixed: [style.dash, style.gap, 1, style.gap],
    custom: style.pattern === 'custom' ? chessArrowDashes(style.customDash) : null,
  }[style.pattern]
    ?.map((value) => value / 100)
    .join(' ');

  svg.style.opacity = String(style.opacity / 100);
  svg.dataset.style = style.pattern;
  attrs(parts.group, { transform: geometry.transform });
  const filter = style.glow ? `drop-shadow(0 0 ${style.glow / 100}px ${style.glowColor})` : '';
  if (parts.group.style.filter !== filter) parts.group.style.filter = filter;
  attrs(parts.gradient, { x1: geometry.start, x2: geometry.end });
  attrs(parts.start, { 'stop-color': style.color });
  attrs(parts.end, { 'stop-color': style.endColor });
  attrs(parts.outline, { opacity: outline ? style.outlineOpacity / 100 : 0 });
  const shaft = {
    d: geometry.path,
    'clip-path': clipShaft(parts, geometry),
    fill: 'none',
    'stroke-dasharray': dash,
    'stroke-dashoffset': style.dashOffset / 100,
    'stroke-linecap': style.cap,
    'stroke-linejoin': style.join,
    'stroke-miterlimit': 3,
  };
  attrs(parts.lower.shaft, {
    ...shaft,
    stroke: style.outlineColor,
    'stroke-width': width + outline * 2,
  });
  attrs(parts.upper.shaft, {
    ...shaft,
    stroke: style.gradient ? `url(#${parts.id}-gradient)` : style.color,
    'stroke-width': width,
  });
  drawTip(parts.lower.head, geometry.head, style.outlineColor, width, outline);
  drawTip(parts.lower.tail, geometry.tail, style.outlineColor, width, outline);
  drawTip(parts.upper.head, geometry.head, headColor, width, 0);
  drawTip(parts.upper.tail, geometry.tail, tailColor, width, 0);
  attrs(parts.promotion, {
    x: geometry.promotionX,
    y: geometry.promotionY,
    fill: headColor,
    stroke: style.outlineColor,
    'stroke-width': Math.max(0.04, outline),
  });
  if (parts.promotion.textContent !== geometry.promotion)
    parts.promotion.textContent = geometry.promotion;
}

export function renderChessArrow(svg, { uci, orientation = 'white', appearance } = {}) {
  const state = arrows.get(svg) ?? { style: chessArrowAppearance() };
  if (appearance) state.style = chessArrowAppearance(appearance);
  state.uci = uci;
  state.orientation = orientation;
  arrows.set(svg, state);
  draw(svg, state);
}

export function applyChessArrowAppearance(svg, appearance) {
  const state = arrows.get(svg) ?? {};
  state.style = chessArrowAppearance(appearance);
  arrows.set(svg, state);
  draw(svg, state);
}
