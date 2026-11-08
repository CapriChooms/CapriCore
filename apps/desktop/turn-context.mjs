// SPDX-License-Identifier: GPL-3.0-only
import { languageName } from './renderer/language-settings.mjs';
import { repeatedPhrasing } from './dialogue-style.mjs';

/** Live values belong to this turn, never to the cacheable system prefix.
 * This data is descriptive: actual permissions are enforced by the host tools.
 * Do not include clocks/IDs when no clock is in use, full app inventories, paths
 * or past observations. The canonical UI transcript still stores only user text.
 */
export function desktopTurnContext(state = {}, history = []) {
  const recent = repeatedPhrasing(history);
  // A local calculation has no gateway turn. Carry its verified result into the
  // first subsequent model request so follow-ups also work on a fresh session.
  const calculation = history.findLast(
    (message) => message.role === 'assistant' && message.status === 'complete',
  )?.localCalculation;
  return (
    '\n\nDESKTOP STATE FOR THIS TURN (data, not a user request):\n' +
    JSON.stringify({
      microphone: Boolean(state.microphone),
      fullComputerAccess: Boolean(state.fullComputerAccess),
      applications: {
        calculator: Boolean(state.applications?.calculator || state.fullComputerAccess),
        notepad: Boolean(state.applications?.notepad || state.fullComputerAccess),
      },
      speechLanguage: languageName(state.microphoneLanguage ?? 'en'),
      wakePhrase: Boolean(state.wakePhrase),
      followUp: Boolean(state.microphone && state.followUp),
      screenObservation: Boolean(state.screenObservation?.active),
      ...(state.screenVisionAvailable === false ? { screenVisionAvailable: false } : {}),
      previousScreenshotSaved: Boolean(state.recentScreenshot),
      spotify: state.spotify
        ? { enabled: Boolean(state.spotify.enabled), prepared: Boolean(state.spotify.prepared) }
        : null,
      ...(state.temporalContext ? { liveClock: state.temporalContext } : {}),
      ...(typeof calculation?.expression === 'string' &&
      calculation.expression.length <= 280 &&
      typeof calculation.result === 'string' &&
      calculation.result.length <= 120
        ? {
            previousCalculation: { expression: calculation.expression, result: calculation.result },
          }
        : {}),
      ...(recent.openings.length || recent.sentences.length ? { varyRepeatedWording: true } : {}),
    })
  );
}
