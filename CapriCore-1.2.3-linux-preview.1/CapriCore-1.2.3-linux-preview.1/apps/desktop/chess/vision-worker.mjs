// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { refineBoardEdges } from './board-colors.mjs';

// The pinned fenshot release uses bundler-style sibling specifiers. Resolve the
// known siblings in this worker without changing module resolution in Capri.
const upstream = new URL('.', import.meta.resolve('@scoriiu/fenshot')).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (
      context.parentURL?.startsWith(upstream) &&
      /^\.\/(?:recognize|detect|tiles|fen|compose)$/.test(specifier)
    )
      return next(specifier + '.js', context);
    return next(specifier, context);
  },
});
const vision = await import('@scoriiu/fenshot');
hook.deregister();
const ort = await import('onnxruntime-web');
ort.env.wasm.numThreads = 1;
const model = await ort.InferenceSession.create(
  readFileSync(fileURLToPath(import.meta.resolve('@scoriiu/fenshot/model/chess-tiles-v2.onnx'))),
  {
    executionProviders: ['wasm'],
  },
);

function usableRead(read, { width, height }) {
  if (!read?.plausible) return false;
  const { x0, y0, x1, y1 } = read.corners;
  return (
    x0 >= -3 && y0 >= -3 && x1 <= width + 3 && y1 <= height + 3 && x1 - x0 >= 96 && y1 - y0 >= 96
  );
}

async function detect({ bytes, width, height, manual, limit }) {
  const data = new Float32Array(width * height);
  for (let pixel = 0, offset = 0; pixel < data.length; pixel++, offset += 4) {
    // Electron NativeImage supplies BGRA, whereas the trainer uses RGB weights.
    data[pixel] = bytes[offset + 2] * 0.299 + bytes[offset + 1] * 0.587 + bytes[offset] * 0.114;
  }
  const image = { data, width, height };
  const classify = async (source, corners) => {
    const tiles = new ort.Tensor('float32', vision.extractTiles(source, corners), [64, 1024]);
    const output = await model.run({ tiles });
    return vision.probsToPlacement(output.probs.data);
  };
  const candidates = [];
  const regions = [{ x: 0, y: 0, width, height }];
  for (let i = 0; i < regions.length && candidates.length < limit && i < 9; i++) {
    const region = regions[i];
    let source = image;
    if (i) {
      const subset = new Float32Array(region.width * region.height);
      for (let row = 0; row < region.height; row++) {
        const offset = (region.y + row) * width + region.x;
        subset.set(data.subarray(offset, offset + region.width), row * region.width);
      }
      source = { data: subset, width: region.width, height: region.height };
    }
    const predict = (corners) => classify(source, corners);
    let read = await vision.recognizeGray(source, predict);
    if (manual && !usableRead(read, source)) {
      const corners = { x0: 0, y0: 0, x1: width, y1: height };
      const placed = await predict(corners);
      read = { ...placed, corners, plausible: true, manualFallback: true };
    }
    if (!usableRead(read, source)) continue;
    const { x0, y0, x1, y1 } = read.manualFallback
      ? read.corners
      : refineBoardEdges(source, read.corners);
    const orientation = vision.resolveOrientation(read.placement).orientation;
    const reliable =
      !read.manualFallback && read.minConfidence >= 0.74 && read.meanConfidence >= 0.95;
    const left = Math.floor(region.x + Math.max(0, x0)),
      top = Math.floor(region.y + Math.max(0, y0));
    const right = Math.ceil(region.x + Math.min(source.width, x1)),
      bottom = Math.ceil(region.y + Math.min(source.height, y1));
    const rect = { x: left, y: top, width: right - left, height: bottom - top };
    if (
      candidates.some(
        (item) => Math.abs(item.rect.x - left) < 20 && Math.abs(item.rect.y - top) < 20,
      )
    )
      continue;
    candidates.push({
      placement: read.placement,
      confidence: read.confidences,
      orientation,
      reliable,
      rect,
    });
    if (!manual && limit > 1) {
      for (const strip of [
        { ...region, width: left - region.x },
        { ...region, x: right, width: region.x + region.width - right },
        { ...region, height: top - region.y },
        { ...region, y: bottom, height: region.y + region.height - bottom },
      ])
        if (strip.width >= 115 && strip.height >= 115) regions.push(strip);
    }
  }
  return candidates;
}

parentPort.on('message', async (value) => {
  try {
    parentPort.postMessage(await detect(value));
  } catch {
    parentPort.postMessage({ error: true });
  }
});
