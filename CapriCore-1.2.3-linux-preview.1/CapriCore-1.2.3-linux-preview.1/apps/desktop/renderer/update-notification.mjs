// SPDX-License-Identifier: GPL-3.0-only
const tagPattern =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function notificationTag(status) {
  const tag = status?.notification?.tag;
  if (typeof tag !== 'string' || tag.length > 80) return '';
  const match = tagPattern.exec(tag);
  if (!match || match[1]?.split('.').some((part) => /^0\d+$/.test(part))) return '';
  return tag;
}

/** An update invitation only: download, dismissal and restart policy belong to the host. */
export class UpdateNotification {
  constructor({ element, ui, onUpdate, onLater, onLayout = () => {}, onError = () => {} }) {
    Object.assign(this, { element, ui, onUpdate, onLater, onLayout, onError });
    this.tag = '';
    this.pending = null;
    this.dismissed = new Set();
    element.hidden = true;
    element.classList.add('update-notification');
    element.dataset.panelCut = '10';
    element.dataset.hitRegion = '';
    element.dataset.untranslated = '';
    element.setAttribute('role', 'region');

    const doc = element.ownerDocument;
    const node = (name, className) => {
      const child = doc.createElement(name);
      child.className = className;
      return child;
    };
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'update-notification-icon');
    icon.setAttribute('viewBox', '0 0 28 28');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    for (const [className, d] of [
      ['update-notification-circuit', 'M9 3H4v6m15-6h5v6M4 19v5h5m10 0h5v-5'],
      ['update-notification-arrow', 'M14 6v12m-5-5 5 5 5-5M9 22h10'],
    ]) {
      const line = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('class', className);
      line.setAttribute('d', d);
      icon.append(line);
    }
    const content = node('div', 'update-notification-content');
    this.label = node('span', 'update-notification-label');
    this.headline = node('p', 'update-notification-headline');
    this.headline.setAttribute('role', 'status');
    this.headline.setAttribute('aria-live', 'polite');
    this.headline.setAttribute('aria-atomic', 'true');
    content.append(this.label, this.headline);
    const actions = node('div', 'update-notification-actions');
    this.updateButton = node('button', 'update-notification-update');
    this.laterButton = node('button', 'update-notification-later');
    for (const button of [this.updateButton, this.laterButton]) button.type = 'button';
    this.updateButton.onclick = () => this.run('update');
    this.laterButton.onclick = () => this.run('later');
    actions.append(this.updateButton, this.laterButton);
    element.append(icon, content, actions);
    this.refresh();
  }

  show(status) {
    const tag = notificationTag(status);
    this.tag = this.dismissed.has(tag) ? '' : tag;
    this.refresh();
  }

  refresh() {
    const { element, ui, pending, tag } = this;
    element.hidden = !tag;
    element.setAttribute('aria-label', ui.text('Updates'));
    element.setAttribute('aria-busy', String(Boolean(pending)));
    element.dataset.busy = pending?.kind ?? '';
    this.label.textContent = ui.text('Updates');
    this.headline.textContent = tag
      ? ui.text('A new update is available: {version}', { version: tag })
      : '';
    this.updateButton.textContent = ui.text(
      pending?.kind === 'update' ? 'Downloading update...' : 'Update',
    );
    this.laterButton.textContent = ui.text('Remind me later');
    this.updateButton.disabled = Boolean(pending) || !tag || typeof this.onUpdate !== 'function';
    this.laterButton.disabled = Boolean(pending) || !tag || typeof this.onLater !== 'function';
    this.onLayout();
  }

  async run(kind) {
    const callback = kind === 'update' ? this.onUpdate : this.onLater;
    if (this.pending || !this.tag || typeof callback !== 'function') return;
    const tag = this.tag;
    this.pending = { tag, kind };
    this.refresh();
    try {
      await callback(tag);
      if (kind === 'later') {
        this.dismissed.add(tag);
        if (this.tag === tag) this.tag = '';
      }
    } catch (error) {
      this.onError(error?.message || this.ui.text('The update could not be completed.'));
    } finally {
      this.pending = null;
      this.refresh();
    }
  }
}
