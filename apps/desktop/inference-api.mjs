// SPDX-License-Identifier: GPL-3.0-only
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { normalizeApiKey, validApiKey as validKey, apiKeyProblem } from './renderer/api-key.mjs';
import {
  inferenceEndpoint,
  isLemonadeNpuEndpoint,
  isLemonadePhiEndpoint,
  isLocalApiEndpoint,
  lemonadeNpuModel,
} from './renderer/inference-endpoint.mjs';

const DEFAULT = {
  enabled: false,
  setupRequired: false,
  baseUrl: 'https://openrouter.ai/api/v1',
  model: '',
  vision: false,
  contextTokens: 32768,
};
const LEGACY_PROFILE = 'legacy';
const MAX_PROFILES = 20;
const IMAGES_UNSUPPORTED = 'The active model cannot read images or video frames.';
function imagesUnsupported() {
  return Object.assign(new Error(IMAGES_UNSUPPORTED), {
    code: 'MODEL_IMAGES_UNSUPPORTED',
    providerStatus: 422,
  });
}
function hasImageInput(payload) {
  return (
    Array.isArray(payload?.messages) &&
    payload.messages.some(
      (message) =>
        (Array.isArray(message?.images) && message.images.length > 0) ||
        (Array.isArray(message?.content) &&
          message.content.some((part) =>
            ['image_url', 'input_image', 'image'].includes(part?.type),
          )),
    )
  );
}
function conversationReasoning(payload, config) {
  const selected = payload.reasoning_effort === 'medium';
  const request = { ...payload };
  // This is an internal one-turn marker, not an arbitrary provider parameter.
  delete request.reasoning_effort;
  delete request.reasoning;
  delete request.thinking;
  if (selected) {
    const requested = request.max_completion_tokens ?? request.max_tokens;
    request.max_tokens =
      Number.isFinite(requested) && requested > 0 ? Math.min(requested, 8192) : 8192;
    delete request.max_completion_tokens;
    if (new URL(config.baseUrl).origin === 'https://openrouter.ai')
      request.reasoning = { effort: 'medium', exclude: true };
  } else {
    if (request.max_tokens > 2048) request.max_tokens = 2048;
    if (request.max_completion_tokens > 2048) request.max_completion_tokens = 2048;
  }
  return { request, selected };
}
function withoutPrivateReasoning(packet) {
  for (const choice of packet?.choices ?? []) {
    for (const value of [choice?.message, choice?.delta]) {
      if (!value || typeof value !== 'object') continue;
      for (const field of ['reasoning', 'reasoning_content', 'reasoning_details', 'thinking'])
        delete value[field];
    }
  }
  return packet;
}
function privateReasoningFreeSse(events) {
  return events.replace(/^data: ?([^\r\n]*)/gm, (line, value) => {
    if (value === '[DONE]' || !value) return line;
    return 'data: ' + JSON.stringify(withoutPrivateReasoning(JSON.parse(value)));
  });
}
async function unlessAborted(operation, signal) {
  const pending = Promise.resolve(operation);
  if (!signal) return pending;
  if (signal.aborted) {
    void pending.catch(() => {});
    signal.throwIfAborted();
  }
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
async function providerErrorText(body, signal) {
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await unlessAborted(reader.read(), signal);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) throw new Error('Provider error exceeds limits.');
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function providerRejectsImages(response, signal) {
  try {
    const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(1000)]);
    const packet = JSON.parse(await providerErrorText(response.body, boundedSignal));
    const detail = packet?.error;
    const code = typeof detail?.code === 'string' ? detail.code : packet?.code;
    const message = typeof detail === 'string' ? detail : (detail?.message ?? packet?.message);
    const text = typeof message === 'string' ? message : '';
    // Only an explicit modality rejection is a capability warning. Invalid
    // image data/size, access, account and transport failures retain their error.
    if (
      /(?:auth|api.?key|permission|billing|balance|credit|quota|rate.?limit|time.?out|timed out|\b(?:format|mime|size|dimensions|resolution|base64)\b|(?:invalid|malformed|corrupt)\s+(?:image\s+)?url|image[^.!?\n]{0,25}(?:too large|too small|corrupt|malformed))/i.test(
        text,
      ) ||
      /(?:auth|key|billing|credit|quota|limit|timeout|format|mime|size|dimensions|base64)/i.test(
        String(code ?? ''),
      )
    )
      return false;
    if (
      [
        'image_input_not_supported',
        'model_does_not_support_images',
        'unsupported_image_modality',
      ].includes(code)
    )
      return true;
    return [
      /\bno endpoints?\b[^\r\n]{0,120}\bsupport\b[^\r\n]{0,60}\bimage(?:s| input)?\b/i,
      /\b(?:model|endpoint|provider)\b[^\r\n]{0,100}\b(?:does not|do not|doesn't|cannot|can't)\s+(?:support|accept|process|read)\b[^\r\n]{0,60}\b(?:images?|image inputs?|image_url|vision)\b/i,
      /\b(?:images?|image inputs?|image_url|vision)\b[^\r\n]{0,60}\b(?:not supported|unsupported)\b/i,
      /\bunsupported\s+image\s+(?:modality|input)\b/i,
    ].some((pattern) => pattern.test(text));
  } catch {
    return false;
  }
}
const PROXYAPI_ORIGIN = 'https://api.proxyapi.ru';
const PROXYAPI_CONNECT_TIMEOUT =
  'API connection to ProxyAPI timed out before HTTPS. Check your VPN or proxy route.';
