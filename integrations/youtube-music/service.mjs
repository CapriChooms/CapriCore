// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareNativeHelper } from '../../apps/desktop/native-helper.mjs';

const home = 'https://music.youtube.com/';
const windowBinding = /^\d{1,14}:\d{1,10}:\d{16,20}:-?\d+(?:,-?\d+){0,20}$/;
const navigationActions = new Set(['open', 'search', 'play']);
const browserLaunchGraceMs = 4_000;
const actions = new Set([
  'open',
  'search',
  'play',
  'start',
  'pause',
  'resume',
  'next',
  'previous',
  'volume',
  'status',
]);
const receipts = new Set([
  'ready',
  'opened',
  'tab_not_found',
  'ambiguous_tab',
  'search_opened',
  'playing',
  'resumed',
  'paused',
  'skipped',
  'previous',
  'volume_set',
  'player_unavailable',
  'no_results',
  'playback_unverified',
  'control_unavailable',
  'control_unverified',
]);

export function validateYouTubeMusicCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !actions.has(input.action))
    throw new Error('Invalid YouTube Music command.');
  const { action, query, value, delta } = input;
  const allowed =
    action === 'search' || action === 'play'
      ? ['query']
      : action === 'volume'
        ? ['value', 'delta']
        : [];
  if (Object.keys(input).some((key) => key !== 'action' && !allowed.includes(key)))
    throw new Error('Unexpected YouTube Music command argument.');
  if (allowed.includes('query')) {
    if (
      typeof query !== 'string' ||
      !query.trim() ||
      query.length > 180 ||
      /[\x00-\x1f\x7f]/.test(query)
    )
      throw new Error('Enter a YouTube Music search query of up to 180 characters.');
    return { action, query: query.trim() };
  }
  if (action === 'volume') {
    if (delta === undefined && Number.isFinite(value) && value >= 0 && value <= 100)
      return { action, value };
    if (value === undefined && Number.isFinite(delta) && delta >= -100 && delta <= 100)
      return { action, delta };
    throw new Error('Use one YouTube Music volume percentage or relative change.');
  }
  return { action };
}

function searchUrl(query) {
  const url = new URL('search', home);
  url.searchParams.set('q', query);
  return url.href;
}

function nativeCommand(executable, command, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(executable, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      signal,
      timeout: ['play', 'start', 'search'].includes(command.action) ? 20000 : 8000,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length <= 8192) return;
      child.kill();
      reject(new Error('Invalid YouTube Music helper output.'));
    });
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error('YouTube Music helper could not finish.'));
      try {
        const result = JSON.parse(output);
        if (typeof result?.ok !== 'boolean' || !receipts.has(result.status))
          throw new Error('Invalid YouTube Music receipt.');
        const track =
          typeof result.track === 'string'
            ? result.track
                .replace(/[\x00-\x1f\x7f]/g, ' ')
                .trim()
                .slice(0, 180)
            : '';
        resolve({
          ok: result.ok,
          status: result.status,
          ...(track ? { track } : {}),
          ...(typeof result.playing === 'boolean' ? { playing: result.playing } : {}),
          ...(typeof result.binding === 'string' &&
          result.binding.length <= 200 &&
          windowBinding.test(result.binding)
            ? { binding: result.binding }
            : {}),
          ...(Number.isFinite(result.volume) && result.volume >= 0 && result.volume <= 100
            ? { volume: result.volume }
            : {}),
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(command) + '\n');
  });
}

/** Control the signed-in browser player using its validated Windows accessibility surface. */
export class YouTubeMusicService {
  constructor({
    root,
    openExternal,
    platform = process.platform,
    prepare = prepareNativeHelper,
    run = nativeCommand,
  }) {
    Object.assign(this, { root, openExternal, platform, prepare, run });
    this.lifetime = new AbortController();
    this.tail = Promise.resolve();
    this.calls = new Map();
    this.waiting = 0;
    this.browserLaunchPendingUntil = 0;
  }

  execute(callId, input, signal) {
    const command = validateYouTubeMusicCommand(input);
    if (typeof callId !== 'string' || !callId || callId.length > 160)
      throw new Error('Invalid YouTube Music operation ID.');
    const running = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    if (running.aborted) return Promise.reject(running.reason);
    const fingerprint = JSON.stringify(command);
    const existing = this.calls.get(callId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error('Invalid YouTube Music operation ID.');
      return existing.task;
    }
    if (this.waiting >= 8) throw new Error('Too many pending YouTube Music commands.');
    this.waiting++;
    const task = this.tail
      .catch(() => {})
      .then(() => this.perform(command, running))
      .finally(() => this.waiting--);
    this.tail = task;
    this.calls.set(callId, { fingerprint, task });
    while (this.calls.size > 64) this.calls.delete(this.calls.keys().next().value);
    return task;
  }

  async perform(command, signal) {
    signal.throwIfAborted();
    if (this.platform !== 'win32') return { ok: false, status: 'unsupported' };
    const { action, query } = command;
    const mayNavigate = navigationActions.has(action);
    let helper;
    try {
      helper = await this.prepare(this.root, 'youtube-music', [
        'WPF/UIAutomationClient.dll',
        'WPF/UIAutomationTypes.dll',
        'WPF/WindowsBase.dll',
        'System.Web.dll',
      ]);
    } catch {
      signal.throwIfAborted();
      return { ok: false, status: 'helper_unavailable' };
    }
    signal.throwIfAborted();
    try {
      const previous = this.binding;
      let result = await this.run(
        helper,
        previous ? { ...command, binding: previous } : command,
        signal,
      );
      if (previous && result.status === 'tab_not_found') {
        this.binding = undefined;
        // A lost binding is reported before the helper changes a document.
        // Transport controls still belong to the tab where playback was established.
        if (action === 'status' || mayNavigate) result = await this.run(helper, command, signal);
      }
      // The browser can accept the previous launch before its tab is visible to UI Automation.
      let remaining = this.browserLaunchPendingUntil - performance.now();
      while (mayNavigate && result.status === 'tab_not_found' && remaining > 0) {
        await delay(Math.min(250, remaining), undefined, { signal });
        result = await this.run(helper, command, signal);
        remaining = this.browserLaunchPendingUntil - performance.now();
      }
      if (mayNavigate && result.status === 'tab_not_found') {
        signal.throwIfAborted();
        try {
          await this.openExternal(query ? searchUrl(query) : home);
        } catch {
          signal.throwIfAborted();
          return { ok: false, status: 'browser_open_failed' };
        }
        this.browserLaunchPendingUntil = performance.now() + browserLaunchGraceMs;
        signal.throwIfAborted();
        if (action !== 'play')
          return { ok: true, status: action === 'open' ? 'opened' : 'search_opened' };
        result = await this.run(helper, { ...command, waitForSearch: true }, signal);
      }
      const { binding, ...details } = result;
      // Keep follow-up controls with the exact browser document that was verified.
      if (details.ok && binding) {
        this.binding = binding;
        this.browserLaunchPendingUntil = 0;
      }
      return details;
    } catch {
      signal.throwIfAborted();
      if (action === 'play' || action === 'start')
        return { ok: false, status: 'playback_unverified' };
      return {
        ok: false,
        status: action === 'status' ? 'helper_unavailable' : 'control_unverified',
      };
    }
  }

  close() {
    this.lifetime.abort();
  }
}
