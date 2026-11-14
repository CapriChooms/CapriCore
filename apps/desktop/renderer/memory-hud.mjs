// SPDX-License-Identifier: GPL-3.0-only
export function memoryDisplay(sample) {
  const valid = (item) =>
    item &&
    Number.isFinite(item.totalBytes) &&
    item.totalBytes > 0 &&
    Number.isFinite(item.usedBytes) &&
    item.usedBytes >= 0 &&
    item.usedBytes <= item.totalBytes;
  const gpus = (sample?.gpus ?? []).filter(valid);
  const gpu = gpus.reduce(
    (best, item) =>
      !best || item.usedBytes / item.totalBytes > best.usedBytes / best.totalBytes ? item : best,
    null,
  );
  return { ram: valid(sample?.ram) ? sample.ram : null, gpu };
}

/** Capacity is a separate fact: a missing driver counter does not mean no GPU. */
export function dedicatedCapacity(sample) {
  return (sample?.gpus ?? []).reduce((best, item) => {
    const dedicated =
      item.memoryKind === 'dedicated' ||
      (item.memoryKind === undefined && item.vendor === 'nvidia');
    return dedicated &&
      Number.isFinite(item.totalBytes) &&
      item.totalBytes > 0 &&
      (!best || item.totalBytes > best.totalBytes)
      ? item
      : best;
  }, null);
}

export function contextDisplay(item) {
  const total =
    Number.isSafeInteger(item?.totalTokens) && item.totalTokens > 0 ? item.totalTokens : null;
  const used =
    total !== null &&
    item?.source === 'last-request' &&
    Number.isSafeInteger(item.usedTokens) &&
    item.usedTokens >= 0
      ? item.usedTokens
      : null;
  return {
    total,
    used,
    percent: used === null ? null : Math.min(100, Math.round((100 * used) / total)),
  };
}

const graphMetrics = ['CPU', 'GPU', 'RAM', 'VRAM'];
const historyLength = 24;
const GiB = 1024 ** 3;
const GB = 1000 ** 3;
const usedPercent = (item) =>
  Number.isFinite(item?.usedBytes) &&
  item.usedBytes >= 0 &&
  Number.isFinite(item?.totalBytes) &&
  item.totalBytes > 0 &&
  item.usedBytes <= item.totalBytes
    ? (100 * item.usedBytes) / item.totalBytes
    : null;

function systemMetrics(sample) {
  const { ram, gpu: vram } = memoryDisplay(sample);
  const capacity = vram ?? dedicatedCapacity(sample);
  const gpus = sample?.gpus ?? [];
  const rankedBy = gpus.some((gpu) => Number.isFinite(gpu.temperatureCelsius))
    ? 'temperatureCelsius'
    : 'utilization';
  const gpu = gpus.reduce(
    (best, item) =>
      !best || (item[rankedBy] ?? -Infinity) > (best[rankedBy] ?? -Infinity) ? item : best,
    null,
  );
  return {
    CPU: { percent: sample?.cpu?.utilization, temperatureCelsius: sample?.cpu?.temperatureCelsius },
    GPU: {
      id: gpu?.id,
      name: gpu?.name,
      percent: gpu?.utilization,
      temperatureCelsius: gpu?.temperatureCelsius,
    },
    RAM: ram ? { percent: usedPercent(ram), usedBytes: ram.usedBytes } : {},
    VRAM: capacity
      ? {
          id: capacity.id,
          name: capacity.name,
          percent: usedPercent(capacity),
          usedBytes: vram?.usedBytes ?? null,
          totalBytes: capacity.totalBytes,
        }
      : {},
  };
}

const warningRules = {
  CPU: { threshold: 95, recovery: 90, temperature: true },
  GPU: { threshold: 87, recovery: 82, temperature: true },
  RAM: { threshold: 95, recovery: 90 },
  VRAM: { threshold: 95, recovery: 90 },
};

