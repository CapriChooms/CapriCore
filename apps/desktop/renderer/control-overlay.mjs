// SPDX-License-Identifier: GPL-3.0-only
// Thin edge-only procedural effects. The central content is never tinted.
const canvas = document.getElementById('control-effects');
const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
let settings = { enabled: true, intensity: 50, theme: 'capri', cursor: true };
let pointer = null,
  previousPointer = null,
  phase = 'observing',
  pulseAt = -10000;
let width = 0,
  height = 0,
  lastFrame = 0,
  frame;
const trail = [],
  reduce = matchMedia('(prefers-reduced-motion: reduce)');
const resize = () => {
  width = innerWidth;
  height = innerHeight;
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
};
resize();
addEventListener('resize', resize);
function palette() {
  return settings.theme === 'blackwall'
    ? ['#ff2858', '#ff619c', '#af54ff']
    : ['#ff2070', '#70ff4a', '#5ae6ff'];
}
function line(points, color, alpha = 1, weight = 1) {
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}
function render(now) {
  frame = requestAnimationFrame(render);
  if (now - lastFrame < (reduce.matches ? 250 : 33)) return;
  lastFrame = now;
  // Clear only the strips and pointer area we use, rather than every 4K pixel.
  ctx.clearRect(0, 0, width, 82);
  ctx.clearRect(0, height - 82, width, 82);
  ctx.clearRect(0, 0, 82, height);
  ctx.clearRect(width - 82, 0, 82, height);
  if (previousPointer) ctx.clearRect(previousPointer.x - 100, previousPointer.y - 100, 200, 200);
  for (const item of trail) ctx.clearRect(item.x - 30, item.y - 30, 60, 60);
  const amount = settings.enabled ? settings.intensity / 50 : 0;
  const colors = palette(),
    time = reduce.matches ? 0 : now * 0.001;
  ctx.shadowBlur = amount * 7;
  ctx.shadowColor = colors[0];
  if (amount) {
    const count = 14 + Math.round(amount * 24),
      depth = 9 + Math.min(1, amount) * 43;
    for (let i = 0; i < count; i++) {
      const seed = Math.sin(i * 91.37 + 0.17) * 43758.54,
        noise = seed - Math.floor(seed);
      const y = ((noise * height + time * (8 + noise * 20)) % (height + 100)) - 50;
      const reach = 4 + depth * (0.3 + 0.7 * Math.sin(i * 5.2 + time * 0.4) ** 2);
      const alpha = amount * (0.12 + 0.3 * Math.sin(i + time) ** 2);
      const x = i % 2 ? width - 3 : 3,
        sign = i % 2 ? -1 : 1;
      if (settings.theme === 'blackwall') {
        const column = x + sign * (3 + noise * depth);
        line(
          [
            [column, y - 45 - noise * 90],
            [column, y + 35],
            [column + sign * 9, y + 35],
            [column + sign * 9, y + 50],
          ],
          colors[i % 3],
          alpha * 1.25,
          i % 4 ? 1 : 2,
        );
        line(
          [
            [x, y],
            [x + sign * reach, y],
          ],
          colors[0],
          alpha * 0.8,
        );
      } else
        line(
          [
            [x, y - 28],
            [x + sign * reach, y - 11],
            [x + sign * reach, y + 8],
            [x + sign * 3, y + 21],
          ],
          colors[i % 3],
          alpha,
          i % 5 ? 1 : 2,
        );
      if (settings.theme === 'capri' && i % 7 === 0) {
        const eyeX = x + sign * (10 + depth * 0.4);
        line(
          [
            [eyeX - 7, y],
            [eyeX, y - 4],
            [eyeX + 7, y],
            [eyeX, y + 4],
            [eyeX - 7, y],
          ],
          colors[1],
          amount * 0.7,
        );
        ctx.globalAlpha = Math.min(1, amount * 0.8);
        ctx.fillStyle = colors[2];
        ctx.fillRect(eyeX - 1, y - 1, 2, 2);
      }
      const topX = (noise * width + time * 16) % width;
      line(
        [
          [topX, 3],
          [topX + 18, 3 + reach * 0.5],
          [topX + 33, 3 + reach * 0.5],
        ],
        colors[i % 3],
        alpha,
      );
      line(
        [
          [width - topX, height - 3],
          [width - topX - 18, height - 3 - reach * 0.5],
        ],
        colors[(i + 1) % 3],
        alpha,
      );
    }
    // Brief chromatic fractures at edges, never over the center of the image.
    const glitch = !reduce.matches && (Math.sin(time * 1.37) > 0.985 || now - pulseAt < 160);
    if (glitch)
      for (let i = 0; i < 7; i++) {
        const y = (i * 173 + now * 0.11) % height,
          side = i % 2 ? width - 70 : 0;
        ctx.fillStyle = colors[i % 3];
        ctx.globalAlpha = Math.min(1, amount * 0.65);
        ctx.fillRect(side, y, 16 + i * 5, 1 + (i % 3));
      }
    const corner = 30 + Math.min(1, amount) * 25;
    for (const [x, y, sx, sy] of [
      [8, 8, 1, 1],
      [width - 8, 8, -1, 1],
      [8, height - 8, 1, -1],
      [width - 8, height - 8, -1, -1],
    ]) {
      line(
        [
          [x, y + sy * corner],
          [x, y + sy * 9],
          [x + sx * 9, y],
          [x + sx * corner, y],
        ],
        colors[phase === 'acting' ? 1 : 0],
        0.45 + amount * 0.5,
        2,
      );
    }
  }
  ctx.shadowBlur = 0;
  while (trail.length && now - trail[0].at > 350) trail.shift();
  if (settings.cursor && pointer) {
    const color = colors[2],
      pulse = Math.max(0, 1 - (now - pulseAt) / 450);
    for (const item of trail) {
      const fade = Math.max(0, 1 - (now - item.at) / 350);
      ctx.globalAlpha = 0.35 * fade;
      ctx.fillStyle = colors[0];
      ctx.fillRect(item.x - 2, item.y - 2, 4, 4);
    }
    const { x, y } = pointer,
      r = 12 + pulse * 12;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r, time * 0.4, time * 0.4 + Math.PI * 1.6);
    ctx.stroke();
    line(
      [
        [x - r - 6, y],
        [x - r, y],
      ],
      colors[1],
      0.9,
      2,
    );
    line(
      [
        [x, y + r + 5],
        [x, y + r],
      ],
      colors[0],
      0.9,
      2,
    );
    line(
      [
        [x + r, y],
        [x + r + 5, y - 5],
        [x + r + 5, y + 5],
        [x + r, y],
      ],
      colors[0],
      0.9,
      1.5,
    );
    line(
      [
        [x - 5, y],
        [x, y - 4],
        [x + 5, y],
        [x, y + 4],
        [x - 5, y],
      ],
      colors[1],
      0.8,
      1,
    );
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x - 1, y - 1, 2, 2);
    previousPointer = { x, y };
  } else previousPointer = null;
  ctx.globalAlpha = 1;
}
globalThis.capriControl = Object.freeze({
  configure(value) {
    settings = { ...settings, ...value };
    document.body.dataset.theme = settings.theme;
  },
  pointer(value) {
    if (pointer) trail.push({ ...pointer, at: performance.now() });
    if (trail.length > 12) trail.shift();
    pointer = value;
  },
  pulse(action) {
    phase = action;
    pulseAt = performance.now();
  },
  phase(value) {
    phase = value;
  },
});
frame = requestAnimationFrame(render);
addEventListener('pagehide', () => cancelAnimationFrame(frame), { once: true });
