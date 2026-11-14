// SPDX-License-Identifier: GPL-3.0-only
const WIDTH = 1280;
const HEIGHT = 720;
export const screenSnapshotWidth = 1920;
export const screenSnapshotHeight = 1080;
export const screenSnapshotBytes = 3 * 1024 * 1024;
const MAX_MONITORS = 8;
const GUTTER = 8;
const LABEL_HEIGHT = 28;

/** Compose the complete ordered set, preserving each monitor's aspect ratio. */
export async function screenMosaic(tiles, label, isCurrent, { detailed = false } = {}) {
  if (!isCurrent()) throw new Error('Screen capture was cancelled');
  if (!Array.isArray(tiles) || tiles.length < 2 || tiles.length > MAX_MONITORS)
    throw new Error('Invalid monitor frames');
  const images = [];
  try {
    for (const tile of tiles) {
      if (!(tile?.png instanceof Uint8Array) || !tile.png.length)
        throw new Error('Invalid monitor frame');
      const image = await createImageBitmap(new Blob([tile.png], { type: 'image/png' }));
      images.push(image);
      if (!isCurrent()) throw new Error('Screen capture was cancelled');
      if (!image.width || !image.height || image.width > WIDTH || image.height > 800)
        throw new Error('Invalid monitor dimensions');
    }

    const width = detailed ? screenSnapshotWidth : WIDTH;
    const height = detailed ? screenSnapshotHeight : HEIGHT;
    const columns = Math.ceil(Math.sqrt(images.length));
    const rows = Math.ceil(images.length / columns);
    const cellWidth = Math.floor((width - GUTTER * (columns + 1)) / columns);
    const maxImageHeight = Math.floor((height - GUTTER * (rows + 1)) / rows) - LABEL_HEIGHT;
    const sizes = images.map((image) => {
      const scale = Math.min(1, cellWidth / image.width, maxImageHeight / image.height);
      return {
        width: Math.max(1, Math.floor(image.width * scale)),
        height: Math.max(1, Math.floor(image.height * scale)),
      };
    });
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(...sizes.slice(row * columns, (row + 1) * columns).map(({ height }) => height)),
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = rowHeights.reduce(
      (sum, height) => sum + height + LABEL_HEIGHT + GUTTER,
      GUTTER,
    );
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#111827';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '600 18px system-ui, sans-serif';
    context.textBaseline = 'middle';
    let y = GUTTER;
    for (const [row, height] of rowHeights.entries()) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        if (index >= images.length) break;
        const x = GUTTER + column * (cellWidth + GUTTER);
        const size = sizes[index];
        context.fillStyle = '#243244';
        context.fillRect(x, y, cellWidth, LABEL_HEIGHT);
        context.fillStyle = '#fff';
        context.fillText(
          label(index + 1),
          x + GUTTER,
          y + LABEL_HEIGHT / 2,
          cellWidth - GUTTER * 2,
        );
        context.drawImage(
          images[index],
          x + Math.floor((cellWidth - size.width) / 2),
          y + LABEL_HEIGHT + Math.floor((height - size.height) / 2),
          size.width,
          size.height,
        );
      }
      y += LABEL_HEIGHT + height + GUTTER;
    }
    return canvas;
  } finally {
    for (const image of images) image.close();
  }
}

export async function screenPng(canvas) {
  const encode = (source) => new Promise((resolve) => source.toBlob(resolve, 'image/png'));
  let blob = await encode(canvas);
  if (blob?.size > screenSnapshotBytes && (canvas.width > WIDTH || canvas.height > HEIGHT)) {
    const fallback = screenFrameCanvas(canvas, canvas.width, canvas.height, false);
    blob = await encode(fallback);
  }
  if (!blob || blob.size > screenSnapshotBytes) throw new Error('Invalid screen frame');
  return blob;
}

export function screenFrameCanvas(image, width, height, detailed) {
  const maxWidth = detailed ? screenSnapshotWidth : WIDTH;
  const maxHeight = detailed ? screenSnapshotHeight : HEIGHT;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
