// SPDX-License-Identifier: GPL-3.0-only
//
// Serves Capri's sprite PNGs in the owner's chosen colors. The capri://
// protocol handler passes every response body through transform(); only
// avatar art under /sprites/ is touched, and nothing changes while the colors
// are the defaults. Recolored sprites are kept in memory per color choice.
import { ART_KEY, avatarArtKey, recolorAtlas, recolorSprite } from '../renderer/avatar-colors.mjs';

export const SPRITE_PATH = /^\/sprites\/[a-z0-9][a-z0-9_.-]{0,80}\.png$/;
export const MAX_CACHED = 120;
// Capri 1.3.0 draws the face (blinks, expressions, gesture faces) from these
// images over the sprite. The atlases hold many small face crops.
export const FACE_IMAGES = Object.freeze(['/avatar-blink-pose.png', '/avatar-blink-eyes.png']);
export const FACE_ATLASES = Object.freeze(['/avatar-face-poses.png', '/avatar-face-gestures.png']);
const isAvatarArt = (pathname) =>
  SPRITE_PATH.test(pathname) || FACE_IMAGES.includes(pathname) || FACE_ATLASES.includes(pathname);

/** True for a capri:// request the protocol should accept with a ?c= tag. */
export const taggedSpriteRequest = (pathname, search) =>
  isAvatarArt(pathname) && search.startsWith('?c=') && ART_KEY.test(search.slice(3));

/** Swaps the first and third byte of every pixel (BGRA <-> RGBA), in place. */
export function swapRedBlue(bytes) {
  for (let p = 0; p < bytes.length; p += 4) {
    const first = bytes[p];
    bytes[p] = bytes[p + 2];
    bytes[p + 2] = first;
  }
  return bytes;
}

export class AvatarRecolor {
  /**
   * getColors: () => the saved avatarColors setting.
   * image: Electron's nativeImage (createFromBuffer / createFromBitmap).
   * atlasEntries: (pathname) => the face atlas registrations, or null.
   */
  constructor({
    getColors,
    image,
    recolor = recolorSprite,
    atlas = recolorAtlas,
    atlasEntries = () => null,
  }) {
    if (typeof getColors !== 'function' || !image)
      throw TypeError('AvatarRecolor needs getColors and image.');
    Object.assign(this, { getColors, image, recolor, atlas, atlasEntries });
    this.cache = new Map();
  }

  /** A short id for the current colors, or '' when the art is unchanged. */
  key() {
    return avatarArtKey(this.getColors());
  }

  transform(pathname, bytes) {
    if (!isAvatarArt(pathname)) return bytes;
    const key = this.key();
    if (!key) return bytes;
    const id = key + pathname;
    const cached = this.cache.get(id);
    if (cached) return cached;
    let output = bytes;
    try {
      const source = this.image.createFromBuffer(Buffer.from(bytes));
      const { width, height } = source.getSize();
      if (!width || !height) return bytes;
      // nativeImage bitmaps are BGRA on Windows.
      const pixels = swapRedBlue(new Uint8Array(source.toBitmap()));
      if (FACE_ATLASES.includes(pathname)) {
        const entries = this.atlasEntries(pathname);
        if (!entries) return bytes;
        this.atlas(pixels, width, height, entries, this.getColors());
      } else this.recolor(pixels, width, height, this.getColors());
      const result = this.image.createFromBitmap(Buffer.from(swapRedBlue(pixels).buffer), {
        width,
        height,
      });
      output = result.toPNG();
    } catch (error) {
      console.warn('Capri colors: could not recolor ' + pathname + ':', error.message);
      return bytes;
    }
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(id, output);
    return output;
  }
}
