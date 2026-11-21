// SPDX-License-Identifier: GPL-3.0-only
import {
  CHESS_FRAME_OUTER_PADDING,
  CHESS_FRAME_OUTSET,
  chessFrameAppearance,
  DEFAULT_CHESS_FRAME,
} from './chess-frame-style.mjs';
import { drawSpark, getSparkAtlas } from './spark-atlas.mjs';

const frameInterval = 1000 / 60;
const flashCount = 5;
const emberCore = '#ffffff';
const chessPalette = {
  color: '#ff3048',
  hot: '#ffb1b7',
  highlight: '#ffe6e8',
  bloom: [1, 0.12, 0.22],
};
const svgNamespace = 'http://www.w3.org/2000/svg';
let nextBloomId = 0;
const angles = [0, 90, 180, -90];
const qualityLevels = [
  { spanCount: 22, particles: 16, samples: 1, maxEdge: 768, maxDepth: 48 },
  { spanCount: 25, particles: 26, samples: 1, maxEdge: 896, maxDepth: 56 },
  { spanCount: 30, particles: 38, samples: 1.25, maxEdge: 1024, maxDepth: 72 },
  { spanCount: 42, particles: 52, samples: 1.65, maxEdge: 1408, maxDepth: 96 },
  { spanCount: 58, particles: 70, samples: 2, maxEdge: 1920, maxDepth: 128 },
  { spanCount: 65, particles: 78, samples: 2.2, maxEdge: 2048, maxDepth: 144 },
  { spanCount: 72, particles: 86, samples: 2.4, maxEdge: 2304, maxDepth: 160 },
  { spanCount: 80, particles: 94, samples: 2.6, maxEdge: 2560, maxDepth: 176 },
];

function framePalette(color) {
  if (!/^#[\da-f]{6}$/i.test(color)) return chessPalette;
  const channels = color
    .slice(1)
    .match(/../g)
    .map((pair) => Number.parseInt(pair, 16));
  const tint = (amount) =>
    `rgb(${channels.map((value) => Math.round(value + (255 - value) * amount)).join(' ')})`;
  return {
    color,
    hot: tint(0.54),
    highlight: tint(0.88),
    bloom: channels.map((value) => (value / 255).toFixed(3)),
  };
}

function randomFrom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function edgePattern(length, inset, edge, quality) {
  const random = randomFrom(6323 + edge * 12523);
  const end = length - inset;
  const segments = [[], [], []];
  const streaks = [];
  const span = (end - inset) / quality.spanCount;
  for (let x = inset; x < end; ) {
    const next = Math.min(end, x + span * (0.35 + random() * 1.65));
    const brightness = random();
    segments[brightness < 0.23 ? 0 : brightness < 0.77 ? 1 : 2].push([x, next]);
    streaks.push({
      from: x,
      to: next,
      phase: random() * Math.PI * 2,
      rate: 0.002 + random() * 0.006,
    });
    x = next + (random() < 0.27 ? span * random() * 0.95 : 0);
  }
  const bright = segments[2];
  const anchors = Array.from({ length: 5 }, (_, i) => {
    const [from, to] = bright[Math.floor((i * bright.length) / 5)] ?? [inset, end];
    return from + random() * (to - from);
  });
  const shards = Array.from({ length: quality.particles }, (_, i) => ({
    anchor: i % 3 === 0 ? anchors[i % anchors.length] : null,
    phase: i * 81 + random() * 120,
    period: 720 + random() * 800,
    seed: (random() * 4294967296) >>> 0,
    dy: 7 + random() * (quality.particles > 38 ? 31 : 22),
    size: 0.52 + random() * 1.8,
  }));
  return { segments, streaks, shards };
}

function emberNoise(seed) {
  const mixed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

function createFrameBloom(element, [red, green, blue]) {
  const id = `chess-frame-bloom-${++nextBloomId}`;
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  // Green and blue separate white highlights from the saturated frame.
  // Respect source coverage before spreading the light over adjacent pixels.
  svg.innerHTML = `
    <filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 ${red}  0 0 0 0 ${green}  0 0 0 0 ${blue}  0 2.4 1.6 0 -2.25" />
      <feComposite in2="SourceAlpha" operator="in" result="emit" />
      <feGaussianBlur in="emit" result="nearBlur" />
      <feComponentTransfer in="nearBlur" result="near"><feFuncA type="linear" /></feComponentTransfer>
      <feMorphology in="emit" operator="dilate" result="wideSpread" />
      <feGaussianBlur in="wideSpread" result="wideBlur" />
      <feComponentTransfer in="wideBlur" result="wide"><feFuncA type="linear" /></feComponentTransfer>
      <feMerge><feMergeNode in="wide" /><feMergeNode in="near" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>`;
  element.append(svg);
  return {
    filter: `url(#${id})`,
    nearBlur: svg.querySelector('[result="nearBlur"]'),
    nearGain: svg.querySelector('[result="near"] feFuncA'),
    wideSpread: svg.querySelector('[result="wideSpread"]'),
    wideBlur: svg.querySelector('[result="wideBlur"]'),
    wideGain: svg.querySelector('[result="wide"] feFuncA'),
  };
}

function taperedStroke(context, x, y, length, weight) {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + length * 0.29, y - weight * 0.47);
  context.lineTo(x + length * 0.72, y - weight * 0.36);
  context.lineTo(x + length, y);
  context.lineTo(x + length * 0.61, y + weight * 0.53);
  context.lineTo(x + length * 0.18, y + weight * 0.32);
  context.fill();
}

function makeHalo(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.3, color + '88');
  gradient.addColorStop(0.64, color + '22');
  gradient.addColorStop(1, color + '00');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return canvas;
}

