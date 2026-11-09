// SPDX-License-Identifier: GPL-3.0-only
const labels = {
  dispatch: 'Starting the request',
  model: 'Preparing the model',
  routing: 'Request routing',
  intent: 'Intent classification',
  context: 'Preparing context',
  gateway: 'Waiting for gateway text',
  stream: 'Receiving the reply',
};
const stages = {
  received: 'Request received',
  chat_started: 'Chat processing started',
  model_start: 'Model preparation started',
  model_ready: 'Model ready',
  routing_start: 'Routing started',
  routing_ready: 'Routing finished',
  intent_start: 'Intent classification started',
  intent_ready: 'Intent classification finished',
  context_start: 'Context preparation started',
  context_ready: 'Context ready',
  gateway_dispatch: 'Sent to gateway',
  gateway_received: 'Gateway received request',
  gateway_headers: 'Gateway headers received',
  gateway_first_delta: 'Gateway emitted first text',
  gateway_first_token: 'Desktop received first text',
  gateway_finished: 'Gateway finished',
  provider_request: 'Sent to model provider',
  provider_headers: 'Provider headers received',
  provider_first_token: 'First model token',
  provider_first_content: 'First model text',
  provider_finished: 'Model generation finished',
  provider_failed: 'Model request failed',
  first_delta: 'First text sent to interface',
  first_paint: 'First text painted',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const states = {
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  incomplete: 'In progress or incomplete',
};
const groups = { runtime: 'Runtime', updates: 'Updates', installer: 'Installer' };
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export class DeveloperPanel {
  constructor({ api, ui, onError, host = document.getElementById('settings-forms') }) {
    Object.assign(this, { api, ui, onError });
    this.visible = false;
    this.generation = 0;
    this.followLatest = true;
    this.panel = element('section', undefined, 'preferences-panel');
    this.panel.id = 'developer-panel';
    this.panel.hidden = true;
    this.panel.dataset.panelCut = '12';
    this.panel.innerHTML = `<h2>For developers</h2>
      <p class="settings-help" data-inline-help>Technical counters only. Conversations, memory, images and API keys are not shown.</p>
      <div class="developer-toolbar settings-actions">
        <button type="button" id="developer-refresh">Refresh</button>
        <button type="button" id="developer-folder">Open logs folder</button>
        <label><input type="checkbox" id="developer-live" checked> Live refresh</label>
      </div>
      <p id="developer-status" class="settings-help" role="status"></p>
      <section class="developer-section" aria-labelledby="developer-timing-title">
        <h3 id="developer-timing-title">Response timing</h3>
        <label for="developer-turn">Recent requests</label>
        <select id="developer-turn"></select>
        <p id="developer-empty" class="settings-help">No measurements yet. Send a message to Capri, then refresh.</p>
        <div id="developer-turn-details" hidden>
          <p id="developer-turn-meta" class="settings-help" data-untranslated></p>
          <div id="developer-metrics" class="developer-metrics"></div>
          <h4>Pipeline stages</h4>
          <p class="settings-help" data-inline-help>Some stages overlap. Missing measurements are shown as a dash; stage times should not be added together.</p>
          <div id="developer-phases"></div>
          <h4>Model calls</h4>
          <p class="settings-help" data-inline-help>Model-reported load, prompt evaluation and generation times are available for local Ollama. External APIs may not provide these counters.</p>
          <div id="developer-calls"></div>
          <details class="developer-events"><summary>All timing events</summary>
            <p class="settings-help" data-inline-help>Event offsets across processes use system timestamps. Paired stage durations use each process's own clock.</p>
            <div id="developer-events"></div>
          </details>
        </div>
      </section>
      <section class="developer-section" aria-labelledby="developer-logs-title">
        <h3 id="developer-logs-title">Logs</h3>
        <label for="developer-log">Log file</label><select id="developer-log"></select>
        <p id="developer-log-status" class="settings-help" role="status"></p>
        <pre id="developer-log-content" tabindex="0" aria-label="Technical log" data-untranslated></pre>
        <p class="settings-help" data-inline-help>Only the latest log tail is shown. Private text and unknown fields are omitted. Nothing is uploaded.</p>
      </section>`;
    host.append(this.panel);
    this.get('refresh').onclick = () => void this.refresh();
    this.get('folder').onclick = () => void this.api.openDeveloperLogs().catch(() => this.error());
    this.get('live').onchange = () => this.schedule();
    this.get('turn').onchange = () => {
      this.followLatest = this.get('turn').value === this.value?.turns[0]?.id;
      this.renderKey = null;
      this.renderTurn();
    };
    this.get('log').onchange = () => {
      this.logKey = null;
      void this.readLog();
    };
    this.panel.querySelector('.developer-events').ontoggle = () => this.renderEvents();
    this.visibility = () => this.schedule();
    document.addEventListener('visibilitychange', this.visibility);
  }
  get(id) {
    return this.panel.querySelector('#developer-' + id);
  }
  text(key, values) {
    return this.ui.text(key, values);
  }
  number(value, digits = 0) {
    return Number.isFinite(value)
      ? new Intl.NumberFormat(this.ui.language ?? 'en', { maximumFractionDigits: digits }).format(
          value,
        )
      : '—';
  }
  ms(value) {
    return Number.isFinite(value)
      ? new Intl.NumberFormat(this.ui.language ?? 'en', {
          style: 'unit',
          unit: 'millisecond',
          unitDisplay: 'short',
          maximumFractionDigits: 1,
        }).format(value)
      : '—';
  }
  time(value) {
    return new Date(value).toLocaleTimeString(this.ui.language ?? 'en');
  }
  error() {
    this.get('status').textContent = this.text('Diagnostics could not be read. Try refreshing.');
  }
  setVisible(visible) {
    this.visible = visible;
    this.generation++;
    this.schedule();
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.visible && !document.hidden && this.get('live').checked)
      this.timer = setTimeout(() => void this.refresh(), 3000);
  }
  async open() {
    this.setVisible(true);
    await this.refresh();
  }
  close() {
    this.setVisible(false);
  }
  async refresh() {
    if (this.busy || !this.visible || document.hidden) return;
    const generation = this.generation;
    this.busy = true;
    this.get('refresh').disabled = true;
    try {
      const value = await this.api.developerDiagnostics();
      if (!this.visible || generation !== this.generation) return;
      this.value = value;
      this.render();
      await this.readLog();
    } catch {
      if (this.visible && generation === this.generation) this.error();
    } finally {
      this.busy = false;
      this.get('refresh').disabled = false;
      this.schedule();
    }
  }
  render() {
    if (!this.value) return;
    this.get('status').textContent = this.value.unavailable
      ? this.text('Diagnostics could not be read. Try refreshing.')
      : this.text('Updated {time}', { time: this.time(this.value.capturedAt) });
    this.options(
      'turn',
      this.value.turns.map((turn) => ({
        id: turn.id,
        label:
          this.time(turn.time) +
          ' · ' +
          this.text(states[turn.status]) +
          ' · ' +
          (turn.modelId ?? turn.id.slice(0, 8)),
      })),
    );
    this.get('turn').disabled = !this.value.turns.length;
    this.get('empty').hidden = Boolean(this.value.turns.length);
    this.get('turn-details').hidden = !this.value.turns.length;
    this.renderTurn();
    this.options(
      'log',
      this.value.logs.map((log) => ({
        id: log.id,
        label: this.text(groups[log.group]) + ' · ' + log.name,
      })),
    );
    this.get('log').disabled = !this.value.logs.length;
    if (!this.value.logs.length) {
      this.get('log-content').textContent = '';
      this.get('log-status').textContent = this.text('No logs are available yet.');
    }
  }
  options(id, items) {
    const select = this.get(id),
      signature = JSON.stringify(items);
    if (select.dataset.options === signature) return;
    const previous = select.value;
    select.replaceChildren(
      ...items.map((item) => {
        const option = element('option', item.label);
        option.value = item.id;
        return option;
      }),
    );
    if ((id !== 'turn' || !this.followLatest) && items.some((item) => item.id === previous))
      select.value = previous;
    select.dataset.options = signature;
  }
  metric(host, label, value) {
    const node = element('div', undefined, 'developer-metric');
    node.append(element('span', this.text(label)), element('strong', value));
    host.append(node);
  }
  renderTurn() {
    const turn = this.value?.turns.find((turn) => turn.id === this.get('turn').value);
    if (!turn) return;
    const signature = JSON.stringify([this.ui.language, turn]);
    if (this.renderKey === signature) return;
    this.renderKey = signature;
    this.get('turn-meta').textContent = [
      this.text(states[turn.status]),
      turn.modelId,
      turn.id,
      !turn.linked && this.text('Unlinked model measurement'),
    ]
      .filter(Boolean)
      .join(' · ');
    const metrics = this.get('metrics');
    metrics.replaceChildren();
    this.metric(metrics, 'First reply text', this.ms(turn.firstTextMs));
    this.metric(metrics, 'Full reply', this.ms(turn.totalMs));
    this.metric(metrics, 'First interface paint', this.ms(turn.firstPaintMs));
    this.metric(metrics, 'Model calls', this.number(turn.calls.length));
    const phases = this.get('phases');
    phases.replaceChildren();
    const maximum = Math.max(turn.totalMs ?? 0, ...turn.phases.map((p) => p.durationMs ?? 0), 1);
    for (const phase of turn.phases) {
      const row = element('div', undefined, 'developer-phase'),
        title = element('div', undefined, 'developer-phase-title');
      title.append(
        element('span', this.text(labels[phase.id])),
        element('strong', this.ms(phase.durationMs)),
      );
      const bar = element('progress');
      bar.max = maximum;
      bar.value = phase.durationMs ?? 0;
      bar.setAttribute('aria-label', this.text(labels[phase.id]));
      row.append(title, bar);
      phases.append(row);
    }
    const calls = this.get('calls'),
      expanded = new Map(
        [...calls.querySelectorAll('details')].map((node) => [node.dataset.request, node.open]),
      );
    calls.replaceChildren();
    if (!turn.calls.length)
      calls.append(
        element(
          'p',
          this.text('No provider counters are available for this request.'),
          'settings-help',
        ),
      );
    for (const [index, call] of turn.calls.entries()) {
      const details = element('details', undefined, 'developer-call');
      details.dataset.request = call.id;
      details.open = expanded.get(call.id) ?? turn.calls.length === 1;
      details.append(
        element(
          'summary',
          this.text('Model call {number}', { number: index + 1 }) +
            (call.modelId ? ' · ' + call.modelId : ''),
        ),
      );
      const list = element('dl', undefined, 'developer-call-metrics');
      for (const [label, value] of [
        ['Loading weights', this.ms(call.loadMs)],
        ['Evaluating the prompt', this.ms(call.promptEvalMs)],
        ['Generating tokens', this.ms(call.evalMs)],
        ['First model token', this.ms(call.firstTokenMs)],
        ['First model text', this.ms(call.firstContentMs)],
        ['Input tokens', this.number(call.promptTokens)],
        ['Output tokens', this.number(call.outputTokens)],
        ['Tokens per second', this.number(call.tokensPerSecond, 1)],
      ])
        list.append(element('dt', this.text(label)), element('dd', value));
      details.append(list);
      calls.append(details);
    }
    this.activeTurn = turn;
    this.renderEvents();
  }
  renderEvents() {
    if (!this.activeTurn || !this.panel.querySelector('.developer-events').open) return;
    const events = this.get('events');
    events.replaceChildren();
    const table = element('table'),
      head = element('tr');
    for (const key of ['Event', 'Source', 'Since request'])
      head.append(element('th', this.text(key)));
    const thead = element('thead');
    thead.append(head);
    const body = element('tbody');
    for (const event of this.activeTurn.events) {
      const row = element('tr');
      row.append(
        element('td', this.text(stages[event.stage] ?? event.stage)),
        element('td', event.source),
        element('td', this.ms(event.sinceStartMs)),
      );
      body.append(row);
    }
    table.append(thead, body);
    events.append(table);
  }
  async readLog() {
    const item = this.value?.logs.find((log) => log.id === this.get('log').value);
    if (!item) return;
    const key = item.id + ':' + item.modifiedAt;
    if (this.logKey === key) return;
    const generation = this.generation,
      id = item.id,
      serial = (this.logSerial = (this.logSerial ?? 0) + 1);
    try {
      const log = await this.api.developerLog(id);
      if (
        !this.visible ||
        generation !== this.generation ||
        serial !== this.logSerial ||
        this.get('log').value !== id
      )
        return;
      const pre = this.get('log-content'),
        scroll = pre.scrollTop,
        bottom = pre.scrollHeight - pre.clientHeight - scroll < 12;
      pre.textContent = log.text
        ? log.text
            .split(/\r?\n/)
            .map((line) => {
              try {
                return JSON.stringify(JSON.parse(line), null, 2);
              } catch {
                return line;
              }
            })
            .join('\n\n')
        : this.text('No technical entries in this log.');
      pre.scrollTop = bottom ? pre.scrollHeight : scroll;
      this.get('log-status').textContent = log.truncated
        ? this.text('Showing the latest 64 KB. Older entries remain in the log file.')
        : this.text('Technical log');
      this.logKey = key;
    } catch {
      if (this.visible && serial === this.logSerial) {
        this.get('log-content').textContent = '';
        this.get('log-status').textContent = this.text(
          'This log is no longer available. Refresh the list.',
        );
      }
    }
  }
}
