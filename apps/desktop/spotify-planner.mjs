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
const planFailure = (code, httpStatus, cause) =>
  Object.assign(new Error('Spotify request could not be planned.'), {
    code,
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

/** A small, isolated skill plan. Native tool syntax and old gateway history
 * cannot become either a command or a spoken reply at this boundary. */
export function spotifyPlanner({ url, model, params = {}, modelCapabilities, fetchImpl = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password)
    throw new Error('Spotify planning requires the local inference boundary.');
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
        format: SPOTIFY_PLAN_SCHEMA,
        messages: [
          {
            role: 'system',
            content:
              'Translate ONE owner music playback request into JSON matching the supplied schema. Spotify is the default music player: the owner does not need to name Spotify. Understand any language. No tool calls or prose. Requests to turn on or play some good music, any music, or ordinary music without a named artist, song or genre mean {"action":"resume"}. Russian examples "Включи музыку" and "Поставь какую-нибудь хорошую музыку" also mean {"action":"resume"}. Do not invent a query for those generic requests. For a named artist/song/genre, use play and preserve the requested name. Only set type artist when an artist is requested; otherwise track by default. Pause, next, previous and volume require explicit requests. Return action none for music opinions, questions about preferences, quoted commands, negations, games, videos, other apps, screen/computer tasks or compound requests. This JSON does not execute anything or grant permissions.',
          },
          { role: 'user', content: text },
        ],
      }),
    }).catch((error) => {
      requestSignal.throwIfAborted();
      throw planFailure('CAPRI_SPOTIFY_PLAN_HTTP_ERROR', undefined, error);
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw planFailure('CAPRI_SPOTIFY_PLAN_HTTP_ERROR', response.status);
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
      if (!matchesPlannerSchema(plan, SPOTIFY_PLAN_SCHEMA)) throw new Error();
      return plan.action === 'none' ? null : validateCommand(plan);
    } catch {
      requestSignal.throwIfAborted();
      throw planFailure('CAPRI_SPOTIFY_PLAN_INVALID');
    }
  };
}
