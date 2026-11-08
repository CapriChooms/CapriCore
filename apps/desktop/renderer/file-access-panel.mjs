export class FileAccessPanel {
  constructor({ api, ui, onOpen, onError }) {
    Object.assign(this, { api, ui, onOpen, onError });
    this.panel = document.getElementById('file-access-panel');
    document.getElementById('file-recovery-refresh').onclick = () => this.recovery();
    document.getElementById('file-access-close').addEventListener('click', () => this.open(false));
    document.getElementById('file-access-add').addEventListener('click', async () => {
      try {
        this.show(await api.addFileFolder());
      } catch {
        onError(
          'This folder cannot be added. Choose a personal folder outside system and Capri application data.',
        );
      }
    });
    document.getElementById('file-access-clear').addEventListener('click', () =>
      api
        .clearFileFolders()
        .then((value) => this.show(value))
        .catch(() => onError('File access could not be revoked.')),
    );
  }
  show(value) {
    const list = document.getElementById('file-access-list');
    list.replaceChildren();
    document.getElementById('file-access-warning').textContent = this.ui.text(value.warning ?? '');
    document.getElementById('file-access-empty').hidden = Boolean(value.scopes.length);
    for (const scope of value.scopes) {
      const row = document.createElement('div');
      row.className = 'file-scope';
      const name = document.createElement('strong');
      name.textContent = scope.label;
      name.dataset.untranslated = 'true';
      const path = document.createElement('p');
      path.textContent = scope.root;
      path.className = 'settings-help';
      path.dataset.untranslated = 'true';
      const label = document.createElement('label');
      label.className = 'dimming-switch';
      const write = document.createElement('input');
      write.type = 'checkbox';
      write.checked = scope.write;
      label.append(write, this.ui.text('Allow file changes'));
      write.addEventListener('change', () =>
        this.api
          .setFileFolderWrite({ id: scope.id, write: write.checked })
          .then((v) => this.show(v))
          .catch(() => this.onError('Folder permissions could not be saved.')),
      );
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'danger-action';
      revoke.textContent = this.ui.text('Revoke folder access');
      revoke.addEventListener('click', () =>
        this.api
          .revokeFileFolder(scope.id)
          .then((v) => this.show(v))
          .catch(() => this.onError('Folder access could not be revoked.')),
      );
      row.append(name, path, label, revoke);
      list.append(row);
    }
    this.ui?.apply(this.ui.language);
  }
  async recovery() {
    try {
      const list = document.getElementById('file-recovery-list');
      list.replaceChildren();
      for (const row of await this.api.fileRecovery()) {
        const card = document.createElement('article');
        card.className = 'action-entry';
        const label = document.createElement('p');
        label.textContent = row.relative;
        label.dataset.untranslated = 'true';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = this.ui.text('Restore');
        button.onclick = async () => {
          button.disabled = true;
          try {
            await this.api.restoreFile(row.id);
          } catch (error) {
            this.onError(error.message);
          } finally {
            button.disabled = false;
          }
        };
        const purge = document.createElement('button');
        purge.type = 'button';
        purge.className = 'danger-action';
        purge.textContent = this.ui.text('Delete permanently');
        purge.onclick = async () => {
          purge.disabled = true;
          try {
            const result = await this.api.purgeRecovery(row.id);
            if (!result.cancelled) await this.recovery();
          } catch (error) {
            this.onError(error.message);
          } finally {
            purge.disabled = false;
          }
        };
        const actions = document.createElement('div');
        actions.className = 'settings-actions';
        actions.append(button, purge);
        card.append(label, actions);
        list.append(card);
      }
      if (!list.childElementCount) list.textContent = this.ui.text('No recovery copies.');
    } catch (error) {
      this.onError(error.message);
    }
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (open) document.getElementById('file-access-add').focus();
    else document.getElementById('settings-open')?.focus();
  }
}
