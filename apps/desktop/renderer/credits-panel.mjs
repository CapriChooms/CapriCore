// SPDX-License-Identifier: GPL-3.0-only
import { normalizeCreditNames, validateEpithet } from '../credits-epithets.mjs';
import { createCreditsRays } from './credits-rays.mjs';
const TEAM = Object.freeze([
  Object.freeze({ name: 'Overyx', role: 'Developer' }),
  Object.freeze({ name: 'v1rch', role: 'Discord developer' }),
  Object.freeze({ name: 'Leberrr', role: 'Discord moderator' }),
]);
const GITHUB_LOGIN = /^(?!.*--)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const MAX_REGISTRY_LENGTH = 2 * 1024 * 1024;
const rayFrameInterval = 32;
// One stable palette/phase per nickname, with no per-name timers.
function nameStyle(element, name) {
  let hash = 2166136261;
  for (const char of name.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash >>>= 0;
  element.classList.add('credits-floating-item');
  element.dataset.tone = String(hash % 6);
  element.style.setProperty('--credits-drift-time', `${5 + (hash % 31) / 10}s`);
  element.style.setProperty('--credits-drift-delay', `${-(hash % 53) / 10}s`);
  element.style.setProperty('--credits-drift-rise', `${2 + (hash % 5) / 2}px`);
  element.style.setProperty('--credits-gradient-time', `${8 + (hash % 31) / 10}s`);
}
function gradientName(name, tag = 'span') {
  const label = document.createElement(tag);
  label.className = 'credits-name-gradient';
  label.dataset.untranslated = '';
  label.dir = 'ltr';
  label.textContent = name;
  return label;
}

function registryData(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.team) ||
    value.team.length !== TEAM.length ||
    !Array.isArray(value.supporters) ||
    value.supporters.length > 50000
  )
    throw new Error('Invalid Hall of Fame registry');

  for (const member of TEAM) {
    const matches = value.team.filter(
      (entry) => entry && entry.name === member.name && entry.role === member.role,
    );
    if (matches.length !== 1) throw new Error('Invalid Hall of Fame team');
  }
  const majorSupporters = normalizeCreditNames(value.majorSupporters);
  const communityHelpers = normalizeCreditNames(value.communityHelpers);
  const seen = new Set();
  const supporters = [];
  for (const entry of value.supporters) {
    if (typeof entry !== 'string') throw new Error('Invalid supporter nickname');
    const name = entry.trim();
    if (!GITHUB_LOGIN.test(name)) throw new Error('Invalid supporter nickname');
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    supporters.push(name);
  }
  const epithets = new Map();
  if (value.epithets !== undefined) {
    if (!value.epithets || typeof value.epithets !== 'object' || Array.isArray(value.epithets))
      throw new Error('Invalid Hall of Fame epithets');
    const names = new Set(
      [...TEAM.map(({ name }) => name), ...supporters, ...majorSupporters, ...communityHelpers].map(
        (name) => name.toLowerCase(),
      ),
    );
    const used = new Set();
    for (const [name, phrase] of Object.entries(value.epithets)) {
      if (
        !names.has(name) ||
        name !== name.toLowerCase() ||
        !validateEpithet(phrase) ||
        used.has(phrase)
      )
        throw new Error('Invalid Hall of Fame epithet');
      epithets.set(name, phrase);
      used.add(phrase);
    }
    if (epithets.size !== names.size) throw new Error('Incomplete Hall of Fame epithets');
  }
  return {
    supporters,
    epithets,
    majorSupporters,
    communityHelpers,
  };
}