/** A warning needs two distinct high samples and rearms only after recovery. */
export class ResourceWarnings {
  constructor() {
    this.readings = new Map();
    this.dismissed = new Set();
  }

  dismiss(device) {
    for (const [key, reading] of this.readings)
      if (reading.warning?.device === device) this.dismissed.add(key);
  }

  update(sample) {
    const { ram } = memoryDisplay(sample);
    const readings = [
      ['CPU', 'CPU', sample?.cpu?.temperatureCelsius, sample?.cpu?.temperatureSampledAt],
      ['RAM', 'RAM', ram ? usedPercent(ram) : null, sample?.sampledAt],
      ...(sample?.gpus ?? []).flatMap((gpu) => [
        ['GPU', gpu.id, gpu.temperatureCelsius, sample.gpuSampledAt],
        ['VRAM', gpu.id, usedPercent(gpu), sample.gpuSampledAt],
      ]),
    ];
    const next = new Map();
    const warnings = new Map();
    for (const [device, id, value, at] of readings) {
      if (!Number.isFinite(value) || !Number.isFinite(at)) continue;
      const key = device + '/' + id;
      const rule = warningRules[device];
      const previous = this.readings.get(key);
      const high = value >= rule.threshold;
      let warning = previous?.warning;
      if (previous?.at !== at) {
        if (value <= rule.recovery) {
          warning = null;
          this.dismissed.delete(key);
        } else if (!warning && high && previous?.high)
          warning = { device, value, temperature: rule.temperature };
      }
      next.set(key, { at, high, warning });
      if (
        warning &&
        !this.dismissed.has(key) &&
        (!warnings.has(device) || warning.value > warnings.get(device).value)
      )
        warnings.set(device, warning);
    }
    this.readings = next;
    return [...warnings.values()];
  }
}

export function sparkline(values, scale) {
  let drawing = false;
  return values
    .map((value, index) => {
      if (!Number.isFinite(value) || value < 0) {
        drawing = false;
        return '';
      }
      const x = (68 * (historyLength - values.length + index)) / (historyLength - 1) + 1;
      const y = 15 - 14 * Math.min(1, value / scale);
      const command = drawing ? 'L' : 'M';
      drawing = true;
      return command + x.toFixed(1) + ' ' + y.toFixed(1) + (command === 'M' ? 'h.1' : '');
    })
    .join('');
}

/** Demand-driven sampling: no render loop, no samples while disabled or hidden,
 * one request at a time even when preferences/visibility change mid-request. */
