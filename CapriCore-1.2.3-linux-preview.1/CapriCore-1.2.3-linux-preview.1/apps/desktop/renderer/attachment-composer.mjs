// SPDX-License-Identifier: GPL-3.0-only
import { clipboardFiles } from './clipboard-files.mjs';
import { screenFrameCanvas, screenPng } from './screen-mosaic.mjs';
const images = new Set(['png', 'jpg', 'jpeg', 'webp']);
const videos = { mp4: 'video/mp4', webm: 'video/webm' };
const text = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'log', 'docx', 'odt', 'pdf']);
const FRAME_LIMIT = 4;

function safeDimensions(width, height) {
  if (!width || !height || width * height > 18000000) throw new Error('Image too large');
}

async function checkImageHeader(file, extension) {
  const header = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (
    extension === 'png' &&
    header.getUint32(0) === 0x89504e47 &&
    header.getUint32(12) === 0x49484452
  )
    return safeDimensions(header.getUint32(16), header.getUint32(20));
  if (extension === 'gif' && header.getUint32(0) === 0x47494638)
    return safeDimensions(header.getUint16(6, true), header.getUint16(8, true));
  if (
    extension === 'webp' &&
    header.getUint32(0) === 0x52494646 &&
    header.getUint32(8) === 0x57454250
  ) {
    const kind = header.getUint32(12);
    if (kind === 0x56503858)
      return safeDimensions(
        1 + (header.getUint32(24, true) & 0xffffff),
        1 + (header.getUint32(26, true) >>> 8),
      );
    if (kind === 0x5650384c) {
      const value = header.getUint32(21, true);
      return safeDimensions(1 + (value & 0x3fff), 1 + ((value >>> 14) & 0x3fff));
    }
    if (kind === 0x56503820)
      return safeDimensions(
        header.getUint16(26, true) & 0x3fff,
        header.getUint16(28, true) & 0x3fff,
      );
  }
  if (['jpg', 'jpeg'].includes(extension) && header.getUint16(0) === 0xffd8) {
    for (let at = 2; at + 9 <= header.byteLength; ) {
      if (header.getUint8(at++) !== 0xff) break;
      while (at < header.byteLength && header.getUint8(at) === 0xff) at++;
      if (at + 8 > header.byteLength) break;
      const marker = header.getUint8(at++);
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      )
        return safeDimensions(header.getUint16(at + 5), header.getUint16(at + 3));
      if (marker === 0xda) break;
      const size = header.getUint16(at);
      if (size < 2) break;
      at += size;
    }
  }
  throw new Error('Unexpected image header');
}

function sheet(count) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#111827';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const columns = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const w = canvas.width / columns,
    h = canvas.height / rows;
  return {
    canvas,
    draw(frame, width, height, index, label) {
      safeDimensions(width, height);
      const x = (index % columns) * w,
        y = Math.floor(index / columns) * h;
      const bar = label ? 26 : 0;
      const scale = Math.min(1, (w - 8) / width, (h - bar - 8) / height);
      context.drawImage(
        frame,
        x + (w - width * scale) / 2,
        y + bar + (h - bar - height * scale) / 2,
        width * scale,
        height * scale,
      );
      if (label) {
        context.fillStyle = '#ecffff';
        context.font = '16px system-ui';
        context.fillText(label, x + 8, y + 20);
      }
    },
  };
}

function waitVideo(video, event, action) {
  return new Promise((resolve, reject) => {
    const done = (error) => {
      clearTimeout(timer);
      video.removeEventListener(event, success);
      video.removeEventListener('error', failure);
      if (error) reject(error);
      else resolve();
    };
    const success = () => done();
    const failure = () => done(new Error('Video cannot be decoded'));
    const timer = setTimeout(failure, 3500);
    video.addEventListener(event, success, { once: true });
    video.addEventListener('error', failure, { once: true });
    try {
      action();
    } catch (error) {
      done(error);
    }
  });
}

async function renderVideo(file, type) {
  const video = document.createElement('video');
  if (!video.canPlayType(type)) throw new Error('Unsupported codec');
  video.muted = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(file);
  try {
    await waitVideo(video, 'loadedmetadata', () => {
      video.src = url;
    });
    safeDimensions(video.videoWidth, video.videoHeight);
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 120)
      throw new Error('Video duration is unavailable or exceeds two minutes');
    const result = sheet(FRAME_LIMIT);
    for (let index = 0; index < FRAME_LIMIT; index++) {
      const at = (video.duration * (index + 0.5)) / FRAME_LIMIT;
      await waitVideo(video, 'seeked', () => {
        video.currentTime = at;
      });
      result.draw(video, video.videoWidth, video.videoHeight, index, `${at.toFixed(1)} s`);
    }
    return result.canvas;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function renderGif(file) {
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const frames = decoder.tracks.selectedTrack.frameCount;
    if (!frames || frames > 1200) throw new Error('GIF frame count exceeds limit');
    const count = Math.min(FRAME_LIMIT, frames);
    const result = sheet(count);
    for (let index = 0; index < count; index++) {
      const frameIndex = count === 1 ? 0 : Math.floor(((frames - 1) * index) / (count - 1));
      const { image } = await decoder.decode({ frameIndex });
      try {
        result.draw(
          image,
          image.displayWidth,
          image.displayHeight,
          index,
          count > 1 ? `Frame ${frameIndex + 1}` : '',
        );
      } finally {
        image.close();
      }
    }
    return result.canvas;
  } finally {
    decoder.close();
  }
}

