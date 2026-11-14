// SPDX-License-Identifier: GPL-3.0-only
const MAX_SECONDS = 366 * 86400;
const clampDuration = (seconds) => Math.max(0, Math.min(MAX_SECONDS, Math.round(seconds)));
const offsets = [-3, -2, -1, 0, 1, 2, 3];
const translate = (rows) => `translateY(${(rows * 100) / offsets.length}%)`;
const digits = (number) => String(number).padStart(2, '0');
const units = [
  {
    name: 'Hours',
    id: 'hours',
    multiplier: 3600,
    maximum: MAX_SECONDS / 3600,
  },
  {
    name: 'Minutes',
    id: 'minutes',
    multiplier: 60,
    maximum: 59,
  },
  {
    name: 'Seconds',
    id: 'seconds',
    multiplier: 1,
    maximum: 59,
  },
];
const unitValue = (seconds, { multiplier, maximum }) =>
  Math.floor(seconds / multiplier) % (maximum + 1);

function durationDial(unit, panel) {
  const { name, id, maximum } = unit;
  const dial = document.createElement('div');
  dial.className = 'time-dial';
  const input = document.createElement('input');
  Object.assign(input, { id: 'time-' + id, type: 'number', min: 0, max: maximum, step: 1 });
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = name;
  const reel = document.createElement('div');
  reel.className = 'time-dial-reel';
  const track = document.createElement('div');
  track.className = 'time-dial-track';
  track.setAttribute('aria-hidden', 'true');
  track.dataset.untranslated = '';
  const rows = offsets.map(() => track.appendChild(document.createElement('span')));
  reel.append(track, input);
  dial.append(label, reel);

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const range = maximum + 1;
  const wrap = (value) => ((value % range) + range) % range;
  const read = () => Math.max(0, Math.min(maximum, Math.round(Number(input.value) || 0)));
  let drag, motion, shown, coastFrame;
  let offset = 0;
  function stopMotion() {
    motion?.cancel();
    motion = undefined;
    cancelAnimationFrame(coastFrame);
    coastFrame = undefined;
    offset = 0;
    track.style.transform = '';
    delete reel.dataset.rolling;
  }
  function settle(from) {
    stopMotion();
    if (!from || reducedMotion.matches) return;
    reel.dataset.rolling = '';
    motion = track.animate([{ transform: translate(from) }, { transform: translate(0) }], {
      duration: 175,
      easing: 'cubic-bezier(.22,.72,.25,1)',
    });
    motion.onfinish = () => {
      motion = undefined;
      delete reel.dataset.rolling;
    };
  }
  function paint(value) {
    if (shown === value) return;
    shown = value;
    for (const [index, row] of offsets.entries())
      rows[index].textContent = digits(wrap(value + row));
  }
  function setValue(value) {
    const text = digits(value);
    if (input.value !== text) input.value = text;
    paint(value);
  }
  function set(value, direction = 0) {
    const changed = value !== shown;
    setValue(value);
    settle(changed ? direction : 0);
  }
  function position(start, travel) {
    const nearest = Math.round(travel);
    const value = wrap(start + nearest);
    if (value !== shown) {
      setValue(value);
      panel.tick();
    }
    offset = nearest - travel;
    track.style.transform = translate(offset);
  }
  function coast({ start, travel, samples }, releasedAt) {
    const last = samples.at(-1);
    const first = samples[0];
    if (reducedMotion.matches || releasedAt - last.time > 85 || last === first) return false;
    const speed = Math.max(
      -0.06,
      Math.min(0.06, (last.travel - first.travel) / Math.max(16, last.time - first.time)),
    );
    if (Math.abs(speed) < 0.006) return false;
    const duration = Math.min(800, 190 + Math.abs(speed) * 9800);
    const target = Math.round(travel + (speed * duration) / 3);
    if ((target - travel) * speed <= 0) return false;
    reel.dataset.rolling = '';
    const startedAt = performance.now();
    const frame = (now) => {
      if (input.disabled || panel.panel.hidden || reducedMotion.matches) {
        stopMotion();
        return;
      }
      const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const eased = 1 - (1 - progress) ** 3;
      position(start, travel + (target - travel) * eased);
      if (progress < 1) coastFrame = requestAnimationFrame(frame);
      else stopMotion();
    };
    coastFrame = requestAnimationFrame(frame);
    return true;
  }
  const step = (delta) => set(wrap(read() + delta), Math.sign(delta));
  dial.addEventListener(
    'wheel',
    (event) => {
      if (input.disabled || drag || !event.deltaY || event.ctrlKey) return;
      event.preventDefault();
      step(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    step(event.key === 'ArrowUp' ? 1 : -1);
  });
  input.addEventListener('input', () => {
    stopMotion();
    if (input.validity.valid) paint(read());
  });
  input.addEventListener('blur', () => {
    if (input.validity.valid) setValue(read());
  });
  reel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag || input.disabled) return;
    event.preventDefault();
    const travel = -offset;
    stopMotion();
    const bounds = reel.getBoundingClientRect();
    drag = {
      pointer: event.pointerId,
      y: event.clientY,
      row: bounds.height / 5,
      middle: bounds.top + bounds.height / 2,
      start: read(),
      origin: travel,
      travel,
      samples: [{ time: event.timeStamp, travel }],
    };
    position(drag.start, travel);
    reel.setPointerCapture(event.pointerId);
  });
  function move(event) {
    const distance = drag.y - event.clientY;
    if (Math.abs(distance) < 4 && !reel.hasAttribute('data-dragging')) return;
    reel.dataset.dragging = '';
    const travel = drag.origin + distance / drag.row;
    if (travel === drag.travel) return;
    drag.travel = travel;
    drag.samples = drag.samples.filter(({ time }) => event.timeStamp - time <= 105);
    drag.samples.push({ time: event.timeStamp, travel });
    position(drag.start, travel);
  }
  reel.addEventListener('pointermove', (event) => {
    if (event.pointerId === drag?.pointer) move(event);
  });
  const endDrag = (event) => {
    if (event.pointerId !== drag?.pointer) return;
    if (event.type === 'pointerup') move(event);
    const gesture = drag;
    drag = undefined;
    if (reel.hasAttribute('data-dragging')) {
      delete reel.dataset.dragging;
      if (event.type !== 'pointerup' || !coast(gesture, event.timeStamp)) settle(offset);
    } else if (event.type === 'pointerup') {
      const selected = Math.round((event.clientY - gesture.middle) / gesture.row);
      if (selected) step(selected);
      else {
        stopMotion();
        input.focus({ preventScroll: true });
        input.select();
      }
    } else {
      stopMotion();
    }
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    reel.addEventListener(event, endDrag);
  return { dial, input, set, stopMotion };
}

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
    this.dials = units.map((unit) => durationDial(unit, this));
    dials.append(...this.dials.map(({ dial }) => dial));
    const kind = document.getElementById('time-kind');
    const presets = document.getElementById('time-presets');
    for (const button of presets.querySelectorAll('button'))
      button.onclick = () => {
        const seconds = Number(button.dataset.seconds);
        this.setDuration(seconds, Math.sign(seconds - this.readDuration()));
      };
    this.setDuration(300);
    document.getElementById('time-close').onclick = () => this.open(false);
    document.getElementById('time-create').onclick = () => {
      const action = kind.value;
      const title = document.getElementById('time-title').value.trim();
      if (action !== 'stopwatch' && !this.dials.every(({ input }) => input.reportValidity()))
        return;
      for (const dial of this.dials) dial.stopMotion();
      const seconds = this.readDuration();
      void this.action({ action, title, ...(action === 'stopwatch' ? {} : { seconds }) });
    };
    kind.onchange = () => {
      const disabled = kind.value === 'stopwatch';
      dials.hidden = presets.hidden = disabled;
      for (const dial of this.dials) {
        if (disabled) dial.stopMotion();
        dial.input.disabled = disabled;
      }
    };
    this.timer = setInterval(() => {
      if (!this.panel.hidden) void this.refresh();
    }, 1000);
  }
  readDuration() {
    return this.dials.reduce(
      (seconds, { input }, i) => seconds + (Number(input.value) || 0) * units[i].multiplier,
      0,
    );
  }
  tick() {
    if (!globalThis.AudioContext) return;
    const audio = (this.tickAudio ??= new AudioContext());
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    const now = audio.currentTime;
    if (now < (this.nextTick ?? 0)) return;
    this.nextTick = now + 0.035;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.frequency.setValueAtTime(720, now);
    oscillator.frequency.exponentialRampToValueAtTime(280, now + 0.023);
    volume.gain.setValueAtTime(0.027, now);
    volume.gain.exponentialRampToValueAtTime(0.001, now + 0.024);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      volume.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + 0.025);
  }
  setDuration(seconds, direction = 0) {
    seconds = clampDuration(seconds);
    this.dials.forEach(({ set }, i) => set(unitValue(seconds, units[i]), direction));
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
