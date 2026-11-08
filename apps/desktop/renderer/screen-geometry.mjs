/** Same inverse lens mapping for shader samples and native alpha hit testing. */
export const CRT_CURVATURE = 0.036;
export function screenSample(point, lens) {
  if (!lens) return point;
  const x = ((point.x - lens.x) / lens.width) * 2 - 1;
  const y = ((point.y - lens.y) / lens.height) * 2 - 1;
  const scale = 1 + lens.curve * (x * x + y * y);
  return {
    x: lens.x + ((x * scale + 1) * lens.width) / 2,
    y: lens.y + ((y * scale + 1) * lens.height) / 2,
  };
}
