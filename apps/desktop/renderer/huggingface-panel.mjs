// SPDX-License-Identifier: GPL-3.0-only
export class HuggingFacePanel {
  constructor({ api, ui, host, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.className = 'settings-card';
    this.panel.innerHTML = `
      <h3>Hugging Face</h3>
      <label for="hf-query">Model name or repository</label>
      <input id="hf-query" type="text" maxlength="160" placeholder="owner/model" autocomplete="off" data-untranslated>
      <label for="hf-task">Model type</label>
      <select id="hf-task"><option value="llm">Language models · GGUF</option><option value="tts">Voice models</option></select>
      <div class="settings-actions"><button id="hf-search" type="button">Search</button><button id="hf-inspect" type="button">Open repository</button></div>
      <div id="hf-results"></div>
      <section id="hf-details" hidden>
        <strong id="hf-repository" data-untranslated></strong><p id="hf-license"><span id="hf-license-name"></span><span id="hf-revision" data-untranslated></span></p>
        <label for="hf-file">Model file / quantization</label><select id="hf-file" data-untranslated></select>
        <label for="hf-projector">Vision projector</label><select id="hf-projector" data-untranslated></select>
        <p id="hf-compatibility" class="settings-help"></p>
        <button id="hf-voices" type="button" hidden>Voice models</button>
        <div class="settings-actions"><button id="hf-plan" type="button">Check download size</button><button id="hf-install" type="button" disabled>Download and prepare</button></div>
        <p id="hf-size"></p>
      </section>
      <p role="status" aria-live="polite"><span id="hf-status"></span><span id="hf-progress-size" data-untranslated></span></p><progress id="hf-progress" max="100" hidden></progress>
      <button id="hf-cancel" type="button" hidden>Cancel download</button>
      <p class="settings-help">After preparation, choose the downloaded model above and apply it. Model capabilities are checked by the local runtime.</p>
      <h4>Installed Hugging Face models</h4><div id="hf-installed"></div>
      <details><summary>Hugging Face access</summary><p class="settings-help">Public models work without a token. A read token can unlock private or approved gated models.</p>
        <label for="hf-token">Hugging Face token</label><input id="hf-token" type="password" autocomplete="off" maxlength="512" data-untranslated>
        <p id="hf-token-status"></p><div class="settings-actions"><button id="hf-save-token" type="button">Save token</button><button id="hf-remove-token" type="button">Remove token</button></div>
      </details>`;
    host.append(this.panel);
    this.get = (name) => this.panel.querySelector('#hf-' + name);
    const act = (name, fn) =>
      (this.get(name).onclick = async () => {
        this.get(name).disabled = true;
        try {
          const value = await fn();
          if (value) this.show(value);
        } catch (error) {
          onError(error.message);
        } finally {
          this.get(name).disabled = false;
          if (this.value) this.show(this.value);
        }
      });
    act('search', () =>
      api.searchHuggingFace({
        query: this.get('query').value.trim(),
        task: this.get('task').value,
      }),
    );
    act('inspect', () => api.inspectHuggingFace(this.get('query').value.trim()));
    act('plan', () =>
      api.planHuggingFace({
        repository: this.repositoryId(),
        revision: this.value.repository.revision,
        filename: this.get('file').value,
        projector: this.get('projector').value || null,
      }),
    );
    act('install', () => api.installHuggingFace());
    act('cancel', () => api.cancelHuggingFace());
    act('voices', async () => {
      await api.openSettings('languages');
    });
    act('save-token', async () => {
      const token = this.get('token').value;
      this.get('token').value = '';
      return api.saveHuggingFaceToken(token);
    });
    act('remove-token', () => api.removeHuggingFaceToken());
    for (const key of ['file', 'projector'])
      this.get(key).onchange = () => {
        this.get('install').disabled = true;
        this.get('size').textContent = '';
      };
  }
  repositoryId() {
    return (
      this.value?.repository?.repository ??
      this.value?.repository?.id ??
      this.value?.repository?.repoId
    );
  }
  size(bytes) {
    return Number.isFinite(bytes) ? `${(bytes / 1e9).toFixed(2)} GB` : '—';
  }
  button(label, fn, { identifier = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (identifier) button.dataset.untranslated = '';
    button.onclick = async () => {
      button.disabled = true;
      try {
        this.show(await fn());
      } catch (error) {
        this.onError(error.message);
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }
  show(value) {
    if (!value) return;
    const previous = this.value;
    this.value = value;
    const busy = !['idle', 'ready', 'error'].includes(value.phase);
    if (JSON.stringify(previous?.results) !== JSON.stringify(value.results)) {
      this.get('results').replaceChildren(
        ...(value.results ?? []).map((item) => {
          const id = item.repository ?? item.id ?? item.modelId;
          return this.button(id, () => this.api.inspectHuggingFace(id), { identifier: true });
        }),
      );
    }
    this.get('details').hidden = !value.repository;
    if (
      value.repository &&
      JSON.stringify(value.repository) !== JSON.stringify(previous?.repository)
    ) {
      const info = value.repository;
      this.get('voices').hidden = info.task !== 'tts';
      this.get('repository').textContent = this.repositoryId();
      const license = this.get('license-name');
      license.toggleAttribute('data-untranslated', Boolean(info.license));
      license.textContent = info.license || this.ui.text('License not specified');
      this.get('revision').textContent = info.revision ? ` · ${info.revision}` : '';
      const files = (info.files ?? []).filter((file) =>
        /\.gguf$/i.test(file.path ?? file.filename ?? file.name),
      );
      const isProjector = (file) => file.kind === 'projector';
      const options = (items) =>
        items.map((file) => {
          const name = file.path ?? file.filename ?? file.name;
          return new Option(`${name} · ${this.size(file.bytes ?? file.size)}`, name);
        });
      this.get('file').replaceChildren(...options(files.filter((file) => !isProjector(file))));
      if (info.selectedFilename && files.some((file) => file.path === info.selectedFilename))
        this.get('file').value = info.selectedFilename;
      this.get('projector').replaceChildren(
        new Option('—', ''),
        ...options(files.filter(isProjector)),
      );
      this.get('compatibility').textContent = this.ui.text(
        files.length
          ? 'Choose one quantization. Split model files are resolved together.'
          : 'This repository needs a compatible runtime. Select supported voice models in Languages.',
      );
      this.get('size').textContent = '';
    }
    const plan = value.plan;
    const size = this.get('size');
    size.replaceChildren();
    if (plan) {
      for (const [key, bytes] of [
        ['Download', plan.downloadBytes ?? plan.totalBytes],
        ['Required free space', plan.requiredBytes ?? plan.requiredDiskBytes],
        ['Free space', plan.diskFreeBytes],
      ]) {
        const label = document.createElement('span');
        label.textContent = this.ui.text(key);
        size.append(label, `: ${this.size(bytes)} · `);
      }
      size.append(
        `RAM (CPU) ≈ ${plan.estimatedCpuRamGiB ?? '?'} GiB · VRAM ≈ ${plan.estimatedVramGiB ?? '?'} GiB`,
      );
    }
    this.get('status').textContent = this.ui.text(
      value.error ??
        {
          idle: '',
          searching: 'Searching models…',
          checking: 'Checking model files…',
          downloading: 'Downloading model…',
          preparing: 'Preparing language model...',
          ready: 'The selected model is ready.',
          removing: 'Removing model…',
        }[value.phase] ??
        value.phase,
    );
    for (const name of [
      'search',
      'inspect',
      'plan',
      'task',
      'file',
      'projector',
      'save-token',
      'remove-token',
    ])
      this.get(name).disabled = busy;
    this.get('plan').disabled = busy || !this.get('file').value;
    const projector = this.get('projector').value;
    const plannedProjector =
      plan?.files?.find((file) =>
        value.repository?.files?.some(
          (source) => source.path === file.path && source.kind === 'projector',
        ),
      )?.path ?? '';
    this.get('install').disabled =
      busy ||
      !plan ||
      (Number.isFinite(plan.diskFreeBytes) && plan.diskFreeBytes < plan.requiredBytes) ||
      plannedProjector !== projector ||
      !plan.files?.some((file) => file.path === this.get('file').value);
    this.get('cancel').hidden = !busy;
    this.get('progress').hidden = !busy;
    const progress = value.progress;
    if (progress?.total)
      this.get('progress').value = Math.min(100, (progress.completed / progress.total) * 100);
    else this.get('progress').removeAttribute('value');
    this.get('progress-size').textContent = progress?.total
      ? ` ${this.size(progress.completed)} / ${this.size(progress.total)}`
      : '';
    this.get('token-status').textContent = this.ui.text(
      value.credentials?.hasToken ? 'Token saved securely' : 'No token saved',
    );
    if (JSON.stringify(previous?.installed) !== JSON.stringify(value.installed)) {
      this.get('installed').replaceChildren(
        ...(value.installed ?? []).map((item) => {
          const row = document.createElement('p');
          const label = document.createElement('span');
          label.textContent = `${item.repository} · ${this.size(item.totalBytes)} `;
          label.dataset.untranslated = '';
          row.append(
            label,
            this.button(this.ui.text('Repair model'), () => this.api.repairHuggingFace(item.id)),
            this.button(this.ui.text('Remove'), () => this.api.removeHuggingFace(item.id)),
          );
          return row;
        }),
      );
    }
  }
  async refresh() {
    this.show(await this.api.huggingFaceStatus());
  }
}
