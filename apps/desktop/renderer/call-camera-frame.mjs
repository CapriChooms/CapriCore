// SPDX-License-Identifier: GPL-3.0-only
import {
  CAMERA_WIDTH,
  CAMERA_HEIGHT,
  CAMERA_FRAME_BYTES,
  CAMERA_BACKGROUND_COLOR,
} from '../call-camera-protocol.mjs';
import { avatarPoseSegments, avatarPoseSwing } from '../avatar-pose-motion.mjs';

const artworkSize = 1254;

function drawCharacter(context, image, x, y, width, height, motion) {
  if (!motion) {
    context.drawImage(image, x, y, width, height);
    return;
  }
  context.save();
  context.translate(x, y);
  context.scale(width / artworkSize, height / artworkSize);
  context.save();
  context.beginPath();
  context.rect(0, 0, artworkSize, artworkSize);
  for (const {
    bounds: [left, top, right, bottom],
  } of motion.segments)
    context.rect(left, top, right - left, bottom - top);
  context.clip('evenodd');
  context.drawImage(image, 0, 0, artworkSize, artworkSize);
  context.restore();
  for (const segment of motion.segments) {
    const {
      bounds: [left, top, right, bottom],
      pivot: [px, py],
    } = segment;
    context.save();
    context.translate(px, py);
    context.rotate((avatarPoseSwing(motion.now, segment) * Math.PI) / 180);
    context.translate(-px, -py);
    context.beginPath();
    context.rect(left, top - 5, right - left, bottom - top + 5);
    context.clip();
    context.drawImage(image, 0, 0, artworkSize, artworkSize);
    context.restore();
  }
  context.restore();
}

export function cameraPoseMotion(id, now = Date.now()) {
  const segments = avatarPoseSegments(id);
  return segments.length ? { segments, now, key: `${id}:${Math.floor(now / (1000 / 12))}` } : null;
}

export function cameraI420(rgba, pixels, width, height) {
  const size = width * height;
  let chroma = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const first = y * width + x;
      let red = 0,
        green = 0,
        blue = 0;
      for (let row = first; row <= first + width; row += width) {
        for (let index = row; index < row + 2; index++) {
          const offset = index * 4;
          const r = rgba[offset],
            g = rgba[offset + 1],
            b = rgba[offset + 2];
          pixels[index] = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
          red += r;
          green += g;
          blue += b;
        }
      }
      pixels[size + chroma] = ((-38 * red - 74 * green + 112 * blue + 512) >> 10) + 128;
      pixels[size + size / 4 + chroma] = ((112 * red - 94 * green - 18 * blue + 512) >> 10) + 128;
      chroma++;
    }
  }
  return pixels;
}

export class CameraFramePublisher {
  color = CAMERA_BACKGROUND_COLOR;
  sourceActive = true;

  constructor({
    image,
    breathScale = () => 1,
    poseMotion = () => null,
    send,
    sendPreview,
    loadBackground,
  }) {
    this.image = image;
    this.breathScale = breathScale;
    this.poseMotion = poseMotion;
    this.send = send;
    this.sendPreview = sendPreview;
    this.loadBackground = loadBackground;
  }

  setState(state) {
    this.state = state;
    this.update();
  }

  setPreview(enabled) {
    if (this.previewEnabled === enabled) return;
    this.previewEnabled = enabled;
    this.previewGeneration = (this.previewGeneration ?? 0) + 1;
    this.previewFrame = null;
    this.update();
  }

  setSourceActive(active) {
    if (this.sourceActive === active) return;
    this.sourceActive = active;
    this.update();
  }

  get wantsFrame() {
    return Boolean(this.sourceActive && (this.state?.enabled || this.previewEnabled));
  }

