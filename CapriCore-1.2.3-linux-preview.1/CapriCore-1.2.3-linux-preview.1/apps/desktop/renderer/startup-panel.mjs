// SPDX-License-Identifier: GPL-3.0-only
export class StartupPanel {
  constructor(ui) {
    this.ui = ui;
    this.panel = document.getElementById('startup-progress');
    this.toggle = this.panel.querySelector('button');
    this.details = document.getElementById('startup-details');
    this.toggle.addEventListener('click', () => this.setExpanded(this.details.hidden));
  }
  setExpanded(expanded) {
    this.details.hidden = !expanded;
    this.toggle.setAttribute('aria-expanded', String(expanded));
  }
  update(value) {
    this.value = value;
    this.render();
    if (this.panel.hidden) {
      clearInterval(this.timer);
      this.timer = null;
      this.setExpanded(false);
    } else {
      this.timer ??= setInterval(() => this.render(), 500);
    }
  }
  render(now = Date.now()) {
    const value = this.value;
    if (!value || !value.stages.length) {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = value.finished;
    if (value.finished) return;
    const names = {
      core: 'Starting local core…',
      models: 'Preparing language models…',
      recognition: 'Preparing speech recognition…',
      voice: 'Preparing Capri’s voice…',
    };
    let complete = 0,
      remaining = 0;
    const running = [];
    let overdue = false;
    for (const stage of value.stages) {
      if (['ready', 'failed'].includes(stage.state)) complete++;
      else if (stage.state === 'running') {
        running.push(stage);
        const elapsed = Math.max(0, (now - stage.started) / 1000);
        complete += Math.min(0.9, elapsed / stage.estimate);
        remaining = Math.max(remaining, stage.estimate - elapsed);
        overdue ||= elapsed >= stage.estimate;
      }
    }
    const summary = this.panel.querySelector('.startup-summary');
    const status =
      running.map((s) => this.ui.text(names[s.id])).join(' · ') ||
      this.ui.text('Starting local core…');
    if (summary.textContent !== status) summary.textContent = status;
    const progress = this.panel.querySelector('progress');
    progress.setAttribute('aria-label', this.ui.text('Startup'));
    // A waiting stage has no running clock. Its full estimate would pin the
    // countdown while another stage runs, including after that stage overruns.
    const hasEstimate = running.length > 0 && !overdue;
    if (hasEstimate) progress.value = Math.min(98, (complete / value.stages.length) * 100);
    else progress.removeAttribute('value');
    this.panel.querySelector('.startup-eta').textContent = hasEstimate
      ? this.ui.text('Estimated remaining: {seconds} s', { seconds: Math.ceil(remaining) })
      : this.ui.text('Still preparing. First startup may take longer.');
  }
}
