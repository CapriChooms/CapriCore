export const MICROPHONE_GAIN = Object.freeze({ min: 0, max: 200, default: 100 });
export const SPEECH_DEFAULTS = Object.freeze({
  trailingSilenceSeconds: 1,
  microphoneGain: MICROPHONE_GAIN.default,
});
export const SPEECH_PAUSE = Object.freeze({ min: 0.5, max: 5, step: 0.1 });

export function validateMicrophoneGain(value) {
  if (!Number.isInteger(value) || value < MICROPHONE_GAIN.min || value > MICROPHONE_GAIN.max)
    throw new Error('Invalid microphone gain');
  return value;
}

export function validateSpeechSettings(value) {
  const pause = value?.trailingSilenceSeconds;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['trailingSilenceSeconds', 'microphoneGain'].includes(key)) ||
    typeof pause !== 'number' ||
    !Number.isFinite(pause) ||
    pause < SPEECH_PAUSE.min ||
    pause > SPEECH_PAUSE.max ||
    Math.abs(pause * 10 - Math.round(pause * 10)) > 1e-8
  )
    throw new Error('Invalid speech pause');
  return {
    trailingSilenceSeconds: Math.round(pause * 10) / 10,
    microphoneGain: validateMicrophoneGain(
      Object.hasOwn(value, 'microphoneGain') ? value.microphoneGain : MICROPHONE_GAIN.default,
    ),
  };
}
