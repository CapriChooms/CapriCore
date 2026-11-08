import {
  INITIATIVE_DEFAULTS,
  validateInitiative,
  quietHour,
  initiativeLimit,
} from './initiative-settings.mjs';
const MEDIA_APPS = new Set(['vlc', 'mpv', 'spotify', 'wmplayer', 'mediaplayer']);
const EVENTS = new Set([
  'app.foreground',
  'user.idle',
  'user.return',
  'session.lock',
  'session.unlock',
  'power.suspend',
  'power.resume',
  'session.ending',
]);
export function validateObservation(value, { now = Date.now() } = {}) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.source !== 'windows-events' ||
    !EVENTS.has(value.kind) ||
    typeof value.id !== 'string' ||
    value.id.length > 80 ||
    !Number.isFinite(value.timestamp) ||
    Math.abs(now - value.timestamp) > 30000 ||
    value.confidence !== 1
  )
    throw new Error('Invalid or stale Windows event');
  if (
    value.processName !== undefined &&
    (typeof value.processName !== 'string' ||
      value.processName.length > 80 ||
      /[\x00-\x1f]/.test(value.processName))
  )
    throw new Error('Invalid process name');
  if (
    value.kind === 'app.foreground' &&
    (typeof value.fullscreen !== 'boolean' ||
      !Number.isInteger(value.processId) ||
      value.processId < 0)
  )
    throw new Error('Invalid window event');
  return {
    schemaVersion: 1,
    source: 'windows-events',
    kind: value.kind,
    id: value.id,
    timestamp: value.timestamp,
    confidence: 1,
    ...(value.processName !== undefined ? { processName: value.processName.toLowerCase() } : {}),
    ...(value.kind === 'app.foreground'
      ? { fullscreen: value.fullscreen, processId: value.processId }
      : {}),
  };
}
/** Scheduling is deterministic; observed text never grants actions or bypasses gates. */
export class InitiativePolicy {
  constructor({
    settings = INITIATIVE_DEFAULTS,
    now = () => Date.now(),
    hour = () => new Date().getHours(),
  } = {}) {
    Object.assign(this, { now, hour });
    this.settings = validateInitiative(settings);
    this.foreground = null;
    this.locked = false;
    this.suspended = false;
    this.idle = false;
    this.lastSpoken = 0;
    this.lastAttempt = 0;
    this.recent = [];
    this.seen = new Set();
    this.dismissed = new Set();
    this.recentText = [];
  }
  configure(settings) {
    this.settings = validateInitiative(settings);
  }
  restoreBudget(value) {
    if (!value || value.schemaVersion !== 1) return;
    const now = this.now(),
      validTime = (t) => Number.isFinite(t) && t <= now && t >= now - 3600000;
    this.lastSpoken = validTime(value.lastSpoken) ? value.lastSpoken : 0;
    this.lastAttempt = validTime(value.lastAttempt) ? value.lastAttempt : 0;
    this.recent = Array.isArray(value.recent) ? value.recent.filter(validTime).slice(-30) : [];
    this.recentText = Array.isArray(value.recentText)
      ? value.recentText.filter((t) => typeof t === 'string' && t.length <= 240).slice(-8)
      : [];
    this.dismissed = new Set(
      Array.isArray(value.dismissed)
        ? value.dismissed.filter((c) => ['return', 'media-app'].includes(c))
        : [],
    );
    this.lastCategory = ['return', 'media-app'].includes(value.lastCategory)
      ? value.lastCategory
      : undefined;
  }
  budget() {
    return {
      schemaVersion: 1,
      lastSpoken: this.lastSpoken,
      lastAttempt: this.lastAttempt,
      recent: this.recent.slice(-30),
      recentText: this.recentText.slice(-8),
      dismissed: [...this.dismissed],
      lastCategory: this.lastCategory,
    };
  }
  observe(value) {
    const event = validateObservation(value, { now: this.now() });
    if (this.seen.has(event.id)) return null;
    this.seen.add(event.id);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
    if (event.kind === 'app.foreground') this.foreground = event;
    if (event.kind === 'session.lock') this.locked = true;
    if (event.kind === 'session.unlock') this.locked = false;
    if (event.kind === 'power.suspend') this.suspended = true;
    if (event.kind === 'power.resume') this.suspended = false;
    if (event.kind === 'user.idle') this.idle = true;
    if (event.kind === 'user.return') this.idle = false;
    // Shutdown is observation only. Never start a model or delay Windows exit.
    if (event.kind === 'user.return' && this.settings.returnReactions)
      return { event, category: 'return', expiresAt: event.timestamp + 20000 };
    if (
      event.kind === 'app.foreground' &&
      this.settings.appReactions &&
      MEDIA_APPS.has(event.processName)
    )
      return { event, category: 'media-app', expiresAt: event.timestamp + 15000 };
    return null;
  }
  permitted(candidate, state = {}, { admitted = false } = {}) {
    this.lastReason = this.reason(candidate, state, { admitted });
    return this.lastReason === 'ready';
  }
  reason(candidate, state = {}, { admitted = false } = {}) {
    const now = this.now(),
      s = this.settings;
    for (const [blocked, reason] of [
      [s.level === 'off', 'disabled'],
      [!candidate, 'no_candidate'],
      [candidate?.expiresAt <= now, 'expired'],
      [this.locked, 'locked'],
      [this.suspended, 'suspended'],
      [this.idle, 'user_away'],
      [state.quiet, 'settings_open'],
      [state.busy, 'model_busy'],
      [state.speaking, 'speaking'],
      [state.userSpeech, 'user_speaking'],
      [state.typing, 'typing'],
      [state.offline, 'sleeping_or_offline'],
      [state.hidden, 'hidden'],
      [quietHour(s, this.hour()), 'quiet_hours'],
      [this.dismissed.has(candidate?.category), 'dismissed'],
      [this.foreground?.fullscreen, 'fullscreen'],
      [this.foreground && s.excludedApps.includes(this.foreground.processName), 'excluded_app'],
    ])
      if (blocked) return reason;
    if (candidate.category === 'media-app' && candidate.event.id !== this.foreground?.id)
      return 'stale_event';
    const cooldown = Math.max(60000, 3600000 / initiativeLimit(s));
    this.recent = this.recent.filter((t) => t > now - 3600000);
    if (now - this.lastSpoken < cooldown) return 'cooldown';
    if (!admitted && now - this.lastAttempt < 60000) return 'attempt_cooldown';
    if (this.recent.length >= initiativeLimit(s)) return 'hourly_limit';
    return 'ready';
  }
  attempted() {
    this.lastAttempt = this.now();
  }
  spoken(candidate, text) {
    this.lastSpoken = this.now();
    this.recent.push(this.lastSpoken);
    this.recentText.push(text);
    this.recentText = this.recentText.slice(-8);
    this.lastCategory = candidate.category;
  }
  dismiss(category = this.lastCategory) {
    if (['return', 'media-app'].includes(category)) this.dismissed.add(category);
  }
  restore() {
    this.dismissed.clear();
  }
}
