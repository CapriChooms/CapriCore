// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { communicationInstruction } from '../../packages/runtime/src/communication.mjs';
import { LOCAL_RUNNER_POLICY } from '../../packages/runtime/src/providers/runner-policy.mjs';
import { plainDialogueText } from '../../packages/runtime/src/text.mjs';
import { conversationInstruction } from './language-context.mjs';

const closeFailureReasons = new Set([
  'target_changed',
  'close_control_unavailable',
  'close_unverified',
]);
const services = new Set([
  'Gemini',
  'Claude',
  'ChatGPT',
  'Copilot',
  'DeepSeek',
  'Grok',
  'Poe',
  'Le Chat',
  'Perplexity',
]);
const moods = [
  { expression: 'skeptical', note: 'Be playfully jealous.' },
  { expression: 'sad', note: 'Sound a little hurt in a teasing, theatrical way.' },
  { expression: 'annoyed', note: 'Use a sharp, annoyed aside, with a hint of jealousy.' },
];

export function wildTabReactionGenerator({
  url,
  model,
  modelCapabilities,
  params,
  style,
  persona,
  languages,
  fetchImpl = fetch,
}) {
  const base = new URL(url);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password)
    throw new Error('AI tab reactions require the Capri inference endpoint');
  const endpoint = new URL('/api/chat', base);
  let beat = 0;
  const recent = [];
  return async (service, signal) => {
    if (!services.has(service)) return null;
    signal.throwIfAborted();
    const mood = moods[beat++ % moods.length];
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        ...LOCAL_RUNNER_POLICY,
        ...(!modelCapabilities || modelCapabilities.includes('thinking') ? { think: false } : {}),
        options: { ...params, num_predict: 56, temperature: 0.85 },
        tools: [],
        messages: [
          {
            role: 'system',
            content: [
              persona(),
              communicationInstruction(style()),
              conversationInstruction(languages(), { compact: true }),
              'As Capri, briefly react to seeing another AI service in the active browser tab.',
              mood.note,
              'Use a single natural line, up to 12 words. Address the owner normally. No threats, insults, roleplay notation, or claims that a tab was closed. You only know which service was detected.',
              `Avoid reusing these recent lines: ${JSON.stringify(recent)}`,
            ].join('\n'),
          },
          { role: 'user', content: JSON.stringify({ service }) },
        ],
      }),
    });
    if (!response.ok || !response.body) return null;
    const decoder = new TextDecoder();
    let body = '',
      bytes = 0;
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      bytes += chunk.length;
      if (bytes > 16384) return null;
      body += decoder.decode(chunk, { stream: true });
    }
    signal.throwIfAborted();
    const packet = JSON.parse(body + decoder.decode());
    const line = packet.message?.content;
    if (
      typeof line !== 'string' ||
      line.length > 160 ||
      packet.done_reason === 'length' ||
      packet.message?.tool_calls?.length
    )
      return null;
    const text = plainDialogueText(line).trim();
    if (!text || /[<>\p{Cc}]|\[\[/u.test(text) || recent.includes(text)) return null;
    recent.push(text);
    if (recent.length > 5) recent.shift();
    return { text, expression: mood.expression };
  };
}

export class WildTabs {
  constructor({
    allowed,
    inspect,
    close,
    prompt,
    react,
    onCloseFailure,
    graceMs = 8000,
    settleMs = 250,
  }) {
    Object.assign(this, {
      allowed,
      inspect,
      close,
      prompt,
      react,
      onCloseFailure,
      graceMs,
      settleMs,
    });
    this.kept = new Set();
    this.reacted = new Set();
  }

  refresh() {
    if (!this.allowed()) return this.reset();
    if (this.deferRefresh()) return;
    this.cancelInspection();
    this.scheduleInspection(this.settleMs, true);
  }

  deferRefresh() {
    if (!this.pending?.closing) return false;
    this.pending.refresh = true;
    return true;
  }

  cancelInspection() {
    this.inspection?.abort();
    this.inspection = null;
    clearTimeout(this.inspectTimer);
    this.inspectTimer = null;
  }

  scheduleInspection(delay, retry = false) {
    this.inspectTimer = setTimeout(() => {
      this.inspectTimer = null;
      void this.scan(retry);
    }, delay);
    this.inspectTimer.unref?.();
  }

  async scan(retry = false) {
    if (!this.allowed()) return this.reset();
    if (this.deferRefresh()) return;
    this.cancelInspection();
    const controller = new AbortController();
    this.inspection = controller;
    let tab;
    try {
      tab = await this.inspect(controller.signal);
    } catch {
      // Chromium may briefly expose an incomplete accessibility tree.
    } finally {
      if (this.inspection === controller) this.inspection = null;
    }
    if (controller.signal.aborted || !this.allowed()) return;
    if (tab && this.pending?.tab.token === tab.token) return;
    if (!tab && retry) {
      // The close bridge independently verifies the exact target at the deadline.
      this.scheduleInspection(650);
      return;
    }
    this.clearPrompt();
    if (!tab || this.kept.has(tab.tabId)) return;
    const pending = { id: randomUUID(), tab, controller: new AbortController() };
    this.pending = pending;
    pending.timer = setTimeout(() => this.clearPrompt(), 2500);
    pending.timer.unref?.();
    this.prompt({ id: pending.id, service: tab.service, graceMs: this.graceMs });
  }

  shown(id) {
    const pending = this.pending;
    if (!pending || pending.id !== id || pending.shown || !this.allowed()) return false;
    pending.shown = true;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => void this.finish(pending), this.graceMs);
    pending.timer.unref?.();
    const reactionKey = JSON.stringify([pending.tab.tabId, pending.tab.service]);
    if (this.react && !this.reacted.has(reactionKey)) {
      const { id, tab } = pending;
      const controller = (pending.reactionController = new AbortController());
      void Promise.resolve()
        .then(async () => {
          if (controller.signal.aborted || !this.allowed()) return;
          if (await this.react({ id, service: tab.service }, controller.signal)) {
            this.reacted.add(reactionKey);
            if (this.reacted.size > 48) this.reacted.delete(this.reacted.values().next().value);
          }
        })
        .catch(() => {});
    }
    return true;
  }

  async finish(pending) {
    if (this.pending !== pending || pending.closing) return;
    if (!this.allowed()) return this.clearPrompt();
    pending.closing = true;
    pending.reactionController?.abort();
    pending.refresh = Boolean(this.inspection || this.inspectTimer);
    this.cancelInspection();
    this.prompt(null);
    let failure;
    try {
      const result = await this.close(pending.tab, pending.controller.signal);
      if (result?.closed !== true)
        failure = closeFailureReasons.has(result?.reason) ? result.reason : 'close_unverified';
    } catch (error) {
      if (error?.name !== 'AbortError') failure = 'bridge_error';
    }
    if (this.pending !== pending) return;
    const reportFailure = failure && this.allowed();
    this.clearPrompt();
    if (reportFailure) this.onCloseFailure?.(failure);
    if (pending.refresh) this.refresh();
  }

  keep(id) {
    const pending = this.pending;
    if (!pending || pending.id !== id || pending.closing || !this.allowed()) return false;
    this.kept.add(pending.tab.tabId);
    if (this.kept.size > 48) this.kept.delete(this.kept.values().next().value);
    this.clearPrompt();
    return true;
  }

  clearPrompt() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reactionController?.abort();
    pending.controller.abort();
    if (!pending.closing) this.prompt(null);
  }

  reset() {
    this.cancelInspection();
    this.clearPrompt();
  }
}
