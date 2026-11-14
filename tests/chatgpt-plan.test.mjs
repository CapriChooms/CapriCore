// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ChatGPTPlanAuth,
  verifyChatGPTIdentity,
  planJson,
} from '../apps/desktop/chatgpt-plan-auth.mjs';
import {
  chatGPTCompletion,
  chatGPTResponsesRequest,
} from '../apps/desktop/chatgpt-plan-completions.mjs';
import { InferenceApi, apiSettings } from '../apps/desktop/inference-api.mjs';
import { chatGPTModelCapabilities } from '../apps/desktop/chatgpt-plan-models.mjs';
import { computerIntentClassifier } from '../apps/desktop/computer-planner.mjs';
import { ChatService, sseData } from '../apps/desktop/chat-service.mjs';
import { TranscriptStore } from '../apps/desktop/storage.mjs';
import { spotifyPlanner } from '../apps/desktop/spotify-planner.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'fixture-signing-key',
  alg: 'RS256',
  use: 'sig',
};
const clientId = 'oaiapp_fixture_registration';
const accessToken = 's3cure-private-access-token-not-an-api-key';
const refreshToken = 'fixture-private-refresh-token';
const email = 'fixture@example.test';
const storage = {
  available: async () => true,
  encrypt: async (text) => Buffer.from(text).map((byte) => byte ^ 31),
  decrypt: async (bytes) =>
    Buffer.from(bytes)
      .map((byte) => byte ^ 31)
      .toString(),
};
function jwt(extra = {}, header = {}) {
  const claims = {
    iss: 'https://auth.openai.com',
    aud: clientId,
    sub: 'fixture-account',
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: 'fixture-nonce',
    ...extra,
  };
  const signing = [
    Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid, ...header })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
  ].join('.');
  return signing + '.' + sign('RSA-SHA256', Buffer.from(signing), privateKey).toString('base64url');
}
const terminal = (text = 'Ready.') => ({
  type: 'response.completed',
  response: {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
  },
});
const sse = (events) =>
  new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
