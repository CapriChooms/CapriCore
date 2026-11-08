// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { snapshotBytes } from '../visual-service.mjs';
import {
  observationOptions,
  SCREEN_VISION_REQUIRED,
  selectedScreenSource,
} from '../screen-observation.mjs';
import { validateInput } from '../chat-service.mjs';

/** Register screen capabilities behind the main frame's authenticated IPC gate. */
export function registerScreenIpc(
  handle,
  {
    root,
    screenVisionAvailable = true,
    capturePolicy,
    screenObservation,
    screenPreviews,
    clipFrames,
    screenshots,
    openPath,
    validImage,
    canSubmit,
    getVisualTurn,
    cancelVisual,
    submitSnapshot,
  },
) {
  handle('capri:clip-frame', (value) => clipFrames.accept(value));
  handle('capri:clip-sound', () => {
    for (const file of [
      path.join(root, 'data/sounds/screenshot.mp3'),
      path.join(root, 'assets/default/screenshot-capture.mp3'),
    ])
      try {
        const folder = path.dirname(file);
        const info = lstatSync(file);
        if (
          lstatSync(folder).isSymbolicLink() ||
          info.isSymbolicLink() ||
          !info.isFile() ||
          info.size > 2 * 1024 * 1024
        )
          continue;
        return new Uint8Array(readFileSync(file));
      } catch {
        /* Try the bundled Steam screenshot cue. */
      }
    return null;
  });
  handle('capri:clip-open', async (id) => {
    const saved = screenshots.saved(id);
    if (!saved) throw new Error('Screenshot not found');
    const error = await openPath(saved.file);
    if (error) throw new Error('Screenshot viewer could not open');
    return true;
  });
  handle('capri:clip-folder', async () => {
    const error = await openPath(screenshots.folder());
    if (error) throw new Error('Screenshot folder could not open');
    return true;
  });
  handle('capri:screen-sources', () => {
    screenPreviews.clear();
    return capturePolicy.discover();
  });
  handle('capri:screen-prepare', async (id) => {
    screenPreviews.clear();
    await capturePolicy.renewSelection(id);
    return capturePolicy.prepare(id);
  });
  handle('capri:screen-monitor-frames', (id, { role, frame }) => {
    if (role !== 'companion') throw new Error('Companion frame required');
    return capturePolicy.monitorFrames(id, frame);
  });
  handle('capri:screen-watch-prepare', async (value) => {
    if (!screenVisionAvailable) throw new Error(SCREEN_VISION_REQUIRED);
    const options = observationOptions(value);
    screenPreviews.clear();
    await capturePolicy.renewSelection(value.sourceId);
    return capturePolicy.prepare(value.sourceId, { mode: 'watch', ...options });
  });
  handle('capri:screen-watch-sample', async (value) => {
    if (!screenVisionAvailable) return { active: false, analyse: false };
    if (!(await capturePolicy.checkActive(value?.captureId)))
      return { active: false, analyse: false };
    return { ...screenObservation.sample(value), active: true };
  });
  handle('capri:screen-watch-frame', (value) => {
    if (!screenVisionAvailable) return { accepted: false };
    const capture = capturePolicy.capture;
    if (
      !capture ||
      capture.mode !== 'watch' ||
      capture.phase !== 'capturing' ||
      capture.id !== value?.captureId ||
      capture.expiresAt <= Date.now()
    )
      throw new Error('Screen access is off');
    const png = snapshotBytes(value.png);
    if (!validImage(png)) throw new Error('Invalid observation image');
    return screenObservation.frame({ ...value, png });
  });
  handle('capri:screen-watch-stop', (id) => {
    if (capturePolicy.capture?.mode === 'watch') capturePolicy.release(id, 'cancelled');
    return true;
  });
  handle('capri:screen-watch-ask', (value) => {
    if (!screenVisionAvailable) throw new Error(SCREEN_VISION_REQUIRED);
    const capture = capturePolicy.capture;
    if (
      !capture ||
      capture.mode !== 'watch' ||
      capture.phase !== 'capturing' ||
      capture.id !== value?.captureId ||
      capture.expiresAt <= Date.now()
    )
      throw new Error('Screen access is off');
    validateInput(value);
    if (!canSubmit()) throw new Error('The conversation is busy');
    const preview = {
      id: randomUUID(),
      source: { ...selectedScreenSource(capture), capturedAt: Date.now() },
    };
    screenPreviews.set(preview.id, preview);
    return submitSnapshot({ ...value, previewId: preview.id });
  });
  handle('capri:screen-finish', (id) => {
    const capture = capturePolicy.capture;
    if (capture?.id !== id || capture.phase !== 'capturing')
      throw new Error('No active selected-source capture');
    const preview = {
      id: randomUUID(),
      source: { ...selectedScreenSource(capture), capturedAt: Date.now() },
    };
    capturePolicy.release(id, 'completed');
    screenPreviews.set(preview.id, preview);
    return preview;
  });
  handle('capri:screen-release', (id) => capturePolicy.release(id));
  handle('capri:screen-cancel', () => {
    if (getVisualTurn()?.kind === 'clip') cancelVisual();
    capturePolicy.stop();
    screenPreviews.clear();
    return true;
  });
  handle('capri:screen-close', () => {
    capturePolicy.clear();
    screenPreviews.clear();
    return true;
  });
  handle('capri:screen-ask', submitSnapshot);
}
