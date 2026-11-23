import { lstatSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';

const ID = /^[a-f0-9-]{36}$/i;
const MAX_BYTES = 64 * 1024 * 1024;
export function screenshotDimensions(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 33 || value.byteLength > MAX_BYTES)
    throw new Error('Invalid screenshot');
  const png = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('Screenshot must be PNG');
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000)
    throw new Error('Screenshot dimensions exceed limits');
  return { width, height };
}

/** Fixed private output, exclusive filenames and no arbitrary file-opening capability. */
export class ScreenshotFiles {
  constructor({ root, directory }) {
    this.root = realpathSync(root);
    this.directory = path.resolve(directory);
  }
  folder() {
    if (!this.directory.startsWith(this.root + path.sep))
      throw new Error('Screenshot folder must stay inside the project');
    let current = this.root;
    for (const part of path.relative(this.root, this.directory).split(path.sep)) {
      current = path.join(current, part);
      if (
        existsSync(current) &&
        (lstatSync(current).isSymbolicLink() || !lstatSync(current).isDirectory())
      )
        throw new Error('Invalid screenshot folder');
    }
    mkdirSync(this.directory, { recursive: true });
    if (!realpathSync(this.directory).startsWith(this.root + path.sep))
      throw new Error('Screenshot folder outside project');
    return this.directory;
  }
  file(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid screenshot ID');
    return path.join(this.folder(), `Capri-${id}.png`);
  }
  saved(id) {
    const file = this.file(id);
    if (!existsSync(file)) return null;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 33 || stat.size > MAX_BYTES)
      throw new Error('Invalid saved screenshot');
    return { id, file, name: path.basename(file), bytes: stat.size, capturedAt: stat.mtimeMs };
  }
  async save(id, png, { signal } = {}) {
    signal?.throwIfAborted();
    const dimensions = screenshotDimensions(png),
      file = this.file(id);
    const handle = await open(file, 'wx', 0o600);
    let complete = false;
    // Disk writes and flushes must not block microphone acknowledgements.
    try {
      try {
        signal?.throwIfAborted();
        await handle.writeFile(png);
        await handle.sync();
      } finally {
        await handle.close();
      }
      signal?.throwIfAborted();
      complete = true;
    } finally {
      if (!complete) await unlink(file);
    }
    return { id, file, name: path.basename(file), bytes: png.byteLength, ...dimensions };
  }
}
