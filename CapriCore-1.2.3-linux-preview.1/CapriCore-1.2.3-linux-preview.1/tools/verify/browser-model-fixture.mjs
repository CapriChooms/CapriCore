// SPDX-License-Identifier: GPL-3.0-only
/** Optional local-model qualification, using the production prompt and tool schema. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import plugin from '../../integrations/companion-tools/index.mjs';
export async function verifyBrowserModel({ root, catalog, windowId, title }) {
  // Qualify a fresh owner request, not an implicit binding left by the native smoke.
  catalog.lastApplication = null;
  const url = new URL(process.env.CAPRI_VERIFY_OLLAMA_URL ?? '');
  const model = process.env.CAPRI_VERIFY_MODEL;
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert(
    /^[a-zA-Z0-9:._/-]{1,128}$/.test(model ?? ''),
    'Set a currently loaded local model explicitly.',
  );
  let definition;
  plugin.register({
    source: path.join(root, 'integrations/companion-tools/index.mjs'),
    registerTool(factory) {
      const tool = factory.create({
        agentId: 'capri',
        senderIsOwner: true,
        messageChannel: 'webchat',
        sessionKey: 'agent:capri:fixture',
        sessionId: 'fixture',
      });
      if (tool.name === 'desktop_control') definition = tool;
    },
  });
  let prompt;
  const saved = new Map();
  const capture = new ChatService({
    gatewayUrl: 'http://127.0.0.1:19999',
    agentId: 'capri',
    sessionKey: 'agent:capri:browser-fixture',
    token: () => 'fixture-only',
    persona: () =>
      'You are Capri, a female desktop companion. Complete the owner’s task using the actual available tool. Do not write memories.',
    interfaceState: () => ({ fullComputerAccess: true, languages: { conversation: 'en' } }),
    store: {
      snapshot: () => [...saved.values()],
      put: (value) => saved.set(value.id, structuredClone(value)),
    },
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['x-capri-tools-once'], 'desktop');
      prompt = JSON.parse(options.body).messages;
      return new Response(
        'data: {"choices":[{"delta":{"content":"Fixture."}}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await capture.send(
    {
      id: randomUUID(),
      text:
        'Open Google Chrome and write Capri in its address bar. Use only the window titled ' +
        title +
        '. Do not press Enter.',
    },
    () => {},
  );
  const calls = [],
    started = performance.now();
  let verified = false,
    answer = '';
  for (let step = 0; step < 7; step++) {
    const response = await fetch(new URL('/api/chat', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        messages: prompt,
        tools: [
          {
            type: 'function',
            function: {
              name: definition.name,
              description: definition.description,
              parameters: definition.parameters,
            },
          },
        ],
        stream: false,
        think: false,
        keep_alive: 300,
        options: { num_ctx: 32768, num_predict: 768, temperature: 0 },
      }),
    });
    assert(response.ok, 'Local model HTTP ' + response.status);
    const packet = await response.json();
    assert(!packet.error, packet.error);
    const message = packet.message;
    prompt.push(message);
    if (!message.tool_calls?.length) {
      answer = message.content;
      break;
    }
    for (const call of message.tool_calls) {
      assert.equal(call.function.name, 'desktop_control');
      const args = call.function.arguments;
      assert(
        ['apps', 'find_app', 'launch', 'inspect', 'browser_input', 'type_text'].includes(
          args.action,
        ),
        'This fixture permits only app discovery and a text draft.',
      );
      if (args.windowId)
        assert.equal(args.windowId, windowId, 'Owner windows must not receive test input.');
      let result;
      try {
        result = await catalog.execute(randomUUID(), args, { propose: (p) => p.execute() });
        if (result.needsWindow)
          result = { ...result, windows: result.windows.filter((w) => w.windowId === windowId) };
      } catch (error) {
        result = { ok: false, error: { message: error.message } };
      }
      calls.push({ action: args.action, ok: result.ok, needsWindow: !!result.needsWindow });
      if (args.action === 'browser_input' && result.typed === true && result.submitted === false)
        verified = true;
      prompt.push({ role: 'tool', tool_name: 'desktop_control', content: JSON.stringify(result) });
    }
  }
  assert(
    verified,
    'The real model must complete address-bar entry; prose is not proof. ' +
      JSON.stringify({ calls, answer }),
  );
  assert(answer?.trim(), 'The real model must finish its reply.');
  return {
    model,
    elapsedMs: Math.round(performance.now() - started),
    calls,
    verifiedDraft: true,
    ownerHistoryChanged: false,
  };
}
