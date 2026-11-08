import { sampleScreen } from './screen-change.mjs';
import { screenMosaic, screenPng } from './screen-mosaic.mjs';

/** Owns one explicitly selected source or monitor set and fences work to that lease. */
export class ScreenWatch {
  constructor({ api, video, mosaicPreview, monitorLabel, onChange, onError }) {
    Object.assign(this, { api, video, mosaicPreview, monitorLabel, onChange, onError });
    this.run = null;
  }
  async start(options) {
    this.stop();
    const run = (this.run = { id: null, sequence: 0, canvas: document.createElement('canvas') });
    this.onChange();
    let grant,
      stream,
      stage = 'selection',
      startupTimer;
    try {
      grant = await this.api.prepareScreenWatch(options);
      run.id = grant.id;
      run.allMonitors = grant.allMonitors === true;
      if (this.run !== run) throw new Error('Cancelled');
      stage = 'capture';
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 1, max: 1 },
        },
      });
      if (
        this.run !== run ||
        stream.getAudioTracks().length ||
        stream.getVideoTracks().length !== 1
      )
        throw new Error('Cancelled or unexpected capture');
      stage = 'first-frame';
      if (run.allMonitors) {
        // The first track authorizes the selection. The mosaic comes from the leased set.
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      } else {
        run.stream = stream;
        this.video.srcObject = stream;
        this.video.hidden = false;
      }
      const firstMosaic = await Promise.race([
        run.allMonitors ? this.mosaic(run) : this.playVideo(),
        new Promise((_, reject) => {
          startupTimer = setTimeout(() => reject(new Error('Screen playback timeout')), 10000);
        }),
      ]);
      if (this.run !== run) throw new Error('Cancelled');
      for (const track of stream?.getTracks() ?? [])
        track.addEventListener('ended', () => {
          if (this.run === run) this.stop();
        });
      run.ready = true;
      this.onChange();
      void this.tick(run, firstMosaic);
    } catch (error) {
      // Only bounded stage/code metadata: never pixels, window titles or paths.
      console.warn(
        'Capri screen startup failed:',
        JSON.stringify({
          stage,
          name: [
            'NotAllowedError',
            'NotReadableError',
            'AbortError',
            'InvalidStateError',
            'NotFoundError',
            'TypeError',
          ].includes(error?.name)
            ? error.name
            : 'Error',
        }),
      );
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (grant) this.api.releaseScreen(grant.id).catch(() => {});
      if (this.run === run) {
        this.stop(false);
        this.onError('The selected source could not be observed. Choose it again.');
      }
    } finally {
      clearTimeout(startupTimer);
    }
  }
  async playVideo() {
    await this.video.play();
    if (!this.video.videoWidth || !this.video.videoHeight)
      await waitForScreenFrame(this.video, 8000);
  }
  async mosaic(run) {
    const isCurrent = () => this.run === run;
    // A foreground request waits for any sample in progress, then takes its own fresh set.
    const previous = run.mosaicRequest ?? Promise.resolve();
    const request = previous
      .catch(() => {})
      .then(async () => {
        if (!isCurrent()) throw new Error('Cancelled');
        const tiles = await this.api.screenMonitorFrames(run.id);
        return screenMosaic(tiles, this.monitorLabel, isCurrent);
      });
    run.mosaicRequest = request;
    try {
      return await request;
    } finally {
      if (run.mosaicRequest === request) run.mosaicRequest = null;
    }
  }
  async png(run, canvas) {
    if (this.run !== run) throw new Error('Cancelled');
    const blob = await screenPng(canvas);
    const png = new Uint8Array(await blob.arrayBuffer());
    if (this.run !== run) throw new Error('Cancelled');
    return png;
  }
  async image(run = this.run) {
    if (!run?.ready || this.run !== run) throw new Error('Screen observation is off');
    if (run.allMonitors) return this.png(run, await this.mosaic(run));
    // Grab from the permitted source track, independently of a hidden/throttled
    // preview element. Reusing its last decoded video frame can show old pixels.
    let bitmap;
    if (typeof ImageCapture === 'function') {
      const grab = new ImageCapture(run.stream.getVideoTracks()[0]).grabFrame();
      let expired = false,
        timer;
      try {
        bitmap = await Promise.race([
          grab.then((frame) => {
            if (expired) {
              frame.close();
              throw new Error('Screen capture expired');
            }
            return frame;
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              reject(new Error('No fresh screen frame'));
            }, 2000);
          }),
        ]);
      } catch (error) {
        // Windows can transiently reject grabFrame while a source is repainting.
        // Wait for a NEW decoded frame from the same lease; never reuse old pixels.
        if (this.run !== run || !run.ready) throw error;
        await waitForScreenFrame(this.video, 1500);
      } finally {
        clearTimeout(timer);
      }
    } else if (this.video.requestVideoFrameCallback) {
      await waitForScreenFrame(this.video, 2000);
    } else {
      throw new Error('Fresh screen capture is unavailable');
    }
    try {
      if (!run.ready || this.run !== run) throw new Error('Screen observation is off');
      const image = bitmap ?? this.video;
      const canvas = document.createElement('canvas'),
        width = bitmap?.width ?? this.video.videoWidth,
        height = bitmap?.height ?? this.video.videoHeight,
        scale = Math.min(1, 1280 / width, 720 / height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return await this.png(run, canvas);
    } finally {
      bitmap?.close();
    }
  }
  async tick(run, mosaic) {
    if (this.run !== run) return;
    try {
      if (run.allMonitors && !mosaic) mosaic = await this.mosaic(run);
      if (this.run !== run) return;
      const signature = sampleScreen(mosaic ?? this.video, run.canvas);
      const result = await this.api.screenWatchSample({ captureId: run.id, signature });
      if (this.run !== run) return;
      if (result.active === false) {
        this.stop(false);
        return;
      }
      if (mosaic) {
        if (
          this.mosaicPreview.width !== mosaic.width ||
          this.mosaicPreview.height !== mosaic.height
        ) {
          this.mosaicPreview.width = mosaic.width;
          this.mosaicPreview.height = mosaic.height;
        }
        this.mosaicPreview.getContext('2d').drawImage(mosaic, 0, 0);
        this.mosaicPreview.hidden = false;
      }
      if (result.analyse) {
        const png = mosaic ? await this.png(run, mosaic) : await this.image(run);
        if (this.run !== run) return;
        await this.api.screenWatchFrame({
          captureId: run.id,
          sequence: run.sequence++,
          signature,
          png,
        });
      }
      run.failures = 0;
    } catch {
      if (this.run === run) {
        // A dropped/oversized frame or transient IPC failure is not revocation.
        // Revalidate this same lease on the next tick, before sending any pixels.
        // Explicit stop, expiry and ended tracks still close it immediately.
        run.failures = (run.failures ?? 0) + 1;
        if (run.failures >= 3) {
          this.stop();
          this.onError('Screen observation stopped. Select the source again.');
        } else if (run.failures === 1) this.onError('A screen update was skipped. Retrying later.');
      }
    } finally {
      if (this.run === run)
        run.timer = setTimeout(
          () => void this.tick(run),
          run.failures || run.allMonitors ? 5000 : 2000,
        );
    }
  }
  stop(notify = true) {
    const run = this.run;
    this.run = null;
    if (run) {
      clearTimeout(run.timer);
      for (const track of run.stream?.getTracks() ?? []) track.stop();
      if (notify && run.id) this.api.stopScreenWatch(run.id).catch(() => {});
    }
    this.video.pause();
    this.video.srcObject = null;
    this.video.hidden = true;
    if (this.mosaicPreview) {
      this.mosaicPreview.hidden = true;
      this.mosaicPreview.width = 0;
      this.mosaicPreview.height = 0;
    }
    this.onChange();
  }
}

/** A fresh decoded frame, with deterministic callback/timer cleanup on every path. */
export function waitForScreenFrame(video, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let id, timer;
    const done = (error) => {
      clearTimeout(timer);
      if (id !== undefined) video.cancelVideoFrameCallback?.(id);
      video.removeEventListener?.('loadeddata', loaded);
      error ? reject(error) : resolve();
    };
    const loaded = () => done();
    timer = setTimeout(() => done(new Error('No fresh screen frame')), timeoutMs);
    if (video.requestVideoFrameCallback) id = video.requestVideoFrameCallback(loaded);
    else if (video.readyState < 2) video.addEventListener('loadeddata', loaded, { once: true });
    else done(new Error('Fresh screen capture is unavailable'));
  });
}
