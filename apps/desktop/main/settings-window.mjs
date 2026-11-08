// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { setWindowAlwaysOnTop } from './window-topmost.mjs';

export function settingsBounds(owner, area) {
  const width = Math.min(680, area.width - 24),
    height = Math.min(Math.max(400, owner.height), area.height - 24);
  let x = owner.x - width - 12;
  if (x < area.x) x = owner.x + owner.width + 12;
  return {
    width,
    height,
    x: Math.round(Math.max(area.x + 12, Math.min(x, area.x + area.width - width - 12))),
    y: Math.round(Math.max(area.y + 12, Math.min(owner.y, area.y + area.height - height - 12))),
  };
}

export function settingsHelpBounds(owner, areas, anchor, height) {
  const gap = 10;
  const minimumWidth = 210;
  const anchorY = owner.y + anchor;
  for (const side of ['right', 'left']) {
    const edge = side === 'right' ? owner.x + owner.width + gap : owner.x - gap;
    const candidates = areas.flatMap((area) => {
      if (anchorY < area.y || anchorY >= area.y + area.height) return [];
      if (side === 'right' && edge >= area.x + area.width) return [];
      if (side === 'left' && edge <= area.x) return [];
      const outer =
        side === 'right' ? Math.max(edge, area.x + gap) : Math.min(edge, area.x + area.width - gap);
      const available = side === 'right' ? area.x + area.width - gap - outer : outer - area.x - gap;
      const width = Math.min(344, available);
      if (width < minimumWidth) return [];
      const x = side === 'right' ? outer : outer - width;
      const h = Math.min(height, area.height - 2 * gap);
      const y = Math.max(area.y + gap, Math.min(anchorY - 14, area.y + area.height - h - gap));
      return [{ x, y, width, height: h, distance: Math.abs(edge - outer), side }];
    });
    if (candidates.length) {
      const { distance, ...bounds } = candidates.sort((a, b) => a.distance - b.distance)[0];
      if (distance < 96) return bounds;
    }
  }
  return null;
}