const PROVIDER_ERRORS = {
  401: 'API provider returned HTTP 401. Check that the key belongs to this provider.',
  402: 'API provider returned HTTP 402. Check the account balance or key budget.',
  403: 'API provider returned HTTP 403. Check the key permissions for this model.',
  404: 'API provider returned HTTP 404. Check the base URL and the model ID for this provider.',
  429: 'API provider returned HTTP 429. The provider rate limit was reached.',
};
const validProfileId = (id) => id === LEGACY_PROFILE || /^[a-f0-9-]{36}$/u.test(id);
const invalidEndpoint =
  'Use HTTPS for remote APIs or HTTP for a loopback address. Omit credentials, query parameters and fragments.';
export function apiSettings(value = DEFAULT) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['profileId', 'tools'].includes(key) && !Object.hasOwn(DEFAULT, key),
    )
  )
    throw new Error('Invalid API settings.');
  const result = { ...DEFAULT, ...value };
  const url = inferenceEndpoint(result.baseUrl, result.model);
  if (!url) throw new Error(invalidEndpoint);
  const local = isLocalApiEndpoint(url);
  result.tools = value.tools === undefined ? !local : value.tools;
  if (
    typeof result.enabled !== 'boolean' ||
    typeof result.setupRequired !== 'boolean' ||
    (result.enabled && result.setupRequired) ||
    typeof result.vision !== 'boolean' ||
    typeof result.tools !== 'boolean' ||
    (result.profileId !== undefined &&
      (typeof result.profileId !== 'string' || !validProfileId(result.profileId))) ||
    !Number.isInteger(result.contextTokens) ||
    result.contextTokens < (local ? 8192 : 32768) ||
    result.contextTokens > 262144 ||
    typeof result.model !== 'string' ||
    result.model.length > 128 ||
    /[\s\x00-\x1f]/.test(result.model) ||
    (result.enabled && !result.model)
  )
    throw new Error('Invalid API model settings.');
  if (
    url.href.length > 512 ||
    (url.protocol !== 'https:' && !local) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(invalidEndpoint);
  // Avoid DNS, hosts-file overrides and IPv6 preference for localhost.
  // A server bound only to IPv6 can be selected explicitly with [::1].
  if (local && url.hostname === 'localhost') url.hostname = '127.0.0.1';
  if (isLemonadeNpuEndpoint(url, result.model)) {
    result.tools = false;
    if (isLemonadePhiEndpoint(url, result.model)) result.vision = false;
    result.model = lemonadeNpuModel(result.model);
  }
  result.baseUrl = url.href.replace(/\/+$/, '');
  return result;
}
function loadApiSettings(file) {
  noLinks(file);
  if (!existsSync(file)) return null;
  if (lstatSync(file).size > 8192) throw new Error('Invalid API settings file.');
  return apiSettings(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
}
function readRecord(file, maxBytes) {
  noLinks(file);
  if (!existsSync(file)) return null;
  const info = lstatSync(file);
  if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid API profile storage.');
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function credentialFor(config, record) {
  if (
    typeof record?.ciphertext !== 'string' ||
    !/^[A-Za-z0-9+/]{1,6000}={0,2}$/u.test(record.ciphertext) ||
    record.origin !== new URL(config.baseUrl).origin
  )
    return null;
  return { origin: record.origin, ciphertext: record.ciphertext };
}
export function readApiSettings(root) {
  try {
    return loadApiSettings(path.join(root, 'data/desktop/inference-api.json')) ?? apiSettings();
  } catch {
    // Keep a damaged owner file intact and leave Settings usable for repair.
    console.warn(
      'API settings could not be read; select a saved connection in Settings to repair them.',
    );
    return apiSettings({ setupRequired: true });
  }
}
const requiresKey = (settings) => !isLocalApiEndpoint(new URL(settings.baseUrl));

function withoutTools(payload) {
  const {
    tools,
    tool_choice,
    parallel_tool_calls,
    functions,
    function_call,
    messages,
    ...options
  } = payload;
  return {
    ...options,
    messages: messages
      .filter((message) => !['tool', 'function'].includes(message.role))
      .filter((message) => message.role !== 'assistant' || message.content)
      .map(({ tool_calls, tool_call_id, function_call, ...message }) => message),
  };
}

function lemonadeNpuRequest({ messages, stop, stream, max_tokens, temperature }, vision) {
  // Keep the RyzenAI request independent of OpenClaw SDK metadata and null
  // content/tool entries. Phi consumes strings; the Gemma user turn can carry images.
  const textMessages = messages.flatMap(({ role, content }) => {
    if (role === 'developer') role = 'system';
    if (!['system', 'user', 'assistant'].includes(role)) return [];
    if (vision && role === 'user' && Array.isArray(content)) {
      const parts = content.filter(
        (part) =>
          (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) ||
          (part?.type === 'image_url' && typeof part.image_url?.url === 'string'),
      );
      return parts.length ? [{ role, content: parts }] : [];
    }
    const text = Array.isArray(content)
      ? content
          .filter((part) => part?.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n')
      : content;
    return typeof text === 'string' && text.trim() ? [{ role, content: text }] : [];
  });
  if (!textMessages.some(({ role }) => role === 'user'))
    throw new Error('Invalid API conversation. A text message is required.');
  const sequences = (Array.isArray(stop) ? stop : [stop])
    .filter((value) => typeof value === 'string' && value.length > 0 && value.length <= 100)
    .slice(0, 4);
  return {
    messages: textMessages,
    stream: stream === true,
    ...(Number.isInteger(max_tokens) && max_tokens > 0
      ? { max_tokens: Math.min(4096, max_tokens) }
      : {}),
    ...(Number.isFinite(temperature) ? { temperature } : {}),
    ...(sequences.length ? { stop: sequences } : {}),
  };
}

async function postProxyApi(session, fetchDirect, url, options) {
  const { signal } = options;
  signal.throwIfAborted();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  let route;
  try {
    route = await Promise.race([session.resolveProxy(url), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
  signal.throwIfAborted();
  if (route === 'DIRECT') return fetchDirect(url, options);
  return session.fetch(url, {
    ...options,
    credentials: 'omit',
    cache: 'no-store',
    bypassCustomProtocolHandlers: true,
  });
}

function postLoopback(url, { headers, body, signal }) {
  // A user-configured environment proxy must not receive a local model's payload.
  // The destination is a validated IP literal, and node:http does not follow redirects.
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        signal,
        agent: false,
      },
      (incoming) => {
        const status = incoming.statusCode;
        const responseHeaders = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2)
          responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        const noBody = [204, 205, 304].includes(status);
        if (noBody) incoming.resume();
        resolve(
          new Response(noBody ? null : Readable.toWeb(incoming), {
            status,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}
function equal(a, b) {
  const x = Buffer.from(a ?? ''),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function bounded(body, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) throw new Error('API request exceeds limits.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function eventData(frame) {
  return frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /u, ''))
    .join('\n')
    .trim();
}

function streamHasReply(body) {
  let replied = false;
  for (const frame of body.split(/\r?\n\r?\n/u)) {
    const data = eventData(frame);
    if (!data || data === '[DONE]') continue;
    const packet = JSON.parse(data);
    if (packet.error) return false;
    if (
      packet.choices?.some(
        ({ delta }) => typeof delta?.content === 'string' && delta.content.trim(),
      )
    )
      replied = true;
  }
  return replied;
}

// Withhold frames that could begin a credential echoed over separate SSE deltas.
function streamingRedactor(key) {
  const suffixes = new Map();
  // Carry a prefix length instead of repeatedly copying long token substrings.
  // This keeps streaming work linear even for 4096-character credentials.
  const failure = new Uint16Array(key.length);
  for (let i = 1, length = 0; i < key.length; i++) {
    while (length && key[i] !== key[length]) length = failure[length - 1];
    if (key[i] === key[length]) length++;
    failure[i] = length;
  }
  const significantLength = Math.min(8, Math.max(2, key.length - 2));
  let pending = '';
  function scan(id, value) {
    if (typeof value !== 'string') return;
    let length = suffixes.get(id) ?? 0;
    for (const character of value) {
      while (length && character !== key[length]) length = failure[length - 1];
      if (character === key[length]) length++;
      // Never release a recoverable prefix just because later text diverges
      // from the credential. Finish/EOF checks alone cannot protect that case.
      if (length >= significantLength) throw new Error('API response contained a credential.');
      if (length === key.length) throw new Error('API response contained a credential.');
    }
    if (length) suffixes.set(id, length);
    else suffixes.delete(id);
  }
  return (frames, final = false) => {
    const safe = frames.replaceAll(key, '[REDACTED]');
    for (const frame of safe.split(/\r?\n\r?\n/u)) {
      const data = eventData(frame);
      if (!data || data === '[DONE]') continue;
      const packet = JSON.parse(data);
      // Provider metadata and nonstandard fields must not echo a recoverable
      // prefix either; known delta fields additionally carry state across frames.
      if (JSON.stringify(packet).includes(key.slice(0, significantLength)))
        throw new Error('API response contained a credential.');
      for (const [index, choice] of (packet.choices ?? []).entries()) {
        const id = choice.index ?? index;
        const delta = choice.delta ?? {};
        scan(id + ':content', delta.content);
        scan(id + ':reasoning', delta.reasoning ?? delta.reasoning_content);
        for (const [toolIndex, call] of (delta.tool_calls ?? []).entries())
          scan(id + ':tool:' + (call.index ?? toolIndex), call.function?.arguments);
        if (choice.finish_reason)
          for (const field of suffixes.keys())
            if (field.startsWith(id + ':')) {
              if (suffixes.get(field) >= significantLength)
                throw new Error('API response contained a credential.');
              suffixes.delete(field);
            }
      }
    }
    if (final && [...suffixes.values()].some((length) => length >= significantLength))
      throw new Error('API response contained a credential.');
    pending += safe;
    if (!final && suffixes.size) return '';
    const output = pending;
    pending = '';
    return output;
  };
}

/** The real credential never enters OpenClaw, child environments, configuration, or diagnostics. */
export class InferenceApi {
  constructor({ root, storage, config = readApiSettings(root), fetchImpl = fetch, proxySession }) {
    Object.assign(this, { root, storage, config, fetchImpl, proxySession });
    this.file = path.join(root, 'data/secrets/inference-api.json');
    this.profilesFile = path.join(root, 'data/secrets/inference-api-profiles.json');
    this.settingsFile = path.join(root, 'data/desktop/inference-api.json');
    this.proxyToken = randomBytes(32).toString('hex');
    this.controllers = new Set();
    this.verifiedOllamaProbes = new Set();
    if (config.enabled) {
      try {
        const record = config.profileId
          ? this.profile(config.profileId).credential
          : this.legacyCredential(config);
        this.activeCredential = credentialFor(config, record);
      } catch {
        this.activeCredentialError = true;
      }
    }
  }
  legacyCredential(config) {
    const value = readRecord(this.file, 8192);
    if (!value) return null;
    if (value.schemaVersion === 2) return credentialFor(config, value);
    if (value.schemaVersion !== 1) throw new Error('Invalid API credential.');
    const saved = loadApiSettings(this.settingsFile);
    return saved && !saved.profileId
      ? credentialFor(config, { ...value, origin: new URL(saved.baseUrl).origin })
      : null;
  }
  readProfiles() {
    try {
      const saved = readRecord(this.profilesFile, 192 * 1024);
      if (saved) {
        if (
          saved.schemaVersion !== 1 ||
          !Array.isArray(saved.profiles) ||
          saved.profiles.length > MAX_PROFILES ||
          new Set(saved.profiles.map((profile) => profile.id)).size !== saved.profiles.length
        )
          throw new Error();
        return saved.profiles.map(({ id, name, settings, credential }) => {
          if (
            typeof id !== 'string' ||
            !validProfileId(id) ||
            typeof name !== 'string' ||
            name.length > 64
          )
            throw new Error();
          const config = apiSettings(settings);
          if (!config.enabled || config.profileId) throw new Error();
          return { id, name, settings: config, credential: credentialFor(config, credential) };
        });
      }
    } catch {
      throw new Error('Saved API connections could not be read.');
    }
    const { profileId, ...saved } = readApiSettings(this.root);
    if (profileId || !saved.model) return [];
    const settings = apiSettings({ ...saved, enabled: true, setupRequired: false });
    let credential;
    try {
      credential = this.legacyCredential(settings);
    } catch {
      credential = null;
    }
    return [{ id: LEGACY_PROFILE, name: '', settings, credential }];
  }
  writeProfiles(profiles) {
    noLinks(this.profilesFile);
    writeJsonAtomic(this.profilesFile, { schemaVersion: 1, profiles });
  }
  profile(id) {
    const profile = this.readProfiles().find((item) => item.id === id);
    if (!profile) throw new Error('API connection was not found.');
    return profile;
  }
  activeProfileId(config = this.config) {
    return config.enabled ? (config.profileId ?? LEGACY_PROFILE) : null;
  }
  async decodeKey(credential) {
    if (!credential) return null;
    try {
      if (!(await this.storage.available())) throw new Error();
      const decoded = await this.storage.decrypt(Buffer.from(credential.ciphertext, 'base64'));
      const key = typeof decoded === 'string' ? decoded : decoded?.result;
      if (!validKey(key)) throw new Error();
      return key;
    } catch {
      throw new Error('Saved API access could not be read. Save your API key again.');
    }
  }
  async key() {
    if (this.activeCredentialError)
      throw new Error('Saved API access could not be read. Save your API key again.');
    return this.decodeKey(this.activeCredential);
  }
  async status() {
    const activeId = this.activeProfileId();
    return {
      activeId,
      setupRequired: this.config.setupRequired,
      secureStorage: await this.storage.available(),
      profiles: this.readProfiles().map(({ id, name, settings, credential }) => ({
        id,
        name,
        ...settings,
        hasKey: Boolean(credential),
        canConnect: Boolean(credential) || !requiresKey(settings),
      })),
    };
  }
  async saveProfile({ id, settings, name = '', key }, beforeCommit = () => {}) {
    const previousSave = this.pendingProfileSave;
    let finishSave;
    this.pendingProfileSave = new Promise((resolve) => (finishSave = resolve));
    await previousSave;
    try {
      const config = apiSettings(settings);
      if (!config.enabled || config.profileId || typeof name !== 'string' || name.length > 64)
        throw new Error('Invalid API model settings.');
      const editing = id !== undefined;
      if (editing && (typeof id !== 'string' || !validProfileId(id)))
        throw new Error('API connection was not found.');
      const profiles = this.readProfiles();
      const index = editing ? profiles.findIndex((profile) => profile.id === id) : -1;
      if (editing && index < 0) throw new Error('API connection was not found.');
      if (!editing && profiles.length >= MAX_PROFILES)
        throw new Error('Remove a saved API connection first.');
      const origin = new URL(config.baseUrl).origin;
      let credential = editing ? profiles[index].credential : null;
      key = normalizeApiKey(key);
      const replacingKey = key !== undefined && key !== '';
      if (!replacingKey && credential && credential.origin !== origin)
        throw new Error('Enter a new API key when changing the provider address.');
      if (requiresKey(config) || replacingKey || credential) {
        if (replacingKey || !credential) {
          const problem = apiKeyProblem(key);
          if (problem) throw new Error(problem);
        }
        if (!(await this.storage.available()))
          throw new Error('Secure credential storage is unavailable. API access was not saved.');
        if (replacingKey || !credential) {
          const ciphertext = Buffer.from(await this.storage.encrypt(key)).toString('base64');
          credential = { origin, ciphertext };
        }
      }
      id ??= randomUUID();
      const profile = {
        id,
        name: name.trim(),
        settings: config,
        credential,
      };
      if (editing) profiles[index] = profile;
      else profiles.push(profile);
      await beforeCommit();
      this.writeProfiles(profiles);
      return id;
    } finally {
      finishSave();
    }
  }
  async selectProfile(id, beforeCommit = () => {}) {
    const profile = id === null ? null : this.profile(id);
    if (profile && !(await this.decodeKey(profile.credential)) && requiresKey(profile.settings))
      throw new Error('Save an API key before enabling API inference.');
    const profiles = this.readProfiles();
    if (profile && !profiles.some((item) => item.id === id))
      throw new Error('API connection was not found.');
    beforeCommit();
    // Preserve the pre-profile connection before changing the installer-visible selection.
    if (!existsSync(this.profilesFile)) this.writeProfiles(profiles);
    noLinks(this.settingsFile);
    writeJsonAtomic(
      this.settingsFile,
      profile ? { ...profile.settings, profileId: id } : apiSettings(),
    );
  }
  removeProfile(id) {
    if (id === this.activeProfileId() || id === this.activeProfileId(readApiSettings(this.root)))
      throw new Error('Switch to another connection before removing this one.');
    const profiles = this.readProfiles();
    const remaining = profiles.filter((profile) => profile.id !== id);
    if (remaining.length === profiles.length) throw new Error('API connection was not found.');
    if (id === LEGACY_PROFILE) {
      noLinks(this.file);
      if (existsSync(this.file)) unlinkSync(this.file);
    }
    this.writeProfiles(remaining);
  }
  async testProfile(id) {
    const profile = this.profile(id);
    const signal = AbortSignal.timeout(requiresKey(profile.settings) ? 15000 : 60000);
    const started = performance.now();
    const key = await this.decodeKey(profile.credential);
    const stream = isLemonadeNpuEndpoint(new URL(profile.settings.baseUrl), profile.settings.model);
    // Exercise the same streaming path and conversation roles used by the real chat.
    const messages = stream
      ? [
          { role: 'system', content: 'Keep replies short.' },
          { role: 'user', content: 'Reply with only OK.' },
          { role: 'assistant', content: 'OK' },
        ]
      : [];
    messages.push({ role: 'user', content: 'Reply with only OK.' });
    const local = isLocalApiEndpoint(new URL(profile.settings.baseUrl));
    const probeId = profile.settings.baseUrl + '\0' + profile.settings.model;
    let noReasoning = local && this.verifiedOllamaProbes.has(probeId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response } = await this.upstream(
        {
          messages,
          stream,
          max_tokens: stream ? 32 : noReasoning ? 64 : 256,
          ...(noReasoning ? { reasoning_effort: 'none' } : {}),
        },
        signal,
        profile.settings,
        key,
      );
      let packet, replied;
      try {
        const body = await bounded(response.body, 64 * 1024);
        packet = stream ? null : JSON.parse(body);
        replied = stream
          ? streamHasReply(body)
          : packet.choices?.some(
              (choice) =>
                typeof choice.message?.content === 'string' && choice.message.content.trim(),
            );
      } catch {
        throw new Error(
          signal.aborted ? 'API request cancelled or timed out.' : 'API model returned no text.',
        );
      }
      const ollama = local && packet?.system_fingerprint === 'fp_ollama';
      if (replied) {
        if (ollama && noReasoning) this.verifiedOllamaProbes.add(probeId);
        return { elapsedMs: Math.round(performance.now() - started) };
      }
      const reasoningOnly = packet?.choices?.some((choice) =>
        ['reasoning', 'reasoning_content', 'thinking'].some(
          (field) => typeof choice.message?.[field] === 'string' && choice.message[field].trim(),
        ),
      );
      // Ollama's documented fingerprint identifies its supported thinking control.
      // A reasoning trace alone never proves usable text. Retry this public probe
      // once without thinking, within the same timeout and a small answer budget.
      // Unknown and remote providers receive no speculative provider parameters.
      if (attempt === 0 && ollama && reasoningOnly && !noReasoning) {
        noReasoning = true;
        continue;
      }
      throw new Error('API model returned no text.');
    }
  }
  localFetch = (url, options = {}) => {
    if (!this.url || new URL(url).origin !== this.url)
      throw new Error('Invalid inference destination.');
    return fetch(url, {
      ...options,
      headers: { ...options.headers, authorization: 'Bearer ' + this.proxyToken },
    });
  };
  async assertImageSupport(signal, config = this.config) {
    if (!config.vision) throw imagesUnsupported();
    signal?.throwIfAborted();
    return true;
  }
  async upstream(payload, signal, config = this.config, key = undefined) {
    if (hasImageInput(payload)) await this.assertImageSupport(signal, config);
    if (key === undefined) key = await this.key();
    const remote = requiresKey(config);
    if (!key && remote) throw new Error('API key is missing.');
    const endpoint = new URL(config.baseUrl);
    const proxyApi = endpoint.origin === PROXYAPI_ORIGIN;
    const prepared = config.tools === false ? withoutTools(payload) : payload;
    const request = isLemonadeNpuEndpoint(endpoint, config.model)
      ? lemonadeNpuRequest(prepared, config.vision)
      : prepared;
    let response;
    try {
      const url = config.baseUrl + '/chat/completions';
      const options = {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'content-type': 'application/json',
          ...(key ? { authorization: 'Bearer ' + key } : {}),
        },
        body: JSON.stringify({
          ...request,
          model: config.model,
        }),
      };
      response = !remote
        ? await postLoopback(url, options)
        : proxyApi && this.proxySession
          ? await postProxyApi(this.proxySession(), this.fetchImpl, url, options)
          : await this.fetchImpl(url, options);
    } catch (error) {
      const networkCode = [
        error,
        error.cause,
        ...(error.cause instanceof AggregateError ? error.cause.errors : []),
      ]
        .map((cause) => cause?.code)
        .find((code) =>
          /^(?:UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_TLS_CERT_ALTNAME_INVALID|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/u.test(
            code,
          ),
        );
      if (
        proxyApi &&
        !signal.aborted &&
        (networkCode === 'UND_ERR_CONNECT_TIMEOUT' ||
          error.message === 'net::ERR_CONNECTION_TIMED_OUT')
      )
        throw new Error(PROXYAPI_CONNECT_TIMEOUT);
      throw new Error(
        signal.aborted
          ? 'API request cancelled or timed out.'
          : 'API connection failed. Check the provider URL and network.' +
            (networkCode ? ' (' + networkCode + ')' : ''),
      );
    }
    if (!response.ok || !response.body) {
      if (
        hasImageInput(payload) &&
        [400, 404, 415, 422].includes(response.status) &&
        response.body &&
        (await providerRejectsImages(response, signal))
      )
        throw imagesUnsupported();
      await response.body?.cancel();
      throw Object.assign(
        new Error(
          PROVIDER_ERRORS[response.status] ??
            'API provider returned HTTP ' +
              response.status +
              '. Check access, model availability and account balance.',
        ),
        { providerStatus: response.status },
      );
    }
    return { response, key };
  }
  async start(port) {
    if (!this.config.enabled || this.server) return;
    if (!(await this.key()) && requiresKey(this.config)) throw new Error('API key is missing.');
    const server = http.createServer(async (req, res) => {
      const controller = new AbortController();
      let timeout = setTimeout(() => controller.abort(), 180000);
      this.controllers.add(controller);
      res.on('close', () => controller.abort());
      try {
        if (!equal(req.headers.authorization, 'Bearer ' + this.proxyToken)) {
          res.writeHead(401).end();
          return;
        }
        if (req.method !== 'POST' || !['/v1/chat/completions', '/api/chat'].includes(req.url)) {
          res.writeHead(404).end();
          return;
        }
        const input = JSON.parse(await bounded(req, 8 * 1024 * 1024));
        if (!Array.isArray(input.messages)) throw new Error('Invalid API conversation.');
        const ollama = req.url === '/api/chat';
        const selectedReasoning = ollama
          ? input.think === true
          : input.reasoning_effort === 'medium';
        if (selectedReasoning) {
          clearTimeout(timeout);
          timeout = setTimeout(() => controller.abort(), 300000);
        }
        const imageRequest = input.messages.some(
          (message) =>
            (ollama && Array.isArray(message?.images) && message.images.length > 0) ||
            (Array.isArray(message?.content) &&
              message.content.some((part) => part?.type === 'image_url')),
        );
        if (imageRequest && !this.config.vision) throw imagesUnsupported();
        const conversation = ollama ? null : conversationReasoning(input, this.config);
        let payload = ollama
          ? {
              messages: input.messages.map((message) => ({
                role: message.role,
                content:
                  Array.isArray(message.images) && message.images.length
                    ? [
                        { type: 'text', text: message.content ?? '' },
                        ...message.images.map((image) => ({
                          type: 'image_url',
                          image_url: { url: 'data:image/png;base64,' + image },
                        })),
                      ]
                    : message.content,
              })),
              stream: false,
              max_tokens: selectedReasoning
                ? Math.min(input.options?.num_predict || 8192, 8192)
                : Math.min(input.options?.num_predict || 768, 4096),
              temperature: input.options?.temperature ?? 0.85,
              ...((imageRequest || input.format) &&
              new URL(this.config.baseUrl).origin === 'https://openrouter.ai' &&
              /^nvidia\/nemotron-3\.5-super-vl(?::free)?$/.test(this.config.model)
                ? { reasoning: { enabled: false } }
                : {}),
              ...(input.format ? { response_format: { type: 'json_object' } } : {}),
            }
          : conversation.request;
        if (ollama && selectedReasoning)
          payload = conversationReasoning(
            { ...payload, reasoning_effort: 'medium' },
            this.config,
          ).request;
        if (ollama && input.format)
          payload.messages.unshift({
            role: 'system',
            content: 'Return JSON matching this output schema: ' + JSON.stringify(input.format),
          });
        const { response, key } = await this.upstream(payload, controller.signal);
        if (ollama || input.stream !== true) {
          const packet = withoutPrivateReasoning(
            JSON.parse(await bounded(response.body, 16 * 1024 * 1024)),
          );
          const serialized = JSON.stringify(packet);
          const raw = key ? serialized.replaceAll(key, '[REDACTED]') : serialized;
          const result = JSON.parse(raw);
          if (ollama) {
            const message = result.choices?.[0]?.message;
            if (!message || message.tool_calls?.length)
              throw new Error('API model returned an invalid tool-free response.');
            const value = {
              model: this.config.model,
              message: { role: 'assistant', content: message.content ?? '' },
              done: true,
              done_reason: result.choices[0].finish_reason,
              prompt_eval_count: result.usage?.prompt_tokens,
              eval_count: result.usage?.completion_tokens,
            };
            res
              .writeHead(200, {
                'content-type': input.stream ? 'application/x-ndjson' : 'application/json',
              })
              .end(JSON.stringify(value) + '\n');
          } else res.writeHead(200, { 'content-type': 'application/json' }).end(raw);
        } else {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
          // Carry a credential-length suffix across chunks so a provider echo
          // split over network packets cannot leak into Gateway logs/history.
          let tail = '',
            total = 0;
          const decoder = new TextDecoder();
          const redact = key ? streamingRedactor(key) : (value) => value;
          for await (const bytes of response.body) {
            total += bytes.length;
            if (total > 16 * 1024 * 1024) throw new Error('API response exceeds limits.');
            tail += decoder.decode(bytes, { stream: true });
            const lf = tail.lastIndexOf('\n\n');
            const crlf = tail.lastIndexOf('\r\n\r\n');
            const end = crlf > lf ? crlf + 4 : lf >= 0 ? lf + 2 : 0;
            if (end) {
              const safe = redact(privateReasoningFreeSse(tail.slice(0, end)));
              if (safe) res.write(safe);
              tail = tail.slice(end);
            }
          }
          res.end(redact(privateReasoningFreeSse(tail + decoder.decode()), true));
        }
      } catch (error) {
        // Never include provider response bodies, fetch causes or credentials.
        const unsupportedImages = error.code === 'MODEL_IMAGES_UNSUPPORTED';
        const message = unsupportedImages
          ? IMAGES_UNSUPPORTED
          : /^API |^Enable vision|^Saved API|^Invalid API/.test(error.message)
            ? error.message
            : 'API request could not be completed.';
        if (!res.headersSent)
          res
            .writeHead(
              Number.isInteger(error.providerStatus) &&
                error.providerStatus >= 400 &&
                error.providerStatus < 500
                ? error.providerStatus
                : 502,
              { 'content-type': 'application/json' },
            )
            .end(
              JSON.stringify({
                error: {
                  message,
                  ...(unsupportedImages ? { code: 'model_images_unsupported' } : {}),
                },
              }),
            );
        else res.destroy();
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(controller);
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    this.server = server;
    this.url = 'http://127.0.0.1:' + server.address().port;
  }
  close() {
    for (const controller of this.controllers) controller.abort();
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = null;
  }
}
