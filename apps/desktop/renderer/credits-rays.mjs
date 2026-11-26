// SPDX-License-Identifier: GPL-3.0-only
import { drawSpark, getSparkAtlas } from './spark-atlas.mjs';

const pulsePeriod = 2600;
const samples = 12;
const inkPadding = 3;
const sparkDirections = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const beamDirections = [
  [0, 32],
  [0.46, 26],
  [1.09, 31],
  [1.61, 24],
  [2.18, 33],
  [2.68, 25],
  [3.18, 32],
  [3.71, 27],
  [4.21, 31],
  [4.75, 24],
  [5.27, 33],
  [5.79, 25],
].map(([angle, reach]) => ({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach }));

function textLines(label) {
  const text = label.firstChild;
  if (!text?.textContent) return [];
  const range = document.createRange();
  const lines = [];
  let offset = 0;
  for (const letter of text.textContent) {
    range.setStart(text, offset);
    offset += letter.length;
    range.setEnd(text, offset);
    const { left, right, top, height } = range.getBoundingClientRect();
    const line = lines.at(-1);
    if (line?.top === top) {
      line.ink += letter;
      line.left = Math.min(line.left, left);
      line.right = Math.max(line.right, right);
    } else lines.push({ ink: letter, left, right, top, height });
  }
  return lines;
}

function glyphMask(lines, font, spacing, box, density) {
  const mask = document.createElement('canvas');
  mask.width = Math.ceil((box.width + inkPadding * 2) * density);
  mask.height = Math.ceil((box.height + inkPadding * 2) * density);
  const context = mask.getContext('2d');
  if (!context) return null;
  context.scale(density, density);
  context.font = font;
  context.direction = 'ltr';
  context.letterSpacing = spacing === 'normal' ? '0px' : spacing;
  context.fillStyle = '#fff';
  // Ranges preserve the browser's line breaks and centered placement, including a wrapped link.
  for (const { ink, left, top, height } of lines) {
    const { fontBoundingBoxAscent: above, fontBoundingBoxDescent: below } =
      context.measureText(ink);
    context.fillText(
      ink,
      left - box.left + inkPadding,
      top - box.top + inkPadding + (height + above - below) / 2,
    );
  }
  return mask;
}

function rayTexture(mask, { width, height, density, color, centerX, centerY }) {
  const texture = document.createElement('canvas');
  texture.width = Math.ceil(width * density);
  texture.height = Math.ceil(height * density);
  const context = texture.getContext('2d');
  if (!context) return null;
  context.scale(density, density);
  context.globalCompositeOperation = 'lighter';
  // Bake all beam directions once. Animation only composites the cached texture.
  for (const { x, y } of beamDirections) {
    for (let step = 1; step <= samples; step++) {
      const distance = step / samples;
      const expansion = 1 + 0.24 * distance;
      const w = (mask.width / density) * expansion;
      const h = (mask.height / density) * expansion;
      context.globalAlpha = 0.055 * (1 - distance * 0.9) ** 1.4;
      context.drawImage(mask, centerX - w / 2 + x * distance, centerY - h / 2 + y * distance, w, h);
    }
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-in';
  const light = context.createRadialGradient(
    centerX,
    centerY,
    0,
    centerX,
    centerY,
    Math.min(width, height) / 2,
  );
  light.addColorStop(0, '#fff');
  light.addColorStop(0.7, color);
  light.addColorStop(1, color);
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);
  return texture;
}

function sparksAlongLines(lines, sheet) {
  return lines.flatMap(({ left, right, top, height }) =>
    sparkDirections.flatMap(([dx, dy]) =>
      [0.25, 0.75].map((position) => {
        const along = position + (Math.random() - 0.5) * 0.3;
        const travel = 9 + Math.random() * 15;
        const drift = (Math.random() - 0.5) * 13;
        return {
          x: left - sheet.left + (right - left) * (dx === 0 ? along : (dx + 1) / 2),
          y: top - sheet.top + height * (dy === 0 ? along : (dy + 1) / 2),
          dx: dx * travel + dy * drift,
          dy: dy * travel + dx * drift,
          phase: Math.random() * 2100,
          cycle: 1350 + Math.random() * 850,
          size: 5 + Math.random() * 5,
          seed: Math.floor(Math.random() * 0x100000000),
        };
      }),
    ),
  );
}

