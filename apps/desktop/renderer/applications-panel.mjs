import { ComputerAppearancePanel } from './computer-appearance-panel.mjs';
export class ApplicationsPanel {
  constructor({ api, ui, onOpen, onError, deferDrafts = false }) {
    Object.assign(this, { api, ui, onOpen, onError });
    this.panel = document.getElementById('applications-panel');
    const pause = document.createElement('div');
    pause.className = 'settings-card';
    pause.innerHTML =
      '<h3>Application access</h3><p class="settings-help">Pause application actions without removing individual permissions.</p><button id="application-access-pause" type="button"></button>';
    (this.panel.querySelector('.preferences-content') ?? this.panel).prepend(pause);
    pause.querySelector('button').onclick = async (event) => {
      event.target.disabled = true;
      try {
        this.showAccess(await api.applicationAccess(!this.access?.enabled));
      } catch (error) {
        onError(error.message);
      } finally {
        event.target.disabled = false;
      }
    };
    const discover = document.createElement('div');
    discover.className = 'settings-card';
    discover.innerHTML =
      '<h3>Find installed applications</h3><label for="installed-app-query">Application name</label><input id="installed-app-query" type="search" maxlength="80" placeholder="Spotify, Discord…"><div class="settings-actions"><button id="installed-app-search" type="button">Search applications</button></div><p id="installed-app-status" role="status"></p><div id="installed-app-results"></div>';
    pause.after(discover);
    const search = discover.querySelector('#installed-app-search');
    search.onclick = async () => {
      search.disabled = true;
      const list = discover.querySelector('#installed-app-results');
      const status = discover.querySelector('#installed-app-status');
      list.replaceChildren();
      status.textContent = ui.text('Searching installed applications…');
      try {
        const matches = await api.discoverApps(discover.querySelector('input').value, true);
        status.textContent = matches.length
          ? ''
          : ui.text('No matching applications found. You can choose an executable manually.');
        for (const match of matches) {
          const row = document.createElement('article');
          row.className = 'action-entry';
          const name = document.createElement('strong');
          name.dataset.untranslated = '';
          name.textContent = match.name;
          const allow = document.createElement('button');
          allow.type = 'button';
          allow.textContent = ui.text('Allow launch');
          allow.onclick = async () => {
            allow.disabled = true;
            try {
              this.showCatalog(await api.grantDiscoveredApp(match.id));
              row.remove();
            } catch (error) {
              onError(error.message);
              allow.disabled = false;
            }
          };
          row.append(name, allow);
          list.append(row);
        }
      } catch (error) {
        status.textContent = ui.text(error.message);
      } finally {
        search.disabled = false;
      }
    };
    discover.querySelector('input').onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!search.disabled) search.click();
      }
    };
    const access = document.createElement('div');
    access.className = 'settings-card';
    access.innerHTML = `<h3>Full computer access <small class="beta-badge">BETA</small></h3>
      <p class="settings-help">Optional access to supported actions on local drives and applications without repeated confirmation. Windows permissions still apply. Turn this off to restore your individual grants.</p>
      <p id="computer-access-status" role="status"></p><button id="computer-access-toggle" type="button">Give full computer access</button>`;
    const controlPanel = document.createElement('section');
    controlPanel.id = 'computer-access-panel';
    controlPanel.className = 'preferences-panel';
    controlPanel.hidden = true;
    controlPanel.dataset.panelCut = '12';
    controlPanel.innerHTML =
      '<h2>Computer control <small class="beta-badge">BETA</small></h2><div class="preferences-content"></div>';
    controlPanel.querySelector('.preferences-content').append(access);
    const task = document.createElement('div');
    task.className = 'settings-card computer-task-card';
    task.innerHTML = `<h3>Computer control</h3>
      <p class="settings-help">Describe the whole task. Capri will act, check each result and stop when finished. Press Esc to stop.</p>
      <label for="computer-task-goal">Message Capri</label>
      <textarea id="computer-task-goal" rows="4" maxlength="8000"></textarea>
      <div class="settings-actions computer-task-actions"><button id="computer-task-run" type="button">Test</button>
      <p id="computer-task-status" role="status" aria-live="polite"></p>
      <button id="computer-task-stop" class="danger-action" type="button" hidden>Stop computer control (Esc)</button></div>`;
    controlPanel.querySelector('.preferences-content').append(task);
    this.appearance = new ComputerAppearancePanel({
      api,
      ui,
      onError,
      deferDrafts,
      container: controlPanel.querySelector('.preferences-content'),
    });
    document.getElementById('companion').append(controlPanel);
    const shortcut = document.createElement('button');
    shortcut.type = 'button';
    shortcut.textContent = 'Computer control';
    shortcut.onclick = () => api.openSettings('computer').catch((error) => onError(error.message));
    (this.panel.querySelector('.preferences-content') ?? this.panel).prepend(shortcut);
    document.getElementById('computer-access-toggle').onclick = async () => {
      const button = document.getElementById('computer-access-toggle');
      button.disabled = true;
      try {
        this.showComputerAccess(await api.setComputerAccess(!this.computerAccess?.enabled));
      } catch (error) {
        onError(error.message);
      } finally {
        this.showComputerAccess(await api.computerAccessStatus());
      }
    };
    document.getElementById('computer-task-run').onclick = async () => {
      const text = document.getElementById('computer-task-goal').value.trim();
      if (!text || this.taskPending || this.taskStatus?.active) return;
      this.taskPending = true;
      this.showComputerTask({ active: true, phase: 'planning', steps: 0 });
      try {
        await api.runComputerTask(text);
      } catch (error) {
        onError(error.message);
      } finally {
        this.taskPending = false;
        this.showComputerTask(await api.computerTaskStatus());
      }
    };
    document.getElementById('computer-task-stop').onclick = () =>
      api.stopComputerControl().catch((error) => onError(error.message));
    document.getElementById('catalog-add').onclick = async () => {
      try {
        this.showCatalog(await api.addCatalogApp());
      } catch (error) {
        onError(error.message);
      }
    };
    document.getElementById('catalog-journal-refresh').onclick = async () => {
      try {
        document.getElementById('catalog-journal').textContent = JSON.stringify(
          await api.desktopJournal(),
          null,
          2,
        );
      } catch (error) {
        onError(error.message);
      }
    };
    document.getElementById('applications-close').addEventListener('click', () => this.open(false));
    for (const [id, work] of [
      ['spotify-access', () => api.setSpotifyAccess(!this.spotify?.enabled)],
      ['spotify-repair', () => api.setSpotifyAccess(true)],
      ['spotify-check', () => api.checkSpotify()],
    ]) {
      document.getElementById(id).onclick = async () => {
        document.getElementById(id).disabled = true;
        try {
          const value = await work();
          if (value && typeof value === 'object') this.showSpotify(value);
        } catch (error) {
          this.onError(error.message);
        } finally {
          this.showSpotify(await api.spotifyStatus().catch(() => this.spotify));
        }
      };
    }
    for (const app of ['notepad', 'calculator'])
      document.getElementById('application-' + app).addEventListener('change', async () => {
        const value = {
          notepad: document.getElementById('application-notepad').checked,
          calculator: document.getElementById('application-calculator').checked,
        };
        for (const input of this.panel.querySelectorAll('input')) input.disabled = true;
        try {
          this.show(await api.setApplications(value));
        } catch {
          this.show(this.value);
          this.onError('Application permissions could not be saved.');
        } finally {
          for (const input of this.panel.querySelectorAll('input')) input.disabled = false;
        }
      });
  }
  show(value) {
    this.value = value;
    for (const app of ['notepad', 'calculator'])
      document.getElementById('application-' + app).checked = value[app];
    this.ui.apply(this.ui.language);
  }
  showAccess(value) {
    this.access = value;
    const button = document.getElementById('application-access-pause');
    button.textContent = this.ui.text(
      value.enabled ? 'Pause application access' : 'Enable application access',
    );
    button.setAttribute('aria-pressed', String(value.enabled));
    if (this.computerAccess)
      this.showComputerAccess({ ...this.computerAccess, paused: !value.enabled });
  }
  showComputerAccess(value) {
    this.computerAccess = value;
    const button = document.getElementById('computer-access-toggle');
    button.textContent = this.ui.text(
      value.enabled ? 'Revoke full computer access' : 'Give full computer access',
    );
    button.classList.toggle('danger-action', value.enabled);
    button.disabled = value.enabling || (value.paused && !value.enabled);
    document.getElementById('computer-access-status').textContent = this.ui.text(
      value.paused
        ? 'Application access is paused.'
        : value.enabled
          ? 'Full computer access is enabled.'
          : 'Individual application and folder grants are in use.',
    );
    if (this.taskStatus) this.showComputerTask(this.taskStatus);
    else document.getElementById('computer-task-run').disabled = !value.enabled || value.paused;
  }
  showComputerTask(value) {
    this.taskStatus = value;
    document.getElementById('computer-task-run').disabled =
      !this.computerAccess?.enabled ||
      this.computerAccess?.paused ||
      value.active ||
      this.taskPending;
    document.getElementById('computer-task-stop').hidden = !value.active && !this.taskPending;
    document.getElementById('computer-task-goal').disabled = value.active || this.taskPending;
    const labels = {
      observing: 'Observing the current window',
      planning: 'Thinking',
      acting: 'Performing the action',
      verifying: 'Checking the result',
      completed: 'Ready',
      stopped: 'Stopped',
      idle: 'Ready',
    };
    document.getElementById('computer-task-status').textContent = this.ui.text(
      labels[value.phase] ?? 'Ready',
    );
  }
  showCatalog(apps) {
    const list = document.getElementById('catalog-list');
    list.replaceChildren();
    for (const app of apps) {
      const card = document.createElement('article');
      card.className = 'action-entry';
      const name = document.createElement('strong');
      name.textContent = app.name;
      name.dataset.untranslated = '';
      const file = document.createElement('p');
      file.textContent = app.executable ?? app.packageId;
      file.dataset.untranslated = '';
      file.className = 'settings-help';
      card.append(name, file);
      for (const [key, title] of [
        ['launch', 'Allow launch'],
        ['inspect', 'Allow accessible field inspection'],
        ['text', 'Allow confirmed text entry'],
      ]) {
        const label = document.createElement('label');
        label.className = 'dimming-switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = app[key];
        input.disabled =
          (key === 'text' && !app.inspect) || (Boolean(app.packageId) && key !== 'launch');
        input.onchange = async () => {
          input.disabled = true;
          try {
            this.showCatalog(await this.api.updateCatalogApp({ id: app.id, [key]: input.checked }));
          } catch (error) {
            input.checked = app[key];
            input.disabled = false;
            this.onError(error.message);
          }
        };
        label.append(input, ' ' + this.ui.text(title));
        card.append(label);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = this.ui.text('Remove');
      remove.onclick = async () => {
        try {
          this.showCatalog(await this.api.updateCatalogApp({ id: app.id, remove: true }));
        } catch (error) {
          this.onError(error.message);
        }
      };
      card.append(remove);
      list.append(card);
    }
  }
  showSpotify(value) {
    if (!value) return;
    this.spotify = value;
    const busy = ['preparing', 'applying', 'checking'].includes(value.phase);
    document.getElementById('spotify-status').textContent = this.ui.text(
      value.phase === 'preparing'
        ? 'Preparing Spotify integration...'
        : value.phase === 'applying'
          ? 'Applying Spotify access...'
          : value.phase === 'checking'
            ? 'Checking Spotify connection...'
            : value.enabled && value.prepared
              ? 'Spotify control is enabled.'
              : value.enabled
                ? 'Spotify needs local setup. Repair the integration or disable access.'
                : 'Spotify control is disabled.',
    );
    const toggle = document.getElementById('spotify-access');
    toggle.disabled = busy;
    toggle.textContent = this.ui.text(value.enabled ? 'Disable Spotify' : 'Enable Spotify');
    const repair = document.getElementById('spotify-repair');
    repair.hidden = !value.enabled || value.prepared;
    repair.disabled = busy;
    document.getElementById('spotify-check').disabled = busy || !value.enabled || !value.prepared;
    document.getElementById('spotify-result').textContent = value.error
      ? this.ui.text(value.error)
      : value.connection === 'connected'
        ? this.ui.text('Connected to Spotify.')
        : value.connection === 'not-running'
          ? this.ui.text('Open Spotify and sign in, then check again.')
          : '';
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (open) {
      this.showAccess(await this.api.applicationAccess());
      this.showComputerAccess(await this.api.computerAccessStatus());
      this.showSpotify(await this.api.spotifyStatus());
      this.showCatalog(await this.api.appCatalog());
    }
    document.getElementById(open ? 'application-notepad' : 'settings-open').focus();
  }
}
