export const SPEECH_DEFAULTS = Object.freeze({ trailingSilenceSeconds: 1 });
export const SPEECH_PAUSE = Object.freeze({ min: 0.5, max: 5, step: 0.1 });

export function validateSpeechSettings(value) {
  const pause = value?.trailingSilenceSeconds;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof pause !== 'number' ||
    !Number.isFinite(pause) ||
    pause < SPEECH_PAUSE.min ||
    pause > SPEECH_PAUSE.max ||
    Math.abs(pause * 10 - Math.round(pause * 10)) > 1e-8
  )
    throw new Error('Invalid speech pause');
  return { trailingSilenceSeconds: Math.round(pause * 10) / 10 };
}
