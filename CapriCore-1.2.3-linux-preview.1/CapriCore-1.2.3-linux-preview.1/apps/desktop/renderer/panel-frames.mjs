/** Closed contours sit inside the clipped surface, including its diagonal cuts. */
export function panelPath(width, height, cut = 12, stroke = 2.5) {
  if (![width, height, cut, stroke].every(Number.isFinite) || width <= stroke || height <= stroke)
    return '';
  const inset = stroke / 2 + 0.35;
  const c = Math.max(0, Math.min(cut, width / 4, height / 3));
  if (!c) return `M${inset},${inset}H${width - inset}V${height - inset}H${inset}Z`;
  const diagonal = c + inset * (Math.SQRT2 - 1);
  return `M${diagonal},${inset}H${width - inset}V${height - diagonal}L${width - diagonal},${height - inset}H${inset}V${diagonal}Z`;
}

const NS = 'http://www.w3.org/2000/svg';
export class PanelFrames {
  constructor() {
    this.panels = new Map();
    this.observer = new ResizeObserver((entries) => {
      for (const { target } of entries) this.update(target);
    });
    for (const host of document.querySelectorAll('[data-panel-cut]')) {
      const svg = document.createElementNS(NS, 'svg');
      svg.classList.add('panel-frame');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      for (const name of [
        'panel-outline',
        'panel-accent',
        'panel-ghost-cyan',
        'panel-ghost-pink',
      ]) {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('class', name);
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(path);
      }
      host.append(svg);
      this.panels.set(host, svg);
      this.observer.observe(host);
      this.update(host);
    }
  }
  update(host) {
    const svg = this.panels.get(host),
      w = host.clientWidth,
      h = host.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, w)} ${Math.max(1, h)}`);
    const d = panelPath(w, h, Number(host.dataset.panelCut));
    for (const path of svg.children) path.setAttribute('d', d);
  }
  destroy() {
    this.observer.disconnect();
    for (const svg of this.panels.values()) svg.remove();
    this.panels.clear();
  }
}
