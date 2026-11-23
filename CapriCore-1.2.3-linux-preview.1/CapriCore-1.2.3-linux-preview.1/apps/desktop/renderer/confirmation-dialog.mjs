// SPDX-License-Identifier: GPL-3.0-only
/** One modal confirmation surface; actions remain in their owning component. */
export class ConfirmationDialog {
  constructor({ ui, onChange }) {
    Object.assign(this, { ui, onChange });
    this.queue = Promise.resolve();
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'confirmation-dialog';
    this.dialog.dataset.hitRegion = '';
    this.dialog.setAttribute('aria-labelledby', 'confirmation-title');
    this.dialog.setAttribute('aria-describedby', 'confirmation-detail');
    this.dialog.innerHTML =
      '<div class="confirmation-card" data-panel-cut="12"><span class="confirmation-kicker">CAPRI // CONFIRM</span><h2 id="confirmation-title"></h2><p id="confirmation-detail"></p><div class="settings-actions" id="confirmation-actions"></div></div>';
    document.body.append(this.dialog);
  }
  ask(options) {
    const next = this.queue.then(() => (options.signal?.aborted ? 'cancel' : this.show(options)));
    this.queue = next.catch(() => 'cancel');
    return next;
  }
  show({ title, detail, confirmLabel = 'Confirm', danger = false, choices, delayMs = 0, signal }) {
    return new Promise((resolve) => {
      const previous = document.activeElement;
      this.dialog.querySelector('h2').textContent = this.ui.text(title);
      this.dialog.querySelector('p').textContent = this.ui.text(detail);
      const actions = this.dialog.querySelector('#confirmation-actions');
      actions.replaceChildren();
      const values = choices ?? [
        { id: 'cancel', label: 'Cancel' },
        { id: 'confirm', label: confirmLabel, danger },
      ];
      const finish = (choice) => {
        clearInterval(countdown);
        this.dialog.removeEventListener('cancel', cancel);
        signal?.removeEventListener('abort', abort);
        this.dialog.close();
        this.onChange(false);
        previous?.isConnected && previous.focus();
        resolve(choice);
      };
      const cancel = (event) => {
        event.preventDefault();
        finish('cancel');
      };
      const abort = () => finish('cancel');
      this.dialog.addEventListener('cancel', cancel);
      signal?.addEventListener('abort', abort, { once: true });
      const deadline = performance.now() + Math.max(0, delayMs);
      const delayed = [];
      for (const value of values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = this.ui.text(value.label);
        button.dataset.choice = value.id;
        if (value.danger) button.className = 'danger-action';
        if (value.id !== 'cancel' && delayMs > 0) delayed.push({ button, label: value.label });
        button.onclick = () => {
          if (!button.disabled) finish(value.id);
        };
        actions.append(button);
      }
      const update = () => {
        const seconds = Math.ceil(Math.max(0, deadline - performance.now()) / 1000);
        for (const { button, label } of delayed) {
          button.disabled = seconds > 0;
          button.textContent =
            seconds > 0
              ? this.ui.text('{label} ({seconds} s)', { label: this.ui.text(label), seconds })
              : this.ui.text(label);
        }
      };
      const countdown = delayed.length ? setInterval(update, 100) : null;
      update();
      this.dialog.showModal();
      this.onChange(true);
      (actions.querySelector('[data-choice="cancel"]') ?? actions.firstElementChild).focus();
    });
  }
}
