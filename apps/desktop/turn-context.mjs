// SPDX-License-Identifier: GPL-3.0-only
import { languageName } from './renderer/language-settings.mjs';
import { repeatedPhrasing } from './dialogue-style.mjs';

export function whenPromptSkill(state, ids, ...items) {
  const activeSkills = state?.activeSkills;
  return !activeSkills || [ids].flat().some((id) => activeSkills.has(id)) ? items : [];
}

/** Live values belong to this turn, never to the cacheable system prefix.
 * This data is descriptive: actual permissions are enforced by the host tools.
 * Do not include clocks/IDs when no clock is in use, full app inventories, paths
 * or past observations. The canonical UI transcript still stores only user text.
 */
export function desktopTurnContext(
  state = {},
  history = [],
  { dialogueOnly = false, includeLocalGreeting = false } = {},
) {
  const recent = repeatedPhrasing(history);
  // A local calculation has no gateway turn. Carry its verified result into the
  // first subsequent model request so follow-ups also work on a fresh session.
  const lastReply = history.findLast(
    (message) => message.role === 'assistant' && message.status === 'complete',
  );
  const calculation = lastReply?.localCalculation;
  // A direct greeting also has no gateway turn. Keep immediate follow-ups coherent.
  const greeting =
    includeLocalGreeting && lastReply?.localGreeting === true
      ? history.findLast(
          (message) => message.role === 'user' && message.turnId === lastReply.turnId,
        )
      : null;
  const skill = (id, fields) => whenPromptSkill(state, `capri.${id}`, fields)[0];
  const value = {
    ...(!dialogueOnly
      ? {
          ...skill('microphone', {
            microphone: Boolean(state.microphone),
            ...(state.microphone
              ? { speechLanguage: languageName(state.microphoneLanguage ?? 'en') }
              : {}),
            wakePhrase: Boolean(state.wakePhrase),
            followUp: Boolean(state.microphone && state.followUp),
          }),
          ...skill('computer', { fullComputerAccess: Boolean(state.fullComputerAccess) }),
          ...whenPromptSkill(state, ['capri.applications', 'capri.calculator'], {
            applications: {
              ...skill('calculator', { calculator: Boolean(state.applications?.calculator) }),
              ...skill('applications', { notepad: Boolean(state.applications?.notepad) }),
            },
          })[0],
          ...skill('screen', {
            screenObservation: Boolean(state.screenObservation?.active),
            ...(state.screenVisionAvailable === false ? { screenVisionAvailable: false } : {}),
            previousScreenshotSaved: Boolean(state.recentScreenshot),
          }),
          ...skill('spotify', {
            spotify: state.spotify
              ? {
                  enabled: Boolean(state.spotify.enabled),
                  prepared: Boolean(state.spotify.prepared),
                }
              : null,
          }),
          ...(state.temporalContext ? skill('timers', { liveClock: state.temporalContext }) : {}),
        }
      : {}),
    ...(typeof calculation?.expression === 'string' &&
    calculation.expression.length <= 280 &&
    typeof calculation.result === 'string' &&
    calculation.result.length <= 120
      ? skill('calculator', {
          previousCalculation: { expression: calculation.expression, result: calculation.result },
        })
      : {}),
    ...(greeting
      ? {
          previousDialogue: {
            user: greeting.text.slice(0, 100),
            reply: lastReply.text.slice(0, 800),
          },
        }
      : {}),
    ...(recent.openings.length || recent.sentences.length ? { varyRepeatedWording: true } : {}),
  };
  // An empty DESKTOP STATE can itself look like an empty desktop to a small
  // model. A greeting needs no state envelope when there is nothing relevant.
  return Object.keys(value).length
    ? '\n\nDESKTOP STATE FOR THIS TURN (data, not a user request):\n' + JSON.stringify(value)
    : '';
}
