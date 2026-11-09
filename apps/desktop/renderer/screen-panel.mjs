import { ScreenWatch, waitForScreenFrame } from './screen-watch.mjs';
import { screenMosaic, screenPng } from './screen-mosaic.mjs';

const IMAGE_WARNING = 'The active model cannot read images or video frames.';
/** IPC may wrap a safe application message; never display arbitrary provider bodies. */
export function screenImageWarning(value) {
  const message = String(value?.message ?? value ?? '').replace(
    /^Error invoking remote method 'capri:[a-z-]+': (?:Error: )?/,
    '',
  );
  return [
    IMAGE_WARNING,
    'Enable vision for a compatible API model before sharing images.',
  ].includes(message)
    ? message
    : null;
}

export function screenSourceLabel(ui, kind, label) {
  if (kind === '') return ui.text('Choose a window or monitor…');
  if (kind === 'monitors') return ui.text('All monitors');
  return ui.text(kind === 'monitor' ? 'Monitor' : 'Window') + ': ' + label;
}

export function screenObservationText(ui, status = {}) {
  if (status.warning) return ui.text(IMAGE_WARNING);
  if (status.blocked)
    return (
      ui.text('Screen observation is off.') +
      ' ' +
      ui.text('API connections') +
      ' → ' +
      ui.text('This API model supports images')
    );
  if (!status.active) return ui.text('Screen observation is off.');
  if (status.analysing) return ui.text('Analysing selected source…');
  if (status.skipped) return ui.text('A screen update was skipped. Retrying later.');
  if (!status.lastAnalysedAt) return ui.text('Waiting for an idle moment to analyse.');
  return (
    ui.text('Last screen update') +
    ': ' +
    new Date(status.lastAnalysedAt).toLocaleTimeString(ui.language) +
    (status.changed ? ' · ' + ui.text('View changed; waiting for next update') : '')
  );
}

