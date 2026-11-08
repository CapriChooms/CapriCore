// SPDX-License-Identifier: GPL-3.0-only
export class StartupPanel {
  constructor(ui) {
    this.ui = ui;
    this.panel = document.createElement('aside');
    this.panel.id = 'startup-progress';
    this.panel.dataset.hitRegion = '';
    this.panel.setAttribute('role', 'status');
    this.panel.innerHTML =
      '<strong>CAPRI <small>pre-alpha</small></strong><p></p><progress max="100" value="0"></progress><small class="startup-eta"></small>';
    document.getElementById('companion').append(this.panel);
    this.timer = setInterval(() => this.render(), 500);
  }
  update(value) {
    this.value = value;
    this.render();
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
    this.panel.querySelector('p').textContent =
      running.map((s) => this.ui.text(names[s.id])).join(' · ') ||
      this.ui.text('Starting local core…');
    const progress = this.panel.querySelector('progress');
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