/** Resolve each independently timed flash. Its position is fixed until its next burst. */
export function chessFrameFlashes(now, count, seed) {
  const flashes = [];
  for (let slot = 0; slot < count; slot++) {
    const clockSeed = seed + Math.imul(slot + 1, 0x9e3779b9);
    const period = 970 + emberNoise(clockSeed) * 1050;
    const time = now + emberNoise(clockSeed + 103) * period;
    const cycle = Math.floor(time / period);
    const eventSeed = clockSeed + Math.imul(cycle + 1, 0x5bd1e995);
    const life = 270 + emberNoise(eventSeed + 17) * 440;
    const age = (time - cycle * period) / life;
    if (age >= 1) continue;
    const heat = Math.min(age / 0.16, 1) * (1 - age) ** 1.25;
    flashes.push({
      edge: Math.floor(emberNoise(eventSeed + 167) * angles.length),
      position: 0.05 + emberNoise(eventSeed + 281) * 0.9,
      radius: 9 + emberNoise(eventSeed + 739) * 14,
      heat,
    });
  }
  return flashes;
}

function drawFlashes(
  context,
  { edge, length, inset, line, scale, palette, haloRadius },
  flashes,
  halo,
) {
  for (const flash of flashes) {
    if (flash.edge !== edge) continue;
    const x = inset + (length - inset * 2) * flash.position;
    const radius = flash.radius * scale;
    const { heat } = flash;
    if (halo) {
      context.globalAlpha = heat * 0.83;
      const spread = radius + haloRadius;
      context.drawImage(halo, x - spread, inset - haloRadius, spread * 2, haloRadius * 2);
    }
    context.globalAlpha = heat * 0.7;
    context.fillStyle = palette.color;
    taperedStroke(context, x - radius * 0.78, inset, radius * 1.56, line * 1.56);
    context.globalAlpha = heat;
    context.fillStyle = emberCore;
    taperedStroke(context, x - radius * 0.32, inset, radius * 0.58, line * 0.68);
  }
}