export class ScreenPanel {
  constructor({ api, ui, onOpen, onError, onSend, onFormChange = () => {} }) {
    Object.assign(this, { api, ui, onOpen, onError, onSend, onFormChange });
    this.onError = (message) => {
      const warning = screenImageWarning(message);
      this.formError = warning ? null : message;
      this.formWarning = warning;
      onError(warning ?? message, warning ? 'warning' : 'error');
      this.onFormChange();
    };
    this.panel = document.getElementById('screen-panel');
    this.generation = 0;
    this.ready = false;
    this.busy = false;
    this.monitorLabel = (number) =>
      this.ui.text('Monitor') + ' ' + number.toLocaleString(this.ui.language);
    this.watch = new ScreenWatch({
      api,
      video: document.getElementById('screen-live-preview'),
      mosaicPreview: document.getElementById('screen-live-mosaic'),
      monitorLabel: this.monitorLabel,
      onChange: () => this.watchControls(),
      onError: (message) => this.onError(message),
    });
    document
      .getElementById('screen-watch-start')
      .addEventListener('click', () => this.startWatch());
    document.getElementById('screen-watch-stop').addEventListener('click', () => this.watch.stop());
    document.getElementById('screen-watch-unlock').onclick = () => this.watch.stop();
    document.getElementById('screen-indicator').addEventListener('click', () => {
      void this.toggleWatch();
    });
    document.getElementById('screen-close').addEventListener('click', () => this.open(false));
    document.getElementById('screen-refresh').addEventListener('click', () => this.refresh());
    document.getElementById('screen-source').addEventListener('change', () => {
      this.watch.stop();
      this.clear();
      this.watchControls();
    });
    document.getElementById('screen-capture').addEventListener('click', () => this.capture());
    document.getElementById('screen-ask').addEventListener('click', () => this.ask());
    document
      .getElementById('screen-question')
      .addEventListener('input', () => this.availability(this.ready, this.busy));
  }
  async startWatch() {
    if (this.visionBlocked) return;
    const interval = document.getElementById('screen-watch-interval'),
      duration = document.getElementById('screen-watch-duration');
    if (!interval.reportValidity() || !duration.reportValidity()) return;
    const settings = {
      intervalMs: Number(interval.value) * 1000,
      durationMs: Number(duration.value) * 60000,
    };
    try {
      await this.api.setScreenSettings(settings);
    } catch (error) {
      this.onError(error.message);
      return;
    }
    this.clear();
    return this.watch.start({
      sourceId: document.getElementById('screen-source').value,
      ...settings,
    });
  }
  settings(value) {
    document.getElementById('screen-watch-interval').value = String(value.intervalMs / 1000);
    document.getElementById('screen-watch-duration').value = String(value.durationMs / 60000);
  }
  async toggleWatch() {
    if (this.watch.run || this.captureState?.active) {
      this.watch.stop();
      await this.api.cancelScreen().catch(() => {});
    } else if (
      !this.visionBlocked &&
      this.ready &&
      document.getElementById('screen-source').value
    ) {
      await this.startWatch();
    } else {
      if (this.visionBlocked) return this.onError(IMAGE_WARNING);
      if (!this.ready) return this.onError('Wait for the local core to finish starting.');
      this.remoteAttached = true;
      await this.refresh();
      const select = document.getElementById('screen-source');
      const sourceId = select.value || (await this.api.pickScreenSource());
      if (!sourceId) return;
      if (![...select.options].some((option) => option.value === sourceId))
        await this.refresh(sourceId);
      select.value = sourceId;
      if (select.value) await this.startWatch();
    }
  }
  refresh(selectedId) {
    if (!this.refreshing) {
      this.refreshing = this.refreshSources(selectedId).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }
  async refreshSources(selectedId = document.getElementById('screen-source').value) {
    this.watch.stop();
    this.clear();
    const revision = this.generation,
      select = document.getElementById('screen-source');
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = this.ui.text('Choose a window or monitor…');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    this.watchControls();
    try {
      const sources = await this.api.screenSources();
      if (revision !== this.generation || (this.panel.hidden && !this.remoteAttached)) return;
      for (const source of sources) {
        const option = document.createElement('option');
        option.value = source.id;
        option.dataset.kind = source.type;
        option.dataset.sourceLabel = source.label;
        option.dataset.untranslated = 'true';
        option.textContent = screenSourceLabel(this.ui, source.type, source.label);
        select.append(option);
      }
      if (sources.some((source) => source.id === selectedId)) select.value = selectedId;
      this.watchControls();
    } catch {
      if (revision === this.generation) this.onError('Screen sources could not be listed.');
    }
  }
  refreshLocale() {
    for (const option of document.querySelectorAll('#screen-source option')) {
      option.textContent = screenSourceLabel(
        this.ui,
        option.dataset.kind ?? '',
        option.dataset.sourceLabel,
      );
    }
    if (this.observationState) this.observation(this.observationState);
    this.watchControls();
    this.renderIndicator();
  }
  async capture() {
    this.clear();
    const revision = ++this.generation;
    const isCurrent = () => revision === this.generation;
    let stream, grant;
    const button = document.getElementById('screen-capture');
    button.disabled = true;
    try {
      grant = await this.api.prepareScreen(document.getElementById('screen-source').value);
      if (revision !== this.generation) throw new Error('Cancelled');
      this.captureId = grant.id;
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: 1,
        },
      });
      if (stream.getAudioTracks().length || stream.getVideoTracks().length !== 1)
        throw new Error('Unexpected capture tracks');
      if (!isCurrent()) throw new Error('Cancelled');
      let canvas;
      if (grant.allMonitors) {
        // The first track authorizes the selection. The mosaic comes from the leased set.
        for (const track of stream.getTracks()) track.stop();
        stream = null;
        const tiles = await this.api.screenMonitorFrames(grant.id);
        canvas = await screenMosaic(tiles, this.monitorLabel, isCurrent);
      } else {
        this.stream = stream;
        canvas = await snapshotCanvas(stream, isCurrent);
      }
      if (!isCurrent()) throw new Error('Cancelled');
      const blob = await screenPng(canvas);
      if (revision !== this.generation) throw new Error('Cancelled');
      const preview = await this.api.finishScreen(grant.id);
      if (revision !== this.generation) throw new Error('Cancelled');
      const png = new Uint8Array(await blob.arrayBuffer());
      if (revision !== this.generation) throw new Error('Cancelled');
      this.png = png;
      this.preview = preview;
      this.previewUrl = URL.createObjectURL(blob);
      const image = document.getElementById('screen-preview');
      image.src = this.previewUrl;
      image.hidden = false;
      this.availability(this.ready, this.busy);
    } catch {
      if (revision === this.generation)
        this.onError(
          'The selected source could not be captured. Select it again; camera access stays off.',
        );
    } finally {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (this.stream === stream) this.stream = null;
      if (this.captureId === grant?.id) this.captureId = null;
      if (grant) this.api.releaseScreen(grant.id).catch(() => {});
      if (revision === this.generation)
        button.disabled = !document.getElementById('screen-source').value;
    }
  }
  async ask() {
    if (this.visionBlocked) return;
    if (this.watch.run?.ready) {
      const run = this.watch.run,
        text = document.getElementById('screen-question').value.trim();
      if (!text) return;
      try {
        const png = await this.watch.image(run);
        this.onSend?.();
        const pending = this.api.askObservedScreen({
          id: crypto.randomUUID(),
          text,
          captureId: run.id,
          png,
        });
        this.open(false);
        await pending;
      } catch (error) {
        this.onError(
          screenImageWarning(error) ??
            'The current view could not be analysed. Try again or select the source again.',
        );
      }
      return;
    }
    const text = document.getElementById('screen-question').value.trim();
    if (!this.preview || !this.png || !text) return;
    this.onSend?.();
    const pending = this.api.askScreen({
      id: crypto.randomUUID(),
      text,
      previewId: this.preview.id,
      png: this.png,
    });
    this.open(false);
    try {
      await pending;
    } catch (error) {
      this.onError(
        screenImageWarning(error) ??
          'The snapshot could not be analysed. Start a conversation first, then take a new snapshot.',
      );
    }
  }
  async clipFrame(value) {
    try {
      const run = this.watch.run;
      if (!run?.ready || run.id !== value.captureId)
        throw new Error('Selected view is unavailable');
      const png = await this.watch.image(run);
      await this.api.resolveClipFrame({ ...value, png });
    } catch {
      this.api
        .resolveClipFrame({ requestId: value.requestId, captureId: value.captureId, error: true })
        .catch(() => {});
    }
  }
  clear() {
    this.generation++;
    if (this.captureId) this.api.releaseScreen(this.captureId).catch(() => {});
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.captureId = null;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
    this.png = null;
    this.preview = null;
    const image = document.getElementById('screen-preview');
    image.removeAttribute('src');
    image.hidden = true;
    document.getElementById('screen-ask').disabled = true;
  }
  status(value) {
    this.captureState = value;
    this.renderIndicator();
    if (value.stopRequested && value.stopRequested === this.watch.run?.id) this.watch.stop(false);
    if (value.stopRequested && value.stopRequested === this.captureId) {
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      this.stream = null;
      this.captureId = null;
      if (value.stopReason !== 'completed') this.generation++;
    }
  }
  renderIndicator() {
    const value = this.captureState ?? {},
      indicator = document.getElementById('screen-indicator');
    indicator.hidden = false;
    indicator.setAttribute('aria-pressed', String(Boolean(value.active || this.clipping)));
    indicator.textContent = this.clipping
      ? 'CLIP'
      : value.active && value.mode !== 'watch'
        ? 'REC'
        : 'OBS';
    indicator.title =
      this.ui.text(value.active ? 'Stop screen access' : 'Screen observation (BETA)') +
      (value.source
        ? ': ' + (value.allMonitors ? this.ui.text('All monitors') : value.source)
        : '');
  }
  observation(value) {
    const previousWarning = this.observationState?.warning;
    this.observationState = value;
    const status = document.getElementById('screen-watch-status');
    status.textContent = screenObservationText(this.ui, this.observationStatus());
    status.dataset.severity = value?.warning ? 'warning' : '';
    if (value?.warning && value.warning !== previousWarning) this.onError(IMAGE_WARNING);
    this.onFormChange();
  }
  observationStatus() {
    const value = this.observationState;
    return {
      blocked: Boolean(this.visionBlocked),
      active: Boolean(value?.active),
      analysing: Boolean(value?.analysing),
      skipped: Boolean(value?.error),
      warning: Boolean(value?.warning),
      lastAnalysedAt: value?.lastAnalysedAt ?? null,
      changed: Boolean(value?.changed),
    };
  }
  watchControls() {
    const active = Boolean(this.watch?.run);
    document.getElementById('screen-watch-locked').hidden = !active;
    for (const id of [
      'screen-source',
      'screen-refresh',
      'screen-watch-interval',
      'screen-watch-duration',
    ])
      document.getElementById(id).disabled = active;
    document.getElementById('screen-watch-stop').disabled = !active;
    document.getElementById('screen-capture').disabled =
      active || !document.getElementById('screen-source').value;
    this.availability(this.ready, this.busy);
  }
  reset() {
    this.watch.stop(false);
    this.clear();
    document.getElementById('screen-source').replaceChildren();
    this.watchControls();
  }
  availability(ready, busy) {
    this.ready = ready;
    this.busy = busy;
    this.onFormChange();
    document.getElementById('screen-watch-start').disabled =
      Boolean(this.watch?.run) ||
      !ready ||
      this.visionBlocked ||
      !document.getElementById('screen-source').value;
    document.getElementById('screen-ask').disabled =
      (!this.watch?.run?.ready && (!this.preview || !this.png)) ||
      !ready ||
      this.visionBlocked ||
      busy ||
      !document.getElementById('screen-question').value.trim();
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (open) {
      if (!this.watch.run) void this.refresh();
      document.getElementById('screen-source').focus();
    } else {
      this.clear();
      if (!this.watch.run) this.api.closeScreen().catch(() => {});
      document.getElementById('settings-open')?.focus();
    }
  }
  formState() {
    return {
      sources: [...document.getElementById('screen-source').options].map((o) => ({
        id: o.value,
        kind: o.dataset.kind ?? '',
        label: o.dataset.sourceLabel ?? '',
      })),
      sourceId: document.getElementById('screen-source').value,
      interval: Number(document.getElementById('screen-watch-interval').value),
      duration: Number(document.getElementById('screen-watch-duration').value),
      active: Boolean(this.watch.run),
      ready: this.ready && !this.visionBlocked,
      busy: this.busy,
      canAsk: Boolean(this.watch.run?.ready || (this.preview && this.png)),
      status: this.observationStatus(),
      png: this.previewUrl ?? null,
      error: this.formError ?? null,
      warning: this.formWarning ?? null,
    };
  }
  async formCommand(command) {
    this.remoteAttached = true;
    if (command.action !== 'state') {
      this.formError = null;
      this.formWarning = null;
    }
    const source = document.getElementById('screen-source');
    if (
      command.action === 'refresh' ||
      (command.action === 'state' && !source.options.length && !this.watch.run)
    )
      await this.refresh(command.sourceId);
    else if (this.refreshing) await this.refreshing;
    if (command.sourceId !== undefined && command.sourceId !== source.value) {
      if (this.watch.run) throw new Error('Stop observation before choosing another source.');
      if (![...source.options].some((o) => o.value === command.sourceId))
        throw new Error('Refresh and select an available screen source.');
      source.value = command.sourceId;
      this.clear();
    }
    if (['start', 'capture'].includes(command.action) && this.watch.run)
      throw new Error('Observation is already running.');
    if (!this.watch.run) {
      if (command.interval !== undefined)
        document.getElementById('screen-watch-interval').value = command.interval;
      if (command.duration !== undefined)
        document.getElementById('screen-watch-duration').value = command.duration;
    }
    if (command.question !== undefined)
      document.getElementById('screen-question').value = command.question;
    if (command.action === 'start') await this.startWatch();
    if (command.action === 'stop') this.watch.stop();
    if (command.action === 'capture') await this.capture();
    if (command.action === 'ask') void this.ask().catch((error) => this.onError(error.message));
    this.watchControls();
    return this.formState();
  }
}

async function snapshotCanvas(stream, isCurrent) {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // A static window may emit only its first frame. play() can already have
  // presented it; waiting for another frame would hang repeat captures.
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    await waitForScreenFrame(video, 5000);
  if (!isCurrent()) throw new Error('Cancelled');
  const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}
