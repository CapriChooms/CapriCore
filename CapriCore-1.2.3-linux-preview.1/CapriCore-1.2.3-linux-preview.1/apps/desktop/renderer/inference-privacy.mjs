// SPDX-License-Identifier: GPL-3.0-only
export const API_DISCLOSURE =
  'Optional alternative to the local language model. Your messages, personality, relevant memory and tool results are sent to your chosen provider. Screen images are sent only when you enable vision and use screen features. Provider charges and privacy terms apply. Speech recognition remains local. Voice stays local unless you enable Voice API separately.';
export function inferencePrivacy(value, ui) {
  const node = document.getElementById('screen-privacy-help');
  if (node && value?.remote) {
    node.textContent = ui.text(API_DISCLOSURE);
    node.classList.add('settings-warning');
  }
}
