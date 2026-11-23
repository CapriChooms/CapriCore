// SPDX-License-Identifier: GPL-3.0-only
const changeLabels = {
  pending: 'Pending review',
  applied: 'Applied',
  discarded: 'Discarded',
  partial: 'Partially applied',
};

export class CodingPanel {
  constructor({ api, ui, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.id = 'coding-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.dataset.panelCut = '12';
    this.panel.dataset.hitRegion = '';
    this.panel.innerHTML = `<div class="settings-heading"><h2>Coding mode</h2></div><div class="preferences-content">
      <section class="settings-card">
      <p class="settings-help" data-inline-help>Capri works directly with one approved project. Full computer control is not required. Files stay local unless your selected model is an external provider.</p>
      <label>Project folder<input type="text" data-code="workspace" readonly placeholder="Choose a project folder"></label>
      <div class="settings-actions"><button type="button" data-code="folder">Choose project folder</button><button type="button" data-code="clear" disabled>Revoke project access</button></div>
      </section>
      <section class="settings-card">
      <h3>Editor</h3><label>Editor integration<select data-code="kind"><option value="vscode">VS Code / Cursor / Windsurf / VSCodium</option><option value="jetbrains">JetBrains IDEs</option><option value="visual-studio">Visual Studio</option><option value="sublime">Sublime Text</option><option value="notepad++">Notepad++</option><option value="neovim">Neovim GUI</option><option value="emacs">Emacs client</option></select></label>
      <input type="text" data-code="editor" readonly placeholder="Select the editor executable"><div class="settings-actions"><button type="button" data-code="pickEditor">Choose editor</button><button type="button" data-code="detect">Find editors</button><button type="button" data-code="openProject" disabled>Open project in editor</button></div><div data-code="editors" class="settings-actions"></div>
      <div data-code="bridgeOptions" hidden><label><input type="checkbox" data-code="bridge"> Use live documents and diagnostics (VS Code-compatible editors)</label><div class="settings-actions"><button type="button" data-code="installBridge" disabled>Install editor bridge</button><button type="button" data-code="checkBridge" hidden>Check editor connection</button></div><p data-code="editorStatus" role="status" hidden></p></div>
      </section>
      <section class="settings-card">
      <h3>Project activity</h3>
      <p data-code="monitorStatus" role="status" aria-live="polite"></p>
      <ul class="coding-activity" data-code="activity" hidden></ul>
      <p data-code="progress" role="status" hidden><strong>Latest coding step</strong> <span data-code="progressText" dir="auto" data-untranslated></span></p>
      </section>
      <section class="settings-card" data-code="reviewCard">
      <h3>Review changes</h3>
      <label><input type="checkbox" data-code="reviewWrites"> Review changes before writing</label>
      <p data-code="noChanges">No code changes yet.</p>
      <label data-code="changePicker" hidden>Change set<select data-code="batches"></select></label>
      <p data-code="changeSummary" dir="auto" data-untranslated hidden></p>
      <div class="coding-files" data-code="changedFiles" hidden></div>
      <pre class="coding-diff" data-code="diff" aria-label="File diff" tabindex="0" dir="ltr" data-untranslated hidden></pre>
      <p class="settings-help" data-code="truncated" hidden>The preview is shortened.</p>
      <div class="settings-actions" data-code="reviewActions" hidden><button type="button" data-code="openFile" hidden>Open file in editor</button><button type="button" data-code="apply" hidden>Apply changes</button><button type="button" data-code="discard" hidden>Discard changes</button></div>
      </section>
      <section class="settings-card">
      <h3>Approved build and test tasks</h3><p class="settings-help">A task runs your project code with your Windows account. Approve only trusted projects. The model cannot change these commands or start a shell.</p>
      <div data-code="tasks"></div><label>Task name<input type="text" data-code="taskName" maxlength="60" placeholder="Unit tests"></label><input type="text" data-code="taskExe" readonly placeholder="Choose node.exe, dotnet.exe or another build tool"><button data-code="pickTask">Choose task executable</button><label>Arguments (JSON array)<input type="text" data-code="taskArgs" placeholder='["--test"]' value='[]'></label><button data-code="addTask">Add approved task</button>
      </section>
      <div class="settings-actions"><button data-code="save">Save project access</button><button data-code="enable">Enable coding mode</button></div><p data-code="status" role="status" aria-live="polite"></p></div>`;
    document.getElementById('companion').append(this.panel);
    this.get = (key) => this.panel.querySelector(`[data-code="${key}"]`);
    this.get('kind').onchange = () => this.selectEditor(this.get('kind').value, '');
    const action = (key, fn) => (this.get(key).onclick = () => this.run(fn));
    action('folder', async () => {
      const value = await api.coding({ op: 'folder' });
      if (value) {
        this.get('workspace').value = value;
        this.renderProject();
      }
    });
    action('clear', async () => {
      const value = { ...this.savedConfig, workspace: '' };
      this.show(await api.coding({ op: 'save', value }));
    });
    for (const [key, target] of [
      ['pickEditor', 'editor'],
      ['pickTask', 'taskExe'],
    ])
      action(key, async () => {
        const value = await api.coding({ op: 'executable' });
        if (!value) return;
        if (target === 'editor') this.selectEditor(this.get('kind').value, value);
        else this.get(target).value = value;
      });
    action('detect', async () => {
      const detect = this.get('detect');
      const results = this.get('editors');
      detect.disabled = true;
      results.setAttribute('aria-busy', 'true');
      try {
        const choices = await api.coding({ op: 'editors' });
        const selectedKind = this.get('kind').value;
        choices.sort((a, b) => Number(b.kind === selectedKind) - Number(a.kind === selectedKind));
        results.replaceChildren(
          ...choices.map((editor) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = editor.name;
            button.title = editor.executable;
            button.onclick = () => this.selectEditor(editor.kind, editor.executable);
            return button;
          }),
        );
        this.get('status').textContent = choices.length
          ? ''
          : ui.text('No known editor found. Choose its executable manually.');
      } finally {
        detect.disabled = false;
        results.removeAttribute('aria-busy');
      }
    });
    action('addTask', async () => {
      this.tasks.push({
        id: this.get('taskName').value.trim(),
        executable: this.get('taskExe').value,
        args: JSON.parse(this.get('taskArgs').value),
      });
      this.renderTasks();
    });
    action('save', async () => this.show(await api.coding({ op: 'save', value: this.value() })));
    action('openProject', async () => {
      const result = await api.coding({ op: 'open-project' });
      if (result?.opened) this.get('status').textContent = ui.text('Project opened in the editor.');
    });
    action('openFile', () =>
      api.coding({ op: 'open-file', path: this.diffPath, line: this.diffLine }),
    );
    this.get('batches').onchange = () => {
      this.selectedBatch = this.get('batches').value;
      this.renderReview();
    };
    for (const key of ['apply', 'discard']) {
      action(key, async () => {
        if (this.selectedBatch !== this.changes?.pending?.id) return;
        const apply = key === 'apply';
        this.showChanges(await api.coding({ op: 'review', id: this.selectedBatch, apply }));
        this.get('status').textContent = ui.text(
          apply ? 'Changes approved.' : 'Changes discarded.',
        );
      });
    }
    action('installBridge', async () => {
      await api.coding({ op: 'install-bridge' });
      this.get('status').textContent = ui.text(
        'Editor bridge installed. Reload the editor and open your trusted project.',
      );
    });
    action('checkBridge', async () => {
      const { config } = await api.coding({ op: 'status' });
      this.bridgeConnected = config.bridgeConnected === true;
      this.renderProject();
    });
    action('enable', async () => {
      const value = await api.coding({ op: 'mode', enabled: !this.enabled });
      this.enabled = value.enabled;
      this.renderMode();
      this.get('status').textContent = value.projectRequired
        ? ui.text('Choose and save a project folder to enable coding mode.')
        : '';
    });
  }
  selectEditor(kind, executable) {
    this.get('kind').value = kind;
    this.get('editor').value = executable;
    this.get('status').textContent = '';
    this.renderEditor();
  }
  renderEditor() {
    const kind = this.get('kind').value;
    const executable = this.get('editor').value;
    const supportsBridge = kind === 'vscode';
    const bridge = this.get('bridge');
    this.get('bridgeOptions').hidden = !supportsBridge;
    bridge.disabled = !supportsBridge || !executable;
    if (bridge.disabled) bridge.checked = false;
    this.get('installBridge').disabled =
      bridge.disabled ||
      this.savedConfig?.editor?.kind !== kind ||
      this.savedConfig?.editor?.executable !== executable;
    this.renderProject();
  }
  renderProject() {
    const saved = this.savedConfig;
    this.get('clear').disabled = !saved?.workspace;
    this.get('openProject').disabled =
      !saved?.workspace ||
      !saved.editor ||
      saved.workspace !== this.get('workspace').value ||
      saved.editor.executable !== this.get('editor').value ||
      saved.editor.kind !== this.get('kind').value;
    const bridge = saved?.bridge && !this.get('openProject').disabled;
    this.get('checkBridge').hidden = !bridge;
    const status = this.get('editorStatus');
    status.hidden = !bridge;
    if (bridge)
      status.textContent = this.ui.text(
        this.bridgeConnected ? 'Editor bridge connected.' : 'Waiting for the editor bridge.',
      );
    this.updateReviewActions();
  }
  value() {
    return {
      workspace: this.get('workspace').value,
      editor: this.get('editor').value
        ? { executable: this.get('editor').value, kind: this.get('kind').value }
        : null,
      tasks: this.tasks,
      bridge: !this.get('bridge').disabled && this.get('bridge').checked,
      reviewWrites: this.get('reviewWrites').checked,
    };
  }
  show(value) {
    const config = value.config;
    if (this.savedConfig && this.savedConfig.workspace !== config.workspace)
      this.get('progress').hidden = true;
    this.get('workspace').value = config.workspace;
    this.get('editor').value = config.editor?.executable ?? '';
    this.get('kind').value = config.editor?.kind ?? 'vscode';
    this.tasks = [...config.tasks];
    this.get('bridge').checked = config.bridge === true;
    this.bridgeConnected = config.bridgeConnected === true;
    this.get('reviewWrites').checked = config.reviewWrites === true;
    this.savedConfig = {
      workspace: config.workspace,
      editor: config.editor,
      tasks: config.tasks,
      bridge: config.bridge === true,
      reviewWrites: config.reviewWrites === true,
    };
    this.renderEditor();
    this.enabled = value.enabled;
    this.renderTasks();
    this.renderMode();
    this.showMonitor(config.monitor);
    this.showChanges(value.changes);
  }
  renderMode() {
    this.get('enable').textContent = this.ui.text(
      this.enabled ? 'Coding mode: On' : 'Enable coding mode',
    );
    this.get('enable').setAttribute('aria-pressed', String(this.enabled));
  }
  onEvent(event) {
    if (event.type === 'coding.project') this.showMonitor(event.monitor);
    if (event.type === 'coding.changes') this.showChanges(event.changes);
    if (event.type === 'coding.settings' && typeof event.enabled === 'boolean') {
      this.enabled = event.enabled;
      this.renderMode();
    }
    if (event.type === 'coding.progress' && event.summary) {
      this.get('progressText').textContent = `${event.step} · ${event.summary}`;
      this.get('progress').hidden = false;
    }
  }
  time(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(this.ui.language) : '';
  }
  showMonitor(monitor) {
    const { watching, changes = [] } = monitor ?? {};
    const status = this.get('monitorStatus');
    const message = this.ui.text(
      watching ? 'Monitoring project files.' : 'Project monitoring is off.',
    );
    if (status.textContent !== message) status.textContent = message;
    const list = this.get('activity');
    list.hidden = changes.length === 0;
    list.replaceChildren(
      ...changes.map(({ path, kind, at }) => {
        const row = document.createElement('li');
        const file = document.createElement('span');
        file.textContent = path;
        file.dir = 'auto';
        file.dataset.untranslated = '';
        const metadata = document.createElement('small');
        metadata.textContent = [
          this.ui.text(kind === 'removed' ? 'Removed' : 'Changed'),
          this.time(at),
        ]
          .filter(Boolean)
          .join(' · ');
        row.append(file, metadata);
        return row;
      }),
    );
  }
  showChanges(changes) {
    const newPending = changes?.pending && changes.pending.id !== this.changes?.pending?.id;
    if (newPending) this.selectedBatch = changes.pending.id;
    this.changes = changes;
    this.renderReview();
    if (newPending) this.revealPending();
  }
  revealPending() {
    if (
      !this.panel.hidden &&
      this.changes?.pending &&
      this.selectedBatch === this.changes.pending.id
    )
      this.get('reviewCard').scrollIntoView({
        block: 'start',
        inline: 'nearest',
        behavior: 'instant',
      });
  }
  renderReview() {
    const { pending, recent = [] } = this.changes ?? {};
    const batches = pending ? [pending, ...recent] : recent;
    const batch = batches.find(({ id }) => id === this.selectedBatch) ?? batches[0];
    if (this.diffBatch !== batch?.id || !batch?.files.some(({ path }) => path === this.diffPath))
      this.clearDiff();
    this.selectedBatch = batch?.id;
    this.activeBatch = batch;
    this.get('noChanges').hidden = Boolean(batch);
    this.get('changePicker').hidden = !batch;
    this.get('changeSummary').hidden = !batch?.summary;
    this.get('changeSummary').textContent = batch?.summary ?? '';
    this.get('changedFiles').hidden = !batch;
    this.updateReviewActions();

    const picker = this.get('batches');
    picker.replaceChildren(
      ...batches.map(({ id, state, at }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = [this.ui.text(changeLabels[state]), this.time(at)]
          .filter(Boolean)
          .join(' · ');
        return option;
      }),
    );
    picker.value = batch?.id ?? '';
    this.get('changedFiles').replaceChildren(
      ...(batch?.files ?? []).map((file) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.path = file.path;
        button.setAttribute('aria-pressed', String(file.path === this.diffPath));
        const label = document.createElement('span');
        label.dir = 'auto';
        label.dataset.untranslated = '';
        label.textContent = file.path;
        const stat = document.createElement('span');
        stat.className = 'coding-file-stat';
        stat.dir = 'ltr';
        stat.dataset.untranslated = '';
        stat.textContent = `+${file.additions} −${file.deletions}`;
        button.append(label, stat);
        button.onclick = () => this.run(() => this.openDiff(batch.id, file.path));
        return button;
      }),
    );
  }
  clearDiff() {
    this.diffBatch = undefined;
    this.diffPath = undefined;
    this.get('diff').hidden = true;
    this.get('diff').replaceChildren();
    this.get('truncated').hidden = true;
  }
  updateReviewActions() {
    const batch = this.activeBatch;
    const pending = batch?.state === 'pending';
    const file = batch?.files.find(({ path }) => path === this.diffPath);
    const open = Boolean(file && (file.kind !== 'create' || batch.state === 'applied'));
    this.get('openFile').hidden = !open;
    this.get('openFile').disabled = this.get('openProject').disabled;
    this.get('apply').hidden = !pending;
    this.get('discard').hidden = !pending;
    this.get('reviewActions').hidden = !open && !pending;
  }
  async openDiff(id, path) {
    const result = await this.api.coding({ op: 'diff', id, path });
    if (this.selectedBatch !== id) return;
    this.diffBatch = id;
    this.diffPath = path;
    this.diffLine =
      result.lines.find(({ type, newLine }) => type === 'added' && newLine)?.newLine ??
      result.lines.find(({ type, oldLine }) => type === 'removed' && oldLine)?.oldLine ??
      1;
    this.updateReviewActions();
    for (const button of this.get('changedFiles').querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(button.dataset.path === path));
    const diff = this.get('diff');
    const code = document.createElement('code');
    for (const { type, text, oldLine, newLine } of result.lines) {
      const row = document.createElement('span');
      row.className = 'coding-diff-line';
      row.dataset.type = type;
      const mark = type === 'added' ? '+' : type === 'removed' ? '−' : ' ';
      const prefix = [oldLine, newLine].map((line) => String(line ?? '').padStart(4)).join(' ');
      row.textContent = type === 'gap' ? text || '…' : `${prefix} ${mark} ${text}`;
      code.append(row);
    }
    diff.replaceChildren(code);
    diff.hidden = false;
    diff.scrollTop = diff.scrollLeft = 0;
    this.get('truncated').hidden = !result.truncated;
  }
  renderTasks() {
    this.get('tasks').replaceChildren();
    for (const task of this.tasks) {
      const row = document.createElement('p'),
        label = document.createElement('span'),
        remove = document.createElement('button');
      label.textContent = task.id + ' ';
      remove.textContent = this.ui.text('Remove');
      remove.onclick = () => {
        this.tasks = this.tasks.filter((value) => value !== task);
        this.renderTasks();
      };
      row.append(label, remove);
      this.get('tasks').append(row);
    }
  }
  async run(fn) {
    if (this.running) return;
    this.running = true;
    this.panel.setAttribute('aria-busy', 'true');
    try {
      await fn();
    } catch (error) {
      this.get('status').textContent = error.message;
      this.onError(error.message);
    } finally {
      this.running = false;
      this.panel.setAttribute('aria-busy', 'false');
    }
  }
  async open() {
    if (this.api.coding) this.show(await this.api.coding({ op: 'status' }));
    this.ui.apply(this.ui.language);
    return true;
  }
}
