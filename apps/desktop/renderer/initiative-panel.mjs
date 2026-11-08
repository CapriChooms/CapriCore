export class InitiativePanel {
  constructor({ api, ui, onOpen, onError }) {
    Object.assign(this, { api, ui, onOpen, onError });
    this.panel = document.getElementById('initiative-panel');
    document.getElementById('initiative-test').onclick = () =>
      api.testInitiative().catch((error) => onError(error.message));
    document.getElementById('initiative-close').addEventListener('click', () => this.open(false));
    this.draft = () => ({
      ...this.value,
      level: document.getElementById('initiative-level').value,
      hourlyLimit:
        document.getElementById('initiative-hourly-limit').value === ''
          ? null
          : Number(document.getElementById('initiative-hourly-limit').value),
      quietStart: Number(document.getElementById('initiative-quiet-start').value),
      quietEnd: Number(document.getElementById('initiative-quiet-end').value),
      quietHoursEnabled: document.getElementById('initiative-quiet-enabled').checked,
      spontaneous: document.getElementById('initiative-spontaneous').checked,
      returnReactions: document.getElementById('initiative-return').checked,
      appReactions: document.getElementById('initiative-apps').checked,
      excludedApps: document
        .getElementById('initiative-exclusions')
        .value.split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    });
    this.save = async () => {
      const button = document.getElementById('initiative-apply');
      button.disabled = true;
      try {
        this.show(await api.setInitiative(this.draft()));
        return true;
      } catch {
        this.onError('Initiative settings could not be applied.');
        return false;
      } finally {
        button.disabled = false;
      }
    };
    document.getElementById('initiative-apply').addEventListener('click', this.save);
    document.getElementById('initiative-level').onchange = () => {
      const input = document.getElementById('initiative-hourly-limit');
      input.value = '';
      input.placeholder =
        document.getElementById('initiative-level').value === 'occasional' ? '10' : '30';
      input.disabled = document.getElementById('initiative-level').value === 'off';
    };
    document.getElementById('initiative-quiet-enabled').onchange = () => this.quietControls();
    document
      .getElementById('initiative-dismiss')
      .addEventListener('click', () =>
        api.dismissInitiative().catch(() => this.onError('The comment could not be dismissed.')),
      );
    document
      .getElementById('initiative-restore')
      .addEventListener('click', () =>
        api.restoreInitiative().catch(() => this.onError('Comment types could not be restored.')),
      );
  }
  show(value) {
    this.value = value;
    document.getElementById('initiative-hourly-limit').disabled = value.level === 'off';
    document.getElementById('initiative-hourly-limit').value = value.hourlyLimit ?? '';
    document.getElementById('initiative-hourly-limit').placeholder =
      value.level === 'occasional' ? '10' : '30';
    document.getElementById('initiative-level').value = value.level;
    document.getElementById('initiative-return').checked = value.returnReactions;
    document.getElementById('initiative-apps').checked = value.appReactions;
    document.getElementById('initiative-quiet-start').value = value.quietStart;
    document.getElementById('initiative-quiet-end').value = value.quietEnd;
    document.getElementById('initiative-quiet-enabled').checked =
      value.quietHoursEnabled ?? value.quietStart !== value.quietEnd;
    document.getElementById('initiative-spontaneous').checked = value.spontaneous !== false;
    this.quietControls();
    document.getElementById('initiative-exclusions').value = value.excludedApps.join(', ');
    this.ui.apply(this.ui.language);
  }
  status(value) {
    this.currentStatus = value;
    document.getElementById('initiative-status').textContent = this.ui.text(
      value.active
        ? 'App awareness active. No screen images or window contents are captured.'
        : value.status === 'failed'
          ? 'App awareness stopped. Apply settings to try again.'
          : 'App awareness is off.',
    );
    const indicator = document.getElementById('awareness-indicator');
    if (indicator) indicator.hidden = true;
    if (value.scheduling) this.activity(value.scheduling);
    else if (this.scheduling) this.activity(this.scheduling);
  }
  activity(value) {
    this.scheduling = value;
    const next =
      value.nextAt > Date.now()
        ? this.ui.text('Next attempt: {time}', {
            time: new Date(value.nextAt).toLocaleTimeString(this.ui.language, {
              hour: '2-digit',
              minute: '2-digit',
            }),
          })
        : '';
    document.getElementById('initiative-status').textContent =
      this.ui.text('Initiative status') +
      ': ' +
      this.ui.text(value.reason).replaceAll('_', ' ') +
      (next ? ' · ' + next : '');
  }
  quietControls() {
    for (const id of ['initiative-quiet-start', 'initiative-quiet-end'])
      document.getElementById(id).disabled = !document.getElementById('initiative-quiet-enabled')
        .checked;
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    document.getElementById(open ? 'initiative-level' : 'settings-open').focus();
  }
}
