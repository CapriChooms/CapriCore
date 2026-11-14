// SPDX-License-Identifier: GPL-3.0-only
// Independent implementation of the published Sign in with ChatGPT protocol.
import http from 'node:http';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { chatGPTModelCapabilities } from './chatgpt-plan-models.mjs';

export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
// Model catalogs include rich metadata unrelated to the picker. They are much
// larger than token/JWKS packets; retain a separate, finite transport budget.
const MODEL_CATALOG_BYTES = 8 * 1024 * 1024;
const AUTH_PACKET_BYTES = 512 * 1024;
const ISSUER = 'https://auth.openai.com';
const TOKEN = ISSUER + '/api/accounts/oauth/token';
const JWKS = ISSUER + '/.well-known/jwks.json';
const USAGE = 'https://chatgpt.com/settings/usage';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const clientIdValid = (value) =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9_-]{6,256}$/.test(value) &&
  value !== 'dynamic_agent_client';
export class ChatGPTPlanError extends Error {
  constructor(message, code = 'CAPRI_CHATGPT_CONNECTION') {
    super(message);
    this.code = code;
  }
}
const problem = (message, code) => new ChatGPTPlanError(message, code);
const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function planJson(fetchImpl, url, options = {}) {
  const maximum = url === CHATGPT_RESOURCE + '/models' ? MODEL_CATALOG_BYTES : AUTH_PACKET_BYTES;
  const signal = AbortSignal.any([
    AbortSignal.timeout(15000),
    ...(options.signal ? [options.signal] : []),
  ]);
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw problem(
        response.status === 401 || response.status === 403
          ? 'ChatGPT access is unavailable. Sign in again and allow plan usage.'
          : response.status === 429
            ? 'ChatGPT usage limit reached. Open Manage usage.'
            : 'ChatGPT connection failed. Check the network and try again.',
        response.status === 429 ? 'CAPRI_CHATGPT_LIMIT' : 'CAPRI_CHATGPT_CONNECTION',
      );
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body ?? []) {
      signal.throwIfAborted();
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maximum)
        throw problem('ChatGPT response exceeds its limit.', 'CAPRI_CHATGPT_RESPONSE_SIZE');
      chunks.push(bytes);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw error instanceof ChatGPTPlanError
      ? error
      : problem(
          signal.aborted
            ? 'ChatGPT request cancelled or timed out.'
            : 'ChatGPT connection failed. Check the network and try again.',
        );
  }
}
export function verifyChatGPTIdentity(token, { clientId, nonce, keys, now = Date.now(), subject }) {
  try {
    if (typeof token !== 'string' || token.length > 32768) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (
      header.alg !== 'RS256' ||
      header.crit ||
      header.b64 !== undefined ||
      typeof header.kid !== 'string'
    )
      throw new Error();
    const jwk = keys.find(
      (key) =>
        key.kid === header.kid &&
        key.kty === 'RSA' &&
        (!key.alg || key.alg === 'RS256') &&
        (!key.use || key.use === 'sig'),
    );
    if (
      !jwk ||
      !verify(
        'RSA-SHA256',
        Buffer.from(parts[0] + '.' + parts[1]),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url'),
      )
    )
      throw new Error();
    const seconds = now / 1000,
      audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== ISSUER ||
      !audience.includes(clientId) ||
      (audience.length > 1 && claims.azp !== clientId) ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= seconds ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 30)) ||
      (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > seconds + 30)) ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.sub.length > 256 ||
      (nonce !== undefined && !same(claims.nonce, nonce)) ||
      (subject && claims.sub !== subject)
    )
      throw new Error();
    return {
      issuer: ISSUER,
      subject: claims.sub,
      email: typeof claims.email === 'string' && claims.email.length <= 254 ? claims.email : '',
    };
  } catch {
    throw problem(
      'ChatGPT identity could not be verified. Sign in again.',
      'CAPRI_CHATGPT_IDENTITY',
    );
  }
}

