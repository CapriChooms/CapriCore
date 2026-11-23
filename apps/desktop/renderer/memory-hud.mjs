// SPDX-License-Identifier: GPL-3.0-only
import {
  DEFAULT_RESOURCE_GRAPHS,
  DEFAULT_RESOURCE_METERS,
  MAX_RESOURCE_METRICS,
  RESOURCE_METRICS,
  RESOURCE_REFRESH_INTERVALS,
  resourceMonitorDisplay,
} from './resource-metrics.mjs';

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

const maximumHistorySamples = 2048;
const graphMillisecondsPerPixel = 1000;
const GiB = 1024 ** 3;
const metricLabels = new Map(RESOURCE_METRICS.map(({ id, label }) => [id, label]));
const deviceLabels = {
  cpu: 'CPU',
  gpu: 'GPU',
  ram: 'RAM',
  vram: 'VRAM',
  cpuTemperature: 'CPU',
  gpuTemperature: 'GPU',
};
const attributeId = (metric) =>
  ['cpu', 'gpu', 'ram', 'vram'].includes(metric) ? deviceLabels[metric] : metric;
const selection = (value, defaults) =>
  Array.isArray(value)
    ? [...new Set(value.filter((metric) => metricLabels.has(metric)))].slice(
        0,
        MAX_RESOURCE_METRICS,
      )
    : defaults;
const usedPercent = (item) =>
  Number.isFinite(item?.usedBytes) &&
  item.usedBytes >= 0 &&
  Number.isFinite(item?.totalBytes) &&
  item.totalBytes > 0 &&
  item.usedBytes <= item.totalBytes
    ? (100 * item.usedBytes) / item.totalBytes
    : null;

function percentage(value, detail = {}) {
  return { value, maximum: 100, unit: '%', ...detail };
}

function temperature(value, detail = {}) {
  return { value, maximum: 100, unit: '°C', ...detail };
}

