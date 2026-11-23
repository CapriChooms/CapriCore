// SPDX-License-Identifier: GPL-3.0-only
/** Animate only genuine overflow. No measurement or JavaScript loop while text is moving. */
export class OverflowTicker {
  constructor(element) {
    this.element = element;
    if (!element.hasAttribute('dir')) element.dir = 'auto';
    this.copy = element.ownerDocument.createElement('span');
    this.copy.className = 'ticker-copy';
    this.copy.textContent = element.textContent;
    element.classList.add('overflow-ticker');
    element.replaceChildren(this.copy);
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(element);
    this.observer.observe(this.copy);
    this.schedule();
  }
  set(text) {
    if (this.copy.textContent === text) return;
    this.copy.textContent = text;
    this.element.title = text;
    this.element.dataset.overflow = 'false';
    this.schedule();
  }
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const distance = Math.max(0, this.copy.scrollWidth - this.element.clientWidth);
      this.element.dataset.overflow = String(this.element.clientWidth > 0 && distance > 1);
      this.element.style.setProperty('--ticker-distance', `${distance}px`);
      const rtl = getComputedStyle(this.element).direction === 'rtl';
      this.element.style.setProperty('--ticker-shift', `${rtl ? distance : -distance}px`);
      this.element.style.setProperty(
        '--ticker-duration',
        `${Math.min(40, Math.max(5, distance / 22 + 3))}s`,
      );
    });
  }
  destroy() {
    this.observer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}
