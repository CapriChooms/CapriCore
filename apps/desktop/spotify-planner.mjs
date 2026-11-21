// SPDX-License-Identifier: GPL-3.0-only
import { LOCAL_RUNNER_POLICY } from '../../packages/runtime/src/providers/runner-policy.mjs';
import { validateCommand } from '../../integrations/spotify/service.mjs';
import { matchesPlannerSchema } from './planner-json.mjs';

const shape = (action, properties = {}, required = []) => ({
  type: 'object',
  additionalProperties: false,
  required: ['action', ...required],
  properties: { action: { const: action }, ...properties },
});
const planFailure = (player, reason, httpStatus, cause) =>
  Object.assign(new Error(`${player} request could not be planned.`), {
    code: `CAPRI_${player === 'YouTube Music' ? 'YOUTUBE_MUSIC' : 'SPOTIFY'}_PLAN_${reason}`,
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    ...(cause ? { cause } : {}),
  });
export const SPOTIFY_PLAN_SCHEMA = {
  anyOf: [
    ...['none', 'resume', 'pause', 'next', 'previous'].map((action) => shape(action)),
    shape(
      'play',
      {
        query: { type: 'string', minLength: 1, maxLength: 180 },
        type: { type: 'string', enum: ['track', 'album', 'artist', 'playlist'] },
      },
      ['query'],
    ),
    shape('volume', { value: { type: 'number', minimum: 0, maximum: 100 } }, ['value']),
    shape('volume', { delta: { type: 'number', minimum: -100, maximum: 100 } }, ['delta']),
  ],
};
const YOUTUBE_MUSIC_PLAN_SCHEMA = {
  anyOf: [
    ...['none', 'open', 'status', 'start', 'resume', 'pause', 'next', 'previous'].map((action) =>
      shape(action),
    ),
    ...['play', 'search'].map((action) =>
      shape(action, { query: { type: 'string', minLength: 1, maxLength: 180 } }, ['query']),
    ),
    ...SPOTIFY_PLAN_SCHEMA.anyOf.slice(-2),
  ],
};

/** A small, isolated skill plan. Native tool syntax and old gateway history
 * cannot become either a command or a spoken reply at this boundary. */
export function spotifyPlanner({
  url,
  model,
  params = {},
  modelCapabilities,
  fetchImpl = fetch,
  player = 'Spotify',
}) {
  const base = new URL(url);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password)
    throw new Error('Music planning requires the local inference boundary.');
  const youtubeMusic = player === 'YouTube Music';
  const schema = youtubeMusic ? YOUTUBE_MUSIC_PLAN_SCHEMA : SPOTIFY_PLAN_SCHEMA;
  const instruction = youtubeMusic
    ? 'Translate one owner instruction concerning YouTube Music into matching JSON. YouTube Music has already been selected, so the owner need not name it. Understand any language. No prose or tool calls. Keep the song, artist or playlist the owner named as the query. Use play for requested named playback (for example, "Play Hikari") and search to show results. A generic request to play music with no name means start. Use resume only when asked to continue existing playback. Use open to visit YouTube Music and status only for an actual question about what is currently playing. For the player volume, use volume with value for a target level ("set it to fifty percent") or delta for a signed change in percentage points ("increase it by ten percent"). For system volume return none. For a capability question, conversation, lyrics, comparison, games, videos, quoted, negated, hypothetical, unrelated or compound task return none. Do not substitute for Spotify, standard YouTube or generic desktop control. Only the latest owner text is supplied and music is never selected by guessing a query.'
    : 'Translate ONE owner music playback request into JSON matching the supplied schema. Spotify is the default music player: the owner does not need to name Spotify. Understand any language. No tool calls or prose. Requests to turn on or play some good music, any music, or ordinary music without a named artist, song or genre mean {"action":"resume"}. Russian examples "Включи музыку" and "Поставь какую-нибудь хорошую музыку" also mean {"action":"resume"}. Do not invent a query for those generic requests. For a named artist/song/genre, use play and preserve the requested name. Only set type artist when an artist is requested; otherwise track by default. Pause, next, previous and volume require explicit requests. Return action none for music opinions, questions about preferences, quoted commands, negations, games, videos, other apps, screen/computer tasks or compound requests. This JSON does not execute anything or grant permissions.';
  return async (text, { signal } = {}) => {
    const requestSignal = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(45000),
    ]);
    const response = await fetchImpl(new URL('/api/chat', base), {
      method: 'POST',
      redirect: 'error',
      signal: requestSignal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        ...LOCAL_RUNNER_POLICY,
        ...(!modelCapabilities || modelCapabilities.includes('thinking') ? { think: false } : {}),
        options: { ...params, temperature: 0, num_predict: 192 },
        format: schema,
        messages: [
          {
            role: 'system',
            content: instruction,
          },
          { role: 'user', content: text },
        ],
      }),
    }).catch((error) => {
      requestSignal.throwIfAborted();
      throw planFailure(player, 'HTTP_ERROR', undefined, error);
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw planFailure(player, 'HTTP_ERROR', response.status);
    }
    try {
      const raw = await response.text();
      if (raw.length > 8192) throw new Error();
      const packet = JSON.parse(raw);
      if (
        packet.done !== true ||
        packet.done_reason === 'length' ||
        packet.message?.tool_calls?.length
      )
        throw new Error();
      const plan = JSON.parse(packet.message?.content);
      if (!matchesPlannerSchema(plan, schema)) throw new Error();
      return plan.action === 'none' ? null : youtubeMusic ? plan : validateCommand(plan);
    } catch {
      requestSignal.throwIfAborted();
      throw planFailure(player, 'INVALID');
    }
  };
}