/** Own app authorization only. Never reads another AI application's account files. */
export class ChatGPTPlanAuth {
  constructor({ root, storage, openBrowser, fetchImpl = fetch, now = Date.now }) {
    Object.assign(this, { storage, openBrowser, fetchImpl, now });
    this.file = path.join(root, 'data/secrets/chatgpt-plan.json');
    this.loading = this.load();
    this.refreshing = new Map();
    this.controllers = new Map();
    this.tail = Promise.resolve();
  }
  async load() {
    try {
      noLinks(this.file);
      if (!existsSync(this.file))
        return (this.store = {
          hostId: 'urn:uuid:' + randomUUID(),
          selectedId: null,
          profiles: [],
        });
      const bytes = readFileSync(this.file);
      if (bytes.length > 2 * 1024 * 1024) throw new Error();
      const saved = JSON.parse(bytes.toString('utf8'));
      if (
        saved.schemaVersion !== 1 ||
        typeof saved.ciphertext !== 'string' ||
        !(await this.storage.available())
      )
        throw new Error();
      const decoded = await this.storage.decrypt(Buffer.from(saved.ciphertext, 'base64'));
      const value = JSON.parse(typeof decoded === 'string' ? decoded : decoded?.result);
      if (
        !/^urn:uuid:[a-f0-9-]{36}$/.test(value.hostId) ||
        !Array.isArray(value.profiles) ||
        value.profiles.length > 10 ||
        new Set(value.profiles.map((p) => p.id)).size !== value.profiles.length ||
        value.profiles.some(
          (p) => !/^[a-f0-9-]{36}$/.test(p.id) || (p.clientId && !clientIdValid(p.clientId)),
        )
      )
        throw new Error();
      this.store = value;
    } catch {
      this.loadError = true;
    }
  }
  async ready() {
    await this.loading;
    if (this.loadError)
      throw problem(
        'Saved ChatGPT access could not be read. Restore access using the original Windows account.',
      );
  }
  async mutate(change) {
    const work = this.tail
      .catch(() => {})
      .then(async () => {
        await this.ready();
        const next = structuredClone(this.store);
        await change(next);
        try {
          if (!(await this.storage.available())) throw new Error();
          const plain = JSON.stringify(next);
          if (Buffer.byteLength(plain) > 1024 * 1024) throw new Error();
          const ciphertext = Buffer.from(await this.storage.encrypt(plain)).toString('base64');
          noLinks(this.file);
          writeJsonAtomic(this.file, { schemaVersion: 1, ciphertext });
        } catch {
          throw problem('Secure credential storage is unavailable. ChatGPT access was not saved.');
        }
        this.store = next;
      });
    this.tail = work;
    await work;
  }
  async profile(id) {
    await this.ready();
    const profile = this.store.profiles.find((p) => p.id === id);
    if (!profile) throw problem('Choose a saved ChatGPT account.');
    return profile;
  }
  async status() {
    await this.loading;
    return {
      loadError: Boolean(this.loadError),
      signingIn: Boolean(this.signingIn),
      selectedId: this.store?.selectedId ?? null,
      profiles: (this.store?.profiles ?? []).map((p, i) => ({
        id: p.id,
        label: p.email || 'Connection ' + (i + 1),
        connected: Boolean(p.credentials?.accessToken),
        sharing: Boolean(
          p.credentials?.scopes?.includes('chatgpt.tokens.use.direct') &&
            p.credentials?.scopes?.includes('resource.invoke'),
        ),
      })),
    };
  }
  async keys(signal) {
    if (!this.jwks || this.jwks.expires < this.now()) {
      const packet = await planJson(this.fetchImpl, JWKS, { signal });
      if (!Array.isArray(packet.keys) || packet.keys.length > 30)
        throw problem('ChatGPT identity keys are unavailable.');
      this.jwks = { keys: packet.keys, expires: this.now() + 3600000 };
    }
    return this.jwks.keys;
  }
  async identity(token, options, signal) {
    let keys = await this.keys(signal);
    // Refresh once for a rotated signing key. Never honor a JWT jku/x5u URL.
    try {
      const kid = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).kid;
      if (!keys.some((key) => key.kid === kid)) {
        this.jwks = null;
        keys = await this.keys(signal);
      }
    } catch (error) {
      if (error instanceof ChatGPTPlanError) throw error;
    }
    return verifyChatGPTIdentity(token, { ...options, keys, now: this.now() });
  }
  tokenSet(packet, previous) {
    if (
      typeof packet.access_token !== 'string' ||
      packet.access_token.length < 8 ||
      packet.access_token.length > 32768 ||
      /[\x00-\x20\x7f]/.test(packet.access_token) ||
      typeof packet.refresh_token !== 'string' ||
      !packet.refresh_token ||
      packet.refresh_token.length > 32768 ||
      typeof packet.token_type !== 'string' ||
      packet.token_type.toLowerCase() !== 'bearer' ||
      !Number.isFinite(packet.expires_in) ||
      packet.expires_in <= 0 ||
      packet.expires_in > 86400 ||
      (packet.scope !== undefined &&
        (typeof packet.scope !== 'string' || packet.scope.length > 4096))
    )
      throw problem('ChatGPT returned an invalid authorization result. Sign in again.');
    return {
      accessToken: packet.access_token,
      refreshToken: packet.refresh_token,
      idToken: packet.id_token ?? previous?.idToken,
      expiresAt: this.now() + packet.expires_in * 1000,
      scopes:
        packet.scope === undefined
          ? (previous?.scopes ?? [])
          : packet.scope.split(/\s+/).filter(Boolean),
    };
  }
  async tokenRequest(parameters, signal) {
    return planJson(this.fetchImpl, TOKEN, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters).toString(),
    });
  }
  async signIn(profileId = null) {
    if (this.signingIn) throw problem('A ChatGPT sign-in is already running.');
    this.signingIn = new AbortController();
    const controller = this.signingIn;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]);
    let server, profile;
    try {
      await this.mutate((store) => {
        if (profileId) profile = store.profiles.find((p) => p.id === profileId);
        else {
          if (store.profiles.length >= 10)
            throw problem('Use a saved ChatGPT account or remove an unused account first.');
          profile = {
            id: randomUUID(),
            clientId: null,
            subject: null,
            email: '',
            credentials: null,
          };
          store.profiles.push(profile);
        }
        if (!profile) throw problem('Choose a saved ChatGPT account.');
      });
      const verifier = randomBytes(32).toString('base64url'),
        state = randomBytes(32).toString('base64url'),
        nonce = randomBytes(32).toString('base64url');
      let resolveCallback, rejectCallback;
      const callback = new Promise((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
      });
      void callback.catch(() => {});
      server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
        const reject = () => {
          res.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
          res.end('Invalid sign-in callback.');
        };
        if (
          req.method !== 'GET' ||
          req.headers.host !== '127.0.0.1:' + server.address().port ||
          req.url.length > 16384
        )
          return reject();
        const url = new URL(req.url, 'http://127.0.0.1');
        if (
          url.pathname !== '/auth/callback' ||
          ['state', 'code', 'client_id', 'error'].some(
            (key) => url.searchParams.getAll(key).length > 1,
          ) ||
          !same(url.searchParams.get('state'), state)
        )
          return reject();
        if (url.searchParams.has('error')) {
          rejectCallback(
            problem('ChatGPT sign-in was declined or could not finish.', 'CAPRI_CHATGPT_CONSENT'),
          );
        } else {
          const clientId = url.searchParams.get('client_id') ?? profile.clientId,
            code = url.searchParams.get('code');
          if (
            !clientIdValid(clientId) ||
            (profile.clientId && clientId !== profile.clientId) ||
            typeof code !== 'string' ||
            !code ||
            code.length > 8192
          )
            return reject();
          resolveCallback({ clientId, code });
        }
        res.writeHead(200, {
          'content-type': 'text/plain',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'",
        });
        res.end('Return to Capri to finish connecting your ChatGPT account.');
      });
      server.requestTimeout = 5000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
      const url = new URL(ISSUER + '/api/accounts/authorize');
      url.search = new URLSearchParams({
        client_id: profile.clientId ?? 'dynamic_agent_client',
        ...(profile.clientId ? {} : { agent_name_hint: 'Capri' }),
        ext_agent_host_id: this.store.hostId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: SCOPES,
        resource: CHATGPT_RESOURCE,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        ...(profile.credentials?.idToken ? { id_token_hint: profile.credentials.idToken } : {}),
      }).toString();
      const aborted = () => rejectCallback(problem('ChatGPT sign-in cancelled or timed out.'));
      signal.addEventListener('abort', aborted, { once: true });
      try {
        signal.throwIfAborted();
        // Windows can keep the browser-launch promise pending after delivering
        // the callback. OAuth completion (or cancellation) must not wait for it.
        void Promise.resolve()
          .then(() => this.openBrowser(url.href))
          .catch(() => rejectCallback(problem('ChatGPT sign-in could not finish. Try again.')));
        const result = await callback;
        signal.throwIfAborted();
        await this.mutate((store) => {
          store.profiles.find((p) => p.id === profile.id).clientId = result.clientId;
        });
        const packet = await this.tokenRequest(
          {
            grant_type: 'authorization_code',
            client_id: result.clientId,
            code: result.code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            resource: CHATGPT_RESOURCE,
          },
          signal,
        );
        if (typeof packet.id_token !== 'string')
          throw problem('ChatGPT identity could not be verified. Sign in again.');
        const identity = await this.identity(
          packet.id_token,
          { clientId: result.clientId, nonce, subject: profile.subject },
          signal,
        );
        const credentials = this.tokenSet(packet);
        signal.throwIfAborted();
        await this.mutate((store) => {
          const target = store.profiles.find((p) => p.id === profile.id);
          Object.assign(target, identity, { clientId: result.clientId, credentials });
          store.selectedId = profile.id;
        });
        return { ...(await this.status()), signingIn: false };
      } finally {
        signal.removeEventListener('abort', aborted);
      }
    } catch (error) {
      throw error instanceof ChatGPTPlanError
        ? error
        : problem('ChatGPT sign-in could not finish. Try again.');
    } finally {
      server?.closeAllConnections();
      server?.close();
      if (this.signingIn === controller) this.signingIn = null;
      if (profile)
        await this.mutate((store) => {
          store.profiles = store.profiles.filter((p) => p.id !== profile.id || p.clientId);
        }).catch(() => {});
    }
  }
  cancelSignIn() {
    this.signingIn?.abort();
  }
  async accessToken(id) {
    const profile = await this.profile(id),
      current = profile.credentials;
    if (
      !current?.scopes.includes('chatgpt.tokens.use.direct') ||
      !current?.scopes.includes('resource.invoke')
    )
      throw problem('Sign in to ChatGPT and allow plan usage first.', 'CAPRI_CHATGPT_CONSENT');
    if (current.expiresAt > this.now() + 60000) return current.accessToken;
    if (!this.refreshing.has(id)) {
      const work = (async () => {
        const packet = await this.tokenRequest({
          grant_type: 'refresh_token',
          client_id: profile.clientId,
          refresh_token: current.refreshToken,
          resource: CHATGPT_RESOURCE,
        });
        if (packet.id_token)
          await this.identity(packet.id_token, {
            clientId: profile.clientId,
            subject: profile.subject,
          });
        const credentials = this.tokenSet(packet, current);
        await this.mutate((store) => {
          const target = store.profiles.find((p) => p.id === id);
          if (target?.credentials?.refreshToken !== current.refreshToken)
            throw problem('ChatGPT account changed. Try again.');
          target.credentials = credentials;
        });
        if (
          !credentials.scopes.includes('chatgpt.tokens.use.direct') ||
          !credentials.scopes.includes('resource.invoke')
        )
          throw problem('Allow ChatGPT plan usage before sending a request.');
        return credentials.accessToken;
      })().finally(() => this.refreshing.delete(id));
      this.refreshing.set(id, work);
    }
    return this.refreshing.get(id);
  }
  async select(id) {
    await this.profile(id);
    await this.mutate((store) => {
      store.selectedId = id;
    });
    return this.status();
  }
  async signOut(id) {
    const profile = await this.profile(id);
    for (const [controller, accountId] of this.controllers)
      if (accountId === id) controller.abort();
    let revoked = !profile.credentials?.refreshToken;
    if (!revoked) {
      try {
        const signal = AbortSignal.timeout(10000);
        const result = await this.fetchImpl(ISSUER + '/api/accounts/oauth/revoke', {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: profile.credentials.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: profile.clientId,
          }).toString(),
        });
        revoked = result.status === 200;
        void result.body?.cancel().catch(() => {});
      } catch {
        /* Local sign-out still clears all tokens. */
      }
    }
    await this.mutate((store) => {
      store.profiles.find((p) => p.id === id).credentials = null;
    });
    return {
      ...(await this.status()),
      warning: revoked
        ? null
        : 'Signed out locally. Remote revocation was not confirmed; disconnect Capri in ChatGPT Settings.',
    };
  }
  async models(id, signal) {
    const accessToken = await this.accessToken(id);
    const value = await planJson(this.fetchImpl, CHATGPT_RESOURCE + '/models', {
      signal,
      headers: { authorization: 'Bearer ' + accessToken },
    });
    if (!Array.isArray(value.models) || value.models.length > 4096)
      throw problem('ChatGPT model list is unavailable.');
    return value.models
      .filter(
        (model) =>
          model?.visibility === 'list' &&
          typeof model.slug === 'string' &&
          /^[a-zA-Z0-9:._/-]{1,128}$/.test(model.slug),
      )
      .map((model) => {
        const capabilities = chatGPTModelCapabilities(model.slug, model);
        return {
          id: model.slug,
          name:
            typeof model.display_name === 'string' ? model.display_name.slice(0, 120) : model.slug,
          ...(Object.keys(capabilities).length ? { capabilities } : {}),
        };
      });
  }
  manageUsage() {
    return this.openBrowser(USAGE);
  }
  close() {
    this.cancelSignIn();
    for (const controller of this.controllers.keys()) controller.abort();
  }
}
