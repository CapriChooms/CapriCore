// SPDX-License-Identifier: GPL-3.0-only
export class PrivateMemoryPanel {
  constructor({ element, api, ui, onError }) {
    Object.assign(this, { element, api, ui, onError });
    element.className = 'settings-card';
    element.innerHTML =
      '<h3>Locked private memory</h3><p>Encrypted on disk with your password. Private replies stay in this window and are erased when locked. They are not added to ordinary chat history. Forgotten passwords cannot be recovered.</p><label for="private-password">Password</label><input id="private-password" type="password" minlength="8" maxlength="256" autocomplete="off"><div class="settings-actions"><button type="button" id="private-unlock">Unlock</button><button type="button" id="private-lock">Lock now</button></div><p id="private-status" role="status"></p><div id="private-open" hidden><label for="private-note">Private note</label><textarea id="private-note" rows="3" maxlength="1200"></textarea><button type="button" id="private-save">Save private note</button><ul id="private-notes" data-untranslated></ul><h3>Private conversation</h3><p>This conversation bypasses ordinary history and tools. By default, private notes stay on this computer.</p><label><input id="private-api" type="checkbox">Allow this private request to use the selected external API</label><label for="private-message">Message Capri privately</label><textarea id="private-message" rows="3" maxlength="2000"></textarea><button type="button" id="private-send">Send privately</button><p id="private-reply" data-untranslated dir="auto"></p><label for="private-new-password">New password</label><input id="private-new-password" type="password" minlength="8" maxlength="256" autocomplete="off"><button id="private-change-password" type="button">Change password</button></div>';
    const $ = (id) => element.querySelector('#' + id);
    this.$ = $;
    $('private-new-password').previousElementSibling.insertAdjacentHTML(
      'beforebegin',
      '<label for="private-current-password">Current password</label><input id="private-current-password" type="password" minlength="8" maxlength="256" autocomplete="off">',
    );
    $('private-unlock').onclick = () =>
      this.run(async () => {
        const password = $('private-password').value;
        $('private-password').value = '';
        const value = await api.privateMemory({
          action: this.state?.exists ? 'unlock' : 'create',
          password,
        });
        this.show(value);
        if (value.unlocked) await this.load();
      });
    $('private-lock').onclick = () =>
      this.run(async () => this.show(await api.privateMemory({ action: 'lock' })));
    $('private-save').onclick = () =>
      this.run(async () => {
        const text = $('private-note').value;
        const rows = await api.privateMemory({ action: 'add', text });
        $('private-note').value = '';
        this.notes(rows);
      });
    $('private-send').onclick = () =>
      this.run(async () => {
        const text = $('private-message').value;
        $('private-send').disabled = true;
        $('private-reply').textContent = ui.text('Thinking');
        try {
          const result = await api.privateMemory({
            action: 'chat',
            text,
            allowApi: $('private-api').checked,
          });
          $('private-message').value = '';
          if (this.state?.unlocked) $('private-reply').textContent = result.text;
        } finally {
          $('private-send').disabled = false;
        }
      });
    $('private-change-password').onclick = () =>
      this.run(async () => {
        const oldPassword = $('private-current-password').value,
          password = $('private-new-password').value;
        $('private-current-password').value = '';
        $('private-new-password').value = '';
        this.show(await api.privateMemory({ action: 'password', oldPassword, password }));
      });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }
  async run(work) {
    try {
      return await work();
    } catch (error) {
      this.$('private-reply').textContent = '';
      this.onError(error.message);
    }
  }
  async open() {
    this.show(await this.api.privateMemory({ action: 'status' }));
    if (this.state.unlocked) await this.load();
  }
  async load() {
    this.notes(await this.api.privateMemory({ action: 'list' }));
  }
  notes(rows) {
    const list = this.$('private-notes');
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li'),
        text = document.createElement('p'),
        remove = document.createElement('button');
      text.textContent = row.text;
      text.dir = 'auto';
      remove.type = 'button';
      remove.textContent = this.ui.text('Remove');
      remove.onclick = () =>
        this.run(async () =>
          this.notes(await this.api.privateMemory({ action: 'remove', id: row.id })),
        );
      item.append(text, remove);
      list.append(item);
    }
  }
  clear() {
    for (const node of this.element.querySelectorAll('input,textarea')) {
      if (node.type === 'checkbox') node.checked = false;
      else node.value = '';
    }
    this.$('private-notes').replaceChildren();
    this.$('private-reply').textContent = '';
    this.$('private-open').hidden = true;
  }
  show(value) {
    this.state = value;
    if (!value.unlocked) this.clear();
    this.$('private-open').hidden = !value.unlocked;
    this.$('private-unlock').textContent = this.ui.text(
      value.exists ? 'Unlock' : 'Create private memory',
    );
    this.$('private-unlock').disabled = value.unlocked || value.busy;
    this.$('private-lock').disabled = !value.unlocked;
    this.$('private-status').textContent = this.ui.text(
      value.unlocked
        ? 'Private memory is unlocked. It locks after five minutes of inactivity.'
        : 'Private memory is locked.',
    );
  }
}