const settingsHelpUrl = 'capri://desktop/settings-help.html';
/** One lazy, sandboxed settings surface; models and capture stay with the owner. */
export class SettingsWindow {
  constructor({
    BrowserWindow,
    screen,
    owner,
    getOwnerDisplay = () => screen.getDisplayMatching(owner.getBounds()),
    directory,
    url,
    quitting,
    onBusy,
    onError,
    onRendererLost = () => {},
  }) {
    Object.assign(this, {
      BrowserWindow,
      screen,
      owner,
      getOwnerDisplay,
      directory,
      url,
      quitting,
      onBusy,
      onError,
      onRendererLost,
    });
    this.requested = false;
    this.ready = false;
    this.painted = false;
    this.contentReady = false;
    this.surfaceReady = false;
    this.surfacePending = null;
    this.navigationRevision = 0;
    this.sentRevision = null;
    this.docked = true;
    this.section = null;
    this.pendingEvents = new Map();
    this.helpRevision = 0;
    owner.on('move', () => this.reposition());
    owner.on('resize', () => this.reposition());
    owner.on('hide', () => this.hide());
    owner.on('minimize', () => this.hide());
    owner.on('always-on-top-changed', () => {
      if (this.window) setWindowAlwaysOnTop(this.window, owner.isAlwaysOnTop());
    });
    owner.on('show', () => {
      if (!this.requested) this.window?.hide();
    });
    owner.on('closed', () => this.destroy());
    for (const event of ['display-removed', 'display-metrics-changed'])
      screen.on(event, () => this.reposition(true));
  }
  get window() {
    return this.view && !this.view.isDestroyed() ? this.view : null;
  }
  snapshot() {
    const view = this.window;
    return {
      exists: Boolean(view),
      requested: this.requested,
      ready: this.ready,
      painted: this.painted,
      contentReady: this.contentReady,
      surfaceReady: this.surfaceReady,
      visible: this.surfaceReady && (view?.isVisible() ?? false),
      docked: this.docked,
    };
  }
  reposition(force = false) {
    if (!this.window || !this.requested || this.owner.isDestroyed() || (!this.docked && !force))
      return;
    const bounds = settingsBounds(this.owner.getBounds(), this.getOwnerDisplay().workArea);
    this.hideHelp(true);
    this.positioning = true;
    this.dockBounds = bounds;
    try {
      this.view.setBounds(bounds);
    } finally {
      this.positioning = false;
    }
  }
  async setHelp(value) {
    if (value === null) {
      this.hideHelp();
      return true;
    }
    const view = this.window;
    if (!view?.isVisible() || !this.requested || this.quitting()) return false;
    const owner = view.getContentBounds();
    const { title, text, y, palette } = value ?? {};
    if (
      typeof title !== 'string' ||
      title.length > 160 ||
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 2000 ||
      !Number.isInteger(y) ||
      y < 0 ||
      y > owner.height
    )
      throw new Error('Invalid settings help.');
    const areas = this.screen.getAllDisplays().map((display) => display.workArea);
    const placement = settingsHelpBounds(owner, areas, y, 120);
    if (!placement) return false;
    const revision = ++this.helpRevision;
    clearTimeout(this.helpHideTimer);
    const panel = (this.helpWindow ??= this.createHelpWindow(placement));
    try {
      await this.helpReady;
      if (this.helpRevision !== revision || panel.isDestroyed() || this.window !== view)
        return false;
      const colors = {};
      for (const key of ['--cyan', '--theme-panel', '--theme-border', '--theme-text']) {
        const color = palette?.[key];
        if (
          typeof color === 'string' &&
          /^(?:#[a-f\d]{3,8}|(?:rgb|hsl)a?\([\d.,%\s]+\))$/i.test(color)
        )
          colors[key] = color;
      }
      const { x, y: top, width, height, side } = placement;
      panel.setBounds({ x, y: top, width, height });
      const requestedHeight = await panel.webContents.executeJavaScript(
        `globalThis.capriSettingsHelp.prepare(${JSON.stringify({ title, text, colors, side })})`,
      );
      if (this.helpRevision !== revision || panel.isDestroyed() || this.window !== view)
        return false;
      if (!Number.isInteger(requestedHeight) || requestedHeight < 1 || requestedHeight > 800)
        throw new Error('Invalid settings help size.');
      const fitted = settingsHelpBounds(owner, areas, y, requestedHeight);
      if (fitted.height < requestedHeight) {
        this.hideHelp();
        return false;
      }
      panel.setBounds({ x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height });
      panel.showInactive();
      await panel.webContents.executeJavaScript('globalThis.capriSettingsHelp.show()');
      return this.helpRevision === revision;
    } catch {
      if (this.helpRevision === revision) this.hideHelp();
      return false;
    }
  }
  createHelpWindow({ x, y, width, height }) {
    const panel = new this.BrowserWindow({
      x,
      y,
      width,
      height,
      title: 'Capri Settings help',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      parent: this.window,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: false,
        backgroundThrottling: false,
      },
    });
    panel.setMenu(null);
    panel.setIgnoreMouseEvents(true);
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview'])
      panel.webContents.on(event, (e) => e.preventDefault());
    panel.once('closed', () => {
      if (this.helpWindow === panel) this.helpWindow = null;
    });
    this.helpReady = panel.loadURL(settingsHelpUrl);
    return panel;
  }
  hideHelp(notify = false, immediate = false) {
    const revision = ++this.helpRevision;
    const panel = this.helpWindow;
    clearTimeout(this.helpHideTimer);
    if (notify && panel) this.send({ type: 'settings.help-closed' });
    if (!panel || panel.isDestroyed()) return;
    if (immediate || !panel.isVisible()) {
      panel.hide();
      return;
    }
    if (panel.webContents.getURL() === settingsHelpUrl)
      void panel.webContents
        .executeJavaScript('globalThis.capriSettingsHelp.hide()')
        .catch(() => {});
    this.helpHideTimer = setTimeout(() => {
      if (this.helpRevision === revision && !panel.isDestroyed()) panel.hide();
    }, 160);
    this.helpHideTimer.unref?.();
  }
  present() {
    const view = this.window;
    if (
      !view ||
      !this.ready ||
      !this.painted ||
      !this.contentReady ||
      !this.requested ||
      this.quitting()
    )
      return;
    if (!this.surfaceReady) {
      if (!this.surfacePending) {
        const pending = this.prepareSurface(view);
        this.surfacePending = pending;
        void pending.finally(() => {
          if (this.surfacePending === pending) this.surfacePending = null;
        });
      }
      return;
    }
    view.webContents.setBackgroundThrottling(false);
    view.setOpacity(1);
    view.setIgnoreMouseEvents(false);
    if (!view.isVisible()) view.show();
    view.webContents.invalidate();
    view.focus();
    this.onBusy(true);
  }
  async prepareSurface(view) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.window !== view || !this.requested || this.quitting()) return;
      let timeout;
      try {
        view.webContents.setBackgroundThrottling(false);
        // The hidden Chromium frame can be ready before Windows has a backing
        // surface. Start the native window almost invisible and click-through.
        view.setOpacity(1 / 255);
        view.setIgnoreMouseEvents(true);
        view.showInactive();
        view.webContents.invalidate();
        const frame = await Promise.race([
          view.webContents.capturePage(undefined, { stayHidden: true }),
          new Promise((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Settings compositor frame timed out')),
              2500,
            );
            timeout.unref?.();
          }),
        ]);
        if (this.window !== view || !this.requested || this.quitting()) return;
        if (frame.isEmpty() || !view.isVisible())
          throw new Error('Settings compositor returned an empty or hidden frame');
        this.surfaceReady = true;
        this.present();
        return;
      } catch (error) {
        if (this.window !== view || !this.requested || this.quitting()) return;
        view.hide();
        if (attempt === 1) this.onError(error.message);
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  async open(section = null, focus = null) {
    if (this.quitting()) return;
    this.requested = true;
    this.section = section;
    this.focusTarget = section === 'models' && focus === 'context' ? 'context' : null;
    this.navigationRevision++;
    if (!this.window) {
      this.ready = false;
      this.painted = false;
      this.contentReady = false;
      this.docked = true;
      this.view = new this.BrowserWindow({
        ...settingsBounds(this.owner.getBounds(), this.getOwnerDisplay().workArea),
        // A native owned window can be restored by Windows along with Capri,
        // independently of our requested/ready state. Keep the reusable renderer
        // (and unsaved drafts), but manage this top-level surface explicitly.
        skipTaskbar: true,
        alwaysOnTop: this.owner.isAlwaysOnTop(),
        minimizable: false,
        maximizable: false,
        frame: false,
        show: false,
        opacity: 0,
        title: 'Capri Settings',
        minWidth: 400,
        minHeight: 400,
        backgroundColor: '#07131c',
        hasShadow: false,
        autoHideMenuBar: true,
        fullscreenable: false,
        webPreferences: {
          preload: path.join(this.directory, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
          // Allow the first populated UI to paint before showing the native
          // window. Normal throttling resumes only when hidden.
          backgroundThrottling: false,
          devTools: Boolean(process.env.CAPRI_DESKTOP_VERIFY),
        },
      });
      const view = this.view;
      setWindowAlwaysOnTop(view, this.owner.isAlwaysOnTop());
      this.view.setMenu(null);
      this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const event of ['will-navigate', 'will-attach-webview'])
        this.view.webContents.on(event, (e) => e.preventDefault());
      this.view.on('close', (e) => {
        if (!this.quitting() && this.ready) {
          e.preventDefault();
          this.send({ type: 'settings.close-request' });
        }
      });
      this.view.once('ready-to-show', () => {
        if (this.window !== view) return;
        this.painted = true;
        this.present();
      });
      this.view.on('hide', () => {
        if (this.window === view) {
          this.send({ type: 'settings.visibility', visible: false });
          this.hideHelp(true, true);
          view.webContents.setBackgroundThrottling(true);
          this.onBusy(false);
        }
      });
      this.view.on('show', () => {
        if (this.window !== view) return;
        if (
          !this.ready ||
          !this.painted ||
          !this.contentReady ||
          !this.requested ||
          this.quitting()
        ) {
          view.hide();
          return;
        }
        this.send({ type: 'settings.visibility', visible: true });
      });
      this.view.on('closed', () => {
        if (this.view !== view) return;
        this.clear();
      });
      this.view.on('unresponsive', () => {
        if (this.window === view && !this.quitting())
          this.onError('Settings window became unresponsive: ' + JSON.stringify(this.snapshot()));
      });
      this.dockBounds = this.view.getBounds();
      this.view.on('move', () => {
        if (this.window !== view) return;
        this.hideHelp(true, true);
        const bounds = view.getBounds();
        if (
          !this.positioning &&
          (!this.dockBounds ||
            ['x', 'y'].some((key) => Math.abs(bounds[key] - this.dockBounds[key]) > 1))
        )
          this.docked = false;
      });
      this.view.on('resize', () => {
        if (this.window !== view) return;
        this.hideHelp(true, true);
        const bounds = view.getBounds();
        if (
          !this.positioning &&
          this.dockBounds &&
          ['width', 'height'].some((key) => Math.abs(bounds[key] - this.dockBounds[key]) > 1)
        )
          this.docked = false;
      });
      this.view.webContents.on('render-process-gone', (_e, details) => {
        if (this.window !== view || this.quitting()) return;
        const requested = this.requested;
        this.onError('Settings renderer stopped: ' + details.reason);
        this.destroy();
        if (requested) this.onRendererLost();
      });
      this.view.webContents.on('console-message', (details) => {
        if (details.level === 'error' || details.level >= 3)
          this.onError(String(details.message).slice(0, 2000));
      });
      try {
        await view.loadURL(this.url);
        if (this.window !== view) return;
      } catch (error) {
        if (this.window !== view || this.quitting()) return;
        this.onError('Settings failed to load: ' + error.message);
        this.destroy();
        throw error;
      }
    }
    if (!this.contentReady && this.requested) this.view.webContents.setBackgroundThrottling(false);
    this.reposition();
    if (this.ready && this.requested && !this.quitting()) {
      this.navigate();
      this.present();
    }
  }
  loaded() {
    if (!this.window || this.quitting()) return;
    this.ready = true;
    for (const event of this.pendingEvents.values()) this.send(event);
    this.pendingEvents.clear();
    this.navigate();
  }
  navigate() {
    if (!this.requested || this.sentRevision === this.navigationRevision) return;
    this.sentRevision = this.navigationRevision;
    this.send(
      this.section === null
        ? { type: 'settings.resume' }
        : { type: 'settings.navigate', section: this.section, focus: this.focusTarget },
    );
  }
  rendered() {
    if (!this.window || !this.ready || this.quitting()) return;
    this.contentReady = true;
    this.present();
    if (!this.requested) this.view.webContents.setBackgroundThrottling(true);
  }
  send(event) {
    if (!this.window || this.view.webContents.isCrashed?.()) return;
    if (this.ready) this.view.webContents.send('capri:event', event);
    else {
      this.pendingEvents.set(event.type, event);
      if (this.pendingEvents.size > 50)
        this.pendingEvents.delete(this.pendingEvents.keys().next().value);
    }
  }
  hide() {
    this.requested = false;
    this.window?.hide();
    this.window?.webContents.setBackgroundThrottling(true);
    this.onBusy(false);
  }
  destroy() {
    const view = this.window;
    this.clear();
    view?.destroy();
  }
  clear() {
    this.hideHelp(false, true);
    this.helpWindow?.destroy();
    this.helpWindow = null;
    this.requested = false;
    this.view = null;
    this.pendingEvents.clear();
    this.ready = false;
    this.painted = false;
    this.contentReady = false;
    this.surfaceReady = false;
    this.surfacePending = null;
    this.sentRevision = null;
    this.onBusy(false);
  }
}
