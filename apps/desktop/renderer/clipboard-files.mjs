// SPDX-License-Identifier: GPL-3.0-only
// Read only the File objects supplied by an explicit paste event, never paths,
// clipboard text/HTML, remote URLs or the global clipboard.
const imageExtensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const supported = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'mp4',
  'webm',
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'log',
  'docx',
  'odt',
  'pdf',
]);
const videos = new Set(['mp4', 'webm']);

export function clipboardFiles(data) {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (!files.length)
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  return files.map((file) => {
    let name = (file.name || '')
      .split(/[\\/]/)
      .at(-1)
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(-160);
    if (!/\.[a-z\d]{1,8}$/i.test(name) && imageExtensions[file.type])
      name = 'clipboard-image.' + imageExtensions[file.type];
    name ||= 'clipboard-file';
    return name === file.name ? file : new File([file], name, { type: file.type });
  });
}

/** Mini-to-owner transport only. Decode/format/vision checks stay in AttachmentComposer. */
export async function clipboardFilePayload(files) {
  const result = [];
  for (const file of files.slice(0, 4)) {
    const extension = /\.([a-z\d]{1,8})$/i.exec(file.name)?.[1].toLowerCase();
    const limit = (videos.has(extension) ? 32 : 8) * 1024 * 1024;
    // Empty placeholders preserve the owner's ordinary unsupported/size warnings
    // without reading a rejected or oversized file into memory.
    const bytes =
      supported.has(extension) && file.size > 0 && file.size <= limit
        ? new Uint8Array(await file.arrayBuffer())
        : new Uint8Array();
    if (bytes.byteLength > limit) throw Error('This file is empty or too large.');
    result.push({ name: file.name, bytes });
  }
  return { files: result, overflow: files.length > 4 };
}