function memory(item) {
  return percentage(usedPercent(item), {
    id: item?.id,
    name: item?.name,
    secondary: item?.usedBytes == null ? null : item.usedBytes / GiB,
    secondaryMaximum: item?.totalBytes == null ? null : item.totalBytes / GiB,
    secondaryUnit: 'GiB',
  });
}

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
  const gpuIdentity = { id: gpu?.id, name: gpu?.name };
  const capriRam = sample?.processLoad?.ramBytes;
  const capriVram = sample?.processLoad?.vramBytes;
  const cpuTemperature = sample?.cpu?.temperatureCelsius;
  return {
    cpu: percentage(sample?.cpu?.utilization, { secondary: cpuTemperature, secondaryUnit: '°C' }),
    gpu: percentage(gpu?.utilization, {
      ...gpuIdentity,
      secondary: gpu?.temperatureCelsius,
      secondaryUnit: '°C',
    }),
    ram: memory(ram),
    vram: memory(capacity),
    capriCpu: percentage(sample?.processLoad?.cpuPercent),
    capriRam: {
      value: capriRam == null ? null : capriRam / GiB,
      maximum: ram?.totalBytes / GiB,
      unit: 'GiB',
    },
    cpuTemperature: temperature(cpuTemperature),
    gpuTemperature: temperature(gpu?.temperatureCelsius, gpuIdentity),
    disk: memory(sample?.disk),
    process: {
      cpu: sample?.processLoad?.cpuPercent,
      ram: capriRam == null ? null : capriRam / GiB,
      vram: capriVram == null ? null : capriVram / GiB,
    },
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

export function sparkline(values, scale, latestAt, width) {
  const earliestAt = latestAt - width * graphMillisecondsPerPixel;
  let drawing = false;
  return values
    .map(({ at, value }) => {
      if (at < earliestAt || at > latestAt) return '';
      if (!Number.isFinite(value) || value < 0) {
        drawing = false;
        return '';
      }
      const x = 69 - (68 * (latestAt - at)) / (latestAt - earliestAt);
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
    this.display = { graphs: [], meters: [] };
    this.history = [];
    this.graphCards = new Map();
    this.meters = new Map();
    this.warnings = new ResourceWarnings();
    this.warningRows = new Map();
    this.graphResize = new ResizeObserver(() => {
      if (this.display.graphs.length) this.drawGraphs();
    });
    this.graphResize.observe(graphs);
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
    element.setAttribute('role', 'group');
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
        if (this.history.length) this.recordReading(systemMetrics(null));
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
    const active = this.display.graphs.length > 0;
    const label = this.ui.text(
      active ? 'Collapse graphs' : this.active ? 'Expand graphs' : 'Show system resource graphs',
    );
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
    const wasGraph = this.display.graphs.length > 0;
    const wasMeter = this.display.meters.length > 0;
    this.settings = {
      memoryMonitor: value.memoryMonitor !== false,
      processGraphs: value.processGraphs !== false,
      memoryStyle: value.memoryStyle === 'bars' ? 'bars' : 'rings',
      graphMetrics: selection(value.graphMetrics, DEFAULT_RESOURCE_GRAPHS),
      meterMetrics: selection(value.meterMetrics, DEFAULT_RESOURCE_METERS),
      memoryIntervalSeconds: RESOURCE_REFRESH_INTERVALS.includes(value.memoryIntervalSeconds)
        ? value.memoryIntervalSeconds
        : 3,
    };
    const changed = this.updateCards();
    this.display = resourceMonitorDisplay(this.settings);
    if (!this.active) this.history = [];
    this.element.hidden = !this.display.meters.length;
    this.contextButton.hidden = !this.active;
    this.graphs.hidden = !this.display.graphs.length;
    this.toggle.hidden = false;
    this.displayLabel();
    this.element.dataset.style = this.settings.memoryStyle;
    this.draw(this.sample);
    this.drawGraphs();
    if (changed || this.element.hidden === wasMeter || this.graphs.hidden === wasGraph)
      this.onLayout();
    if (!this.active) {
      clearTimeout(this.timer);
      this.timer = null;
      this.drawWarnings(null);
    } else if (
      !this.timer ||
      changed ||
      previous.memoryIntervalSeconds !== this.settings.memoryIntervalSeconds
    ) {
      void this.poll();
    }
  }
  get active() {
    return Boolean(this.display.meters.length || this.display.graphs.length);
  }

  updateCards() {
    const rebuild = (element, cards, ids, create) => {
      if (Array.from(cards.keys()).join() === ids.join()) return false;
      element.innerHTML = ids.map(create).join('');
      element.style.setProperty('--resource-count', String(ids.length));
      cards.clear();
      for (const child of element.children) cards.set(child.dataset.resourceMetric, child);
      return true;
    };
    const graphs = rebuild(
      this.graphs,
      this.graphCards,
      this.settings.graphMetrics,
      (
        id,
      ) => `<div class="process-graph" data-metric="${attributeId(id)}" data-resource-metric="${id}" role="img">
        <span class="process-graph-label"><span></span><strong>—</strong></span>
        <span class="process-graph-reading">—</span>
        <div class="process-graph-plot"><svg viewBox="0 0 70 16" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke"/></svg></div>
        <span class="process-graph-time" aria-hidden="true"><span></span><span></span></span>
      </div>`,
    );
    const meters = rebuild(
      this.element,
      this.meters,
      this.settings.meterMetrics,
      (
        id,
      ) => `<div class="memory-gauge" data-memory="${attributeId(id)}" data-resource-metric="${id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="memory-track" cx="12" cy="12" r="9"/><circle class="memory-fill" cx="12" cy="12" r="9" pathLength="100"/></svg>
        <span class="memory-label"><span></span><strong>—</strong><span class="memory-bar" aria-hidden="true"><i></i></span></span>
      </div>`,
    );
    return graphs || meters;
  }

  async poll() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.destroyed || this.pending || !this.active || this.document.hidden) return;
    const startedAt = performance.now();
    this.pending = true;
    try {
      this.sample = await this.api.memoryStatus();
    } catch {
      this.sample = null;
    } finally {
      this.pending = false;
      if (!this.destroyed && this.active && !this.document.hidden) {
        const reading = systemMetrics(this.sample);
        this.draw(this.sample, reading);
        this.recordReading(reading);
        if (this.display.graphs.length) this.drawGraphs(reading);
        this.drawWarnings(this.sample);
        const interval = this.settings.memoryIntervalSeconds * 1000;
        const elapsed = performance.now() - startedAt;
        this.timer = setTimeout(() => this.poll(), interval - (elapsed % interval));
      }
    }
  }
  recordReading(reading) {
    this.history.push({ at: performance.now(), reading });
    if (this.history.length > maximumHistorySamples) this.history.shift();
  }
  resourceReading(id, reading) {
    const format = (value, max = 1) =>
      value.toLocaleString(this.ui.language, { maximumFractionDigits: max });
    const label = this.ui.text(metricLabels.get(id));
    const { value, unit, name, secondary, secondaryMaximum, secondaryUnit } = reading;
    const available = Number.isFinite(value);
    const text = available
      ? format(value, unit === '%' ? 0 : 1) + (unit === '%' ? '%' : ' ' + unit)
      : '—';
    const secondaryText = secondaryUnit
      ? (Number.isFinite(secondary) ? format(secondary) : '—') + ' ' + secondaryUnit
      : '';
    const completeSecondary = Number.isFinite(secondaryMaximum)
      ? `${Number.isFinite(secondary) ? format(secondary) : '—'} / ${format(secondaryMaximum)} ${secondaryUnit}`
      : secondaryText;
    const title = [
      label,
      name,
      available ? text : this.ui.text('Unavailable'),
      completeSecondary,
    ].filter(Boolean);
    const cpuTemperatureMissing = id === 'cpuTemperature' && !available;
    if (cpuTemperatureMissing)
      title.push(
        this.ui.text(
          'CPU temperature is unavailable. LibreHardwareMonitor can provide it through its local server at 127.0.0.1:8085.',
        ),
      );
    return {
      label,
      available,
      text,
      secondaryText: cpuTemperatureMissing ? this.ui.text('Unavailable') : secondaryText,
      title,
    };
  }
  drawGraphs(latest = this.history.at(-1)?.reading ?? systemMetrics(this.sample)) {
    this.graphs.setAttribute('aria-label', this.ui.text('System resource usage'));
    const seconds = new Intl.NumberFormat(this.ui.language, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
    });
    const latestAt = this.history.at(-1)?.at ?? performance.now();
    for (const [id, item] of this.graphCards) {
      const reading = latest[id];
      const { label, available, text, secondaryText, title } = this.resourceReading(id, reading);
      const plot = item.querySelector('svg');
      const width = Math.max(1, Math.round(plot.getBoundingClientRect().width));
      const left = latestAt - width * graphMillisecondsPerPixel;
      const values = this.history
        .filter(({ at }) => at >= left)
        .map(({ at, reading }) => ({
          at,
          value: reading[id].id === latest[id].id ? reading[id].value : null,
        }));
      const primary = item.querySelector('strong');
      const name = item.querySelector('.process-graph-label span');
      const secondary = item.querySelector('.process-graph-reading');
      item.dataset.available = String(available);
      item.toggleAttribute('data-single-reading', !secondaryText);
      primary.textContent = text;
      name.textContent = label;
      secondary.textContent = secondaryText;
      const axis = Number.isFinite(reading.maximum)
        ? reading.maximum
        : Math.max(1, ...values.map(({ value }) => value).filter(Number.isFinite));
      plot.querySelector('path').setAttribute('d', sparkline(values, axis, latestAt, width));
      const [oldest, current] = item.querySelector('.process-graph-time').children;
      oldest.textContent = seconds.format(-(width * graphMillisecondsPerPixel) / 1000);
      current.textContent = seconds.format(0);
      if (Number.isFinite(latest.process[id])) {
        const unit = id === 'cpu' ? '%' : ' GiB';
        title.push(
          'Capri ' +
            latest.process[id].toLocaleString(this.ui.language, { maximumFractionDigits: 1 }) +
            unit,
        );
      }
      item.title = title.join(' · ');
      item.setAttribute('aria-label', item.title);
    }
  }
  drawWarnings(sample) {
    const warnings = this.warnings.update(sample);
    const active = new Set(
      [...this.warnings.readings.values()].map(({ warning }) => warning?.device),
    );
    for (const [metric, card] of this.graphCards)
      card.dataset.warning = String(active.has(deviceLabels[metric]));
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
  draw(sample, latest = systemMetrics(sample)) {
    for (const [id, el] of this.meters) {
      const reading = latest[id];
      const { label, available, text, title } = this.resourceReading(id, reading);
      const measured = available && Number.isFinite(reading.maximum) && reading.maximum > 0;
      const percent = measured
        ? Math.max(0, Math.min(100, (100 * reading.value) / reading.maximum))
        : null;
      const isTemperature = reading.unit === '°C';
      const rule = isTemperature ? warningRules[deviceLabels[id]] : null;
      const high = rule ? reading.value >= rule.threshold : percent >= 90;
      const medium = rule ? reading.value >= rule.recovery : percent >= 75;
      el.title = title.join(' · ');
      el.setAttribute('aria-label', el.title);
      el.setAttribute('role', measured ? 'meter' : 'img');
      for (const [key, value] of Object.entries({
        'aria-valuemin': 0,
        'aria-valuemax': reading.maximum,
        'aria-valuenow': Math.max(0, Math.min(reading.value, reading.maximum)),
        'aria-valuetext': text,
      }))
        if (measured) el.setAttribute(key, String(value));
        else el.removeAttribute(key);
      el.dataset.pressure =
        percent === null ? 'unknown' : high ? 'high' : medium ? 'medium' : 'normal';
      el.querySelector('.memory-label > span').textContent = label;
      el.querySelector('strong').textContent = text;
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
    this.element.setAttribute('aria-label', this.ui.text('System resource usage'));
  }
  destroy() {
    this.destroyed = true;
    this.graphResize.disconnect();
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
