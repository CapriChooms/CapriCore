// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { InferenceApi } from '../../apps/desktop/inference-api.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { ActionBroker } from '../../apps/desktop/action-broker.mjs';
import {
  root,
  runtime,
  initialize,
  headers,
  request,
  startGateway,
  stopManaged,
} from '../../packages/runtime/src/index.mjs';
const parent = path.join(root, '.runtime/api-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const desktopBroker = new ActionBroker({
  root: folder,
  execute: async ({ tool, args }) => {
    assert.equal(tool, 'desktop_control');
    if (args.action === 'run_task') {
      assert.equal(args.goal, 'Open Chrome, enter the requested draft and verify it.');
      return {
        ok: true,
        status: 'completed',
        verified: true,
        steps: 2,
        summary: 'Draft verified.',
      };
    }
    assert.deepEqual(args, { action: 'browser_input', query: 'Google Chrome', text: 'Capri' });
    return { ok: true, typed: true, submitted: false };
  },
});
await desktopBroker.start();
const socket = createServer();
await new Promise((r) => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const config = {
  enabled: true,
  baseUrl: 'https://fixture.invalid/v1',
  model: 'fixture-tool-model',
  contextTokens: 32768,
  vision: false,
};
const storage = {
  available: async () => true,
  encrypt: async (s) => Buffer.from(s).reverse(),
  decrypt: async (b) => Buffer.from(b).reverse().toString(),
};
const report = {
  passed: false,
  folder,
  realProviderUsed: false,
  ownerHistoryUsed: false,
  calls: 0,
  toolRoundTrip: false,
};
let socialPhase = 'conversation',
  scopedPhase = null,
  rejectLargeRequest = false;
const options = {
  root: folder,
  storage,
  fetchImpl: async (_, options) => {
    const payload = JSON.parse(options.body);
    report.calls++;
    if (rejectLargeRequest) {
      assert.equal((payload.tools ?? []).length, 0);
      return Response.json({ error: { message: 'private-canary' } }, { status: 413 });
    }
    if (scopedPhase) {
      const expected = {
        calculator: 'application_control',
        spotify: 'spotify_control',
        desktop: 'desktop_control',
        'desktop-task': 'desktop_control',
      }[scopedPhase];
      const desktop = scopedPhase.startsWith('desktop');
      assert.deepEqual(
        (payload.tools ?? []).map((tool) => tool.function.name).sort(),
        desktop ? [expected, 'settings_control'] : [expected],
      );
      const calculation = scopedPhase === 'calculator';
      const task = scopedPhase === 'desktop-task';
      const toolReply = payload.messages.find((m) => m.role === 'tool');
      if (calculation && toolReply) {
        assert.match(JSON.stringify(toolReply), /32[.]18695387886216/);
        report.scientificToolRoundTrip = true;
      }
      if (desktop && toolReply) {
        assert.match(JSON.stringify(toolReply), task ? /Draft verified/ : /typed/);
        report.desktopToolRoundTrip = true;
        if (task) report.computerTaskRoundTrip = true;
      }
      const choice =
        (calculation || desktop) && !toolReply
          ? {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_calculation',
                    type: 'function',
                    function: {
                      name: expected,
                      arguments: JSON.stringify(
                        desktop
                          ? task
                            ? {
                                action: 'run_task',
                                goal: 'Open Chrome, enter the requested draft and verify it.',
                              }
                            : { action: 'browser_input', query: 'Google Chrome', text: 'Capri' }
                          : {
                              action: 'calculate',
                              app: 'calculator',
                              expression: 'sqrt(1036)',
                              showWindow: false,
                            },
                      ),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            }
          : { index: 0, delta: { content: 'Scoped fixture ready.' }, finish_reason: 'stop' };
      return new Response(
        'data: ' + JSON.stringify({ id: 'scoped', choices: [choice] }) + '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    if (socialPhase) {
      const names = (payload.tools ?? []).map((tool) => tool.function.name);
      if (socialPhase === 'dialogue') {
        assert.deepEqual(names, [], 'ordinary chat must reach the provider with zero tools');
        report.dialogueCalls = (report.dialogueCalls ?? 0) + 1;
      } else {
        assert.deepEqual(names.sort(), ['memory_get', 'memory_search']);
        report.socialTools = names;
      }
      return new Response(
        'data: ' +
          JSON.stringify({
            id: 'social-fixture',
            choices: [{ index: 0, delta: { content: 'Hello.' }, finish_reason: 'stop' }],
          }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    assert.ok(
      payload.tools.some((tool) => tool.function.name === 'session_status'),
      'the next task must regain its tool surface',
    );
    const toolReply = payload.messages.some((m) => m.role === 'tool');
    if (toolReply) report.toolRoundTrip = true;
    const choices = toolReply
      ? [
          {
            index: 0,
            delta: { content: 'Ready. The tool result was received.' },
            finish_reason: 'stop',
          },
        ]
      : [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_fixture_status',
                  type: 'function',
                  function: { name: 'session_status', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ];
    return new Response(
      'data: ' +
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          model: config.model,
          choices,
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  },
};
const profiles = new InferenceApi(options);
await profiles.selectProfile(
  await profiles.saveProfile({ settings: config, key: 'sk-fixture-not-a-real-key' }),
);
const api = new InferenceApi(options);
await api.start(0);
const rt = runtime({
  stateDir: path.join(folder, 'state'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
  logPrefix: 'api-verification-' + path.basename(folder).toLowerCase(),
});
rt.remote = config;
rt.inferenceUrl = api.url;
rt.remoteProxyToken = api.proxyToken;
initialize(rt);
const gatewayConfig = JSON.parse(readFileSync(rt.configPath, 'utf8'));
gatewayConfig.plugins.load.paths.push(path.join(root, 'integrations/spotify'));
gatewayConfig.plugins.entries['capri-spotify'] = { enabled: true, config: {} };
gatewayConfig.tools.allow.push('spotify_control');
const appState = path.join(folder, 'applications');
mkdirSync(appState, { recursive: true });
writeFileSync(
  path.join(appState, 'applications.json'),
  JSON.stringify({ schemaVersion: 1, settings: { calculator: true, notepad: false } }),
);
gatewayConfig.plugins.entries['capri-applications'].config.stateDirectory = path.relative(
  root,
  appState,
);
gatewayConfig.plugins.entries['capri-companion-tools'].config.endpointRoot = path.relative(
  root,
  folder,
);
writeFileSync(rt.configPath, JSON.stringify(gatewayConfig, null, 2));
try {
  await startGateway(rt);
  const transitionSession = 'agent:capri:transition-fixture';
  for (const mode of ['dialogue', 'conversation', 'dialogue']) {
    socialPhase = mode;
    const social = await request(rt.gatewayUrl + '/v1/chat/completions', {
      method: 'POST',
      timeout: 120000,
      headers: {
        ...headers(rt),
        'x-capri-tools-once': mode,
        'x-openclaw-session-key': transitionSession,
      },
      body: JSON.stringify({
        model: 'openclaw/capri',
        stream: false,
        messages: [{ role: 'user', content: 'Hello.' }],
      }),
    });
    assert.match(JSON.stringify(social), /Hello/);
  }
  socialPhase = false;
  for (const scope of ['calculator', 'spotify', 'desktop', 'desktop-task']) {
    scopedPhase = scope;
    const scoped = await request(rt.gatewayUrl + '/v1/chat/completions', {
      method: 'POST',
      timeout: 120000,
      headers: {
        ...headers(rt),
        'x-capri-tools-once': scope.startsWith('desktop') ? 'desktop' : scope,
        'x-openclaw-message-channel': 'webchat',
        'x-openclaw-session-key': 'agent:capri:scope-fixture-' + scope,
      },
      body: JSON.stringify({
        model: 'openclaw/capri',
        stream: false,
        messages: [
          {
            role: 'user',
            content: scope === 'calculator' ? 'Square root of 1036?' : 'Spotify controls fixture.',
          },
        ],
      }),
    });
    assert.match(JSON.stringify(scoped), /Scoped fixture ready/);
  }
  scopedPhase = null;
  const result = await request(rt.gatewayUrl + '/v1/chat/completions', {
    method: 'POST',
    timeout: 120000,
    headers: { ...headers(rt), 'x-openclaw-session-key': transitionSession },
    body: JSON.stringify({
      model: 'openclaw/capri',
      stream: false,
      messages: [
        {
          role: 'user',
          content: 'Use session_status once, then say Ready. This is an isolated synthetic test.',
        },
      ],
    }),
  });
  assert.equal(report.toolRoundTrip, true);
  socialPhase = 'dialogue';
  const afterAction = await request(rt.gatewayUrl + '/v1/chat/completions', {
    method: 'POST',
    timeout: 30000,
    headers: {
      ...headers(rt),
      'x-capri-tools-once': 'dialogue',
      'x-openclaw-session-key': transitionSession,
    },
    body: JSON.stringify({
      model: 'openclaw/capri',
      stream: false,
      messages: [{ role: 'user', content: 'Hello again.' }],
    }),
  });
  assert.match(JSON.stringify(afterAction), /Hello/);
  assert.equal(report.calls, 13);
  assert.equal(report.dialogueCalls, 3);
  assert.equal(report.computerTaskRoundTrip, true);
  assert.equal(report.scientificToolRoundTrip, true);
  assert.equal(report.desktopToolRoundTrip, true);
  assert.match(JSON.stringify(result), /Ready/);
  rejectLargeRequest = true;
  const stored = new Map();
  const chat = new ChatService({
    gatewayUrl: rt.gatewayUrl,
    agentId: 'capri',
    sessionKey: 'agent:capri:oversize-fixture',
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
    persona: () => 'Fixture persona.',
    store: { snapshot: () => [...stored.values()], put: (item) => stored.set(item.id, item) },
    interfaceState: () => ({ modelToolsAvailable: false }),
    externalInference: true,
    externalRequestTooLargeSince: (startedAt) => api.requestTooLargeSince(startedAt),
  });
  const events = [];
  await chat.send(
    { id: '64069c34-e112-4272-a675-1cebc8d556bc', text: 'Explain why the sky is blue.' },
    (event) => events.push(event),
  );
  assert.equal(api.diagnostics().lastFailure.providerStatus, 413);
  assert.match(events.at(-1).message, /HTTP 413.*request is too large/u);
  assert.doesNotMatch(JSON.stringify(events), /private-canary/u);
  report.providerSizeError = true;
  report.passed = true;
} finally {
  await stopManaged(rt.logPrefix);
  api.close();
  desktopBroker.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
