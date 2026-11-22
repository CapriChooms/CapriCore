// SPDX-License-Identifier: GPL-3.0-only
const MAX_EVENT = 262144;

/** Decode SSE without assuming a TCP chunk is a line or a complete UTF-8 character. */
export async function* sseData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  let dataLength = 0;
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > MAX_EVENT) throw new Error('Gateway event exceeds limit');
    let position;
    while ((position = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, position).replace(/\r$/, '');
      buffer = buffer.slice(position + 1);
      if (!line) {
        if (data.length) yield data.join('\n');
        data = [];
        dataLength = 0;
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
        dataLength += data.at(-1).length;
        if (dataLength > MAX_EVENT) throw new Error('Gateway event exceeds limit');
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() || data.length)
    throw new Error('Gateway stream ended in the middle of an event');
}
