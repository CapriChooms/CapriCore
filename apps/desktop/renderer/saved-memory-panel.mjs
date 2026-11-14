// SPDX-License-Identifier: GPL-3.0-only
/** Never render memory as HTML or treat it as interface text. */
export class SavedMemoryPanel {
  constructor({ element, toggle, api, ui }) {
    Object.assign(this, { element, toggle, api, ui });
    this.items = [];
    this.generation = 0;
    this.state = 'idle';
    element.innerHTML = `
      <div class="saved-memory-heading"><strong>Saved memories</strong><button type="button" id="saved-memory-refresh">Refresh</button></div>
      <p class="saved-memory-help">Facts Capri can recall in future conversations.</p>
      <label for="saved-memory-new">Add a memory</label><textarea id="saved-memory-new" rows="3" maxlength="280" placeholder="A fact you want Capri to remember…"></textarea><button id="saved-memory-add" type="button">Save memory</button><button id="saved-memory-cancel" type="button" hidden>Cancel</button><p id="saved-memory-receipt" role="status"></p>
      <input id="saved-memory-search" type="search" maxlength="200" placeholder="Search saved memories…" aria-label="Search saved memories…" autocomplete="off" spellcheck="false">
      <p id="saved-memory-status" role="status" aria-live="polite"></p>
      <ul id="saved-memory-list" data-untranslated aria-label="Saved memories"></ul>
      <p id="saved-memory-limit" hidden>Showing a limited list. Some notes could not be displayed.</p>`;
    this.search = element.querySelector('#saved-memory-search');
    this.list = element.querySelector('#saved-memory-list');
    this.status = element.querySelector('#saved-memory-status');
    this.limit = element.querySelector('#saved-memory-limit');
    this.refresh = element.querySelector('#saved-memory-refresh');
    toggle.setAttribute('aria-controls', element.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = () => (element.hidden ? this.open() : this.close());
    this.refresh.onclick = () => this.load();
    const add = element.querySelector('#saved-memory-add'),
      note = element.querySelector('#saved-memory-new'),
      receipt = element.querySelector('#saved-memory-receipt');
    const cancel = element.querySelector('#saved-memory-cancel');
    this.stopEditing = () => {
      this.editing = undefined;
      note.value = '';
      cancel.hidden = true;
    };
    cancel.onclick = this.stopEditing;
    add.onclick = async () => {
      if (!note.value.trim()) return;
      add.disabled = true;
      receipt.textContent = '';
      try {
        if (this.editing)
          await api.changeSavedMemory({ id: this.editing, text: note.value.trim() });
        else if ((await api.saveMemory(note.value.trim())).saved !== true)
          throw new Error('The memory could not be verified.');
        this.stopEditing();
        receipt.textContent = ui.text('Memory saved and verified.');
        await this.load();
      } catch (error) {
        receipt.textContent = ui.text(error.message);
      } finally {
        add.disabled = false;
      }
    };
    this.search.oninput = () => this.render();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.close();
    });
  }
  async open() {
    this.element.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.toggle.textContent = this.ui.text('Hide saved memories');
    await this.load();
    if (!this.element.hidden)
      (this.toggle.closest('[data-companion-group]') ?? this.element).scrollIntoView({
        block: 'start',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
  }
  close() {
    this.generation++;
    this.element.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.textContent = this.ui.text('View saved memories');
    this.items = [];
    this.search.value = '';
    this.stopEditing();
    this.element.querySelector('#saved-memory-receipt').textContent = '';
    this.list.replaceChildren();
    this.status.textContent = '';
    this.state = 'idle';
    this.limit.hidden = true;
    this.refresh.disabled = false;
    this.element.removeAttribute('aria-busy');
  }
  async load() {
    if (this.element.hidden) return;
    const generation = ++this.generation;
    this.state = 'loading';
    this.items = [];
    this.limit.hidden = true;
    this.render();
    try {
      const value = await this.api.readSavedMemory();
      if (generation !== this.generation || this.element.hidden) return;
      if (!value || !Array.isArray(value.items)) throw new Error('Invalid saved memory response');
      this.items = value.items;
      this.truncated = value.truncated === true || value.unavailable === true;
      this.state = value.unavailable && !this.items.length ? 'unavailable' : 'ready';
    } catch {
      if (generation !== this.generation || this.element.hidden) return;
      this.state = 'error';
    }
    this.render();
  }
  render() {
    if (this.element.hidden) return;
    const loading = this.state === 'loading';
    this.element.setAttribute('aria-busy', String(loading));
    this.refresh.disabled = loading;
    this.search.disabled = loading || ['error', 'unavailable'].includes(this.state);
    this.toggle.textContent = this.ui.text('Hide saved memories');
    this.refresh.textContent = this.ui.text('Refresh');
    this.list.setAttribute('aria-label', this.ui.text('Saved memories'));
    const query = this.search.value.normalize('NFKC').toLocaleLowerCase(this.ui.language).trim();
    const words = query.split(/\s+/u).filter(Boolean);
    const items = this.items.filter(({ text }) => {
      const content = text.normalize('NFKC').toLocaleLowerCase(this.ui.language);
      return words.every((word) => content.includes(word));
    });
    this.list.replaceChildren(
      ...items.map(({ text, id }) => {
        const item = document.createElement('li');
        item.className = 'saved-memory-note';
        const content = document.createElement('p');
        content.dir = 'auto';
        content.textContent = text;
        const actions = document.createElement('div');
        actions.className = 'settings-actions';
        const edit = document.createElement('button');
        const remove = document.createElement('button');
        edit.type = remove.type = 'button';
        edit.textContent = this.ui.text('Edit');
        remove.textContent = this.ui.text('Delete');
        edit.onclick = () => {
          const input = this.element.querySelector('#saved-memory-new');
          this.editing = id;
          input.value = text;
          this.element.querySelector('#saved-memory-cancel').hidden = false;
          input.focus();
        };
        remove.onclick = async () => {
          remove.disabled = true;
          const receipt = this.element.querySelector('#saved-memory-receipt');
          try {
            await this.api.changeSavedMemory({ id });
            if (this.editing === id) this.stopEditing();
            receipt.textContent = this.ui.text('Memory deleted.');
            await this.load();
          } catch (error) {
            receipt.textContent = this.ui.text(error.message);
            remove.disabled = false;
          }
        };
        actions.append(edit, remove);
        item.append(content, actions);
        return item;
      }),
    );
    let key = loading
      ? 'Loading saved memories…'
      : this.state === 'error'
        ? 'Saved memories could not be loaded. Try again.'
        : this.state === 'unavailable'
          ? 'Memory files are unavailable.'
          : !this.items.length
            ? 'No saved memories yet.'
            : !items.length
              ? 'No matching memories.'
              : words.length
                ? '{shown} of {total} memories'
                : '{count} saved memories';
    this.status.textContent = this.ui.text(key, {
      count: this.items.length,
      shown: items.length,
      total: this.items.length,
    });
    this.limit.hidden = !this.truncated || this.state !== 'ready';
  }
}