function fixture(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'capri-chatgpt-'));
  const requests = [],
    browsers = [];
  let auth;
  const transport = async (url, init = {}) => {
    requests.push({ url, ...init });
    assert.equal(init.redirect, 'error');
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/oauth/revoke')) return new Response(null, { status: 200 });
    if (url.endsWith('/oauth/token')) {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('client_id'), clientId);
      assert.equal(form.get('resource'), 'https://api.openai.com/v1');
      if (form.get('grant_type') === 'authorization_code') {
        const browser = browsers.at(-1);
        assert.equal(form.get('redirect_uri'), browser.searchParams.get('redirect_uri'));
        assert.equal(
          createHash('sha256').update(form.get('code_verifier')).digest('base64url'),
          browser.searchParams.get('code_challenge'),
        );
      }
      return Response.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: options.expiresIn ?? 3600,
        scope:
          options.scope ??
          'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        id_token: jwt({
          nonce: browsers.at(-1).searchParams.get('nonce'),
          sub: options.subject?.() ?? 'fixture-account',
        }),
      });
    }
    if (url.endsWith('/models') && options.modelResponse) return options.modelResponse();
    if (url.endsWith('/models'))
      return Response.json({
        models: [
          { slug: 'fixture-model', display_name: 'Fixture model', visibility: 'list' },
          { slug: 'hidden', visibility: 'hidden' },
        ],
      });
    if (url.endsWith('/responses'))
      return sse([{ type: 'response.output_text.delta', delta: 'Ready.' }, terminal()]);
    throw new Error('Unexpected destination');
  };
  auth = new ChatGPTPlanAuth({
    root,
    storage,
    fetchImpl: options.fetchImpl ?? transport,
    openBrowser: async (value) => {
      const url = new URL(value);
      browsers.push(url);
      if (options.browser) return options.browser(url, auth);
      assert.equal(url.origin, 'https://auth.openai.com');
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        code: 'fixture-code',
        state: url.searchParams.get('state'),
        client_id: clientId,
      }).toString();
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  t.after(async () => {
    auth.close();
    await auth.tail.catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  return { root, auth, requests, browsers, transport };
}

test('identity verification rejects wrong signature, nonce, issuer, audience, expiry, subject and algorithm', () => {
  const options = { clientId, nonce: 'fixture-nonce', keys: [jwk] };
  assert.equal(verifyChatGPTIdentity(jwt(), options).subject, 'fixture-account');
  for (const claims of [
    { nonce: 'other' },
    { iss: 'https://attacker.test' },
    { aud: 'another-app' },
    { exp: 1 },
    { nbf: 9999999999 },
    { sub: '' },
  ])
    assert.throws(() => verifyChatGPTIdentity(jwt(claims), options), /could not be verified/);
  assert.throws(() => verifyChatGPTIdentity(jwt(), { ...options, subject: 'other-account' }));
  assert.throws(() => verifyChatGPTIdentity(jwt({}, { alg: 'none' }), options));
  assert.throws(() => verifyChatGPTIdentity(jwt() + 'bad', options));
  assert.throws(() => verifyChatGPTIdentity(jwt({}, { kid: 'unknown' }), options));
});

test('OAuth uses a real loopback callback and PKCE; only own encrypted account state is persisted', async (t) => {
  const { auth, root, requests, browsers } = fixture(t);
  assert.equal((await auth.status()).profiles.length, 0);
  assert.equal(requests.length, 0);
  const result = await auth.signIn();
  assert(result.profiles[0].connected && result.profiles[0].sharing);
  assert.equal(browsers[0].searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(browsers[0].searchParams.get('agent_name_hint'), 'Capri');
  const disk = readFileSync(auth.file, 'utf8');
  for (const secret of [accessToken, refreshToken, email, 'fixture-account'])
    assert(!disk.includes(secret));
  assert(!JSON.stringify(result).includes(accessToken));
  assert(!JSON.stringify(result).includes(refreshToken));
  const restored = new ChatGPTPlanAuth({ root, storage });
  assert.equal((await restored.status()).profiles[0].id, result.profiles[0].id);
  assert.equal(await restored.accessToken(result.selectedId), accessToken);
  await auth.signIn(result.selectedId);
  assert.equal(browsers[1].searchParams.get('client_id'), clientId);
  assert.equal(
    browsers[1].searchParams.get('ext_agent_host_id'),
    browsers[0].searchParams.get('ext_agent_host_id'),
  );
  assert.notEqual(browsers[1].searchParams.get('nonce'), browsers[0].searchParams.get('nonce'));
  assert.notEqual(browsers[1].searchParams.get('state'), browsers[0].searchParams.get('state'));
  assert(!browsers[1].searchParams.has('agent_name_hint'));
});

test('invalid state and duplicate callback values are rejected without consuming the real authorization', async (t) => {
  const { auth, browsers } = fixture(t, {
    browser: async (url) => {
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        code: 'fixture-code',
        state: 'wrong-state',
        client_id: clientId,
      });
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.append('state', 'other');
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.delete('state');
      callback.searchParams.set('state', url.searchParams.get('state'));
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  assert((await auth.signIn()).profiles[0].connected);
  assert.equal(browsers.length, 1);
});

test('identity-only consent never enables inference or silently uses another credential', async (t) => {
  const { auth, requests } = fixture(t, { scope: 'openid profile email offline_access' });
  const result = await auth.signIn();
  assert.equal(result.profiles[0].sharing, false);
  await assert.rejects(auth.accessToken(result.selectedId), /allow plan usage/);
  assert(!requests.some((request) => request.url.endsWith('/responses')));
});

test('account model discovery accepts a large rich catalog and keeps all visible models in server order', async (t) => {
  const models = Array.from({ length: 130 }, (_, index) => ({
    slug: 'fixture-model-' + index,
    display_name: 'Model ' + index,
    visibility: 'list',
    metadata: { description: 'catalog metadata '.repeat(500) },
  }));
  const payload = JSON.stringify({ models: [...models, { slug: 'hidden', visibility: 'hidden' }] });
  assert(Buffer.byteLength(payload) > 512 * 1024);
  const { auth } = fixture(t, {
    modelResponse: () => new Response(payload, { headers: { 'content-type': 'application/json' } }),
  });
  const account = await auth.signIn();
  assert.deepEqual(
    await auth.models(account.selectedId),
    models.map((model) => ({ id: model.slug, name: model.display_name })),
  );
});

test('catalog byte limits stop oversized streams, cancel the body and allow a later refresh', async (t) => {
  let oversized = true,
    reads = 0,
    cancelled = false;
  const { auth } = fixture(t, {
    modelResponse: () =>
      oversized
        ? new Response(
            new ReadableStream({
              pull(controller) {
                reads++;
                controller.enqueue(Buffer.alloc(1024 * 1024, 32));
                if (reads >= 32) controller.close();
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { 'content-type': 'application/json', 'content-length': '1' } },
          )
        : Response.json({
            models: [{ slug: 'retry-model', display_name: 'Retry model', visibility: 'list' }],
          }),
  });
  const account = await auth.signIn();
  await assert.rejects(auth.models(account.selectedId), {
    code: 'CAPRI_CHATGPT_RESPONSE_SIZE',
    message: 'ChatGPT response exceeds its limit.',
  });
  assert.equal(cancelled, true);
  assert(reads < 12);
  oversized = false;
  assert.deepEqual(await auth.models(account.selectedId), [
    { id: 'retry-model', name: 'Retry model' },
  ]);
});

test('a larger model catalog budget never enlarges token or identity-key packet limits', async () => {
  for (const url of [
    'https://auth.openai.com/api/accounts/oauth/token',
    'https://auth.openai.com/.well-known/jwks.json',
  ]) {
    let cancelled = false;
    await assert.rejects(
      planJson(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(Buffer.alloc(600 * 1024, 32));
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
        url,
      ),
      { code: 'CAPRI_CHATGPT_RESPONSE_SIZE' },
    );
    assert.equal(cancelled, true);
  }
});

test('model catalogs discard malformed or hidden rows and never forward metadata to Settings', async (t) => {
  const { auth } = fixture(t, {
    modelResponse: () =>
      Response.json({
        models: [
          null,
          0,
          {},
          { slug: 'hidden-model', visibility: 'hidden' },
          { slug: 'invalid model', visibility: 'list' },
          {
            slug: 'visible-model',
            visibility: 'list',
            display_name: 'Visible',
            privateMetadata: 'never sent to renderer',
          },
        ],
      }),
  });
  const account = await auth.signIn();
  assert.deepEqual(await auth.models(account.selectedId), [
    { id: 'visible-model', name: 'Visible' },
  ]);
});

test('cancelling model discovery stops its body without modifying the signed-in account', async (t) => {
  const controller = new AbortController();
  let cancelled = false;
  const { auth } = fixture(t, {
    modelResponse: () => {
      controller.abort();
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(Buffer.from('{"models":[]}'));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    },
  });
  const account = await auth.signIn();
  await assert.rejects(
    auth.models(account.selectedId, controller.signal),
    /cancelled or timed out/,
  );
  assert.equal(cancelled, true);
  assert.equal((await auth.status()).selectedId, account.selectedId);
});

test(
  'a valid OAuth callback completes even if Windows never resolves browser launch',
  { timeout: 5000 },
  async (t) => {
    const { auth } = fixture(t, {
      browser: async (url) => {
        const callback = new URL(url.searchParams.get('redirect_uri'));
        callback.search = new URLSearchParams({
          code: 'fixture-code',
          state: url.searchParams.get('state'),
          client_id: clientId,
        });
        assert.equal((await fetch(callback)).status, 200);
        return new Promise(() => {});
      },
    });
    const result = await auth.signIn();
    assert.equal(result.signingIn, false);
    assert.equal(result.profiles[0].sharing, true);
    assert.equal((await auth.models(result.selectedId))[0].id, 'fixture-model');
  },
);

test(
  'sign-in cancellation interrupts an unresolved browser launch',
  { timeout: 5000 },
  async (t) => {
    const { auth } = fixture(t, {
      browser: async (_url, service) => {
        service.cancelSignIn();
        return new Promise(() => {});
      },
    });
    await assert.rejects(auth.signIn(), /cancelled or timed out/);
    assert.equal((await auth.status()).signingIn, false);
  },
);

test('browser-launch rejection recovers without exposing its error or leaving sign-in busy', async (t) => {
  const { auth } = fixture(t, {
    browser: async () => {
      throw new Error('private operating-system URL details');
    },
  });
  await assert.rejects(auth.signIn(), { message: 'ChatGPT sign-in could not finish. Try again.' });
  assert.equal((await auth.status()).signingIn, false);
});

test('cancelled sign-in closes its listener and encryption failure never opens a browser', async (t) => {
  const { auth, browsers } = fixture(t, {
    browser: async (_url, service) => service.cancelSignIn(),
  });
  await assert.rejects(auth.signIn(), /cancelled or timed out/);
  assert.equal((await auth.status()).signingIn, false);
  assert.equal((await auth.status()).profiles.length, 0);
  await assert.rejects(fetch(browsers[0].searchParams.get('redirect_uri')));
  const second = fixture(t);
  second.auth.storage = { available: async () => false };
  await assert.rejects(second.auth.signIn(), /Secure credential storage/);
  assert.equal(second.browsers.length, 0);
});

test('reauthorization cannot replace a saved account with another identity', async (t) => {
  let subject = 'fixture-account';
  const { auth } = fixture(t, { subject: () => subject });
  const status = await auth.signIn();
  subject = 'different-account';
  await assert.rejects(auth.signIn(status.selectedId), /identity could not be verified/);
  assert.equal((await auth.profile(status.selectedId)).subject, 'fixture-account');
});

test('issued registration survives a failed exchange instead of registering another app', async (t) => {
  const value = fixture(t);
  value.auth.fetchImpl = (url, init) =>
    url.endsWith('/oauth/token') ? new Response(null, { status: 500 }) : value.transport(url, init);
  await assert.rejects(value.auth.signIn(), /connection failed/);
  const status = await value.auth.status();
  assert.equal(status.profiles.length, 1);
  value.auth.fetchImpl = value.transport;
  await value.auth.signIn(status.profiles[0].id);
  assert.equal(value.browsers[1].searchParams.get('client_id'), clientId);
});

test('refreshes are serialized and replace rotating credentials atomically; sign-out clears tokens', async (t) => {
  const value = fixture(t);
  const status = await value.auth.signIn();
  value.auth.now = () => Date.now() + 3590000;
  let refreshes = 0;
  value.auth.fetchImpl = async (url, init) => {
    if (url.endsWith('/oauth/token')) {
      refreshes++;
      await delay(10);
      assert.equal(new URLSearchParams(init.body).get('refresh_token'), refreshToken);
      return Response.json({
        access_token: 'fixture-rotated-access',
        refresh_token: 'fixture-rotated-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    return value.transport(url, init);
  };
  assert.deepEqual(
    await Promise.all([
      value.auth.accessToken(status.selectedId),
      value.auth.accessToken(status.selectedId),
    ]),
    ['fixture-rotated-access', 'fixture-rotated-access'],
  );
  assert.equal(refreshes, 1);
  const signedOut = await value.auth.signOut(status.selectedId);
  assert.equal(signedOut.profiles[0].connected, false);
  assert.equal((await value.auth.profile(status.selectedId)).clientId, clientId);
  assert.equal((await value.auth.profile(status.selectedId)).credentials, null);
});

test('Responses conversion preserves history, images and local tool results without hosted action tools', () => {
  const request = chatGPTResponsesRequest({
    model: 'fixture-model',
    messages: [
      { role: 'system', content: 'Personality fixture.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
        ],
      },
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'calculator', arguments: '{"expression":"2+2"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"result":4}' },
    ],
    tools: [{ type: 'function', function: { name: 'calculator', parameters: { type: 'object' } } }],
  });
  assert.equal(request.store, false);
  assert.equal(request.stream, true);
  assert.equal(request.tools[0].type, 'namespace');
  assert.equal(request.tools[0].tools[0].name, 'calculator');
  assert.equal(request.input[1].content[1].type, 'input_image');
  assert.equal(request.input[2].type, 'function_call');
  assert.equal(request.input[3].type, 'function_call_output');
  assert.throws(() =>
    chatGPTResponsesRequest({
      messages: [{ role: 'user', content: 'Hi.' }],
      tools: [{ type: 'computer_use_preview' }],
    }),
  );
});

test('Terra capability selection repairs the legacy false default and preserves an explicit manual override', () => {
  const settings = {
    enabled: true,
    authMode: 'chatgpt',
    accountId: '11111111-1111-4111-8111-111111111111',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6.1-terra',
    vision: false,
  };
  assert.equal(apiSettings(settings).vision, true);
  assert.equal(apiSettings({ ...settings, visionMode: 'manual' }).vision, false);
  assert.equal(apiSettings({ ...settings, visionMode: 'catalog' }).vision, false);
  assert.equal(apiSettings({ ...settings, model: 'unknown-model' }).vision, false);
  assert.deepEqual(
    chatGPTModelCapabilities('unknown-model', {
      supports_images: true,
      privateData: 'never forwarded',
    }),
    { vision: true },
  );
  assert.equal(chatGPTModelCapabilities('gpt-6.1-terra', { supports_images: false }).vision, false);
  assert.throws(() => apiSettings({ ...settings, visionMode: 'invalid' }), /vision mode/);
});

test('account catalog keeps only reviewed or explicit capabilities and never forwards private metadata', async (t) => {
  const { auth } = fixture(t, {
    modelResponse: () =>
      Response.json({
        models: [
          { slug: 'gpt-6.1-terra', visibility: 'list' },
          {
            slug: 'catalog-image-model',
            visibility: 'list',
            input_modalities: ['text', 'image'],
            supports_function_calling: false,
            privateMetadata: 'PRIVATE-CATALOG-CANARY',
          },
          { slug: 'catalog-text-model', visibility: 'list', input_modalities: ['text'] },
          { slug: 'unknown-model', visibility: 'list', supports_images: 'true' },
        ],
      }),
  });
  const account = await auth.signIn();
  const models = await auth.models(account.selectedId);
  assert.equal(models[0].capabilities.vision, true);
  assert.deepEqual(models[1].capabilities, { vision: true, tools: false });
  assert.deepEqual(models[2].capabilities, { vision: false });
  assert.equal(models[3].capabilities, undefined);
  assert.equal(JSON.stringify(models).includes('PRIVATE-CATALOG-CANARY'), false);
});

test('Terra normal turns and small classifiers disable reasoning while the owner thinking mode remains medium', () => {
  const normal = { model: 'gpt-6.1-terra', messages: [{ role: 'user', content: 'Ready.' }] };
  assert.equal(chatGPTResponsesRequest(normal).reasoning.effort, 'none');
  const classifier = chatGPTResponsesRequest({ ...normal, max_tokens: 64 });
  assert.equal(classifier.max_output_tokens, 64);
  assert.equal(classifier.reasoning.effort, 'none');
  assert.equal(
    chatGPTResponsesRequest({ ...normal, reasoning: { effort: 'medium' } }).reasoning.effort,
    'medium',
  );
  assert.equal(
    chatGPTResponsesRequest({ ...normal, model: 'gpt-6.1-sol' }).reasoning.effort,
    'low',
  );
});

test('real intent classifier and image chat traverse the ChatGPT proxy with correct reasoning and modalities', async (t) => {
  const { root } = fixture(t);
  const requests = [];
  const auth = {
    controllers: new Map(),
    accessToken: async () => accessToken,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const text =
        body.text?.format?.type === 'json_schema'
          ? '{"intent":"chat","usesPrevious":false}'
          : 'Ready.';
      return sse([{ type: 'response.output_text.delta', delta: text }, terminal(text)]);
    },
  };
  const api = new InferenceApi({
    root,
    storage,
    chatgpt: auth,
    config: apiSettings({
      enabled: true,
      authMode: 'chatgpt',
      accountId: '11111111-1111-4111-8111-111111111111',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6.1-terra',
      vision: false,
    }),
  });
  t.after(() => api.close());
  await api.start(0);
  const classify = computerIntentClassifier({
    url: api.url,
    model: 'unused-local-name',
    fetchImpl: api.localFetch,
  });
  for (const text of ['How are you doing?', 'Как у тебя дела?', 'Comment vas-tu ?'])
    assert.deepEqual(await classify(text, { fullComputerAccess: true }), {
      intent: 'chat',
      usesPrevious: false,
    });
  assert.ok(
    requests.every(
      (request) => request.reasoning.effort === 'none' && request.max_output_tokens === 64,
    ),
  );
  assert.ok(
    requests.every((request) => request.text.format.schema.properties.intent.enum.includes('chat')),
  );
  const chat = (payload) =>
    api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  const image = await chat({
    stream: true,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Name the color.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
        ],
      },
    ],
  });
  assert.equal(image.status, 200);
  assert.match(await image.text(), /Ready/);
  assert.equal(requests.at(-1).input[0].content[1].type, 'input_image');
  assert.equal(requests.at(-1).reasoning.effort, 'none');
  await (
    await chat({
      messages: [{ role: 'user', content: 'Think carefully.' }],
      reasoning_effort: 'medium',
    })
  ).text();
  assert.equal(requests.at(-1).reasoning.effort, 'medium');
  assert.equal(auth.controllers.size, 0);
});

test('Spotify commands traverse the real chat, JSON planner and ChatGPT Responses proxy without root-union rejection', async (t) => {
  for (const model of ['gpt-6-luna', 'gpt-6.1-terra']) {
    const root = mkdtempSync(path.join(tmpdir(), 'capri-music-api-'));
    const plans = new Map([
      ['play something cool', { action: 'resume' }],
      ['Включи какую-нибудь музыку', { action: 'resume' }],
      ['Mets de la musique sympa', { action: 'resume' }],
      ['Play Example Artist', { action: 'play', query: 'Example Artist' }],
      ['Turn Spotify down a little', { action: 'volume', delta: -10 }],
      ['Pause Spotify', { action: 'pause' }],
      ['Play chess', { action: 'none' }],
    ]);
    const requests = [],
      actions = [];
    const auth = {
      controllers: new Map(),
      accessToken: async () => accessToken,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        const schema = body.text?.format?.schema;
        // Documented Responses boundary: a union is valid inside an object,
        // but not as the schema root. This reproduces the old HTTP rejection.
        if (!schema || schema.type !== 'object' || schema.anyOf)
          return Response.json(
            {
              error: {
                code: 'invalid_json_schema',
                message: 'The schema root must be an object, not anyOf.',
              },
            },
            { status: 400 },
          );
        const text = body.input.findLast((item) => item.role === 'user').content;
        const plan = plans.get(text) ?? { action: 'none' };
        const content = JSON.stringify(schema.properties.result ? { result: plan } : plan);
        return sse([{ type: 'response.output_text.delta', delta: content }, terminal(content)]);
      },
    };
    const api = new InferenceApi({
      root,
      storage,
      chatgpt: auth,
      config: apiSettings({
        enabled: true,
        authMode: 'chatgpt',
        accountId: '11111111-1111-4111-8111-111111111111',
        baseUrl: 'https://api.openai.com/v1',
        model,
      }),
    });
    t.after(() => api.close());
    await api.start(0);
    const chat = new ChatService({
      externalInference: true,
      gatewayUrl: 'http://127.0.0.1:1',
      agentId: 'capri',
      sessionKey: 'fixture',
      token: () => '',
      persona: () => 'PRIVATE-PERSONALITY-CANARY',
      store: new TranscriptStore(path.join(root, 'transcript.json')),
      interfaceState: () => ({
        languages: { conversation: 'en' },
        spotify: { enabled: true, prepared: true },
      }),
      prepareMusic: spotifyPlanner({
        url: api.url,
        model: 'unused-local-name',
        fetchImpl: api.localFetch,
      }),
      localMusic: async (_input, command) => {
        actions.push(command);
        return { ok: true, data: { playing: command.action !== 'pause', volumePercent: 40 } };
      },
      computerTask: () => assert.fail('Music must never activate desktop control'),
      fetchImpl: async () =>
        new Response(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: 'Hello.' } }] }) +
            '\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    for (const text of [
      'play something cool',
      'Включи какую-нибудь музыку',
      'Play Example Artist',
      'Turn Spotify down a little',
      'Pause Spotify',
      'Do you like this music?',
      'Play chess',
      'Do not play music',
    ]) {
      const events = [];
      await chat.send({ id: crypto.randomUUID(), text }, (event) => events.push(event));
      assert.equal(
        events.at(-1).type,
        'turn.completed',
        JSON.stringify({ model, text, failure: chat.lastFailure }),
      );
      assert.ok(events.at(-1).assistant.text.trim());
    }
    // The same planner supports wording routed semantically by callers in other languages.
    assert.deepEqual(await chat.prepareMusic('Mets de la musique sympa'), { action: 'resume' });
    assert.deepEqual(actions, [
      { action: 'resume' },
      { action: 'resume' },
      { action: 'play', query: 'Example Artist' },
      { action: 'volume', delta: -10 },
      { action: 'pause' },
    ]);
    assert.equal(requests.length, 7);
    assert.ok(requests.every((request) => request.input.length === 2 && !request.tools));
    assert(!JSON.stringify(requests).includes('PRIVATE-PERSONALITY-CANARY'));
    assert.equal(auth.controllers.size, 0);
    assert.equal(api.controllers.size, 0);
    assert.equal(api.lastFailure, null);
  }
});