  update() {
    if (!this.wantsFrame) {
      this.stop();
      return;
    }
    const { color = CAMERA_BACKGROUND_COLOR, imageRevision = null } = this.state?.background ?? {};
    if (this.background?.color !== color || this.background?.imageRevision !== imageRevision) {
      const selection = { color, imageRevision };
      this.background = selection;
      this.replaceBackground(color);
      if (imageRevision !== null) void this.readBackground(selection);
    }
    if (!this.timer) {
      const canvas = document.createElement('canvas');
      canvas.width = CAMERA_WIDTH;
      canvas.height = CAMERA_HEIGHT;
      this.context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!this.context) return;
      this.timer = setInterval(() => void this.tick(), 75);
    }
    if (this.state?.enabled) this.frame ??= new Uint8Array(CAMERA_FRAME_BYTES);
    else this.frame = this.nativeFrame = null;
    void this.tick();
  }

  async readBackground(selection) {
    let bitmap;
    try {
      const bytes = await this.loadBackground(selection.imageRevision);
      if (bytes && this.background === selection) {
        bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      }
    } catch {
      // A missing or invalid bitmap falls back to the saved solid color.
    }
    if (this.background === selection) this.replaceBackground(selection.color, bitmap);
    else bitmap?.close();
  }

  replaceBackground(color, bitmap) {
    this.backgroundBitmap?.close();
    this.backgroundBitmap = bitmap;
    this.color = color;
    this.previous = null;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = this.context = this.frame = this.background = null;
    this.nativeFrame = this.previewFrame = null;
    this.replaceBackground(CAMERA_BACKGROUND_COLOR);
  }

  async publishPreview() {
    if (!this.previewEnabled || this.previewPending || this.previewFrame === this.previous) return;
    const previous = this.previous;
    const generation = this.previewGeneration;
    const background = this.background;
    this.previewPending = true;
    try {
      const png = await new Promise((resolve) => this.context.canvas.toBlob(resolve, 'image/png'));
      if (!png) return;
      const bytes = new Uint8Array(await png.arrayBuffer());
      if (generation !== this.previewGeneration || background !== this.background) return;
      if (await this.sendPreview(bytes)) this.previewFrame = previous;
    } catch {
      // The settings window can close while a frame is being encoded.
    } finally {
      this.previewPending = false;
    }
  }

  async tick() {
    if (!this.context) return;
    const image = this.image();
    const width = image?.naturalWidth ?? image?.width;
    const height = image?.naturalHeight ?? image?.height;
    if (!width || !height || image.complete === false) return;
    const revision = image.avatarTextureRevision ?? image.currentSrc ?? null;
    const breath = this.breathScale();
    const motion = this.poseMotion(image);
    const changed =
      this.previous?.image !== image ||
      this.previous?.revision !== revision ||
      this.previous?.breath !== breath ||
      this.previous?.motion !== (motion?.key ?? null);
    if (changed) {
      const scale = Math.min((CAMERA_WIDTH - 28) / width, (CAMERA_HEIGHT - 18) / height);
      const fittedHeight = height * scale;
      const stretchedHeight = fittedHeight * breath;
      const context = this.context;
      context.fillStyle = this.color;
      context.fillRect(0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
      if (this.backgroundBitmap) context.drawImage(this.backgroundBitmap, 0, 0);
      drawCharacter(
        context,
        image,
        (CAMERA_WIDTH - width * scale) / 2,
        (CAMERA_HEIGHT - fittedHeight) / 2 - (stretchedHeight - fittedHeight) * 0.93,
        width * scale,
        stretchedHeight,
        motion,
      );
      this.previous = { image, revision, breath, motion: motion?.key ?? null };
    }
    void this.publishPreview();
    if (!this.frame || this.pending) return;
    const now = performance.now();
    if (this.nativeFrame !== this.previous) {
      const { data } = this.context.getImageData(0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
      cameraI420(data, this.frame, CAMERA_WIDTH, CAMERA_HEIGHT);
      this.nativeFrame = this.previous;
    } else if (now - this.sentAt < 1000) return;
    this.pending = true;
    this.sentAt = now;
    try {
      if (!(await this.send(this.frame))) this.sentAt = -Infinity;
    } catch {
      this.sentAt = -Infinity;
    } finally {
      this.pending = false;
    }
  }
}

export function cameraBreathScale(sprite, sleeping) {
  if (!sleeping) return 1;
  const { transform } = getComputedStyle(sprite);
  return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).d;
}
