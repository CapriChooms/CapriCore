// SPDX-License-Identifier: GPL-3.0-only
import { plainDialogueText } from '../../packages/runtime/src/text.mjs';
import { conversationInstruction } from './language-context.mjs';

const routes = ['owner', 'owner-and-call'];
export const MAX_CALL_REQUEST = 1200;

const format = {
  type: 'object',
  properties: {
    route: { type: 'string', enum: routes },
    reply: { type: 'string', maxLength: 420 },
  },
  required: ['route', 'reply'],
  additionalProperties: false,
};

/** A single explicitly approved exchange. No regular chat context or tools. */
export function callResponseGenerator({ url, model, modelCapabilities, fetchImpl = fetch }) {
  const base = new URL(url);
  if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:' || base.username || base.password)
    throw new Error('Call replies require a loopback inference endpoint.');
  const endpoint = new URL('/api/chat', base).href;
  return async (text, languages, signal) => {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_CALL_REQUEST)
      throw new Error('Enter a short request for the call.');
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        ...(!modelCapabilities || modelCapabilities.includes('thinking') ? { think: false } : {}),
        options: { num_predict: 160 },
        format,
        tools: [],
        messages: [
          {
            role: 'system',
            content:
              'You are Capri, a witty cyberpunk companion. Reply in at most two short sentences. Choose the route "owner" for a private, ambiguous or sensitive request. Choose "owner-and-call" only when the owner clearly addresses the call or asks you to share the response with the people in the call. Never read passwords, contact details, authentication codes, or any other sensitive information to the call. Only the single request below is available. You have no tools and cannot take actions. Return just the required JSON.\n' +
              conversationInstruction(languages),
          },
          { role: 'user', content: text.trim() },
        ],
      }),
    });
    if (!response.ok || !response.body) throw new Error('Capri could not prepare a call reply.');
    const decoder = new TextDecoder();
    let raw = '',
      size = 0;
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > 16384) throw new Error('The call reply is too large.');
      raw += decoder.decode(chunk, { stream: true });
    }
    signal.throwIfAborted();
    try {
      const packet = JSON.parse(raw + decoder.decode());
      if (packet.done_reason === 'length' || packet.message?.tool_calls?.length) throw new Error();
      const value = JSON.parse(packet.message?.content);
      if (
        !routes.includes(value.route) ||
        typeof value.reply !== 'string' ||
        value.reply.length > 420 ||
        Object.keys(value).length !== 2
      )
        throw new Error();
      const reply = plainDialogueText(value.reply).trim();
      if (!reply) throw new Error();
      return { route: value.route, reply };
    } catch {
      throw new Error('Capri could not determine a safe call reply.');
    }
  };
}
