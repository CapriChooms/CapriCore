// SPDX-License-Identifier: GPL-3.0-only
const orbitPeriod = 8000;
const samples = 24;
const orbitRadius = 83;
const projectionDepth = 0.48;
const inkPadding = 3;

function glyphMask(label, font, spacing, width, height, density) {
  const mask = document.createElement('canvas');
  mask.width = Math.ceil((width + inkPadding * 2) * density);
  mask.height = Math.ceil((height + inkPadding * 2) * density);
  const context = mask.getContext('2d');
  if (!context) return null;
  context.scale(density, density);
  context.font = font;
  context.letterSpacing = spacing === 'normal' ? '0px' : spacing;
  const ink = label.textContent;
  const { fontBoundingBoxAscent: above, fontBoundingBoxDescent: below } = context.measureText(ink);
  context.fillStyle = '#fff';
  context.fillText(ink, inkPadding, inkPadding + (height + above - below) / 2);
  return mask;
}

function paintBeam(context, { mask, color, width, height, density }, elapsed) {
  const angle = (((elapsed % orbitPeriod) / orbitPeriod) * 2 - 0.75) * Math.PI;
  const x = -Math.cos(angle) * orbitRadius * projectionDepth;
  const y = -Math.sin(angle) * orbitRadius * projectionDepth;
  const centerX = width / 2;
  const centerY = height / 2;
  context.setTransform(density, 0, 0, density, 0, 0);
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'lighter';
  // Project the same upright glyphs away from the moving light at increasing depths.
  for (let step = 1; step <= samples; step++) {
    const distance = step / samples;
    const expansion = 1 + projectionDepth * distance;
    const w = (mask.width / density) * expansion;
    const h = (mask.height / density) * expansion;
    context.globalAlpha = 0.062 * (1 - distance * 0.86) ** 1.25;
    context.drawImage(mask, centerX - w / 2 + x * distance, centerY - h / 2 + y * distance, w, h);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-in';
  const light = context.createLinearGradient(centerX, centerY, centerX + x, centerY + y);
  light.addColorStop(0, '#fff');
  light.addColorStop(0.6, color);
  light.addColorStop(1, color);
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);
}

export function createCreditsRays(label) {
  const element = document.createElement('span');
  element.className = 'credits-god-rays';
  element.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'credits-ray-sheet';
  canvas.width = canvas.height = 1;
  element.append(canvas);
  const context = canvas.getContext('2d');
  let geometry;
  let measured;
  return {
    element,
    measure() {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!context || !width || !height) return;
      const { offsetWidth: inkWidth, offsetHeight: inkHeight } = label;
      const style = getComputedStyle(label);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const spacing = style.letterSpacing;
      const color = style.getPropertyValue('--name-glow').trim() || '#fff';
      const density = Math.min(1.5, devicePixelRatio);
      const signature = [width, height, inkWidth, inkHeight, density, font, spacing, color].join(
        '|',
      );
      if (measured === signature) return;
      const mask = glyphMask(label, font, spacing, inkWidth, inkHeight, density);
      if (!mask) return;
      canvas.width = Math.ceil(width * density);
      canvas.height = Math.ceil(height * density);
      geometry = { mask, color, width, height, density };
      measured = signature;
    },
    paint(elapsed) {
      if (geometry) paintBeam(context, geometry, elapsed);
    },
  };
}