function drawStreaks(context, { streaks, inset, line, detail, palette, haloRadius }, now, halo) {
  context.fillStyle = palette.hot;
  for (const { from, to, phase, rate } of streaks) {
    const pulse = now * rate + phase;
    const heat = (0.5 + Math.sin(pulse) * 0.5) ** 2;
    if (heat < 0.13) continue;
    const width = (to - from) * (0.22 + heat * 0.5);
    const x = from + (to - from - width) * (0.5 + Math.sin(pulse * 0.62) * 0.5);
    if (halo && heat > 0.65) {
      const spread = haloRadius * 0.42;
      context.globalAlpha = (heat - 0.65) * 1.2;
      context.drawImage(halo, x - spread, inset - spread, width + spread * 2, spread * 2);
    }
    context.globalAlpha = heat * 0.9;
    if (detail < 4) {
      context.fillRect(x, inset - line * 0.4, width, line * (0.48 + heat * 0.37));
      continue;
    }
    taperedStroke(context, x, inset - line * 0.08, width, line * (0.6 + heat * 0.5));
    if (heat > 0.88 && phase > 3.5) {
      context.globalAlpha = heat * 0.38;
      taperedStroke(context, x + width * 0.28, inset + line * 0.83, width * 0.62, line * 0.29);
    }
  }
}

function drawEmbers(
  context,
  { shards, length, inset, line, scale, palette, particleTravel, haloRadius },
  atlas,
  halo,
  now,
  outward,
) {
  if (outward) {
    context.save();
    context.translate(0, inset * 2);
    context.scale(1, -1);
  }
  for (const shard of shards) {
    const cycle = (now + shard.phase) / shard.period;
    const generation = Math.floor(cycle);
    const age = (cycle - generation) / 0.79;
    if (age >= 1) continue;
    const seed = shard.seed + generation * 5317;
    const drift = (emberNoise(seed + 613) - 0.5) * 52;
    const spread = emberNoise(seed);
    const source =
      shard.anchor === null
        ? inset + spread * (length - inset * 2)
        : shard.anchor + (spread - 0.5) * 20 * scale;
    const x = Math.max(inset, Math.min(length - inset, source + drift * age * scale));
    const travel = (1 - (1 - age) ** 1.4) * shard.dy * scale * particleTravel;
    const y = inset + travel;
    const fade = (1 - age) ** 1.35;
    const size = shard.size * scale * (1 - age * 0.54);
    if (atlas) {
      context.globalAlpha = fade;
      drawSpark(context, atlas, x, y, size * 4.1, age, seed);
      continue;
    }
    context.fillStyle = palette.color;
    context.globalAlpha = fade * 0.93;
    context.beginPath();
    context.moveTo(x - drift * age * 0.15 - size * 0.65, y - travel * 0.14);
    context.lineTo(x + size, y - line * 0.25);
    context.lineTo(x + size * 0.45, y + size);
    context.fill();
    context.globalAlpha = fade ** 1.8;
    if (halo) {
      const spread = size + haloRadius * 0.22;
      context.drawImage(halo, x - spread, y - spread, spread * 2, spread * 2);
    }
    context.fillStyle = emberCore;
    taperedStroke(context, x - size * 0.32, y, size * 1.14, size * 0.67);
  }
  if (outward) context.restore();
}

function drawEdge(context, { segments, length, inset, line, palette }) {
  context.lineCap = 'butt';
  context.strokeStyle = palette.color;
  context.beginPath();
  context.moveTo(inset, inset);
  context.lineTo(length - inset, inset);
  context.lineWidth = line * 0.9;
  context.globalAlpha = 0.18;
  context.stroke();
  for (const [index, spans] of segments.entries()) {
    context.beginPath();
    for (const [from, to] of spans) {
      context.moveTo(from, inset);
      context.lineTo(to, inset);
    }
    context.strokeStyle = palette.color;
    context.lineWidth = line;
    context.globalAlpha = [0.24, 0.76, 1][index];
    context.stroke();
    context.strokeStyle = index === 2 ? palette.highlight : palette.hot;
    context.lineWidth = line * 0.42;
    context.globalAlpha = [0.05, 0.32, 0.94][index];
    context.stroke();
  }
  context.globalAlpha = 1;
}

