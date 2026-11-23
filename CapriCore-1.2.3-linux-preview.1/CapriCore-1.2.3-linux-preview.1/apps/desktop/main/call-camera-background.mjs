// SPDX-License-Identifier: GPL-3.0-only
import { lstatSync, readFileSync } from 'node:fs';
import {
  assertPrivatePath,
  writePrivateBytesAtomic,
} from '../../../packages/runtime/src/safe-file.mjs';
import { screenshotDimensions } from '../screenshot-files.mjs';
import {
  CAMERA_WIDTH,
  CAMERA_HEIGHT,
  CAMERA_BACKGROUND_COLOR,
  CAMERA_BACKGROUND_IMAGE_BYTES,
  cameraBackgroundColorValid,
} from '../call-camera-protocol.mjs';

const saveError = 'Camera background could not be saved.';

function backgroundImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > CAMERA_BACKGROUND_IMAGE_BYTES)
    throw new Error(saveError);
  const { width, height } = screenshotDimensions(bytes);
  if (width !== CAMERA_WIDTH || height !== CAMERA_HEIGHT) throw new Error(saveError);
  return Buffer.from(bytes);
}

export class CallCameraBackground {
  #color = CAMERA_BACKGROUND_COLOR;
  #image = null;
  #revision = 0;

  constructor(file) {
    this.file = file;
    try {
      assertPrivatePath(file);
      const info = lstatSync(file);
      if (!info.isFile() || info.nlink !== 1 || info.size > CAMERA_BACKGROUND_IMAGE_BYTES * 2)
        return;
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 1 || !cameraBackgroundColorValid(saved.color)) return;
      const image =
        saved.image === null ? null : backgroundImage(Buffer.from(saved.image, 'base64'));
      this.#color = saved.color.toLowerCase();
      this.#image = image;
    } catch {
      // Missing or unreadable preferences fall back to the built-in background.
    }
  }

  snapshot() {
    return { color: this.#color, imageRevision: this.#image ? this.#revision : null };
  }

  image(revision) {
    return revision === this.#revision ? this.#image : null;
  }

  set(value) {
    try {
      const color = value?.image === undefined ? value?.color : this.#color;
      if (!cameraBackgroundColorValid(color)) throw new Error(saveError);
      const nextColor = color.toLowerCase();
      const image = value.image === undefined ? null : backgroundImage(value.image);
      if (!image && !this.#image && this.#color === nextColor) return;
      const json = JSON.stringify({
        version: 1,
        color: nextColor,
        image: image?.toString('base64') ?? null,
      });
      writePrivateBytesAtomic(this.file, Buffer.from(json));
      this.#color = nextColor;
      this.#image = image;
      this.#revision++;
    } catch {
      throw new Error(saveError);
    }
  }
}
