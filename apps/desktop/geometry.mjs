/** All geometry is in Electron's device-independent pixels. */
import { screenSample } from './renderer/screen-geometry.mjs';
import { avatarBodyPartAt } from './avatar-body-regions.mjs';
export function placeInWorkArea(saved, workArea, size, margin = 16) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const clamp = (value, low, high) => Math.round(Math.max(low, Math.min(value, high)));
  return {
    x: clamp(
      Number.isFinite(saved?.x) ? saved.x : workArea.x + workArea.width - width - margin,
      workArea.x,
      workArea.x + workArea.width - width,
    ),
    y: clamp(
      Number.isFinite(saved?.y) ? saved.y : workArea.y + workArea.height - height - margin,
      workArea.y,
      workArea.y + workArea.height - height,
    ),
    width,
    height,
  };
}

export function validWindowFootprint(footprint, bounds) {
  return (
    footprint &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(footprint[key])) &&
    footprint.x >= 0 &&
    footprint.y >= 0 &&
    footprint.width > 0 &&
    footprint.height > 0 &&
    footprint.x + footprint.width <= bounds.width &&
    footprint.y + footprint.height <= bounds.height
  );
}

export function visibleWindowBounds(bounds, footprint) {
  return footprint
    ? { ...footprint, x: bounds.x + footprint.x, y: bounds.y + footprint.y }
    : bounds;
}

export function placeVisibleInWorkArea(bounds, workArea, size, footprint) {
  if (!footprint || footprint.width > workArea.width || footprint.height > workArea.height)
    return placeInWorkArea(bounds, workArea, size);
  const visible = placeInWorkArea(visibleWindowBounds(bounds, footprint), workArea, footprint);
  return { ...bounds, x: visible.x - footprint.x, y: visible.y - footprint.y };
}

export function pointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

export function avatarDropOutside(point, bounds, margin = 24) {
  return (
    [point?.x, point?.y].every(
      (coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) < 2 ** 30,
    ) &&
    !pointInRect(point, {
      x: bounds.x - margin,
      y: bounds.y - margin,
      width: bounds.width + 2 * margin,
      height: bounds.height + 2 * margin,
    })
  );
}

/** The same normalized point in the PNG stays under the cursor after a drag. */
export function spriteGrabPoint(point, rect) {
  const sample = screenSample(point, rect.lens);
  const source = rect.source ?? { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: source.x + ((sample.x - rect.x) / rect.width) * source.width,
    y: source.y + ((sample.y - rect.y) / rect.height) * source.height,
  };
}

function opaquePixel(u, v, alpha, imageSize, threshold) {
  if (!alpha || u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const x = Math.floor(u * imageSize.width),
    y = Math.floor(v * imageSize.height);
  return alpha[y * imageSize.width + x] >= threshold;
}

export function spriteHit(point, rect, alpha, imageSize, threshold = 16) {
  if (rect.enabled === false || !pointInRect(point, rect.lens ?? rect)) return false;
  const { x: u, y: v } = spriteGrabPoint(point, rect);
  return opaquePixel(u, v, alpha, imageSize, threshold);
}

/** A small padded artwork box makes the portrait easier to grab. */
export function spriteDragHit(point, rect, { alpha, imageSize, visibleBounds }) {
  if (!visibleBounds) return spriteHit(point, rect, alpha, imageSize);
  if (rect.enabled === false || !pointInRect(point, rect.lens ?? rect)) return false;
  const sample = screenSample(point, rect.lens);
  if (!pointInRect(sample, rect)) return false;
  const source = rect.source ?? { x: 0, y: 0, width: 1, height: 1 };
  const sx = rect.width / (source.width * imageSize.width);
  const sy = rect.height / (source.height * imageSize.height);
  const padding = 12;
  return pointInRect(sample, {
    x: rect.x + (visibleBounds.x - source.x * imageSize.width) * sx - padding,
    y: rect.y + (visibleBounds.y - source.y * imageSize.height) * sy - padding,
    width: visibleBounds.width * sx + padding * 2,
    height: visibleBounds.height * sy + padding * 2,
  });
}

export function spritePressKind(point, rect, { alpha, imageSize, poseId }, headpat = true, pose) {
  if (rect.enabled === false || !pointInRect(point, rect.lens ?? rect)) return null;
  const { x: u, y: v } = spriteGrabPoint(point, rect);
  const part = avatarBodyPartAt(u, v, (x, y) => opaquePixel(x, y, alpha, imageSize, 16), {
    ...pose,
    ...(poseId && { poseId }),
  });
  return part && (headpat ? part : 'body');
}

export function validateRegions(value, bounds) {
  if (!value || !Array.isArray(value.controls) || value.controls.length > 32)
    throw new Error('Invalid hit regions');
  const rect = (item) => {
    if (!item || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(item[key])))
      throw new Error('Invalid hit region');
    if (
      item.x < 0 ||
      item.y < 0 ||
      item.width <= 0 ||
      item.height <= 0 ||
      item.x + item.width > bounds.width + 2 ||
      item.y + item.height > bounds.height + 2
    )
      throw new Error('Hit region outside window');
    return { x: item.x, y: item.y, width: item.width, height: item.height };
  };
  const sprite = rect(value.sprite);
  if (value.sprite.enabled !== undefined) {
    if (typeof value.sprite.enabled !== 'boolean') throw new Error('Invalid sprite visibility');
    sprite.enabled = value.sprite.enabled;
  }
  if (value.sprite.source !== undefined) {
    const source = value.sprite.source;
    if (
      !source ||
      !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(source[key])) ||
      source.x < 0 ||
      source.y < 0 ||
      source.width <= 0 ||
      source.height <= 0 ||
      source.x + source.width > 1.000001 ||
      source.y + source.height > 1.000001
    )
      throw new Error('Invalid sprite crop');
    sprite.source = { x: source.x, y: source.y, width: source.width, height: source.height };
  }
  if (value.sprite.lens !== undefined) {
    const lens = value.sprite.lens;
    if (!Number.isFinite(lens?.curve) || lens.curve < 0 || lens.curve > 0.06)
      throw new Error('Invalid portrait lens');
    sprite.lens = { ...rect(lens), curve: lens.curve };
  }
  const regions = { controls: value.controls.map(rect), sprite };
  if (value.footprint !== undefined) {
    const footprint = rect(value.footprint);
    // CSS and native content dimensions can differ by one pixel on fractional DPI.
    footprint.width = Math.min(footprint.width, bounds.width - footprint.x);
    footprint.height = Math.min(footprint.height, bounds.height - footprint.y);
    if (!validWindowFootprint(footprint, bounds)) throw new Error('Invalid visible window bounds');
    regions.footprint = footprint;
  }
  return regions;
}