export class MemoryHUD {
  constructor({
    element,
    contextButton,
    graphs,
    warnings,
    toggle,
    api,
    ui,
    document = globalThis.document,
    onLayout = () => {},
    onError = () => {},
  }) {
    Object.assign(this, {
      element,
      contextButton,
      graphs,
      warningList: warnings,
      toggle,
      api,
      ui,
      document,
      onLayout,
      onError,
    });
    this.settings = { memoryMonitor: false, processGraphs: false, memoryIntervalSeconds: 3 };
    this.history = [];
    this.graphCards = new Map();
    this.warnings = new ResourceWarnings();
    this.warningRows = new Map();
    toggle.onclick = (event) =>
      this.changeDisplay(event.target.closest('[data-monitor-menu]') ? 'menu' : 'toggle');
    toggle.oncontextmenu = (event) => {
      event.preventDefault();
      void this.changeDisplay('menu');
    };
    toggle.onkeydown = (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        void this.changeDisplay('menu');
      }
    };
    graphs.setAttribute('role', 'group');
    graphs.innerHTML = graphMetrics
      .map(
        (label) => `<div class="process-graph" data-metric="${label}" role="img">
        <span class="process-graph-label"><span>${label}</span><strong>—</strong></span>
        <span class="process-graph-reading">—</span>
        <svg viewBox="0 0 70 16" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke"/></svg>
      </div>`,
      )
      .join('');
    for (const label of graphMetrics)
      this.graphCards.set(label, graphs.querySelector(`[data-metric="${label}"]`));
    element.innerHTML = ['RAM', 'VRAM']
      .map(
        (name) => `<div class="memory-gauge" data-memory="${name}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="memory-track" cx="12" cy="12" r="9"/><circle class="memory-fill" cx="12" cy="12" r="9" pathLength="100"/></svg>
      <span class="memory-label"><span>${name}</span><strong>—</strong><span class="memory-bar" aria-hidden="true"><i></i></span></span>
      </div>`,
      )
      .join('');
    this.contextButton.onclick = async () => {
      if (this.openingContext) return;
      this.openingContext = true;
      try {
        await this.api.openSettings('model-context');
      } catch (error) {
        this.onError(error.message);
      } finally {
        this.openingContext = false;
      }
    };
    this.visibility = () => {
      if (document.hidden) {
        this.sample = null;
        this.drawWarnings(null);
        clearTimeout(this.timer);
      } else void this.poll();
    };
    document.addEventListener('visibilitychange', this.visibility);
  }
  async changeDisplay(action) {
    if (this.changingDisplay) return;
    this.changingDisplay = true;
    try {
      await this.api.monitorDisplay(action);
    } catch {
      this.onError('Monitor display could not be saved.');
    } finally {
      this.changingDisplay = false;
    }
  }
  displayLabel() {
    const active = this.settings.processGraphs;
    const label = this.ui.text(active ? 'Collapse graphs' : 'Expand graphs');
    const shortcut = this.ui.text('Use the arrow or press Down to choose a monitor style.');
    this.toggle.title = `${label} · ${shortcut}`;
    this.toggle.setAttribute('aria-label', label);
    this.toggle.setAttribute('aria-description', shortcut);
    this.toggle.setAttribute('aria-pressed', String(active));
  }
  refreshLocale() {
    this.displayLabel();
    this.draw(this.sample);
    this.drawGraphs();
    this.drawWarnings(this.sample);
  }
  configure(value) {
    const previous = this.settings;
    this.settings = {
      memoryMonitor: value.memoryMonitor !== false,
      processGraphs: value.processGraphs !== false,
      memoryStyle: value.memoryStyle === 'bars' ? 'bars' : 'rings',
      memoryIntervalSeconds: [3, 5, 10].includes(value.memoryIntervalSeconds)
        ? value.memoryIntervalSeconds
        : 3,
    };
    if (!this.active) this.history = [];
    this.element.hidden = !this.settings.memoryMonitor || this.settings.processGraphs;
    this.contextButton.hidden = !this.active;
    this.graphs.hidden = !this.settings.processGraphs;
    this.toggle.hidden = false;
    this.displayLabel();
    this.element.dataset.style = this.settings.memoryStyle;
    this.draw(this.sample);
    if (this.settings.processGraphs) this.drawGraphs();
    if (!this.active) {
      clearTimeout(this.timer);
      this.timer = null;
      this.drawWarnings(null);
    } else if (
      !this.timer ||
      previous.memoryIntervalSeconds !== this.settings.memoryIntervalSeconds
    ) {
      void this.poll();
    }
  }
  get active() {
    return this.settings.memoryMonitor || this.settings.processGraphs;
  }
  async poll() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.destroyed || this.pending || !this.active || this.document.hidden) return;
    this.pending = true;
    try {
      this.sample = await this.api.memoryStatus();
    } catch {
      this.sample = null;
    } finally {
      this.pending = false;
      if (!this.destroyed && this.active && !this.document.hidden) {
        this.draw(this.sample);
        this.history.push(systemMetrics(this.sample));
        if (this.history.length > historyLength) this.history.shift();
        if (this.settings.processGraphs) this.drawGraphs();
        this.drawWarnings(this.sample);
        this.timer = setTimeout(() => this.poll(), this.settings.memoryIntervalSeconds * 1000);
      }
    }
  }
  drawGraphs() {
    this.graphs.setAttribute('aria-label', this.ui.text('System resource usage'));
    const format = (value) => value.toLocaleString(this.ui.language, { maximumFractionDigits: 1 });
    for (const label of graphMetrics) {
      const item = this.graphCards.get(label);
      const latest = this.history.at(-1)?.[label] ?? {};
      const values = this.history.map((reading) =>
        reading[label].id === latest.id ? reading[label].percent : null,
      );
      const valid = Number.isFinite(latest.percent);
      const value = valid ? format(Math.round(latest.percent)) + '%' : '—';
      const temperature = label === 'CPU' || label === 'GPU';
      const secondary = temperature
        ? latest.temperatureCelsius
        : Number.isFinite(latest.usedBytes)
          ? latest.usedBytes / GB
          : null;
      const unit = temperature ? '°C' : 'GB';
      const reading =
        (Number.isFinite(secondary)
          ? format(secondary)
          : label === 'VRAM' && Number.isFinite(latest.totalBytes)
            ? '— / ' + format(latest.totalBytes / GB)
            : '—') +
        ' ' +
        unit;
      const process = this.sample?.processLoad;
      const capri = {
        CPU: Number.isFinite(process?.cpuPercent) ? format(process.cpuPercent) + '%' : null,
        RAM: Number.isFinite(process?.ramBytes) ? format(process.ramBytes / GiB) + ' GiB' : null,
        VRAM: Number.isFinite(process?.vramBytes) ? format(process.vramBytes / GiB) + ' GiB' : null,
      }[label];
      const title = [
        label,
        latest.name,
        valid ? value : this.ui.text('Unavailable'),
        Number.isFinite(secondary) || (label === 'VRAM' && Number.isFinite(latest.totalBytes))
          ? reading
          : this.ui.text('Unavailable') + ' (' + unit + ')',
        capri ? 'Capri ' + capri : null,
      ]
        .filter(Boolean)
        .join(' · ');
      item.dataset.available = String(valid);
      item.querySelector('strong').textContent = value;
      item.querySelector('.process-graph-reading').textContent = reading;
      item.querySelector('path').setAttribute('d', sparkline(values, 100));
      item.title = title;
      item.setAttribute('aria-label', title);
    }
  }
  drawWarnings(sample) {
    const warnings = this.warnings.update(sample);
    const active = new Set(
      [...this.warnings.readings.values()].map(({ warning }) => warning?.device),
    );
    for (const [device, card] of this.graphCards) card.dataset.warning = String(active.has(device));
    const current = new Set(warnings.map(({ device }) => device));
    let layoutChanged = false;
    for (const [device, item] of this.warningRows) {
      if (current.has(device)) continue;
      if (item.row.contains(this.document.activeElement)) this.toggle.focus();
      item.row.remove();
      this.warningRows.delete(device);
      layoutChanged = true;
    }
    for (const { device, temperature, value } of warnings) {
      let item = this.warningRows.get(device);
      if (!item) {
        const row = this.document.createElement('div');
        row.className = 'resource-warning';
        row.dataset.warningDevice = device;
        const text = this.document.createElement('span');
        text.className = 'resource-warning-message';
        const dismiss = this.document.createElement('button');
        dismiss.className = 'resource-warning-dismiss';
        dismiss.type = 'button';
        dismiss.dataset.hitRegion = '';
        dismiss.textContent = '×';
        dismiss.onclick = () => {
          this.warnings.dismiss(device);
          this.drawWarnings(this.sample);
        };
        row.append(text, dismiss);
        const actions = [];
        if (!temperature) {
          const group = this.document.createElement('div');
          group.className = 'resource-warning-actions';
          for (const [label, section] of [
            ['Change local model', 'local-model'],
            ['Change device', 'model-devices'],
            ['Use API', 'api'],
          ]) {
            const button = this.document.createElement('button');
            button.type = 'button';
            button.dataset.hitRegion = '';
            button.dataset.resourceAction = section;
            button.onclick = async () => {
              if (this.openingWarningSettings) return;
              this.openingWarningSettings = true;
              try {
                await this.api.openSettings(section);
              } catch (error) {
                this.onError(error.message);
              } finally {
                this.openingWarningSettings = false;
              }
            };
            group.append(button);
            actions.push({ button, label });
          }
          row.append(group);
        }
        this.warningList.append(row);
        item = { row, text, dismiss, actions };
        this.warningRows.set(device, item);
        layoutChanged = true;
      }
      const message = this.ui.text(
        temperature
          ? '{device} is overheating ({value} °C).'
          : '{device} is nearly full ({value}%).',
        { device, value: Math.round(value).toLocaleString(this.ui.language) },
      );
      if (item.text.textContent !== message) {
        item.text.textContent = message;
        layoutChanged = true;
      }
      item.dismiss.title = this.ui.text('Dismiss');
      item.dismiss.setAttribute('aria-label', `${item.dismiss.title} · ${message}`);
      for (const { button, label } of item.actions) button.textContent = this.ui.text(label);
    }
    this.warningList.hidden = !warnings.length;
    if (layoutChanged) this.onLayout();
  }
  draw(sample) {
    const { ram, gpu } = memoryDisplay(sample);
    const capacity = gpu ?? dedicatedCapacity(sample);
    const format = (bytes) =>
      (bytes / 1024 ** 3).toLocaleString(this.ui.language, { maximumFractionDigits: 1 });
    for (const [name, item] of [
      ['RAM', ram],
      ['VRAM', gpu],
    ]) {
      const el = this.element.querySelector(`[data-memory="${name}"]`);
      const percent = item ? Math.round((item.usedBytes / item.totalBytes) * 100) : null;
      const detail = item
        ? `${name} · ${format(item.usedBytes)} / ${format(item.totalBytes)} GiB · ${percent}%${item.name ? ' · ' + item.name : ''}`
        : name === 'VRAM' && capacity
          ? `${name} · — / ${format(capacity.totalBytes)} GiB · ${this.ui.text('Unavailable')} · ${capacity.name ?? ''}`
          : `${name} · ${this.ui.text('Unavailable')}`;
      el.title = detail;
      el.setAttribute('aria-label', detail);
      el.setAttribute('role', item ? 'meter' : 'img');
      for (const [key, value] of Object.entries({
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
      }))
        if (item) el.setAttribute(key, String(value));
        else el.removeAttribute(key);
      el.dataset.pressure =
        percent === null ? 'unknown' : percent >= 90 ? 'high' : percent >= 75 ? 'medium' : 'normal';
      el.querySelector('strong').textContent = percent === null ? '—' : percent + '%';
      el.style.setProperty('--memory-used', String(percent ?? 0));
    }
    const { used, total, percent } = contextDisplay(sample?.context);
    const tokens = (value) => (value === null ? '—' : value.toLocaleString(this.ui.language));
    const detail = this.ui.text('Last request: {used} / {total} tokens. Click to change context.', {
      used: tokens(used),
      total: tokens(total),
    });
    this.contextButton.title = detail;
    this.contextButton.setAttribute('aria-label', detail);
    this.contextButton.dataset.pressure =
      percent === null ? 'unknown' : percent >= 90 ? 'high' : percent >= 75 ? 'medium' : 'normal';
    this.contextButton.querySelector('strong').textContent = percent === null ? '—' : percent + '%';
    this.element.title = this.ui.text(
      'System-wide RAM and VRAM usage. The busiest GPU is shown. Missing driver data is unavailable.',
    );
  }
  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.warningList.replaceChildren();
    this.warningList.hidden = true;
    this.toggle.onclick = null;
    this.toggle.oncontextmenu = null;
    this.toggle.onkeydown = null;
    this.contextButton.onclick = null;
    this.document.removeEventListener('visibilitychange', this.visibility);
  }
}