test('unwrapping a ChatGPT planner envelope cannot accept extra root fields or invalid Spotify commands', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'capri-music-api-invalid-'));
  let answer;
  const auth = {
    controllers: new Map(),
    accessToken: async () => accessToken,
    fetchImpl: async () =>
      sse([{ type: 'response.output_text.delta', delta: answer }, terminal(answer)]),
  };
  const api = new InferenceApi({
    root,
    storage,
    chatgpt: auth,
    config: apiSettings({
      enabled: true,
      authMode: 'chatgpt',
      accountId: '11111111-1111-4111-8111-111111111111',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6-luna',
    }),
  });
  t.after(() => api.close());
  await api.start(0);
  const planner = spotifyPlanner({ url: api.url, fetchImpl: api.localFetch });
  for (const invalid of [
    '{"action":"resume"}',
    '{"result":{"action":"resume"},"extra":"PRIVATE-OUTPUT"}',
    '{"result":{"action":"volume","value":101}}',
    '{"result":{"action":"play","query":"Example","shell":"calc"}}',
    '{"result":null}',
    'not JSON',
  ]) {
    answer = invalid;
    await assert.rejects(planner('play something cool'), (error) => {
      assert(['CAPRI_SPOTIFY_PLAN_HTTP_ERROR', 'CAPRI_SPOTIFY_PLAN_INVALID'].includes(error.code));
      assert(!error.message.includes('PRIVATE-OUTPUT'));
      return true;
    });
  }
  answer = '{"result":{"action":"none"}}';
  assert.equal(await planner('Do you like this music?'), null);
  assert.equal(auth.controllers.size, 0);
  assert.equal(api.controllers.size, 0);
});

