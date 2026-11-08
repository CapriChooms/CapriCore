import { initiativeLimit } from './initiative-settings.mjs';
import { randomUUID } from 'node:crypto';
import { InitiativePolicy } from './initiative-policy.mjs';
import { plainDialogueText } from '../../packages/runtime/src/text.mjs';

export class InitiativeService {
  constructor({
    settings,
    state,
    generate,
    commit,
    deliver,
    onError = () => {},
    persist = () => {},
    budget,
    now = () => Date.now(),
    hour,
    settleMs = 1500,
    onStatus = () => {},
    random = Math.random,
  }) {
    Object.assign(this, { state, generate, commit, deliver, onError, persist, now, settleMs });
    this.policy = new InitiativePolicy({ settings, now, ...(hour ? { hour } : {}) });
    this.policy.restoreBudget(budget);
    this.typingUntil = 0;
    Object.assign(this, { onStatus, random });
    this.history = [];
    this.reschedule(true);
    this.scheduler = setInterval(() => this.tick(), 15000);
    this.scheduler.unref?.();
  }
  reschedule(first = false) {
    const minimum =
      first && !this.policy.lastSpoken ? 45000 : 3600000 / initiativeLimit(this.policy.settings);
    this.nextAt = this.now() + minimum * (1 + this.random() * 0.2);
  }
  snapshot() {
    return {
      reason: this.lastReason ?? 'waiting',
      nextAt: this.nextAt,
      history: this.history.slice(-12),
    };
  }
  report(reason) {
    if (reason !== this.lastReason || ['delivered', 'generation_failed'].includes(reason)) {
      this.history.push({ at: this.now(), reason });
      if (this.history.length > 60) this.history.shift();
    }
    this.lastReason = reason;
    this.onStatus(this.snapshot());
  }
  tick(force = false) {
    if ((!this.policy.settings.spontaneous && !force) || this.active || this.timer) return;
    const candidate = {
      category: 'spontaneous',
      expiresAt: this.now() + 60000,
      event: { kind: 'conversation.idle', source: 'local-scheduler', timestamp: this.now() },
      preview: force,
    };
    const reason = this.policy.reason(candidate, this.candidateState(candidate));
    this.report(reason === 'ready' && !force && this.now() < this.nextAt ? 'waiting' : reason);
    if (reason !== 'ready' || (!force && this.now() < this.nextAt)) return;
    this.reschedule();
    void this.run(candidate);
  }
  configure(settings) {
    if (JSON.stringify(settings) === JSON.stringify(this.policy.settings)) return;
    this.cancel();
    const wasOff = this.policy.settings.level === 'off';
    this.policy.configure(settings);
    this.reschedule(wasOff);
  }
  activity({ quietMs = 3000 } = {}) {
    this.typingUntil = Math.max(this.typingUntil, this.now() + quietMs);
    this.cancel();
    // A microphone VAD tick or keystroke must not repeatedly move a three-minute
    // deadline into the future. Activity gates delivery; it does not erase it.
  }
  currentState() {
    const state = this.state();
    return { ...state, typing: Boolean(state.typing) || this.now() < this.typingUntil };
  }
  candidateState(candidate) {
    const state = this.currentState();
    return candidate?.preview
      ? { ...state, quiet: false, typing: Boolean(this.state().typing) }
      : state;
  }
  observe(event) {
    const candidate = this.policy.observe(event);
    if (!candidate) {
      if (
        this.active &&
        !this.policy.permitted(this.active.candidate, this.candidateState(this.active.candidate), {
          admitted: true,
        })
      )
        this.cancel();
      return;
    }
    const reason = this.policy.reason(candidate, this.candidateState(candidate));
    this.report(reason);
    if (reason !== 'ready' || this.active) return;
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(candidate);
    }, this.settleMs);
  }
  async run(candidate) {
    if (!this.policy.permitted(candidate, this.candidateState(candidate)) || this.active) return;
    this.policy.attempted();
    this.saveBudget();
    const controller = new AbortController(),
      id = randomUUID();
    this.active = { controller, id, candidate };
    this.report('preparing_comment');
    const timeout = setTimeout(
      () => controller.abort(new Error('The observation expired')),
      Math.max(1, candidate.expiresAt - this.now()),
    );
    const deliverable = () =>
      !controller.signal.aborted &&
      this.active?.id === id &&
      this.policy.permitted(candidate, this.candidateState(candidate), { admitted: true });
    try {
      const response = await this.generate(candidate, {
        signal: controller.signal,
        recent: this.policy.recentText,
        level: this.policy.settings.level,
      });
      if (!deliverable()) {
        this.report(controller.signal.aborted ? 'generation_timeout' : this.policy.lastReason);
        return;
      }
      if (response?.speak !== true) {
        if (this.policy.settings.level === 'conversational' && (this.silentAttempts ?? 0) < 2) {
          this.silentAttempts = (this.silentAttempts ?? 0) + 1;
          this.nextAt = this.now() + 60000 * (1 + this.random() * 0.5);
        } else this.silentAttempts = 0;
        this.report('model_chose_silence');
        return;
      }
      const text = plainDialogueText(response.text ?? '').trim();
      if (
        !text ||
        text.length > 240 ||
        text.split(/\s+/).length > 35 ||
        this.policy.recentText.some((previous) => previous.toLowerCase() === text.toLowerCase())
      )
        return;
      const message = {
        id: randomUUID(),
        turnId: id,
        role: 'assistant',
        status: 'complete',
        text,
        createdAt: new Date(this.now()).toISOString(),
        origin: {
          kind: 'initiative',
          category: candidate.category,
          source: candidate.event.source,
          observedAt: candidate.event.timestamp,
        },
        ...(response.avatar ? { avatar: response.avatar } : {}),
      };
      if (!deliverable()) return;
      await this.commit(message, candidate, { signal: controller.signal });
      if (!deliverable()) return;
      this.policy.spoken(candidate, text);
      this.silentAttempts = 0;
      this.saveBudget();
      this.deliver(message, candidate);
      this.report('delivered');
    } catch (error) {
      this.report(
        controller.signal.aborted ? 'generation_cancelled_or_expired' : 'generation_failed',
      );
      if (!controller.signal.aborted) this.onError('An optional comment was skipped.');
    } finally {
      clearTimeout(timeout);
      if (this.active?.id === id) this.active = null;
    }
  }
  saveBudget() {
    try {
      this.persist(this.policy.budget());
    } catch {
      this.onError('Optional comment preferences could not be saved.');
    }
  }
  dismiss() {
    this.cancel();
    this.policy.dismiss();
    this.saveBudget();
  }
  restore() {
    this.policy.restore();
    this.saveBudget();
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.active?.controller.abort();
    this.active = null;
  }
  close() {
    clearInterval(this.scheduler);
    this.cancel();
  }
}
