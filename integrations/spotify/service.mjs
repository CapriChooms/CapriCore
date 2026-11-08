import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spotifySourceHash } from './native-build.mjs';

export const ACTIONS = [
  'status',
  'search',
  'play',
  'resume',
  'pause',
  'toggle',
  'next',
  'previous',
  'volume',
  'mute',
  'seek',
  'shuffle',
  'repeat',
  'liked_songs',
  'queue',
  'queue_add',
  'library',
];
export const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ACTIONS },
    query: {
      type: 'string',
      description: 'Song, artist, album or playlist to search/play. Include the artist when known.',
      maxLength: 180,
    },
    type: {
      type: 'string',
      enum: ['track', 'album', 'artist', 'playlist', 'any'],
      description: 'Search/play category; default track.',
    },
    resultId: { type: 'string', description: 'A resultId returned by search; never invent one.' },
    uri: {
      type: 'string',
      description: 'An exact spotify:track/album/artist/playlist URI or open.spotify.com link.',
    },
    value: {
      type: 'number',
      minimum: 0,
      maximum: 100,
      description: 'Absolute Spotify volume percent; volume action only.',
    },
    delta: {
      type: 'number',
      minimum: -100,
      maximum: 100,
      description: 'Relative volume percent, instead of value; e.g. -15 for quieter.',
    },
    seconds: {
      type: 'number',
      minimum: 0,
      maximum: 86400,
      description: 'Absolute playback position for seek.',
    },
    enabled: { type: 'boolean', description: 'Required for mute and shuffle.' },
    mode: {
      type: 'string',
      enum: ['off', 'context', 'track'],
      description: 'Required for repeat.',
    },
  },
};
const LIMITS = { query: 180, resultId: 16, uri: 300 };
function invalid() {
  throw new Error(
    'Invalid Spotify command. Use only the documented action and its required arguments.',
  );
}
export function normalizeSpotifyUri(value) {
  if (/^spotify:(track|album|artist|playlist):[a-zA-Z0-9]{22}$/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'open.spotify.com' ||
    url.username ||
    url.password ||
    url.port
  )
    invalid();
  const match = url.pathname.match(
    /^\/(?:intl-[a-z-]+\/)?(track|album|artist|playlist)\/([a-zA-Z0-9]{22})\/?$/,
  );
  if (!match) invalid();
  return `spotify:${match[1]}:${match[2]}`;
}
export function validateCommand(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !ACTIONS.includes(value.action)
  )
    invalid();
  if (Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) invalid();
  const result = { ...value };
  for (const [key, max] of Object.entries(LIMITS))
    if (key in result) {
      if (
        typeof result[key] !== 'string' ||
        !result[key].trim() ||
        result[key].length > max ||
        /[\x00-\x1f]/.test(result[key])
      )
        invalid();
      result[key] = result[key].trim();
    }
  if (result.resultId && !/^[a-f0-9]{16}$/.test(result.resultId)) invalid();
  if (result.uri) result.uri = normalizeSpotifyUri(result.uri);
  if (result.type && !schema.properties.type.enum.includes(result.type)) invalid();
  const number = (key, min, max) => {
    if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max) invalid();
  };
  if (result.action === 'search' && !result.query) invalid();
  if (
    result.action === 'play' &&
    [result.query, result.resultId, result.uri].filter(Boolean).length !== 1
  )
    invalid();
  if (result.action === 'queue_add' && [result.query, result.resultId].filter(Boolean).length !== 1)
    invalid();
  if (result.action === 'volume') {
    if ('value' in result === 'delta' in result) invalid();
    'value' in result ? number('value', 0, 100) : number('delta', -100, 100);
  }
  if (['mute', 'shuffle'].includes(result.action) && typeof result.enabled !== 'boolean') invalid();
  if (result.action === 'seek') number('seconds', 0, 86400);
  if (result.action === 'repeat' && !schema.properties.mode.enum.includes(result.mode)) invalid();
  const allowed = {
    search: ['query', 'type'],
    play: ['query', 'type', 'resultId', 'uri'],
    queue_add: ['query', 'resultId'],
    volume: ['value', 'delta'],
    mute: ['enabled'],
    shuffle: ['enabled'],
    seek: ['seconds'],
    repeat: ['mode'],
  };
  if (
    Object.keys(result).some(
      (key) => key !== 'action' && !(allowed[result.action] ?? []).includes(key),
    )
  )
    invalid();
  return result;
}

