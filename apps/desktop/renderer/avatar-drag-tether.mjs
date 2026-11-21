// SPDX-License-Identifier: GPL-3.0-only
import { sparkPalette, SPARK_SHAPES } from './spark-atlas.mjs';
import { TELEPORT_LIGHTNING_DEFAULTS } from './teleport-effects.mjs';

const svgNamespace = 'http://www.w3.org/2000/svg';
const format = ({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`;
const normalized = (value) => Math.min(1, Math.max(0, value / 100));
const mix = (a, b, t) => a + (b - a) * t;

function noise(seed, index) {
  const mixed = Math.imul(seed ^ Math.imul(index, 0x9e3779b1), 0x85ebca6b);
  return ((mixed ^ (mixed >>> 13)) >>> 0) / 0x100000000;
}

function shardPath(points, center, axis, side, size) {
  const scale = size / 48;
  const path = points.map(([x, y]) => {
    const along = (x - 24) * scale;
    const across = (y - 24) * scale * side;
    return format({
      x: center.x + axis.x * along - axis.y * across,
      y: center.y + axis.y * along + axis.x * across,
    });
  });
  return `M${path.join('L')}Z`;
}

/** Coordinates are in CSS pixels. A single clock and seed keep display slices aligned. */
export function dragLightningGeometry(
  { from, to, intensity, chaos = 55, seed = 0, effects },
  now,
  reduced,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 1 || !Number.isFinite(intensity) || intensity <= 0)
    return null;
  const density = normalized(intensity);
  const disorder = normalized(chaos);
  const time = reduced ? 0 : now / 1000;
  const pieces = Math.min(42, Math.max(4, Math.ceil(distance / 24)));
  const spread = Math.min(19, distance * 0.14) * mix(0.15, 1, disorder);
  const nx = -dy / distance;
  const ny = dx / distance;
  const point = (t, offset = 0) => ({
    x: from.x + dx * t + nx * offset,
    y: from.y + dy * t + ny * offset,
  });
  const nodes = [from];
  for (let i = 1; i < pieces; i++) {
    const t = i / pieces;
    const wobble = reduced ? 0 : 0.23 * Math.sin(time * 11 + i * 1.92);
    const bend = (noise(seed, i) * 1.6 - 0.8 + wobble) * spread * Math.sin(t * Math.PI);
    nodes.push(point(t, bend));
  }
  nodes.push(to);
  const spine = (t, offset) => {
    const i = Math.min(pieces - 1, Math.floor(t * pieces));
    const phase = t * pieces - i;
    return {
      x: mix(nodes[i].x, nodes[i + 1].x, phase) + nx * offset,
      y: mix(nodes[i].y, nodes[i + 1].y, phase) + ny * offset,
    };
  };
  const bolt = `M${nodes.map(format).join('L')}`;
  let branches = '';
  const branchCount = Math.min(19, Math.ceil((1 + distance / 115) * density * (reduced ? 1 : 2)));
  for (let i = 0; i < branchCount; i++) {
    const offset = 100 + i * 7;
    const t = mix(0.05, 0.94, noise(seed, offset));
    const side = noise(seed, offset + 1) < 0.5 ? -1 : 1;
    const reach = Math.min((1 - t) * 0.8, mix(8, 37, noise(seed, offset + 2)) / distance);
    const width = mix(3, 20, disorder * noise(seed, offset + 3));
    const branch = [
      spine(t, 0),
      spine(t + reach * 0.38, width * side * 0.7),
      spine(t + reach * 0.65, width * side * 0.53),
      spine(t + reach, width * side),
    ];
    branches += `M${branch.map(format).join('L')}`;
  }
  const {
    teleportSparkAmount = TELEPORT_LIGHTNING_DEFAULTS.teleportSparkAmount,
    teleportSparkTravel = TELEPORT_LIGHTNING_DEFAULTS.teleportSparkTravel,
    teleportReducedFlash = false,
  } = effects ?? {};
  let faintEmbers = '';
  let embers = '';
  let sparks = '';
  const quiet = reduced || teleportReducedFlash;
  const amount = normalized(teleportSparkAmount) / 0.65;
  const travel = normalized(teleportSparkTravel) / 0.55;
  const sparkCount = Math.min(
    72,
    Math.ceil(((6 + distance / 12) * density * amount * (quiet ? 0.3 : 1)) / 2) * 2,
  );
  for (let i = 0; i < sparkCount; i++) {
    const offset = 500 + i * 11;
    const t = mix(0.045, 0.95, noise(seed, offset));
    const side = i % 2 ? 1 : -1;
    const duration = mix(0.19, 0.68, noise(seed, offset + 2));
    const life = (time / duration + noise(seed, offset + 3)) % 1;
    const drift = mix(7, 34, noise(seed, offset + 4)) * mix(0.52, 1, disorder) * travel;
    const arm = (0.16 + life * 0.84) * drift * side;
    const along = Math.min(0.97, t + life * Math.min(0.04, 11 / distance));
    const before = spine(along - 0.023, 0);
    const after = spine(along + 0.023, 0);
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    const axis = { x: (after.x - before.x) / length, y: (after.y - before.y) / length };
    const at = spine(along, 0);
    const center = { x: at.x - axis.y * arm, y: at.y + axis.x * arm };
    const size = mix(3.6, 10.8, noise(seed, offset + 5)) * (1 - life * 0.59);
    const shape = SPARK_SHAPES[Math.floor(noise(seed, offset + 6) * SPARK_SHAPES.length)];
    const ember = shardPath(shape, center, axis, side, size);
    if (life > 0.6) faintEmbers += ember;
    else {
      embers += ember;
      sparks += shardPath(shape, center, axis, side, size * 0.52);
    }
  }
  return { bolt, branches, sparks, embers, faintEmbers, sparkCount, branchCount };
}

export class AvatarDragTether {
  constructor() {
    this.svg = document.createElementNS(svgNamespace, 'svg');
    this.svg.classList.add('avatar-drag-lightning');
    this.svg.setAttribute('aria-hidden', 'true');
    Object.assign(this.svg.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '8',
      visibility: 'hidden',
    });
    const defs = document.createElementNS(svgNamespace, 'defs');
    const clip = document.createElementNS(svgNamespace, 'clipPath');
    clip.id = 'avatar-drag-lightning-clip';
    this.clip = document.createElementNS(svgNamespace, 'path');
    this.clip.setAttribute('clip-rule', 'evenodd');
    clip.append(this.clip);
    defs.append(clip);
    this.group = document.createElementNS(svgNamespace, 'g');
    this.paths = [
      ['bolt', 'halo', 8, 0.13],
      ['bolt', 'halo', 4, 0.29],
      ['branches', 'stroke', 1, 0.64],
      ['bolt', 'stroke', 1.45, 0.98],
      ['faintEmbers', 'ember', 0, 0.33],
      ['embers', 'ember', 0, 0.88],
      ['sparks', 'core', 0, 0.95],
    ].map(([key, role, width, opacity]) => {
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linejoin', 'bevel');
      path.setAttribute('stroke-linecap', 'round');
      this.group.append(path);
      return { key, path, role, width, opacity };
    });
    this.svg.append(defs, this.group);
    document.body.append(this.svg);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', () => this.value && this.draw(this.value));
  }

  draw(value) {
    if (!value || !value.from || !value.to || value.intensity <= 0) return this.clear();
    this.value = value;
    this.updateClip(value.exclude);
    this.applyAppearance(value.effects);
    if (!this.frame) this.paint();
  }

  applyAppearance({ teleportColor, teleportThickness, teleportGlow, teleportReducedFlash } = {}) {
    const color = teleportColor ?? TELEPORT_LIGHTNING_DEFAULTS.teleportColor;
    const thickness = (teleportThickness ?? TELEPORT_LIGHTNING_DEFAULTS.teleportThickness) / 100;
    const glow = (teleportGlow ?? TELEPORT_LIGHTNING_DEFAULTS.teleportGlow) / 45;
    const quiet = this.motion.matches || teleportReducedFlash === true;
    const key = `${color}/${thickness}/${glow}/${quiet}`;
    if (this.appearanceKey === key) return;
    this.appearanceKey = key;
    const palette = sparkPalette(
      color === TELEPORT_LIGHTNING_DEFAULTS.teleportColor ? undefined : color,
    );
    for (const { path, role, width, opacity } of this.paths) {
      if (role === 'ember' || role === 'core') {
        path.setAttribute('fill', role === 'core' ? palette.core[1] : palette.shard[1]);
        path.setAttribute('opacity', opacity * (quiet && role === 'core' ? 0.68 : 1));
        continue;
      }
      const halo = role === 'halo';
      path.setAttribute('stroke', halo ? color : palette.shard[2]);
      path.setAttribute('stroke-width', width * thickness * (halo ? Math.max(0.45, glow) : 1));
      path.setAttribute('opacity', Math.min(1, opacity * (halo ? glow * (quiet ? 0.5 : 1) : 1)));
    }
  }

  updateClip(exclude) {
    const key = exclude
      ? `${exclude.x},${exclude.y},${exclude.width},${exclude.height},${innerWidth},${innerHeight}`
      : '';
    if (key === this.clipKey) return;
    this.clipKey = key;
    if (!exclude) {
      this.group.removeAttribute('clip-path');
      return;
    }
    const { x, y, width, height } = exclude;
    this.clip.setAttribute(
      'd',
      `M0,0H${innerWidth}V${innerHeight}H0ZM${x},${y}h${width}v${height}h${-width}Z`,
    );
    this.group.setAttribute('clip-path', 'url(#avatar-drag-lightning-clip)');
  }

  paint() {
    this.frame = 0;
    const geometry = dragLightningGeometry(this.value, Date.now(), this.motion.matches);
    if (!geometry) return this.clear();
    for (const { key, path } of this.paths) path.setAttribute('d', geometry[key]);
    this.svg.style.visibility = 'visible';
    if (!this.motion.matches) this.frame = requestAnimationFrame(() => this.paint());
  }

  clear() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.value = null;
    this.svg.style.visibility = 'hidden';
  }
}
