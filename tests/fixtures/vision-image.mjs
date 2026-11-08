import { deflateSync } from 'node:zlib';
/** Original generated fixture, never a user screenshot. */
export function visionImage() {
  const width = 320,
    height = 180,
    raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const color =
        x >= 30 && x < 130 && y >= 40 && y < 140
          ? [240, 0, 0]
          : (x - 240) ** 2 + (y - 90) ** 2 <= 45 ** 2
            ? [0, 60, 240]
            : [255, 255, 255];
      raw.set(color, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const name = Buffer.from(type),
      body = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