/** Keep the luminance-based border bloom on static strips and animate cached light sprites above it. */
export class ChessFrameEffect {
  constructor(
    element,
    { color, inset = -CHESS_FRAME_OUTSET, strokeInset, getOutsetLimit, speed = 1 } = {},
  ) {
    this.element = element;
    this.getOutsetLimit = getOutsetLimit;
    this.speed = speed;
    this.strokeInset = strokeInset;
    element.style.inset = `${inset}px`;
    this.style = DEFAULT_CHESS_FRAME;
    this.palette = framePalette(color);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.intersecting = false;
    this.dirty = true;
    this.update = this.update.bind(this);
    this.tick = this.tick.bind(this);
    this.flashSeed = Math.floor(Math.random() * 4294967296);
    this.bloom = createFrameBloom(element, this.palette.bloom);
    this.edges = angles.map(() => {
      const canvas = document.createElement('canvas');
      const base = document.createElement('canvas');
      canvas.width = canvas.height = base.width = base.height = 1;
      for (const layer of [base, canvas])
        Object.assign(layer.style, { position: 'absolute', transformOrigin: '0 0' });
      element.append(base, canvas);
      return { canvas, base, context: canvas.getContext('2d'), cache: base.getContext('2d') };
    });
    this.resize = new ResizeObserver(() => this.update());
    this.resize.observe(element);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.intersecting = entry.isIntersecting;
      this.update();
    });
    this.intersection.observe(element);
    this.motion.addEventListener('change', this.update);
    document.addEventListener('visibilitychange', this.update);
    window.addEventListener(
      'pagehide',
      () => {
        cancelAnimationFrame(this.animation);
        this.resize.disconnect();
        this.intersection.disconnect();
        this.motion.removeEventListener('change', this.update);
        document.removeEventListener('visibilitychange', this.update);
      },
      { once: true },
    );
  }

  setAppearance(value) {
    const style = chessFrameAppearance(value);
    if (Object.keys(style).every((key) => style[key] === this.style[key])) return;
    this.style = style;
    this.dirty = true;
    this.update();
  }

  setVisible(visible) {
    if (this.element.hidden === !visible) return;
    this.element.hidden = !visible;
    this.update();
  }

  update() {
    cancelAnimationFrame(this.animation);
    const { clientWidth: width, clientHeight: height } = this.element;
    if (
      this.element.hidden ||
      document.hidden ||
      !this.intersecting ||
      Math.min(width, height) < 24
    )
      return;
    if (this.dirty || width !== this.width || height !== this.height) this.layout(width, height);
    for (const { canvas, base } of this.edges) {
      canvas.hidden = this.motion.matches;
      base.style.opacity = String((this.style.opacity / 100) * (this.motion.matches ? 1 : 0.72));
    }
    if (!this.motion.matches) {
      this.nextPaint = undefined;
      this.animation = requestAnimationFrame(this.tick);
    }
  }

  layout(width, height) {
    this.width = width;
    this.height = height;
    this.dirty = false;
    const side = Math.min(width, height);
    const scale = Math.max(0.62, Math.min(1.35, side / 270));
    const inset = this.strokeInset ?? Math.max(2, Math.min(4.5, side * 0.012));
    const line = (0.48 + this.style.width * 0.21) * scale;
    const { glow, detail, particlesOutward } = this.style;
    const boost = (Math.max(0, glow - 4) / 26) ** 1.3;
    const nearGlow = Math.min(4, glow);
    const nearRadius = (0.7 + nearGlow * 0.85 + boost * 2.1) * scale;
    const wideRadius = boost ? (4.5 + boost * 13.5) * scale : 0;
    // Enlarge the highlights before blurring so a strong halo doesn't amplify
    // quantization in the low-alpha tail of the blur.
    this.bloom.nearBlur.setAttribute('stdDeviation', String(nearRadius));
    this.bloom.nearGain.setAttribute('slope', String(2.7 + nearGlow * 0.28 + boost * 3.2));
    this.bloom.wideSpread.setAttribute('radius', String(boost * 3.25 * scale));
    this.bloom.wideBlur.setAttribute('stdDeviation', String(wideRadius));
    this.bloom.wideGain.setAttribute('slope', String(boost * 6.5));
    const quality = qualityLevels[detail - 1];
    if (detail >= 3) this.sparkAtlas = getSparkAtlas(this.palette.color, glow / 30);
    if (glow) this.halo ??= makeHalo(this.palette.color);
    const haloPadding = glow ? Math.ceil(Math.max(nearRadius * 2, wideRadius * 2.75)) : 0;
    const particleDepth = (detail >= 4 ? 43 : 33) * scale;
    const outsetLimit = this.getOutsetLimit?.() ?? Infinity;
    const outset = Math.max(
      0,
      Math.min(
        outsetLimit,
        CHESS_FRAME_OUTER_PADDING - CHESS_FRAME_OUTSET,
        Math.ceil(Math.max(line, haloPadding + (particlesOutward ? particleDepth : 0)) - inset),
      ),
    );
    // Paint past the corners and fade the far edge when the host has a finite gutter.
    const edgePadding = this.getOutsetLimit ? outset : 0;
    const particleTravel =
      edgePadding && particlesOutward
        ? Math.min(1, Math.max(0, (outset + inset - 8 * scale) / particleDepth))
        : 1;
    const inside = Math.min(
      side / 2,
      Math.ceil(inset + (particlesOutward ? line * 2 : particleDepth) + haloPadding),
    );
    const depth = inside + outset;
    for (const [index, edge] of this.edges.entries()) {
      const length = index % 2 ? height : width;
      const paintLength = length + edgePadding * 2;
      const ratio = Math.min(
        Math.max(devicePixelRatio, quality.samples),
        quality.samples * 1.5,
        quality.maxEdge / paintLength,
      );
      edge.geometry = {
        ...edgePattern(length, inset, index, quality),
        length,
        inset,
        line,
        scale,
        detail,
        particleTravel,
        edge: index,
        palette: this.palette,
        haloRadius: Math.max(nearRadius * 2.4, wideRadius * 2.1),
      };
      const { canvas, base, cache } = edge;
      const placement = {
        left: `${index === 1 || index === 2 ? width : 0}px`,
        top: `${index >= 2 ? height : 0}px`,
        width: `${paintLength}px`,
        height: `${depth}px`,
        transform: `rotate(${angles[index]}deg) translate(${-edgePadding}px, ${-outset}px)`,
        maskImage: edgePadding ? `linear-gradient(transparent, black ${outset * 0.55}px)` : '',
      };
      Object.assign(base.style, placement, { filter: glow ? this.bloom.filter : 'none' });
      Object.assign(canvas.style, placement, { opacity: String(this.style.opacity / 100) });
      base.width = Math.min(quality.maxEdge, Math.ceil(paintLength * ratio));
      const depthLimit = quality.maxDepth * (particlesOutward ? 1.5 : 1);
      base.height = Math.min(depthLimit, Math.ceil(depth * ratio));
      // Moving sparks have soft edges. A smaller backing store reduces per-frame uploads.
      const movingRatio = Math.min(ratio, 1.5);
      canvas.width = Math.min(quality.maxEdge, Math.ceil(paintLength * movingRatio));
      canvas.height = Math.min(depthLimit, Math.ceil(depth * movingRatio));
      const yScale = canvas.height / depth;
      const xScale = canvas.width / paintLength;
      edge.transform = [xScale, 0, 0, yScale, edgePadding * xScale, outset * yScale];
      if (cache) {
        const bx = base.width / paintLength;
        const by = base.height / depth;
        cache.setTransform(bx, 0, 0, by, edgePadding * bx, outset * by);
        drawEdge(cache, edge.geometry);
      }
    }
  }

  paint(now) {
    const atlas = this.style.detail >= 3 ? this.sparkAtlas : null;
    const halo = this.style.glow ? this.halo : null;
    const flashes = chessFrameFlashes(now, flashCount, this.flashSeed);
    for (const { canvas, context, geometry, transform } of this.edges) {
      if (!context) continue;
      context.resetTransform();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(...transform);
      drawStreaks(context, geometry, now, halo);
      drawFlashes(context, geometry, flashes, halo);
      drawEmbers(context, geometry, atlas, halo, now, this.style.particlesOutward);
      context.globalAlpha = 1;
    }
  }

  tick(now) {
    if (
      this.element.hidden ||
      document.hidden ||
      !this.element.isConnected ||
      !this.intersecting ||
      this.motion.matches
    )
      return;
    this.nextPaint ??= now;
    if (now + 1 >= this.nextPaint) {
      this.paint(now * this.speed);
      const intervals = Math.max(1, Math.floor((now - this.nextPaint) / frameInterval) + 1);
      this.nextPaint += intervals * frameInterval;
    }
    this.animation = requestAnimationFrame(this.tick);
  }
}
