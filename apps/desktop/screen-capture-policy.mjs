import { randomUUID } from 'node:crypto';

const desktopUrl = 'capri://desktop/index.html';
const noThumbnail = { width: 0, height: 0 };
const monitorThumbnail = { width: 1280, height: 800 };
const monitorLimit = 8;
const monitorFrameBytes = 5 * 1024 * 1024;
const monitorSampleBytes = 24 * 1024 * 1024;
const windowId = /^window:\d+:\d+$/;
const monitorId = /^screen:\d+:\d+$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function monitorPng(thumbnail) {
  if (!thumbnail || thumbnail.isEmpty()) throw new Error('Monitor frame is empty');
  const { width, height } = thumbnail.getSize(1);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error('Invalid monitor frame size');
  const scale = Math.min(1, monitorThumbnail.width / width, monitorThumbnail.height / height);
  const image =
    scale === 1
      ? thumbnail
      : thumbnail.resize({
          width: Math.max(1, Math.floor(width * scale)),
          height: Math.max(1, Math.floor(height * scale)),
        });
  const png = image.toPNG({ scaleFactor: 1 });
  if (!Buffer.isBuffer(png) || png.length < 33 || png.length > monitorFrameBytes)
    throw new Error('Monitor frame exceeds limits');
  if (!png.subarray(0, 8).equals(pngSignature) || png.toString('ascii', 12, 16) !== 'IHDR')
    throw new Error('Monitor frame is not PNG');
  const pngWidth = png.readUInt32BE(16),
    pngHeight = png.readUInt32BE(20);
  if (
    pngWidth < 1 ||
    pngHeight < 1 ||
    pngWidth > monitorThumbnail.width ||
    pngHeight > monitorThumbnail.height
  )
    throw new Error('Monitor frame exceeds limits');
  return png;
}

