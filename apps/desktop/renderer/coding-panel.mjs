// SPDX-License-Identifier: GPL-3.0-only
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
      <p class="settings-help">Capri works directly with one approved project. Full computer control is not required. Files stay local unless your selected model is an external provider.</p>
      <label>Project folder<input type="text" data-code="workspace" readonly placeholder="Choose a project folder"></label>
      <div class="settings-actions"><button data-code="folder">Choose project folder</button><button data-code="clear">Revoke project access</button></div>
      <h3>Editor</h3><label>Editor integration<select data-code="kind"><option value="vscode">VS Code / Cursor / Windsurf / VSCodium</option><option value="jetbrains">JetBrains IDEs</option><option value="visual-studio">Visual Studio</option><option value="sublime">Sublime Text</option><option value="notepad++">Notepad++</option><option value="neovim">Neovim GUI</option><option value="emacs">Emacs client</option></select></label>
      <input type="text" data-code="editor" readonly placeholder="Select the editor executable"><div class="settings-actions"><button data-code="pickEditor">Choose editor</button><button data-code="detect">Find editors</button></div><div data-code="editors" class="settings-actions"></div>
      <p class="settings-help">Files open at the requested line through the editor’s native CLI. Save editor buffers before asking Capri to edit them. Capri refuses stale file hashes instead of overwriting newer disk changes.</p>
      <div data-code="bridgeOptions" hidden><label><input type="checkbox" data-code="bridge"> Use live documents and diagnostics (VS Code-compatible editors)</label><button data-code="installBridge" disabled>Install editor bridge</button><p class="settings-help">Save project access first, then install the bridge and reload your editor. It connects only to a trusted workspace on this PC. Unsaved edits are protected.</p></div>
      <h3>Approved build and test tasks</h3><p class="settings-help">A task runs your project code with your Windows account. Approve only trusted projects. The model cannot change these commands or start a shell.</p>
      <div data-code="tasks"></div><label>Task name<input type="text" data-code="taskName" maxlength="60" placeholder="Unit tests"></label><input type="text" data-code="taskExe" readonly placeholder="Choose node.exe, dotnet.exe or another build tool"><button data-code="pickTask">Choose task executable</button><label>Arguments (JSON array)<input type="text" data-code="taskArgs" placeholder='["--test"]' value='[]'></label><button data-code="addTask">Add approved task</button>
      <div class="settings-actions"><button data-code="save">Save project access</button><button data-code="enable">Enable coding mode</button></div><p data-code="status" role="status" aria-live="polite"></p></div>`;
    document.getElementById('companion').append(this.panel);
    this.get = (key) => this.panel.querySelector(`[data-code="${key}"]`);
    this.get('kind').onchange = () => this.selectEditor(this.get('kind').value, '');
    const action = (key, fn) => (this.get(key).onclick = () => this.run(fn));
    action('folder', async () => {
      const value = await api.coding({ op: 'folder' });
      if (value) this.get('workspace').value = value;
    });
    action('clear', async () => {
      this.get('workspace').value = '';
      this.show(await api.coding({ op: 'save', value: this.value() }));
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
      const choices = await api.coding({ op: 'editors' });
      this.get('editors').replaceChildren();
      for (const editor of choices) {
        const button = document.createElement('button');
        button.textContent = editor.name;
        button.onclick = () => this.selectEditor(editor.kind, editor.executable);
        this.get('editors').append(button);
      }
      if (!choices.length)
        this.get('status').textContent = ui.text(
          'No known editor found. Choose its executable manually.',
        );
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
    action('installBridge', async () => {
      await api.coding({ op: 'install-bridge' });
      this.get('status').textContent = ui.text(
        'Editor bridge installed. Reload the editor and open your trusted project.',
      );
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
      this.savedEditor?.kind !== kind ||
      this.savedEditor?.executable !== executable;
  }
  value() {
    return {
      workspace: this.get('workspace').value,
      editor: this.get('editor').value
        ? { executable: this.get('editor').value, kind: this.get('kind').value }
        : null,
      tasks: this.tasks,
      bridge: !this.get('bridge').disabled && this.get('bridge').checked,
    };
  }
  show(value) {
    const config = value.config;
    this.savedEditor = config.editor;
    this.get('workspace').value = config.workspace;
    this.get('editor').value = config.editor?.executable ?? '';
    this.get('kind').value = config.editor?.kind ?? 'vscode';
    this.tasks = config.tasks;
    this.get('bridge').checked = config.bridge === true;
    this.renderEditor();
    this.enabled = value.enabled;
    this.renderTasks();
    this.renderMode();
  }
  renderMode() {
    this.get('enable').textContent = this.ui.text(
      this.enabled ? 'Coding mode: On' : 'Enable coding mode',
    );
    this.get('enable').setAttribute('aria-pressed', String(this.enabled));
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
    try {
      await fn();
    } catch (error) {
      this.get('status').textContent = error.message;
      this.onError(error.message);
    }
  }
  async open() {
    if (this.api.coding) this.show(await this.api.coding({ op: 'status' }));
    this.ui.apply(this.ui.language);
    return true;
  }
}
