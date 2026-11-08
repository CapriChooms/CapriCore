// SPDX-License-Identifier: GPL-3.0-only
export const WORKFLOW_ACTION_LABELS = Object.freeze({
  click: 'Click',
  drag: 'Drag',
  keys: 'Keyboard shortcut',
  scroll: 'Scroll',
  text: 'Type text',
});

export class WorkflowsPanel {
  constructor({ api, ui, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.id = 'workflows-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.innerHTML =
      '<h2>Task training</h2><div class="preferences-content"><div class="settings-card"><p>Record clicks, dragging, scrolling and shortcuts for up to two minutes. Ordinary typing, clipboard contents and password fields are not recorded. Add text steps manually, review the draft and save it. Esc stops recording or playback.</p><div class="settings-actions"><button id="workflow-record" type="button">Start recording</button><button id="workflow-stop" type="button" disabled>Stop</button></div><p id="workflow-status" role="status"></p><label for="workflow-name">Workflow name</label><input id="workflow-name" maxlength="80"><div id="workflow-steps"></div><div class="settings-actions"><button id="workflow-add-text" type="button">Add text after the last input-field click</button><button id="workflow-save" type="button">Save workflow</button></div><details><summary>Advanced step editor</summary><textarea id="workflow-json" rows="10" spellcheck="false"></textarea><button id="workflow-edit" type="button">Use edited steps</button></details></div><div class="settings-card"><h3>Saved workflows</h3><p>Playback requires full computer access. Targets must match uniquely. Capri stops if a target changes or Esc is pressed.</p><label for="workflow-variables">Variables (JSON object)</label><textarea id="workflow-variables" rows="3" placeholder="{&quot;query&quot;:&quot;a song name&quot;}"></textarea><div id="workflow-list"></div></div></div>';
    this.panel.dataset.panelCut = '12';
    for (const paragraph of this.panel.querySelectorAll('.settings-card > p:not([id])'))
      paragraph.classList.add('settings-help');
    document.getElementById('companion').append(this.panel);
    const $ = (id) => this.panel.querySelector('#' + id);
    this.$ = $;
    $('workflow-record').onclick = () =>
      this.run(async () => {
        this.status(await api.workflowAction({ action: 'record' }));
        this.edit({ name: '', steps: [] });
      });
    $('workflow-stop').onclick = () =>
      this.run(async () => {
        const result = await api.workflowAction({ action: 'stop' });
        if (result.steps) this.edit({ name: $('workflow-name').value, steps: result.steps });
      });
    $('workflow-save').onclick = () =>
      this.run(async () => {
        this.draft.name = $('workflow-name').value;
        this.list(await api.workflowAction({ action: 'save', workflow: this.draft }));
      });
    $('workflow-edit').onclick = () =>
      this.run(async () =>
        this.edit({
          ...this.draft,
          name: $('workflow-name').value,
          steps: JSON.parse($('workflow-json').value),
        }),
      );
    $('workflow-add-text').onclick = () =>
      this.run(async () => {
        const previous = this.draft?.steps.findLast(
          (step) => step.selector?.role === 'ControlType.Edit',
        );
        if (!previous) throw new Error('Record a click on the input field first.');
        this.draft.steps.push({ ...previous, action: 'text', text: '{{text}}', delayMs: 100 });
        this.render();
      });
    this.render();
  }
  async run(work) {
    try {
      return await work();
    } catch (error) {
      this.onError(error.message);
    }
  }
  async open() {
    const value = await this.api.workflowAction({ action: 'status' });
    this.status(value.status);
    this.list(value.workflows);
    if (value.draft?.length && !this.draft?.steps?.length)
      this.edit({ name: '', steps: value.draft });
  }
  status(value) {
    const stopped = this.recording && !value.recording;
    this.recording = value.recording;
    this.$('workflow-status').textContent =
      this.ui.text(
        value.recording
          ? 'Recording — press Esc to stop'
          : value.playing
            ? 'Playing — press Esc to stop'
            : 'Ready',
      ) +
      ' · ' +
      value.count;
    this.$('workflow-record').disabled = value.recording || value.playing;
    this.$('workflow-stop').disabled = !value.recording && !value.playing;
    if (stopped)
      void this.run(async () => {
        const state = await this.api.workflowAction({ action: 'status' });
        this.edit({ name: this.$('workflow-name').value, steps: state.draft ?? [] });
      });
  }
  edit(value) {
    this.draft = structuredClone(value);
    this.$('workflow-name').value = value.name;
    this.render();
  }
  render() {
    this.$('workflow-save').disabled = !this.draft?.steps?.length;
    this.$('workflow-add-text').disabled = !(this.draft?.steps ?? []).some(
      (step) => step.selector?.role === 'ControlType.Edit',
    );
    const list = this.$('workflow-steps');
    list.replaceChildren();
    for (const [index, step] of (this.draft?.steps ?? []).entries()) {
      const row = document.createElement('article'),
        title = document.createElement('p'),
        action = document.createElement('span'),
        detail = document.createElement('span');
      row.className = 'action-entry';
      action.className = 'workflow-action-label';
      action.textContent = this.ui.text(WORKFLOW_ACTION_LABELS[step.action] ?? step.action);
      detail.dataset.untranslated = '';
      detail.textContent = step.selector?.label ?? step.keys?.join(' + ') ?? step.amount ?? '';
      title.append(`${index + 1}. `, action, ' · ', detail);
      row.append(title);
      if (step.action === 'text') {
        const input = document.createElement('textarea');
        input.rows = 2;
        input.maxLength = 2000;
        input.value = step.text;
        input.oninput = () => {
          step.text = input.value;
          this.$('workflow-json').value = JSON.stringify(this.draft.steps, null, 2);
        };
        row.append(input);
      }
      for (const [label, offset] of [
        ['↑', -1],
        ['↓', 1],
        ['×', 0],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute(
          'aria-label',
          this.ui.text(offset === 0 ? 'Remove' : offset < 0 ? 'Move up' : 'Move down'),
        );
        button.onclick = () => {
          if (!offset) this.draft.steps.splice(index, 1);
          else if (this.draft.steps[index + offset])
            [this.draft.steps[index], this.draft.steps[index + offset]] = [
              this.draft.steps[index + offset],
              step,
            ];
          this.render();
        };
        row.append(button);
      }
      list.append(row);
    }
    this.$('workflow-json').value = JSON.stringify(this.draft?.steps ?? [], null, 2);
  }
  list(rows) {
    const list = this.$('workflow-list');
    list.replaceChildren();
    for (const workflow of rows) {
      const row = document.createElement('article'),
        title = document.createElement('strong');
      row.className = 'action-entry';
      title.textContent = workflow.name;
      title.dataset.untranslated = '';
      row.append(title);
      for (const action of ['edit', 'run', 'remove']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = this.ui.text(
          { edit: 'Edit', run: 'Run workflow', remove: 'Remove' }[action],
        );
        button.onclick = () =>
          this.run(async () => {
            if (action === 'edit') return this.edit(workflow);
            if (action === 'remove')
              return this.list(
                await this.api.workflowAction({ action: 'remove', id: workflow.id }),
              );
            button.disabled = true;
            try {
              const result = await this.api.workflowAction({
                action: 'run',
                id: workflow.id,
                variables: JSON.parse(this.$('workflow-variables').value || '{}'),
              });
              this.$('workflow-status').textContent = this.ui.text(result.confirmation);
            } finally {
              button.disabled = false;
            }
          });
        row.append(button);
      }
      list.append(row);
    }
  }
}
