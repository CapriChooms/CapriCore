// SPDX-License-Identifier: GPL-3.0-only
export class ComputerAppearancePanel {
  constructor({ api, ui, onError, container, deferDrafts = false }) {
    Object.assign(this, { api, ui, onError, deferDrafts });
    this.card = document.createElement('div');
    this.card.className = 'settings-card';
    this.card.innerHTML = `<h3>Control effects</h3>
      <p class="settings-help">Procedural effects stay at the screen edges. The center stays clear. Press Esc to stop computer control.</p>
      <label class="dimming-switch"><input id="computer-fx-enabled" type="checkbox"> Enable edge effects</label>
      <label for="computer-fx-theme">Control style</label><select id="computer-fx-theme"><option value="capri">Capri</option><option value="blackwall">Blackwall</option></select>
      <label for="computer-fx-intensity">Effect intensity <output id="computer-fx-intensity-value"></output></label><input id="computer-fx-intensity" type="range" min="0" max="100" step="1">
      <label class="dimming-switch"><input id="computer-fx-cursor" type="checkbox"> Capri cursor and trail</label>
      <label for="computer-fx-motion">Pointer movement duration <output id="computer-fx-motion-value"></output></label><input id="computer-fx-motion" type="range" min="0" max="1000" step="20">
      <p class="settings-help">Zero makes the pointer move instantly. Higher values make its movement slower and smoother.</p>
      <div class="settings-actions"><button id="computer-fx-preview" type="button">Preview effects for 3 seconds</button></div>
      <p class="settings-help">Preview the current effect. Save when closing Settings to keep your changes.</p>`;
    container.append(this.card);
    for (const id of ['enabled', 'theme', 'intensity', 'cursor', 'motion'])
      this.get(id).onchange = () => {
        this.outputs();
        if (!this.deferDrafts) void this.save();
      };
    for (const id of ['intensity', 'motion']) this.get(id).oninput = () => this.outputs();
    this.get('preview').onclick = async () => {
      const button = this.get('preview');
      button.disabled = true;
      try {
        await api.previewComputerAppearance(this.draft());
      } catch (e) {
        onError(e.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  get(id) {
    return this.card.querySelector('#computer-fx-' + id);
  }
  outputs() {
    this.get('intensity-value').textContent = this.get('intensity').value + '%';
    this.get('motion-value').textContent = this.get('motion').value + ' ms';
    this.get('intensity').disabled = !this.get('enabled').checked;
  }
  show(value) {
    this.value = value;
    this.get('enabled').checked = value.enabled;
    this.get('theme').value = value.theme;
    this.get('intensity').value = value.intensity;
    this.get('cursor').checked = value.cursor;
    this.get('motion').value = value.pointerDuration;
    this.outputs();
    this.ui.apply(this.ui.language);
  }
  async open() {
    this.show(await this.api.computerAppearance());
  }
  draft() {
    return {
      enabled: this.get('enabled').checked,
      theme: this.get('theme').value,
      intensity: Number(this.get('intensity').value),
      cursor: this.get('cursor').checked,
      pointerDuration: Number(this.get('motion').value),
    };
  }
  async save() {
    try {
      this.show(await this.api.setComputerAppearance(this.draft()));
      return true;
    } catch (e) {
      this.onError(e.message);
      if (!this.deferDrafts) await this.open();
      return false;
    }
  }
}
