// SPDX-License-Identifier: GPL-3.0-only
// The cells include the entire registered figure. Holding a drawing does not
// transform the sprite, its grip, or its individual limbs at playback time.
export const hangingCelActions = Object.freeze(['hang-pullup', 'hang-catch', 'hang-wrist-scan']);
export const seatedCelActions = Object.freeze(['ledge-keytar']);

const cellSize = 512;
const columns = 3;
const rows = 2;
const master = -1;
const caughtChipHoldMs = 1000;
const extendedScannerHoldMs = 3000;
const cellsPerSheet = columns * rows;
const timelines = new Map();

function register(action, asset, frameId, exposures) {
  let durationMs = 0;
  let previousKey = master;
  const stops = exposures.map(([cell, milliseconds]) => {
    durationMs += milliseconds;
    if (cell < cellsPerSheet) previousKey = cell;
    return Object.freeze({ cell, previousKey, until: durationMs });
  });
  const clip = Object.freeze({ kind: 'registered-cels', action, frameId, durationMs });
  timelines.set(action, {
    asset,
    clip,
    stops,
    hasBreakdowns: stops.some((stop) => stop.cell >= cellsPerSheet),
  });
}

// 0–5 are the keys; 6–11 are the corresponding in-betweens on a second sheet.
register('hang-pullup', 'hang-pullup', 'pose-ceiling', [
  [master, 125],
  [6, 80],
  [0, 105],
  [7, 95],
  [1, 170],
  [8, 75],
  [2, 100],
  [9, 75],
  [3, 310],
  [4, 150],
  [10, 105],
  [11, 85],
  [5, 105],
  [master, 185],
]);
register('hang-catch', 'hang-catch', 'pose-ceiling', [
  [master, 125],
  [0, 125],
  [6, 80],
  [7, 95],
  [1, 170],
  [8, 65],
  [2, 115],
  [9, 80],
  [3, caughtChipHoldMs],
  [10, 65],
  [4, 110],
  [11, 100],
  [5, 95],
  [master, 185],
]);
register('hang-wrist-scan', 'hang-wrist-scan', 'pose-ceiling', [
  [master, 130],
  [0, 95],
  [1, 110],
  [2, 150],
  [3, 200],
  [4, 225],
  [5, extendedScannerHoldMs],
  [4, 155],
  [3, 110],
  [2, 135],
  [1, 130],
  [0, 105],
  [master, 180],
]);
register('ledge-keytar', 'ledge-keytar', 'pose-sit-edge', [
  [master, 130],
  [6, 80],
  [0, 110],
  [7, 95],
  [1, 175],
  [8, 80],
  [2, 175],
  [9, 80],
  [3, 245],
  [9, 80],
  [2, 155],
  [9, 80],
  [3, 300],
  [10, 95],
  [4, 140],
  [11, 105],
  [5, 110],
  [master, 190],
]);
register('ledge-peek-below', 'hang-pullup', 'pose-ceiling', [
  [master, 150],
  [6, 80],
  [0, 115],
  [7, 90],
  [1, 190],
  [8, 75],
  [2, 125],
  [9, 90],
  [3, 445],
  [4, 170],
  [10, 110],
  [11, 105],
  [5, 110],
  [master, 215],
]);

export function registeredCelClip(action) {
  return timelines.get(action)?.clip ?? null;
}

export function registeredCelFrame(action, elapsedMs) {
  const cell = registeredCelAt(action, elapsedMs);
  if (cell === master) return null;
  const asset = timelines.get(action).asset;
  return cell < cellsPerSheet
    ? { asset, cell }
    : { asset: asset + '-breakdowns', cell: cell - cellsPerSheet };
}

export function validRegisteredCel(clip, action, frameId) {
  const known = registeredCelClip(action);
  return Boolean(
    known &&
      frameId === known.frameId &&
      clip?.kind === known.kind &&
      clip.action === action &&
      clip.frameId === frameId &&
      clip.durationMs === known.durationMs,
  );
}

export function registeredCelAt(action, elapsedMs) {
  const timeline = timelines.get(action);
  if (!timeline || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return master;
  return timeline.stops.find((stop) => elapsedMs < stop.until)?.cell ?? master;
}

const assets = new Map();

export const hangingCelAssetNames = Object.freeze([
  ...new Set(
    Array.from(timelines.values()).flatMap(({ asset, hasBreakdowns }) =>
      hasBreakdowns ? [asset, asset + '-breakdowns'] : [asset],
    ),
  ),
]);

function atlasEntry(asset) {
  let entry = assets.get(asset);
  if (!entry || (entry.retryAt && Date.now() >= entry.retryAt)) {
    const image = new Image();
    entry = { image };
    image.decoding = 'async';
    image.src = 'capri://desktop/hanging-cels/' + asset + '.webp';
    assets.set(asset, entry);
    entry.ready = image.decode().then(
      () => image.naturalWidth === columns * cellSize && image.naturalHeight === rows * cellSize,
      () => {
        entry.retryAt = Date.now() + 5000;
        return false;
      },
    );
  }
  return entry;
}

function loadAtlas(asset) {
  const { image } = atlasEntry(asset);
  return image.complete &&
    image.naturalWidth === columns * cellSize &&
    image.naturalHeight === rows * cellSize
    ? image
    : null;
}

export async function prepareRegisteredCel(action) {
  const timeline = timelines.get(action);
  if (!timeline) return true;
  const { asset, hasBreakdowns } = timeline;
  const [ready] = await Promise.all([
    atlasEntry(asset).ready,
    hasBreakdowns ? atlasEntry(asset + '-breakdowns').ready : true,
  ]);
  return ready;
}

export function createCelPainter(canvas, getAtlas = loadAtlas) {
  const context = canvas.getContext('2d');
  let shownImage = null,
    shownSrc = '',
    shownCell = master;
  return {
    draw(original, action, elapsedMs) {
      const timeline = timelines.get(action);
      if (!timeline) return false;
      const keys = getAtlas(timeline.asset);
      const breakdowns = timeline.hasBreakdowns ? getAtlas(timeline.asset + '-breakdowns') : null;
      const stop = timeline.stops.find((stop) => elapsedMs >= 0 && elapsedMs < stop.until);
      let cell = keys ? (stop?.cell ?? master) : master;
      let atlas = keys;
      let asset = timeline.asset;
      if (cell >= cellsPerSheet) {
        if (breakdowns) {
          cell -= cellsPerSheet;
          atlas = breakdowns;
          asset += '-breakdowns';
        } else cell = stop.previousKey;
      }
      const image = cell === master ? original : atlas;
      const src = image.currentSrc || image.src;
      if (image === shownImage && src === shownSrc && cell === shownCell) return false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (cell === master) context.drawImage(original, 0, 0, canvas.width, canvas.height);
      else {
        const x = (cell % columns) * cellSize;
        const y = Math.floor(cell / columns) * cellSize;
        context.drawImage(atlas, x, y, cellSize, cellSize, 0, 0, canvas.width, canvas.height);
      }
      shownImage = image;
      shownSrc = src;
      shownCell = cell;
      canvas.dataset.clipFrame = cell === master ? 'master' : asset + ':' + cell;
      return true;
    },
    reset() {
      shownImage = null;
      delete canvas.dataset.clipFrame;
    },
  };
}
