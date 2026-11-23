// SPDX-License-Identifier: GPL-3.0-only
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Keyed DOM/FLIP; never re-render the full overlay or intercept desktop input. */
export class ControlTaskChain {
  constructor(host) {
    this.host = host;
    this.nodes = new Map();
    this.completed = new Set();
    this.timers = new Map();
    this.revision = 0;
  }
  positions() {
    return new Map([...this.nodes].map(([id, node]) => [id, node.getBoundingClientRect()]));
  }
  animate(before) {
    if (reduced()) return;
    for (const [id, node] of this.nodes) {
      const old = before.get(id);
      node.getAnimations().forEach((animation) => animation.cancel());
      const now = node.getBoundingClientRect();
      node.animate(
        old
          ? [
              { transform: `translate(${old.left - now.left}px,${old.top - now.top}px)` },
              { transform: 'translate(0,0)' },
            ]
          : [
              { opacity: 0, transform: 'translateY(-8px) scale(.95)' },
              { opacity: 1, transform: 'none' },
            ],
        { duration: 330, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }
  update(value) {
    if (!value || !Array.isArray(value.steps) || value.steps.length > 16) return;
    if (!value.active) {
      this.clear();
      return;
    }
    const steps = value.steps.length
      ? value.steps
      : [
          {
            id: 'phase',
            label:
              {
                planning: 'Planning',
                observing: 'Observing',
                acting: 'Performing action',
                verifying: 'Verifying',
              }[value.phase] ?? 'Preparing task',
            state: 'active',
          },
        ];
    const signature = JSON.stringify([value.revision, Boolean(value.replanning), steps]);
    if (signature === this.signature) return; // phase polling must not restart the layout animation
    this.signature = signature;
    const before = this.positions();
    const wanted = new Set();
    for (const step of steps) {
      if (
        !step ||
        !/^[\w-]{1,32}$/.test(step.id) ||
        typeof step.label !== 'string' ||
        step.label.length > 120 ||
        !['active', 'pending', 'completed'].includes(step.state)
      )
        continue;
      if (this.completed.has(step.id) && !this.nodes.has(step.id)) continue;
      wanted.add(step.id);
      let node = this.nodes.get(step.id);
      if (!node) {
        node = document.createElement('li');
        node.className = 'control-task-step';
        node.dataset.id = step.id;
        const icon = document.createElement('span'),
          text = document.createElement('span');
        icon.className = 'task-step-icon';
        text.className = 'task-step-label';
        node.append(icon, text);
        this.nodes.set(step.id, node);
      }
      node.dataset.state = step.state;
      node.querySelector('.task-step-icon').textContent =
        step.state === 'completed' ? '✓' : step.state === 'active' ? '◈' : '◇';
      node.querySelector('.task-step-label').textContent = step.label;
      node.setAttribute('aria-current', step.state === 'active' ? 'step' : 'false');
      this.host.append(node);
      if (step.state === 'completed' && !this.completed.has(step.id)) {
        this.completed.add(step.id);
        this.timers.set(
          step.id,
          setTimeout(() => this.removeCompleted(step.id), reduced() ? 50 : 850),
        );
      }
    }
    for (const [id, node] of this.nodes)
      if (!wanted.has(id) && !this.completed.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    this.host.style.setProperty('--task-count', this.nodes.size);
    this.host.hidden = this.nodes.size === 0;
    this.host.dataset.replanning = String(
      value.replanning || (value.revision > this.revision && this.revision > 0),
    );
    this.revision = value.revision;
    this.animate(before);
  }
  removeCompleted(id) {
    const node = this.nodes.get(id);
    this.timers.delete(id);
    if (!node) return;
    const remove = () => {
      if (this.nodes.get(id) !== node) return;
      this.timers.delete(id);
      const before = this.positions();
      node.remove();
      this.nodes.delete(id);
      this.host.style.setProperty('--task-count', this.nodes.size);
      this.host.hidden = !this.nodes.size;
      this.animate(before);
    };
    if (reduced()) remove();
    else
      node.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(.86)' },
        ],
        { duration: 220, fill: 'forwards' },
      );
    if (!reduced()) this.timers.set(id, setTimeout(remove, 230));
  }
  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.nodes.clear();
    this.completed.clear();
    this.host.replaceChildren();
    this.host.hidden = true;
    this.revision = 0;
    this.signature = null;
  }
}