export class CreditsPanel {
  constructor({ ui }) {
    this.ui = ui;
    this.loaded = false;
    this.loadPromise = null;
    this.supporters = [];
    this.epithets = new Map();
    this.motionState = new WeakMap();
    this.teamNames = [];
    this.rayElapsed = 0;
    this.rayStartedAt = null;
    this.rayFrame = null;
    this.animateTeamRays = this.animateTeamRays.bind(this);
    this.rayMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.rayColors = matchMedia('(forced-colors: active)');
    this.rayMotion.addEventListener('change', () => this.syncTeamRays());
    this.rayColors.addEventListener('change', () => this.paintTeamRays());
    this.rayResize = new ResizeObserver(() => this.paintTeamRays());
    this.panel = document.createElement('section');
    this.panel.id = 'credits-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.dataset.panelCut = '12';
    this.panel.dataset.hitRegion = '';
    this.panel.setAttribute('aria-labelledby', 'credits-title');
    this.panel.innerHTML = `
      <h2 id="credits-title">Credits</h2>
      <div class="preferences-content credits-content">
        <header class="settings-card credits-hero">
          <div class="credits-emblem" aria-hidden="true" data-untranslated>
            <svg viewBox="0 0 52 52" fill="none"><path d="M36 12H20l-9 9v18h25l6-6H21V23l5-5h10" /><path d="M32 25h10v10" /></svg>
          </div>
          <div class="credits-heading-copy">
          <h3>Hall of Fame</h3>
          <p class="credits-hero-description" data-inline-help>The people who bring Capri to life.</p>
          </div>
        </header>

        <section class="settings-card credits-team-section" aria-labelledby="credits-team-title">
          <h3 id="credits-team-title">The team</h3>
          <ul id="credits-team" class="credits-team"></ul>
        </section>

        <div class="credits-future-grid">
            <section class="settings-card credits-future-card" aria-labelledby="credits-major-title">
              <div class="credits-reserved-icon" aria-hidden="true" data-untranslated>◇</div>
              <h3 id="credits-major-title">Major supporters</h3>
              <ul id="credits-major-supporters" class="credits-reserved-list">
                <li><span>Reserved</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>01</span></li>
                <li><span>Reserved</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>02</span></li>
                <li><span>Reserved</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>03</span></li>
              </ul>
            </section>
            <section class="settings-card credits-future-card" aria-labelledby="credits-helpers-title">
              <div class="credits-reserved-icon" aria-hidden="true" data-untranslated>+</div>
              <h3 id="credits-helpers-title">Community helpers</h3>
              <ul id="credits-community-helpers" class="credits-reserved-list">
                <li><span>Pending</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>01</span></li>
                <li><span>Pending</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>02</span></li>
                <li><span>Pending</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>03</span></li>
              </ul>
            </section>
        </div>

        <section class="settings-card credits-supporters-section" aria-labelledby="credits-supporters-title">
          <h3 id="credits-supporters-title">Early access supporters</h3>
          <div class="credits-roster-toolbar">
            <div class="credits-count"><strong id="credits-count" data-untranslated>—</strong><span>Supporters</span></div>
            <div id="credits-search-field" class="credits-search-field" hidden>
              <label for="credits-search">Find a nickname</label>
              <input id="credits-search" type="search" maxlength="39" autocomplete="off" spellcheck="false" aria-controls="credits-supporters">
            </div>
          </div>
          <div id="credits-list-state" class="credits-list-state" role="status" aria-live="polite" aria-atomic="true">
            <span class="credits-state-light" aria-hidden="true" data-untranslated></span>
            <p id="credits-status" data-inline-help>Loading supporter list…</p>
          </div>
          <button id="credits-retry" class="credits-retry" type="button" hidden>Try again</button>
          <p id="credits-no-matches" class="credits-no-matches" role="status" aria-live="polite" hidden data-inline-help>No matching nicknames.</p>
          <ul id="credits-supporters" class="credits-supporters" hidden></ul>
        </section>
      </div>`;
    document.getElementById('settings-forms').append(this.panel);
    this.get = (id) => this.panel.querySelector('#credits-' + id);
    const root = document.getElementById('companion');
    this.motionObserver =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => this.updateMotion(entries), {
            root,
            rootMargin: '80px 0px',
          })
        : null;
    this.nativeVisible = true;
    const visibility = () => this.setVisible(this.nativeVisible);
    document.addEventListener('visibilitychange', visibility);
    root?.addEventListener('scroll', () => this.onScroll(), { passive: true });
    root?.addEventListener('scrollend', () => this.finishScroll(), { passive: true });
    visibility();
    this.renderTeam();
    this.get('retry').addEventListener('click', () => this.open({ retry: true }));
    this.get('search').addEventListener('input', () => this.filterSupporters());
    this.ui.apply(this.ui.language);
  }

  setVisible(visible) {
    this.nativeVisible = visible;
    this.panel.toggleAttribute('data-page-hidden', !visible || document.hidden);
    if (!visible || document.hidden) this.finishScroll();
    else this.syncTeamRays();
  }

  onScroll() {
    if (this.panel.hidden || !this.nativeVisible || document.hidden) return;
    if (!this.scrolling) {
      this.scrolling = true;
      this.panel.setAttribute('data-scrolling', '');
      this.syncTeamRays();
    }
    clearTimeout(this.scrollEndTimer);
    this.scrollEndTimer = setTimeout(() => this.finishScroll(), 140);
  }

  finishScroll() {
    clearTimeout(this.scrollEndTimer);
    this.scrollEndTimer = null;
    this.scrolling = false;
    this.panel.removeAttribute('data-scrolling');
    this.syncTeamRays();
  }

  updateMotion(entries) {
    // Read animation clocks before changing styles. Only entering/leaving names
    // are visited; scrolling never loops over the full roster or measures layout.
    const latest = new Map(entries.map((entry) => [entry.target, entry]));
    const updates = [...latest.values()].map(({ target, isIntersecting }) => {
      const state = this.motionState.get(target);
      const visible = target.hasAttribute('data-in-view');
      if (!isIntersecting && visible && state) {
        const animation = state.drift
          .getAnimations()
          .find((value) => value.animationName === 'credits-drift');
        if (typeof animation?.currentTime === 'number' && Number.isFinite(animation.currentTime))
          state.elapsed += Math.max(0, animation.currentTime);
      }
      return { target, isIntersecting, visible, state };
    });
    for (const { target, isIntersecting, visible, state } of updates) {
      if (isIntersecting && !visible && state)
        target.style.setProperty('--credits-drift-delay', `${state.delay - state.elapsed / 1000}s`);
      target.toggleAttribute('data-in-view', isIntersecting);
    }
    if (updates.some(({ target }) => target.classList.contains('credits-team-card')))
      this.syncTeamRays();
  }

  epithet(name, caption = document.createElement('span')) {
    const phrase = this.epithets.get(name.toLowerCase());
    caption.className = 'credits-epithet';
    caption.dataset.untranslated = '';
    caption.dir = 'ltr';
    caption.textContent = phrase ?? '';
    caption.hidden = !phrase;
    return caption;
  }

  renderTeam() {
    const fragment = document.createDocumentFragment();
    TEAM.forEach((member, index) => {
      const card = document.createElement('li');
      card.className = 'credits-team-card';
      nameStyle(card, member.name);
      card.dataset.tone = String([2, 0, 3][index]);
      const identity = document.createElement('div');
      identity.className = 'credits-team-identity credits-drift';
      const role = document.createElement('span');
      role.className = 'credits-team-role';
      role.textContent = this.ui.text(member.role);
      const label = gradientName(member.name, 'strong');
      label.classList.add('credits-team-name');
      const wrapper = document.createElement('span');
      wrapper.className = 'credits-team-light';
      wrapper.dir = 'ltr';
      const rays = createCreditsRays(label);
      wrapper.append(rays.element, label);
      const caption = this.epithet(member.name);
      this.teamNames.push({ name: member.name, card, rays, caption });
      identity.append(wrapper, caption, role);
      card.append(identity);
      fragment.append(card);
    });
    this.replaceNames(this.get('team'), fragment);
    for (const { rays } of this.teamNames) this.rayResize.observe(rays.element);
  }

  paintTeamRays() {
    if (this.canShowTeamRays()) {
      const elapsed = this.teamRayTime(performance.now());
      for (const { rays } of this.teamNames) {
        rays.measure();
        rays.paint(elapsed);
      }
    }
    this.syncTeamRays();
  }

  canShowTeamRays() {
    return (
      !this.panel.hidden && !this.panel.hasAttribute('data-page-hidden') && !this.rayColors.matches
    );
  }

  canAnimateTeamRays() {
    return (
      this.canShowTeamRays() &&
      !this.scrolling &&
      !this.rayMotion.matches &&
      this.teamNames.some(({ card }) => !this.motionObserver || card.hasAttribute('data-in-view'))
    );
  }

  teamRayTime(now) {
    return (
      this.rayElapsed + (this.rayStartedAt === null ? 0 : Math.max(0, now - this.rayStartedAt))
    );
  }

  syncTeamRays() {
    if (this.canAnimateTeamRays()) {
      if (this.rayStartedAt !== null) return;
      this.rayStartedAt = performance.now();
      this.rayLastPaint = -Infinity;
      this.rayFrame = requestAnimationFrame(this.animateTeamRays);
    } else if (this.rayStartedAt !== null) {
      this.rayElapsed = this.teamRayTime(performance.now());
      this.rayStartedAt = null;
      cancelAnimationFrame(this.rayFrame);
      this.rayFrame = null;
    }
  }

  animateTeamRays(now) {
    if (!this.canAnimateTeamRays()) {
      this.syncTeamRays();
      return;
    }
    if (now - this.rayLastPaint >= rayFrameInterval) {
      this.rayLastPaint = now;
      const elapsed = this.teamRayTime(now);
      for (const { card, rays } of this.teamNames)
        if (!this.motionObserver || card.hasAttribute('data-in-view')) rays.paint(elapsed);
    }
    this.rayFrame = requestAnimationFrame(this.animateTeamRays);
  }

  replaceNames(parent, fragment) {
    for (const old of parent.querySelectorAll('.credits-floating-item'))
      this.motionObserver?.unobserve(old);
    parent.replaceChildren(fragment);
    for (const item of parent.querySelectorAll('.credits-floating-item')) {
      this.motionState.set(item, {
        drift: item.querySelector('.credits-drift'),
        delay: Number.parseFloat(item.style.getPropertyValue('--credits-drift-delay')) || 0,
        elapsed: 0,
      });
      this.motionObserver?.observe(item);
    }
  }

  renderSupporters(names) {
    const fragment = document.createDocumentFragment();
    this.supporters = names.map((name) => {
      const card = document.createElement('li');
      card.className = 'credits-supporter';
      card.dataset.untranslated = '';
      card.dir = 'ltr';
      nameStyle(card, name);
      const drift = document.createElement('span');
      drift.className = 'credits-drift';
      drift.append(gradientName(name), this.epithet(name));
      card.append(drift);
      fragment.append(card);
      return {
        key: name.toLowerCase(),
        epithet: this.epithets.get(name.toLowerCase())?.toLowerCase() ?? '',
        card,
      };
    });
    this.replaceNames(this.get('supporters'), fragment);
    this.get('count').textContent = String(names.length);
    this.get('search-field').hidden = names.length === 0;
    this.filterSupporters();
  }

  renderAcknowledgements(id, names) {
    const list = this.get(id);
    list.className = 'credits-featured-list';
    const fragment = document.createDocumentFragment();
    for (const name of names) {
      const item = document.createElement('li');
      item.className = 'credits-featured-name';
      item.dataset.untranslated = '';
      item.dir = 'ltr';
      nameStyle(item, name);
      const drift = document.createElement('span');
      drift.className = 'credits-drift';
      drift.append(gradientName(name), this.epithet(name));
      item.append(drift);
      fragment.append(item);
    }
    this.replaceNames(list, fragment);
  }

  filterSupporters() {
    const query = this.get('search').value.trim().toLowerCase();
    let matches = 0;
    for (const { key, epithet, card } of this.supporters) {
      card.hidden = !key.includes(query) && !epithet.includes(query);
      if (!card.hidden) matches++;
    }
    this.get('supporters').hidden = matches === 0;
    this.get('no-matches').hidden = this.supporters.length === 0 || matches > 0;
  }

  showState(message, { busy = false, retry = false } = {}) {
    this.get('status').textContent = this.ui.text(message);
    this.get('list-state').hidden = !message;
    this.get('list-state').dataset.state = busy ? 'loading' : retry ? 'unavailable' : 'ready';
    this.get('retry').hidden = !retry;
    this.get('retry').disabled = busy;
    this.get('search').disabled = busy;
    this.get('supporters').setAttribute('aria-busy', String(busy));
  }

  async open({ retry = false } = {}) {
    if (this.loadPromise) return this.loadPromise;
    if (this.loaded && !retry) return;
    this.showState('Loading supporter list…', { busy: true });
    this.loadPromise = (async () => {
      try {
        const response = await fetch('hall-of-fame.json', { credentials: 'omit' });
        if (!response.ok) throw new Error('Hall of Fame registry unavailable');
        const source = await response.text();
        if (source.length > MAX_REGISTRY_LENGTH) throw new Error('Hall of Fame registry too large');
        const data = registryData(JSON.parse(source));
        this.epithets = data.epithets;
        for (const { name, caption } of this.teamNames) this.epithet(name, caption);
        this.renderAcknowledgements('major-supporters', data.majorSupporters);
        this.renderAcknowledgements('community-helpers', data.communityHelpers);
        this.renderSupporters(data.supporters);
        this.loaded = true;
        this.showState(data.supporters.length ? '' : 'No supporters have been listed yet.', {
          retry: data.supporters.length === 0,
        });
      } catch {
        this.showState('The supporter list could not be loaded.', { retry: true });
      } finally {
        this.ui.apply(this.ui.language);
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }
}