function paintSparks(context, geometry, elapsed) {
  const { atlas, sparks, density } = geometry;
  context.resetTransform();
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  if (!atlas) return;
  context.scale(density, density);
  for (const spark of sparks) {
    const age = (((elapsed + spark.phase) % spark.cycle) / spark.cycle) * 1.55;
    if (age >= 1) continue;
    const travel = 1 - (1 - age) ** 1.45;
    context.globalAlpha = Math.min(age / 0.15, 1) * (1 - age) ** 1.25;
    drawSpark(
      context,
      atlas,
      spark.x + spark.dx * travel,
      spark.y + spark.dy * travel,
      spark.size * (1 - age * 0.45),
      age,
      spark.seed,
    );
  }
  context.globalAlpha = 1;
}

export function createCreditsRays(label) {
  const element = document.createElement('span');
  element.className = 'credits-god-rays';
  element.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'credits-ray-sheet';
  const particles = document.createElement('canvas');
  particles.className = 'credits-spark-sheet';
  canvas.width = canvas.height = 1;
  particles.width = particles.height = 1;
  element.append(canvas, particles);
  const context = canvas.getContext('2d');
  const sparkContext = particles.getContext('2d');
  const pulseOffset = Math.random() * pulsePeriod;
  let geometry;
  let measured;
  return {
    element,
    measure() {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!context || !width || !height) return;
      const box = label.getBoundingClientRect();
      const sheet = element.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const inkX = box.left - sheet.left;
      const inkY = box.top - sheet.top;
      const style = getComputedStyle(label);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const spacing = style.letterSpacing;
      const color = style.getPropertyValue('--name-glow').trim() || '#fff';
      const density = Math.min(1.5, devicePixelRatio);
      const signature = [
        width,
        height,
        box.width,
        box.height,
        inkX.toFixed(2),
        inkY.toFixed(2),
        density,
        font,
        spacing,
        color,
        label.textContent,
      ].join('|');
      if (measured === signature) return;
      const lines = textLines(label);
      const mask = glyphMask(lines, font, spacing, box, density);
      if (!mask) return;
      const centerX = inkX - inkPadding + mask.width / density / 2;
      const centerY = inkY - inkPadding + mask.height / density / 2;
      const texture = rayTexture(mask, { width, height, density, color, centerX, centerY });
      if (!texture) return;
      canvas.width = particles.width = texture.width;
      canvas.height = particles.height = texture.height;
      geometry = {
        texture,
        density,
        centerX: centerX * density,
        centerY: centerY * density,
        color,
        atlas: geometry?.color === color ? geometry.atlas : getSparkAtlas(color, 0.45),
        sparks: sparksAlongLines(lines, sheet),
      };
      measured = signature;
    },
    paint(elapsed, animate = true) {
      if (!geometry) return;
      const { texture, centerX, centerY } = geometry;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 0.71;
      context.drawImage(texture, 0, 0);
      if (!animate) return;
      // A soft highlight moves outward along the fixed rays while their roots stay lit.
      const age = ((elapsed + pulseOffset) % pulsePeriod) / pulsePeriod;
      const scale = 0.84 + age * 0.43;
      context.globalAlpha = 0.55 * Math.sin(age * Math.PI);
      context.drawImage(
        texture,
        centerX * (1 - scale),
        centerY * (1 - scale),
        texture.width * scale,
        texture.height * scale,
      );
      if (sparkContext) paintSparks(sparkContext, geometry, elapsed);
    },
  };
}