/** Gesture-bound permission for one source or an explicitly selected set of monitors. */
export class ScreenCapturePolicy {
  constructor({
    sources,
    displays = () => [],
    ownerFrame,
    onChange = () => {},
    now = () => Date.now(),
  }) {
    Object.assign(this, { sources, displays, ownerFrame, onChange, now });
    this.catalog = new Map();
    this.epoch = 0;
    this.displayEpoch = 0;
    this.monitorSampleInFlight = false;
    this.capture = null;
    this.lastStop = null;
  }
  diagnostics() {
    const { source, ...state } = this.snapshot();
    // Window titles and visual content do not belong in a diagnostic report.
    return { ...state, lastStop: this.lastStop ? { ...this.lastStop } : null };
  }
  snapshot() {
    return {
      schemaVersion: 1,
      active: this.capture?.phase === 'capturing' && this.capture.expiresAt > this.now(),
      armed: Boolean(
        this.capture && this.capture.phase !== 'capturing' && this.capture.expiresAt > this.now(),
      ),
      phase: this.capture?.phase ?? 'off',
      source: this.capture?.label ?? null,
      ...(this.capture?.allMonitors && { allMonitors: true }),
      mode: this.capture?.mode ?? 'one-shot',
      camera: false,
      audio: false,
      savesImages: false,
    };
  }
  publish() {
    this.onChange(this.snapshot());
  }
  enumerate(types, thumbnailSize = noThumbnail) {
    return this.sources({ types, thumbnailSize, fetchWindowIcons: false });
  }
  monitorLayout(sources, includeWindows = false) {
    if (!Array.isArray(sources)) return null;
    const monitors = includeWindows
      ? sources.filter((source) => typeof source?.id !== 'string' || !windowId.test(source.id))
      : sources;
    if (monitors.length < 2 || monitors.length > monitorLimit) return null;
    let displays;
    try {
      displays = this.displays();
    } catch {
      return null;
    }
    if (!Array.isArray(displays) || displays.length !== monitors.length) return null;
    const geometry = new Map();
    for (const display of displays) {
      const { id, bounds, scaleFactor, rotation } = display ?? {};
      if (
        !Number.isSafeInteger(id) ||
        id === -1 ||
        id === -10 ||
        !bounds ||
        ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) ||
        bounds.width < 1 ||
        bounds.height < 1 ||
        !Number.isFinite(scaleFactor) ||
        scaleFactor <= 0 ||
        ![0, 90, 180, 270].includes(rotation) ||
        geometry.has(String(id))
      )
        return null;
      geometry.set(String(id), {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        scaleFactor,
        rotation,
      });
    }
    const nativeIds = new Set();
    const layout = [];
    for (const source of monitors) {
      const nativeId = source?.id,
        displayId = source?.display_id;
      if (
        typeof nativeId !== 'string' ||
        !monitorId.test(nativeId) ||
        nativeIds.has(nativeId) ||
        !geometry.has(displayId)
      )
        return null;
      nativeIds.add(nativeId);
      layout.push({ nativeId, displayId, ...geometry.get(displayId) });
      geometry.delete(displayId);
    }
    return layout.sort(
      (a, b) => a.y - b.y || a.x - b.x || Number(a.displayId) - Number(b.displayId),
    );
  }
  matchingMonitors(sources, capture) {
    if (capture.layoutKey !== JSON.stringify(this.monitorLayout(sources))) {
      this.displayTopologyChanged();
      throw new Error('The selected monitors are no longer available');
    }
    return capture.monitorIds.map((id) => sources.find((source) => source.id === id));
  }
  async discover() {
    const epoch = ++this.epoch;
    const displayEpoch = this.displayEpoch;
    const previous = [...this.catalog.entries()];
    this.catalog.clear();
    this.stop();
    // Enumeration must never request thumbnails from unselected user windows.
    const sources = await this.enumerate(['window', 'screen']);
    if (epoch !== this.epoch) throw new Error('Screen source selection was cancelled');
    if (!Array.isArray(sources) || sources.length > 200)
      throw new Error('Screen source list is unavailable');
    if (sources.some((s) => s.thumbnail && !s.thumbnail.isEmpty()))
      throw new Error('Screen source enumeration must not include image thumbnails');
    this.catalog.clear();
    for (const source of sources) {
      if (typeof source.id !== 'string' || !(windowId.test(source.id) || monitorId.test(source.id)))
        continue;
      const displayId = String(source.display_id ?? '');
      const label = String(source.name ?? 'Selected source')
        .replace(/[\x00-\x1f]/g, '')
        .slice(0, 160);
      const token =
        previous.find(
          ([, selected]) =>
            !selected.allMonitors &&
            selected.nativeId === source.id &&
            selected.displayId === displayId &&
            selected.label === label,
        )?.[0] ?? randomUUID();
      this.catalog.set(token, {
        nativeId: source.id,
        displayId,
        label,
      });
    }
    const layout = displayEpoch === this.displayEpoch ? this.monitorLayout(sources, true) : null;
    if (layout) {
      const layoutKey = JSON.stringify(layout);
      const token =
        previous.find(([, selected]) => selected.layoutKey === layoutKey)?.[0] ?? randomUUID();
      this.catalog.set(token, {
        nativeId: layout[0].nativeId,
        displayId: layout[0].displayId,
        label: 'All monitors',
        allMonitors: true,
        layoutKey,
        monitorIds: Object.freeze(layout.map((monitor) => monitor.nativeId)),
        displayIds: Object.freeze(layout.map((monitor) => monitor.displayId)),
      });
    }
    return [...this.catalog.entries()].map(([id, s]) => ({
      id,
      label: s.label,
      type: s.allMonitors ? 'monitors' : s.nativeId.startsWith('window:') ? 'window' : 'monitor',
    }));
  }
  prepare(token, { mode = 'one-shot', durationMs = 600000, intervalMs = 30000 } = {}) {
    if (
      !['one-shot', 'watch'].includes(mode) ||
      !Number.isInteger(durationMs) ||
      durationMs < 30000 ||
      durationMs > 7200000 ||
      !Number.isInteger(intervalMs) ||
      intervalMs < 15000 ||
      intervalMs > 300000
    )
      throw new Error('Invalid screen capture mode');
    const selected = this.catalog.get(token);
    if (!selected) throw new Error('Choose an available screen source again');
    // Arm immediately so Chromium can read the click's transient activation.
    // consume() revalidates this exact selection before providing any pixels.
    this.stop();
    const id = randomUUID();
    this.capture = {
      id,
      nativeId: selected.nativeId,
      displayId: selected.displayId,
      label: selected.label,
      ...(selected.allMonitors && {
        allMonitors: true,
        layoutKey: selected.layoutKey,
        monitorIds: selected.monitorIds,
        displayIds: selected.displayIds,
      }),
      mode,
      durationMs,
      intervalMs,
      expiresAt: this.now() + 10000,
      phase: 'armed',
    };
    this.publish();
    return {
      id,
      expiresAt: this.capture.expiresAt,
      ...(selected.allMonitors && { allMonitors: true }),
    };
  }
  matchingSource(sources, capture) {
    return sources.find(
      (source) =>
        source.id === capture.nativeId &&
        (!capture.displayId || String(source.display_id ?? '') === capture.displayId),
    );
  }
  permits(request) {
    if (!request || typeof request !== 'object') return false;
    const capture = this.capture,
      frame = this.ownerFrame();
    return Boolean(
      capture &&
        capture.phase === 'armed' &&
        capture.expiresAt > this.now() &&
        frame &&
        request.frame === frame &&
        frame.url === desktopUrl &&
        ['capri://desktop', 'capri://desktop/'].includes(request.securityOrigin) &&
        request.videoRequested === true &&
        request.audioRequested === false &&
        request.userGesture === true,
    );
  }
  async consume(request, respond) {
    let answered = false;
    const reply = (value) => {
      if (!answered) {
        answered = true;
        respond(value);
      }
    };
    if (!this.permits(request)) {
      reply({});
      return;
    }
    const capture = this.capture;
    capture.phase = 'resolving';
    try {
      const sources = await this.enumerate([
        capture.nativeId.startsWith('window:') ? 'window' : 'screen',
      ]);
      if (this.capture !== capture || capture.expiresAt <= this.now())
        throw new Error('Screen capture was cancelled');
      const source = capture.allMonitors
        ? this.matchingMonitors(sources, capture)[0]
        : this.matchingSource(sources, capture);
      if (!source) throw new Error('Selected screen source is no longer available');
      // Recheck the exact requesting frame after enumeration; no source fallback.
      if (request.frame !== this.ownerFrame() || request.frame.url !== desktopUrl)
        throw new Error('Screen capture frame changed');
      capture.phase = 'capturing';
      capture.frame = request.frame;
      capture.checkedAt = this.now();
      if (capture.mode === 'watch') capture.expiresAt = this.now() + capture.durationMs;
      this.expiryTimer = setTimeout(
        () => {
          if (this.capture === capture) this.stop('expired');
        },
        Math.max(1, capture.expiresAt - this.now()),
      );
      this.expiryTimer.unref?.();
      this.publish();
      if (capture.allMonitors) this.requireMonitorLease(capture, request.frame);
      reply({ video: source });
    } catch {
      if (this.capture === capture) this.stop('source-unavailable');
      reply({});
    }
  }
  requireMonitorLease(capture, frame) {
    if (this.capture !== capture) throw new Error('Monitor capture was cancelled');
    if (capture.expiresAt <= this.now()) {
      this.stop('expired');
      throw new Error('Monitor capture expired');
    }
    if (frame !== this.ownerFrame() || frame.url !== desktopUrl) {
      this.stop('frame-changed');
      throw new Error('Screen capture frame changed');
    }
  }
  async monitorFrames(id, frame) {
    const capture = this.capture;
    if (
      !capture?.allMonitors ||
      capture.id !== id ||
      capture.phase !== 'capturing' ||
      !frame ||
      frame !== capture.frame ||
      capture.monitorFrameDelivered ||
      this.monitorSampleInFlight
    )
      throw new Error('Monitor capture is unavailable');
    this.monitorSampleInFlight = true;
    try {
      this.requireMonitorLease(capture, frame);
      let monitors;
      try {
        // Verify the selected set before asking Electron for screen pixels.
        const available = await this.enumerate(['screen']);
        this.requireMonitorLease(capture, frame);
        this.matchingMonitors(available, capture);
        const sampled = await this.enumerate(['screen'], monitorThumbnail);
        this.requireMonitorLease(capture, frame);
        monitors = this.matchingMonitors(sampled, capture);
      } catch (error) {
        if (this.capture === capture) this.stop('source-unavailable');
        throw error;
      }
      let total = 0;
      const frames = monitors.map(({ thumbnail }) => {
        const png = monitorPng(thumbnail);
        total += png.length;
        if (total > monitorSampleBytes) throw new Error('Monitor frames exceed limits');
        return { png: new Uint8Array(png) };
      });
      this.requireMonitorLease(capture, frame);
      if (capture.mode === 'one-shot') capture.monitorFrameDelivered = true;
      return frames;
    } catch {
      throw new Error('Monitor capture is unavailable');
    } finally {
      this.monitorSampleInFlight = false;
    }
  }
  release(id, reason = 'cancelled') {
    if (this.capture?.id !== id) return false;
    this.stop(reason);
    return true;
  }
  async checkActive(id) {
    const capture = this.capture;
    if (
      !capture ||
      capture.id !== id ||
      capture.phase !== 'capturing' ||
      capture.expiresAt <= this.now()
    )
      return false;
    if (
      capture.frame !== this.ownerFrame() ||
      (capture.allMonitors && capture.frame.url !== desktopUrl)
    ) {
      this.stop('frame-changed');
      return false;
    }
    if (!capture.allMonitors && this.now() - capture.checkedAt < 4000) return true;
    try {
      const sources = await this.enumerate([
        capture.nativeId.startsWith('window:') ? 'window' : 'screen',
      ]);
      if (this.capture !== capture) return false;
      if (capture.allMonitors) {
        this.requireMonitorLease(capture, capture.frame);
        this.matchingMonitors(sources, capture);
      } else if (!this.matchingSource(sources, capture)) {
        this.stop('source-unavailable');
        return false;
      }
      capture.checkedAt = this.now();
      return true;
    } catch {
      if (this.capture === capture) this.stop('source-unavailable');
      return false;
    }
  }
  displayTopologyChanged() {
    this.displayEpoch++;
    for (const [token, source] of this.catalog) {
      if (source.allMonitors) this.catalog.delete(token);
    }
    if (this.capture?.allMonitors) this.stop('source-unavailable');
  }
  stop(reason = 'cancelled') {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (this.capture) {
      const id = this.capture.id;
      this.lastStop = { reason, at: this.now(), mode: this.capture.mode };
      console.info('Capri screen capture stopped:', JSON.stringify(this.lastStop));
      this.capture = null;
      this.onChange({ ...this.snapshot(), stopRequested: id, stopReason: reason });
    }
  }
  clear(reason = 'cancelled') {
    this.epoch++;
    this.catalog.clear();
    this.stop(reason);
  }
}