test('headerless Responses streams complete in both connection-test and streaming modes', async () => {
  const wire = Buffer.from(
    [
      { type: 'response.created', response: { status: 'in_progress' } },
      { type: 'response.output_text.delta', delta: 'Ready.' },
      terminal(),
    ]
      .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
      .join(''),
  );
  for (const stream of [false, true]) {
    const auth = { controllers: new Map(), fetchImpl: async () => new Response(wire) };
    const response = await chatGPTCompletion(
      auth,
      {
        model: 'gpt-6.1-terra',
        messages: [{ role: 'user', content: 'Reply with exactly: Ready.' }],
        stream,
      },
      AbortSignal.timeout(2000),
      accessToken,
    );
    if (stream) {
      const packets = [];
      for await (const raw of sseData(response.body)) packets.push(raw);
      assert.equal(packets.at(-1), '[DONE]');
      assert.equal(
        packets
          .slice(0, -1)
          .map((raw) => JSON.parse(raw).choices[0].delta.content ?? '')
          .join(''),
        'Ready.',
      );
    } else {
      const value = await response.json();
      assert.equal(value.choices[0].message.content, 'Ready.');
      assert.equal(value.choices[0].finish_reason, 'stop');
    }
    assert.equal(auth.controllers.size, 0);
  }
});

