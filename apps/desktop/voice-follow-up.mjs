// SPDX-License-Identifier: GPL-3.0-only
/** Only the trusted microphone callback can create a voice-origin turn. */
export function wantsVoiceFollowUp({ text, origin, enabled, sessionId, activeSessionId }) {
  return Boolean(
    enabled &&
      origin === 'microphone' &&
      sessionId &&
      sessionId === activeSessionId &&
      /[?？؟][\s\p{Pe}\p{Pf}"'»]*$/u.test(String(text ?? '').trim()),
  );
}
