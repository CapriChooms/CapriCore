// SPDX-License-Identifier: GPL-3.0-only

export const AVATAR_REPLY_INSTRUCTION =
  'The capriAvatar field in DESKTOP STATE FOR THIS TURN is your own onscreen body. When the owner comments on it, answer as yourself in one or two sentences. Explicitly use the relevant detail (for example, your hair color, or whether you are hanging by your hands or your feet). Use the current pose over earlier dialogue and correct any mistaken premise about your current pose. Keep any joke grounded in the avatar. This data tells you nothing about the owner’s desk, files, or other apps. If your pose is missing, you can describe your usual look without guessing your pose. For questions about an attached image, use the image itself.';

const appearance =
  'Very large, jagged bright red hair, an angular neon-green face and large blue cybernetic eyes.';

const forms = {
  portrait: 'Character visible in the home window.',
  desktop: 'Character visible on the desktop outside the home window.',
  compact: 'Only the compact signal core is visible.',
  dialogue: 'Only the dialogue is visible.',
  moving: 'The avatar is moving between positions.',
  hidden: 'The character is currently off-screen or its pose is unavailable.',
};

const actions = {
  wink: 'Winking',
  gaze: 'Looking around',
  surprise: 'Showing surprise',
  laugh: 'Laughing',
  excited: 'Showing excitement',
  sleepy: 'Looking sleepy',
};

/** Descriptive data from the app's own artwork and presentation, with no screen or app access. */
export function describeOwnAvatar({ mode, frame, expression, activity, placement, character }) {
  const state = {
    form: forms[mode],
    appearance,
  };
  if (!character) return { ...state, form: 'The character artwork is unavailable.' };
  if (!frame || !['portrait', 'desktop'].includes(mode)) return state;
  const pose =
    mode === 'desktop' && ['ceiling_hands', 'ceiling_feet'].includes(frame.pose)
      ? `Hanging ${frame.pose === 'ceiling_feet' ? 'upside down by the feet' : 'by both hands'} from ${placement === 'window' ? 'a window edge' : 'the top edge of the screen, like a ceiling'}.`
      : mode === 'desktop' && frame.pose === 'seat' && placement !== 'window'
        ? 'Sitting on a desktop edge.'
        : frame.pose === 'idle'
          ? 'Standing.'
          : frame.description;
  return {
    ...state,
    ...(pose && { pose }),
    ...(frame.pose === 'sleep' && { action: 'Sleeping with eyes closed' }),
    ...(frame.pose !== 'sleep' &&
      frame.kind !== 'reviewed_music' &&
      expression && {
        expression: ['neutral', 'neutral_small_smile'].includes(expression)
          ? 'relaxed with a small smile'
          : expression.replace(/^idle-/, '').replaceAll('_', ' '),
        ...(actions[activity] && { action: actions[activity] }),
      }),
  };
}
