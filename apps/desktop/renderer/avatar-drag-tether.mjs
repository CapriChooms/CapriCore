// SPDX-License-Identifier: GPL-3.0-only

const svgNamespace = 'http://www.w3.org/2000/svg';
const format = ({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`;
const line = (from, to) => `M${format(from)}L${format(to)}`;
const normalized = (value) => Math.min(1, Math.max(0, value / 100));
const mix = (a, b, t) => a + (b - a) * t;

function noise(seed, index) {
  const mixed = Math.imul(seed ^ Math.imul(index, 0x9e3779b1), 0x85ebca6b);
  return ((mixed ^ (mixed >>> 13)) >>> 0) / 0x100000000;
}

/** Coordinates are in CSS pixels. A single clock and seed keep display slices aligned. */
export function dragLightningGeometry({ from, to, intensity, chaos = 55, seed = 0 }, now, reduced) {
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
  let embers = '';
  let sparks = '';
  const sparkCount = Math.min(72, Math.ceil((6 + distance / 12) * density * (reduced ? 0.3 : 1)));
  for (let i = 0; i < sparkCount; i++) {
    const offset = 500 + i * 11;
    const t = mix(0.045, 0.95, noise(seed, offset));
    const side = noise(seed, offset + 1) < 0.5 ? -1 : 1;
    const duration = mix(0.19, 0.68, noise(seed, offset + 2));
    const life = (time / duration + noise(seed, offset + 3)) % 1;
    const drift = mix(4, 33, disorder * noise(seed, offset + 4));
    const travel = (0.15 + life * 0.85) * drift * side;
    const tip = spine(Math.min(1, t + life * Math.min(0.04, 11 / distance)), travel);
    const length = (reduced ? 1.5 : 0.7 + Math.sin(life * Math.PI) * 3.8) * (1 - life * 0.55);
    const slash = line(tip, {
      x: tip.x - (dx / distance) * length - nx * side * length * 0.42,
      y: tip.y - (dy / distance) * length - ny * side * length * 0.42,
    });
    if (i % 4 === 0) sparks += slash;
    else embers += slash;
  }
  return { bolt, branches, sparks, embers, sparkCount, branchCount };
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
      ['bolt', '#ff164b', 8, 0.13],
      ['bolt', '#fa174a', 4, 0.29],
      ['branches', '#ff1946', 1.0, 0.64],
      ['bolt', '#ff3e5c', 1.45, 0.98],
      ['embers', '#fa234b', 1.5, 0.63],
      ['sparks', '#ff7587', 1.7, 0.95],
    ].map(([key, color, width, opacity]) => {
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linejoin', 'bevel');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', width);
      path.setAttribute('opacity', opacity);
      this.group.append(path);
      return { key, path };
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
    if (!this.frame) this.paint();
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
