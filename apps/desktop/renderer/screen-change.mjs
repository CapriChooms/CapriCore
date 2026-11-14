export const SAMPLE_WIDTH = 64;
export const SAMPLE_HEIGHT = 36;
export const SAMPLE_BYTES = SAMPLE_WIDTH * SAMPLE_HEIGHT;

export function validScreenSample(value) {
  return value instanceof Uint8Array && value.length === SAMPLE_BYTES;
}

export function screenChanged(previous, current, threshold = 0.035) {
  return screenDifference(previous, current) >= threshold;
}

export function screenDifference(previous, current) {
  if (!validScreenSample(current)) throw new Error('Invalid screen sample');
  if (!previous) return 1;
  if (!validScreenSample(previous)) throw new Error('Invalid previous screen sample');
  let difference = 0;
  for (let i = 0; i < current.length; i++) difference += Math.abs(current[i] - previous[i]);
  return difference / (current.length * 255);
}

export function sampleScreen(video, canvas) {
  if (canvas.width !== SAMPLE_WIDTH) canvas.width = SAMPLE_WIDTH;
  if (canvas.height !== SAMPLE_HEIGHT) canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
  const sample = new Uint8Array(SAMPLE_BYTES);
  for (let i = 0; i < sample.length; i++)
    sample[i] = Math.round(
      pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114,
    );
  return sample;
}
