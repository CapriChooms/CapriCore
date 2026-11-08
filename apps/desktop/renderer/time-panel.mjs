// SPDX-License-Identifier: GPL-3.0-only
const MAX_SECONDS = 366 * 86400;
const units = [
  {
    name: 'Hours',
    id: 'hours',
    increase: 'Increase hours',
    decrease: 'Decrease hours',
    multiplier: 3600,
    maximum: MAX_SECONDS / 3600,
  },
  {
    name: 'Minutes',
    id: 'minutes',
    increase: 'Increase minutes',
    decrease: 'Decrease minutes',
    multiplier: 60,
    maximum: 59,
  },
  {
    name: 'Seconds',
    id: 'seconds',
    increase: 'Increase seconds',
    decrease: 'Decrease seconds',
    multiplier: 1,
    maximum: 59,
  },
];
const duration = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};
export class TimePanel {
  constructor({ api, ui, onOpen, onError }) {
    Object.assign(this, { api, ui, onOpen, onError });
    this.panel = document.getElementById('time-panel');
    const dials = document.getElementById('time-duration');
    this.dials = units.map(({ name, id, increase, decrease, multiplier, maximum }) => {
      const dial = document.createElement('div');
      dial.className = 'time-dial';
      const input = document.createElement('input');
      Object.assign(input, { id: 'time-' + id, type: 'number', min: 0, max: maximum, step: 1 });
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = name;
      const step = (delta) => this.setDuration(this.readDuration() + delta * multiplier);
      const arrow = (delta) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = delta > 0 ? '▲' : '▼';
        button.setAttribute('aria-label', delta > 0 ? increase : decrease);
        button.onclick = () => step(delta);
        return button;
      };
      dial.addEventListener(
        'wheel',
        (event) => {
          if (input.disabled || !event.deltaY || event.ctrlKey) return;
          event.preventDefault();
          step(event.deltaY < 0 ? 1 : -1);
        },
        { passive: false },
      );
      input.addEventListener('blur', () => {
        if (input.validity.valid) this.setDuration(this.readDuration());
      });
      dial.append(label, arrow(1), input, arrow(-1));
      dials.append(dial);
      return input;
    });
    this.setDuration(300);
    document.getElementById('time-close').onclick = () => this.open(false);
    document.getElementById('time-create').onclick = () => {
      const action = document.getElementById('time-kind').value;
      const title = document.getElementById('time-title').value.trim();
      if (action !== 'stopwatch' && !this.dials.every((dial) => dial.reportValidity())) return;
      const seconds = this.readDuration();
      void this.action({ action, title, ...(action === 'stopwatch' ? {} : { seconds }) });
    };
    document.getElementById('time-kind').onchange = () => {
      const disabled = document.getElementById('time-kind').value === 'stopwatch';
      for (const control of dials.querySelectorAll('input, button')) control.disabled = disabled;
    };
    this.timer = setInterval(() => {
      if (!this.panel.hidden) void this.refresh();
    }, 1000);
  }
  readDuration() {
    return this.dials.reduce(
      (seconds, dial, i) => seconds + (Number(dial.value) || 0) * units[i].multiplier,
      0,
    );
  }
  setDuration(seconds) {
    let remaining = Math.max(0, Math.min(MAX_SECONDS, Math.round(seconds)));
    this.dials.forEach((input, i) => {
      const { multiplier } = units[i];
      input.value = String(Math.floor(remaining / multiplier)).padStart(2, '0');
      remaining %= multiplier;
    });
  }
  async action(args) {
    try {
      await this.api.timeAction(args);
      await this.refresh();
    } catch (error) {
      this.onError(error.message);
    }
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.show(await this.api.timeStatus());
    } catch (error) {
      this.onError(error.message);
    } finally {
      this.refreshing = false;
    }
  }
  show(objects) {
    const list = document.getElementById('time-list');
    list.replaceChildren();
    for (const object of objects
      .filter((o) => !['cancelled', 'acknowledged'].includes(o.state))
      .slice(0, 100)) {
      const card = document.createElement('article');
      card.className = 'action-entry';
      const label = document.createElement('strong');
      if (object.title) label.dataset.untranslated = '';
      label.textContent =
        object.title ||
        this.ui.text(
          object.kind === 'stopwatch'
            ? 'Stopwatch'
            : object.kind === 'timer'
              ? 'Timer'
              : 'Reminder',
        );
      const status = document.createElement('p');
      status.textContent =
        this.ui.text(
          object.state === 'due' ? 'Due now' : object.state === 'paused' ? 'Paused' : 'Running',
        ) +
        ' · ' +
        duration(object.kind === 'stopwatch' ? object.elapsedMs : (object.remainingMs ?? 0));
      if (object.kind === 'reminder')
        status.textContent +=
          ' · ' +
          new Intl.DateTimeFormat(this.ui.language, {
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(object.dueAt);
      const buttons = document.createElement('div');
      buttons.className = 'settings-actions';
      if (object.kind === 'stopwatch' && this.api.selectStopwatch) {
        const select = document.createElement('button');
        select.textContent = this.ui.text('Show on companion');
        select.onclick = () =>
          this.api.selectStopwatch(object.id).catch((error) => this.onError(error.message));
        buttons.append(select);
      }
      if (object.state === 'due' && this.api.retryReminder) {
        const speak = document.createElement('button');
        speak.textContent = this.ui.text('Speak reminder');
        speak.onclick = () =>
          this.api.retryReminder(object.id).catch((error) => this.onError(error.message));
        buttons.append(speak);
      }
      for (const action of [
        ...(object.kind !== 'reminder' && ['running', 'paused'].includes(object.state)
          ? [object.state === 'running' ? 'pause' : 'resume']
          : []),
        ...(object.state === 'due' && object.kind !== 'stopwatch' ? ['snooze'] : []),
        'cancel',
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = this.ui.text(
          { pause: 'Pause', resume: 'Resume', cancel: 'Dismiss', snooze: 'Snooze 5 minutes' }[
            action
          ],
        );
        button.onclick = () => this.action({ action, id: object.id });
        buttons.append(button);
      }
      card.append(label, status, buttons);
      list.append(card);
    }
    if (!list.childElementCount) {
      const empty = document.createElement('p');
      empty.textContent = this.ui.text('No active timers or reminders.');
      list.append(empty);
    }
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (open) await this.refresh();
  }
}