async function renderImage(file, extension) {
  if (Object.hasOwn(videos, extension)) return renderVideo(file, videos[extension]);
  await checkImageHeader(file, extension);
  if (extension === 'gif' && typeof ImageDecoder === 'function') return renderGif(file);
  const image = await createImageBitmap(file);
  try {
    safeDimensions(image.width, image.height);
    const canvas = screenFrameCanvas(image, image.width, image.height, true);
    const context = canvas.getContext('2d');
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#111827';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.close();
  }
}

async function readPdf(file) {
  const { getDocument, GlobalWorkerOptions } = await import('./attachment-pdf.mjs');
  GlobalWorkerOptions.workerSrc = new URL('./attachment-pdf.worker.mjs', import.meta.url).href;
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
  });
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const pdf = await task.promise;
        let text = '';
        const pageLimit = Math.min(pdf.numPages, 30);
        for (let index = 1; index <= pageLimit && text.length < 12001; index++) {
          const page = await pdf.getPage(index);
          const content = await page.getTextContent();
          text +=
            content.items.map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ' ')).join('') +
            '\n\n';
          page.cleanup();
        }
        if (!text.trim()) throw new Error('PDF has no selectable text');
        return { blob: new Blob([text.slice(0, 12001)]), shortened: pdf.numPages > pageLimit };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('PDF read timed out')), 6000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}

export class AttachmentComposer {
  constructor({ api, onChange, canAttach, isRemote, canSee, text }) {
    Object.assign(this, { api, onChange, canAttach, isRemote, canSee, text });
    this.items = [];
    this.messages = [];
    this.revision = 0;
    this.input = document.getElementById('attachment-input');
    this.button = document.getElementById('attachment-open');
    this.dock = document.getElementById('attachment-drafts');
    this.info = document.getElementById('attachment-info');
    this.list = document.getElementById('attachment-list');
    const composer = document.querySelector('.composer');
    document.getElementById('message').addEventListener('paste', (event) => {
      if (!this.canAttach()) return;
      const files = clipboardFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void this.add(files);
    });
    this.button.onclick = () => this.input.click();
    this.input.onchange = () => {
      const files = Array.from(this.input.files);
      this.input.value = '';
      void this.add(files);
    };
    document.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    });
    document.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (composer.contains(event.target)) void this.add(Array.from(event.dataTransfer.files));
    });
  }
  async add(files) {
    if (this.pending || !this.canAttach()) return;
    this.pending = true;
    const revision = ++this.revision;
    this.render();
    const messages = new Set();
    const slots = 4 - this.items.length;
    try {
      for (const file of files.slice(0, slots)) {
        if (revision !== this.revision) return;
        const extension = /\.([a-z\d]{1,8})$/i.exec(file.name)?.[1].toLowerCase();
        const media =
          images.has(extension) || extension === 'gif' || Object.hasOwn(videos, extension);
        if (!media && !text.has(extension)) {
          messages.add('Capri cannot read this file format yet.');
          continue;
        }
        if (media && !this.canSee()) {
          messages.add('The active model cannot read images or video frames.');
          continue;
        }
        if (!file.size || file.size > (Object.hasOwn(videos, extension) ? 32 : 8) * 1024 * 1024) {
          messages.add('This file is empty or too large.');
          continue;
        }
        try {
          const canvas = media ? await renderImage(file, extension) : null;
          const pdf = extension === 'pdf' ? await readPdf(file) : null;
          const payload = canvas ? await screenPng(canvas) : (pdf?.blob ?? file);
          if (!payload || payload.size > (media ? 3 : 8) * 1024 * 1024) throw new Error();
          if (revision !== this.revision) return;
          const name = file.name.replace(/[\x00-\x1f\x7f]/g, '').slice(-160);
          const result = await this.api.addAttachment({
            name,
            originalBytes: file.size,
            bytes: new Uint8Array(await payload.arrayBuffer()),
          });
          if (result.accepted) {
            if (revision !== this.revision) {
              void this.api.removeAttachment(result.id).catch(() => {});
              return;
            }
            this.items.push({ id: result.id, name });
            if (result.shortened || pdf?.shortened)
              messages.add('Capri will read the first part of a long document.');
            if (result.animated) messages.add('Capri reads sampled frames without audio.');
          } else messages.add(result.message);
        } catch {
          messages.add('Capri could not read this file or its media codec.');
        }
      }
      if (files.length > slots) messages.add('Attach up to four files at once.');
    } finally {
      this.pending = false;
      if (revision === this.revision) this.messages = [...messages];
      this.render();
    }
  }
  clear() {
    this.revision++;
    for (const item of this.items) void this.api.removeAttachment(item.id).catch(() => {});
    this.items = [];
    this.messages = [];
    this.render();
  }
  remove(id) {
    const item = this.items.find((value) => value.id === id);
    if (!item || this.pending) return false;
    this.items = this.items.filter((value) => value !== item);
    void this.api.removeAttachment(item.id).catch(() => {});
    this.render();
    return true;
  }
  render() {
    this.list.replaceChildren(
      ...this.items.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${item.name} ×`;
        button.title = this.text('Remove {filename}', { filename: item.name });
        button.onclick = () => this.remove(item.id);
        return button;
      }),
    );
    const external =
      this.items.length && this.isRemote() ? 'Files are shared with the active API when sent.' : '';
    this.info.textContent = [
      ...this.messages,
      this.pending ? 'Preparing attachments…' : '',
      external,
    ]
      .filter(Boolean)
      .map((message) => this.text(message))
      .join(' ');
    this.dock.hidden = !this.items.length && !this.info.textContent;
    this.onChange();
  }
}
