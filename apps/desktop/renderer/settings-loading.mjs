// SPDX-License-Identifier: GPL-3.0-only
// No catalog, model or settings-data imports: paint a usable shell first.
const layout = document.getElementById('settings-layout');
document.getElementById('settings-window-close').onclick = () => {
  void window.capri.closeSettings().catch(console.error);
};
void window.capri.settingsLoading().catch(console.error);

export function panelLoading(value) {
  document.getElementById('companion').toggleAttribute('data-panel-loading', value);
  document.getElementById('companion').setAttribute('aria-busy', String(value));
}

export function finishSettingsLoading() {
  document.body.removeAttribute('data-settings-loading');
  layout.inert = false;
}