test('missing response headers never turn malformed, interrupted or failed content into a successful connection', async () => {
  const wire = (events) =>
    Buffer.from(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''));
  const bodies = [
    Buffer.from('<html>private upstream diagnostic</html>\n\n'),
    Buffer.from('{"detail":"private upstream diagnostic"}'),
    wire([{ type: 'response.output_text.delta', delta: 'Partial' }]),
    wire([
      {
        type: 'response.failed',
        response: {
          status: 'failed',
          error: { code: 'server_error', message: 'private upstream diagnostic' },
        },
      },
    ]),
    wire([
      {
        type: 'response.incomplete',
        response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      },
    ]),
  ];
  for (const body of bodies) {
    const auth = { controllers: new Map(), fetchImpl: async () => new Response(body) };
    await assert.rejects(
      chatGPTCompletion(
        auth,
        {
          model: 'gpt-6.1-terra',
          messages: [{ role: 'user', content: 'Reply with exactly: Ready.' }],
          stream: false,
        },
        AbortSignal.timeout(2000),
        accessToken,
      ),
      {
        code: 'CAPRI_CHATGPT_RESPONSE',
        message: 'ChatGPT returned an incomplete or unsupported response.',
      },
    );
    assert.equal(auth.controllers.size, 0);
  }
});

