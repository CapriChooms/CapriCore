// SPDX-License-Identifier: GPL-3.0-only
import { PrivateMemoryPanel } from './private-memory-panel.mjs';
export class KnowledgePanel {
  constructor({ api, ui, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.id = 'knowledge-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.innerHTML =
      '<h2>Brain and private memory</h2><div class="preferences-content"><div class="settings-card"><h3>Local Brain folder</h3><p>Drop TXT, Markdown, Word (DOCX), ODT or text PDF documents into Brain. Capri retrieves relevant excerpts locally. Scanned PDFs need text recognition first.</p><label><input id="brain-enabled" type="checkbox">Use local knowledge</label><label><input id="brain-api" type="checkbox">Allow relevant Brain excerpts to be sent to an external API</label><div class="settings-actions"><button id="brain-folder" type="button">Open Brain folder</button><button id="brain-refresh" type="button">Refresh index</button></div><p id="brain-status" role="status"></p><label for="brain-query">Test knowledge search</label><input id="brain-query" type="search" maxlength="500"><button id="brain-search" type="button">Search Brain</button><div id="brain-results" data-untranslated></div></div><div id="private-memory-controls"></div></div>';
    document.getElementById('companion').append(this.panel);
    this.panel.dataset.panelCut = '12';
    for (const paragraph of this.panel.querySelectorAll('.settings-card > p:not([id])'))
      paragraph.classList.add('settings-help');
    this.privateMemory = new PrivateMemoryPanel({
      element: this.panel.querySelector('#private-memory-controls'),
      api,
      ui,
      onError,
    });
    const $ = (id) => this.panel.querySelector('#' + id);
    for (const id of ['brain-enabled', 'brain-api'])
      $(id).onchange = () =>
        this.run(async () =>
          this.show(
            await api.brainAction({
              action: 'configure',
              enabled: $('brain-enabled').checked,
              shareWithApi: $('brain-api').checked,
            }),
          ),
        );
    $('brain-folder').onclick = () => this.run(() => api.brainAction({ action: 'open' }));
    $('brain-refresh').onclick = () =>
      this.run(async () => this.show(await api.brainAction({ action: 'refresh' })));
    $('brain-search').onclick = () =>
      this.run(async () => {
        const rows = await api.brainAction({ action: 'search', query: $('brain-query').value });
        const list = $('brain-results');
        list.replaceChildren();
        for (const row of rows) {
          const item = document.createElement('article'),
            source = document.createElement('strong'),
            text = document.createElement('p');
          source.textContent = row.source + ' · ' + row.page;
          text.textContent = row.content;
          item.className = 'saved-memory-note';
          item.append(source, text);
          list.append(item);
        }
        if (!rows.length) list.textContent = ui.text('No matching knowledge found.');
      });
  }
  async run(work) {
    try {
      return await work();
    } catch (error) {
      this.onError(error.message);
    }
  }
  async open({ privateMemory = true } = {}) {
    this.show(await this.api.brainAction({ action: 'status' }));
    if (privateMemory) await this.privateMemory.open();
  }
  show(value) {
    this.panel.querySelector('#brain-enabled').checked = value.enabled;
    this.panel.querySelector('#brain-api').checked = value.shareWithApi;
    this.panel.querySelector('#brain-refresh').disabled = value.busy;
    this.panel.querySelector('#brain-search').disabled = value.busy;
    this.panel.querySelector('#brain-status').textContent =
      this.ui.text(value.busy ? 'Indexing documents…' : 'Documents indexed') +
      ': ' +
      value.indexed +
      ' · ' +
      this.ui.text('Skipped') +
      ': ' +
      value.skipped;
  }
}
