// SPDX-License-Identifier: GPL-3.0-only
export function stopwatchText(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
/** Visual interpolation only; the service remains authoritative across pause/restart. */
export class StopwatchHUD {
  constructor({
    element,
    api,
    ui = { text: (value) => value },
    now = () => performance.now(),
    onChange = () => {},
    onError = () => {},
    confirm,
  }) {
    Object.assign(this, { element, api, ui, now, onChange, onError, confirm });
    try {
      this.selected = localStorage.getItem('capri.stopwatch.selected');
    } catch {
      /* Optional preference. */
    }
    this.controls = document.getElementById('stopwatch-controls');
    element.setAttribute('aria-controls', 'stopwatch-controls');
    element.onclick = () => this.open(this.controls.hidden);
    document.getElementById('stopwatch-close').onclick = () => this.open(false);
    document.getElementById('stopwatch-all').onclick = () => {
      this.open(false);
      void api.openSettings('time');
    };
    document.getElementById('stopwatch-toggle').onclick = () =>
      this.action(this.object?.state === 'running' ? 'pause' : 'resume');
    document.getElementById('stopwatch-stop').onclick = () => this.action('cancel');
    document.getElementById('stopwatch-reset').onclick = async () => {
      if (
        (await this.confirm?.({
          title: 'Reset stopwatch?',
          detail: 'Elapsed time will return to zero.',
          confirmLabel: 'Reset',
          danger: true,
        })) === 'confirm'
      )
        await this.action('reset');
    };
    document.addEventListener('pointerdown', (event) => {
      if (
        !this.controls.hidden &&
        !document.querySelector('dialog[open]') &&
        !this.controls.contains(event.target) &&
        !element.contains(event.target)
      )
        this.open(false);
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key === 'Escape' &&
          !this.controls.hidden &&
          !document.querySelector('dialog[open]')
        ) {
          event.stopPropagation();
          this.open(false);
        }
      },
      { capture: true },
    );
    this.timer = setInterval(() => {
      if (!document.hidden) this.draw();
    }, 250);
    this.sync = setInterval(() => {
      if (!document.hidden) this.refresh();
    }, 10000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refresh();
    });
  }
  open(open) {
    this.controls.hidden = !open;
    this.element.setAttribute('aria-expanded', String(open));
    this.draw();
    this.onChange();
  }
  async action(action) {
    if (!this.object || this.acting) return;
    this.acting = true;
    const id = this.object.id;
    for (const button of this.controls.querySelectorAll('button')) button.disabled = true;
    try {
      await this.api.timeAction({ action, id });
      await this.refresh();
      if (action === 'cancel') this.open(false);
    } catch (error) {
      this.onError(error.message);
    } finally {
      this.acting = false;
      for (const button of this.controls.querySelectorAll('button')) button.disabled = false;
    }
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.show(await this.api.timeStatus());
    } catch {
      /* Next visibility/sync retries. */
    } finally {
      this.refreshing = false;
    }
  }
  show(objects) {
    const clocks = objects.filter(
      (o) => o.kind === 'stopwatch' && ['running', 'paused'].includes(o.state),
    );
    this.object = clocks.find((o) => o.id === this.selected) ?? clocks[0];
    this.selected = this.object?.id;
    this.received = this.now();
    this.count = clocks.length;
    this.persistSelection();
    this.draw();
  }
  draw() {
    const o = this.object;
    const visibilityChanged = this.element.hidden !== !o;
    this.element.hidden = !o;
    if (!o) {
      const wasOpen = !this.controls.hidden;
      this.controls.hidden = true;
      this.element.setAttribute('aria-expanded', 'false');
      if (wasOpen || visibilityChanged) this.onChange();
      return;
    }
    const ms = o.elapsedMs + (o.state === 'running' ? Math.max(0, this.now() - this.received) : 0);
    this.element.textContent = stopwatchText(ms);
    this.element.dataset.running = String(o.state === 'running');
    this.element.title =
      (o.title || this.ui.text('Stopwatch')) +
      ' · ' +
      this.ui.text(o.state === 'running' ? 'Running' : 'Paused') +
      (this.count > 1 ? ' +' + (this.count - 1) : '');
    this.element.setAttribute('aria-label', this.ui.text('Stopwatch controls'));
    if (!this.controls.hidden) {
      document.getElementById('stopwatch-controls-title').textContent =
        o.title || this.ui.text('Stopwatch');
      document.getElementById('stopwatch-toggle').textContent = this.ui.text(
        o.state === 'running' ? 'Pause' : 'Resume',
      );
    }
    if (visibilityChanged) this.onChange();
  }
  select(id) {
    this.selected = id;
    this.persistSelection();
    void this.refresh();
  }
  persistSelection() {
    try {
      if (this.selected) localStorage.setItem('capri.stopwatch.selected', this.selected);
      else localStorage.removeItem('capri.stopwatch.selected');
    } catch {
      /* Optional preference. */
    }
  }
  destroy() {
    clearInterval(this.timer);
    clearInterval(this.sync);
  }
}