test('explicit non-SSE media types remain rejected and their bodies are cancelled', async () => {
  for (const type of ['application/json', 'text/html', 'text/plain']) {
    let cancelled = false;
    const auth = {
      controllers: new Map(),
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': type } },
        ),
    };
    await assert.rejects(
      chatGPTCompletion(
        auth,
        { model: 'fixture', messages: [{ role: 'user', content: 'Ready.' }], stream: false },
        AbortSignal.timeout(2000),
        accessToken,
      ),
      { code: 'CAPRI_CHATGPT_RESPONSE' },
    );
    assert.equal(cancelled, true);
    assert.equal(auth.controllers.size, 0);
  }
});

test('request cleanup does not misreport an ordinary network failure as a timeout', async () => {
  const auth = {
    controllers: new Map(),
    fetchImpl: async () => {
      throw new Error('private transport details');
    },
  };
  await assert.rejects(
    chatGPTCompletion(
      auth,
      { model: 'fixture', messages: [{ role: 'user', content: 'Ready.' }], stream: false },
      AbortSignal.timeout(2000),
      accessToken,
    ),
    {
      code: 'CAPRI_CHATGPT_CONNECTION',
      message: 'ChatGPT connection failed. Check the network and try again.',
    },
  );
  assert.equal(auth.controllers.size, 0);
});