/** Public oEmbed metadata only. No OAuth, cookies, HTML rendering or arbitrary URLs. */
export async function spotifyLinkTitle(uri, { fetchImpl = fetch, signal } = {}) {
  const [, type, id] = normalizeSpotifyUri(uri).split(':');
  const url = new URL('https://open.spotify.com/oembed');
  url.searchParams.set('url', `https://open.spotify.com/${type}/${id}`);
  const timeout = AbortSignal.timeout(6000);
  const response = await fetchImpl(url, {
    redirect: 'error',
    credentials: 'omit',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new Error('Spotify could not identify that music link. Try its title and artist.');
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    text += decoder.decode(chunk, { stream: true });
    if (text.length > 65536) throw new Error('Spotify link metadata is too large.');
  }
  text += decoder.decode();
  const metadata = JSON.parse(text);
  if (
    metadata.provider_name !== 'Spotify' ||
    typeof metadata.title !== 'string' ||
    !metadata.title.trim() ||
    metadata.title.length > 500 ||
    /[\x00-\x1f]/.test(metadata.title)
  )
    throw new Error('Spotify returned incomplete link metadata. Try the title and artist.');
  return metadata.title.trim();
}

/** Private, serial stdio. Mutating commands are never retried automatically. */
export class SpotifyWorker {
  constructor({ root, spawnImpl = spawn }) {
    Object.assign(this, { root, spawnImpl });
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
  }
  start() {
    const folder = path.join(this.root, '.runtime/spotify-bridge');
    if (!existsSync(path.join(folder, 'build.json')))
      throw new Error('Spotify bridge is not installed. Run setup-spotify.cmd.');
    const build = JSON.parse(readFileSync(path.join(folder, 'build.json'), 'utf8'));
    if (!/^[a-f0-9]{16}\/Capri\.Spotify\.exe$/.test(build.artifact ?? ''))
      throw new Error('Invalid Spotify bridge build. Run setup-spotify.cmd.');
    const exe = path.join(folder, build.artifact);
    if (!existsSync(exe)) throw new Error('Spotify bridge is missing. Run setup-spotify.cmd.');
    const hash = spotifySourceHash(this.root);
    if (hash !== build.sourceSha256)
      throw new Error('Spotify bridge needs rebuilding. Run setup-spotify.cmd.');
    if (this.child && this.sourceHash === hash) return;
    if (this.child) this.close();
    const env = Object.fromEntries(
      ['SystemRoot', 'WINDIR', 'PATH', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP']
        .filter((name) => process.env[name])
        .map((name) => [name, process.env[name]]),
    );
    const child = (this.child = this.spawnImpl(exe, [], {
      cwd: this.root,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    this.sourceHash = hash;
    let buffer = '';
    const fail = () => {
      if (this.child !== child) return;
      this.close(
        new Error(
          'Spotify control stopped. The command outcome may be unknown; check playback before retrying.',
        ),
      );
    };
    child.on('error', fail);
    child.on('exit', fail);
    child.stdin.on('error', fail);
    child.stderr.on('data', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 262144) {
        fail();
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          fail();
          return;
        }
        if (event.type === 'ready' && event.protocol === 1) continue;
        if (event.type !== 'result' || typeof event.ok !== 'boolean') {
          fail();
          return;
        }
        const pending = this.pending.get(event.request);
        if (pending) {
          this.pending.delete(event.request);
          clearTimeout(pending.timer);
          pending.resolve(event);
        }
      }
    });
  }
  send(command) {
    this.start();
    if (this.pending.size) throw new Error('Spotify control is busy.');
    const request = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.close(
            new Error(
              'Spotify control timed out. Check the player before retrying; the command will not be repeated automatically.',
            ),
          ),
        25000,
      );
      this.pending.set(request, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...command, request }) + '\n', (error) => {
        if (error) this.close(new Error('Spotify bridge disconnected.'));
      });
    });
  }
  close(error = new Error('Spotify integration closed.')) {
    const child = this.child;
    this.child = null;
    this.sourceHash = null;
    if (child) {
      child.stdin.destroy();
      child.kill();
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
export class SpotifyService {
  constructor(worker, { fetchImpl = fetch } = {}) {
    this.worker = worker;
    this.fetchImpl = fetchImpl;
    this.tail = Promise.resolve();
    this.calls = new Map();
    this.waiting = 0;
  }
  execute(callId, args, signal) {
    const command = validateCommand(args);
    if (typeof callId !== 'string' || !callId || callId.length > 160) invalid();
    if (signal?.aborted)
      return Promise.reject(new Error('Spotify command cancelled before execution.'));
    const fingerprint = JSON.stringify(command);
    if (this.calls.has(callId)) {
      const prior = this.calls.get(callId);
      if (prior.fingerprint !== fingerprint) invalid();
      return prior.task;
    }
    if (this.waiting >= 8) throw new Error('Too many pending Spotify commands.');
    this.waiting++;
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        if (signal?.aborted) throw new Error('Spotify command cancelled before execution.');
        if (command.action === 'play' && command.uri)
          command.resourceTitle = await spotifyLinkTitle(command.uri, {
            fetchImpl: this.fetchImpl,
            signal,
          });
        if (signal?.aborted) throw new Error('Spotify command cancelled before execution.');
        return this.worker.send(command);
      })
      .finally(() => {
        this.waiting--;
      });
    this.tail = task;
    this.calls.set(callId, { fingerprint, task });
    while (this.calls.size > 64) this.calls.delete(this.calls.keys().next().value);
    return task;
  }
  close() {
    this.worker.close();
  }
}