test('provider streams text immediately and requires response.completed for success', async () => {
  let source;
  const upstream = new ReadableStream({
    start(controller) {
      source = controller;
    },
  });
  const auth = {
    controllers: new Map(),
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).store, false);
      return new Response(upstream, { headers: { 'content-type': 'text/event-stream' } });
    },
  };
  const response = await chatGPTCompletion(
    auth,
    { model: 'fixture', messages: [{ role: 'user', content: 'Hi.' }], stream: true },
    AbortSignal.timeout(2000),
    accessToken,
  );
  const iterator = sseData(response.body)[Symbol.asyncIterator]();
  source.enqueue(
    Buffer.from(
      'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello.' }) + '\n\n',
    ),
  );
  assert.equal(JSON.parse((await iterator.next()).value).choices[0].delta.content, 'Hello.');
  source.enqueue(Buffer.from('data: ' + JSON.stringify(terminal('Hello.')) + '\n\n'));
  source.close();
  const rest = [];
  for await (const raw of { [Symbol.asyncIterator]: () => iterator }) rest.push(raw);
  assert.equal(rest.at(-1), '[DONE]');
  const incompleteAuth = {
    controllers: new Map(),
    fetchImpl: async () => sse([{ type: 'response.output_text.delta', delta: 'Partial' }]),
  };
  await assert.rejects(
    chatGPTCompletion(
      incompleteAuth,
      { model: 'fixture', messages: [{ role: 'user', content: 'Hi.' }] },
      AbortSignal.timeout(2000),
      accessToken,
    ),
    /incomplete/,
  );
});

test('function-call fragments map back to Capri and an unknown tool is rejected', async () => {
  const call = {
    type: 'function_call',
    id: 'fc_1',
    call_id: 'call_1',
    name: 'calculator',
    namespace: 'capri',
    arguments: '{"expression":"2+2"}',
  };
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: call.arguments },
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.completed', response: { status: 'completed', output: [call] } },
  ];
  const payload = {
    model: 'fixture',
    messages: [{ role: 'user', content: '2+2' }],
    tools: [{ type: 'function', function: { name: 'calculator' } }],
  };
  const auth = { controllers: new Map(), fetchImpl: async () => sse(events) };
  const packet = await (
    await chatGPTCompletion(auth, payload, AbortSignal.timeout(2000), accessToken)
  ).json();
  assert.equal(packet.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(packet.choices[0].message.tool_calls, [
    { id: 'call_1', type: 'function', function: { name: 'calculator', arguments: call.arguments } },
  ]);
  auth.fetchImpl = async () =>
    sse([
      {
        type: 'response.completed',
        response: { status: 'completed', output: [{ ...call, name: 'ungranted_shell' }] },
      },
    ]);
  await assert.rejects(
    chatGPTCompletion(auth, payload, AbortSignal.timeout(2000), accessToken),
    /unsupported response/,
  );
});

test('ChatGPT connections use their own account token, survive profile reload, and never persist it as an API key', async (t) => {
  const { auth, root } = fixture(t);
  const status = await auth.signIn();
  const api = new InferenceApi({ root, storage, chatgpt: auth });
  const settings = {
    enabled: true,
    authMode: 'chatgpt',
    accountId: status.selectedId,
    baseUrl: 'https://api.openai.com/v1',
    model: 'fixture-model',
  };
  const id = await api.saveProfile({ settings, name: 'ChatGPT plan' });
  assert(!readFileSync(api.profilesFile, 'utf8').includes(accessToken));
  assert.equal((await api.status()).profiles[0].canConnect, true);
  await api.selectProfile(id);
  assert.equal(api.config.enabled, false, 'Selection takes effect after the guarded restart.');
  assert.equal((await api.testProfile(id)).elapsedMs >= 0, true);
  const restored = new InferenceApi({ root, storage, chatgpt: auth });
  assert.equal(await restored.key(), accessToken);
  assert.throws(
    () => apiSettings({ ...settings, baseUrl: 'https://attacker.test/v1' }),
    /Invalid ChatGPT/,
  );
  await assert.rejects(api.saveProfile({ settings, key: accessToken }), /sign-in instead/);
});

test(
  'cancelling before the first token aborts the upstream response immediately',
  { timeout: 3000 },
  async () => {
    let aborted = false;
    const auth = {
      controllers: new Map(),
      fetchImpl: async (_url, { signal }) =>
        new Response(
          new ReadableStream({
            start(source) {
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  source.error(new DOMException('Aborted', 'AbortError'));
                },
                { once: true },
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    };
    const response = await chatGPTCompletion(
      auth,
      {
        accountId: 'fixture-account',
        model: 'fixture',
        messages: [{ role: 'user', content: 'Hi.' }],
        stream: true,
      },
      AbortSignal.timeout(10000),
      accessToken,
    );
    assert.equal(auth.controllers.size, 1);
    await response.body.cancel();
    assert.equal(aborted, true);
    assert.equal(auth.controllers.size, 0);
  },
);
