// SPDX-License-Identifier: GPL-3.0-only
import { normalizeCreditNames, validateEpithet } from '../credits-epithets.mjs';
const TEAM = Object.freeze([
  Object.freeze({ name: 'Overyx', role: 'Developer' }),
  Object.freeze({ name: 'v1rch', role: 'Discord developer' }),
  Object.freeze({ name: 'Leberrr', role: 'Discord moderator' }),
]);
const GITHUB_LOGIN = /^(?!.*--)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const MAX_REGISTRY_LENGTH = 2 * 1024 * 1024;
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

function teamNameLight(name) {
  const wrapper = document.createElement('span');
  wrapper.className = 'credits-team-light';
  wrapper.dir = 'ltr';
  const rays = document.createElement('span');
  rays.className = 'credits-god-rays';
  rays.setAttribute('aria-hidden', 'true');
  // Three small sheets of static glyph projections; only the sheets animate.
  for (const [index, direction] of [
    [-0.8, -0.65],
    [0.8, -0.4],
    [0.12, 0.85],
  ].entries()) {
    const sheet = document.createElement('span');
    sheet.className = 'credits-ray-sheet';
    sheet.dataset.rayTone = String(index);
    for (let step = 1; step <= 10; step++) {
      const progress = step / 10;
      const ray = document.createElement('span');
      ray.className = 'credits-glyph-ray';
      ray.dataset.text = name;
      ray.style.setProperty('--ray-x', `${direction[0] * progress * 42}px`);
      ray.style.setProperty('--ray-y', `${direction[1] * progress * 44}px`);
      ray.style.setProperty('--ray-scale-x', String(1 + progress * 0.55));
      ray.style.setProperty('--ray-scale-y', String(1 + progress * 2.2));
      ray.style.setProperty('--ray-alpha', String(0.13 * (1 - progress * 0.9) ** 1.4));
      sheet.append(ray);
    }
    rays.append(sheet);
  }
  const label = gradientName(name, 'strong');
  label.classList.add('credits-team-name');
  const sheen = document.createElement('span');
  sheen.className = 'credits-glyph-sheen';
  sheen.dataset.text = name;
  sheen.setAttribute('aria-hidden', 'true');
  wrapper.append(rays, label, sheen);
  return wrapper;
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

  const team = TEAM.map((member) => {
    const matches = value.team.filter(
      (entry) => entry && entry.name === member.name && entry.role === member.role,
    );
    if (matches.length !== 1) throw new Error('Invalid Hall of Fame team');
    return { name: member.name, role: member.role };
  });
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
      [...team.map(({ name }) => name), ...supporters, ...majorSupporters, ...communityHelpers].map(
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
    team,
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
        <header class="credits-hero">
          <div class="credits-emblem" aria-hidden="true" data-untranslated>
            <svg viewBox="0 0 52 52" fill="none"><path d="M36 12H20l-9 9v18h25l6-6H21V23l5-5h10" /><path d="M32 25h10v10" /></svg>
          </div>
          <div class="credits-heading-copy">
          <p class="credits-eyebrow" data-untranslated data-inline-help>CAPRI</p>
          <h3>Hall of Fame</h3>
          <p class="credits-hero-description" data-inline-help>The people who bring Capri to life.</p>
          </div>
        </header>

        <section class="credits-section credits-team-section" aria-labelledby="credits-team-title">
          <div class="credits-section-heading"><h3 id="credits-team-title">The team</h3><span class="credits-section-code" aria-hidden="true" data-untranslated>01 / 03</span></div>
          <ul id="credits-team" class="credits-team"></ul>
        </section>

        <section class="credits-section credits-future-section">
          <div class="credits-future-grid">
            <section class="credits-future-card" aria-labelledby="credits-major-title">
              <div class="credits-reserved-icon" aria-hidden="true" data-untranslated>◇</div>
              <h3 id="credits-major-title">Major supporters</h3>
              <ul id="credits-major-supporters" class="credits-reserved-list">
                <li><span>Reserved</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>01</span></li>
                <li><span>Reserved</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>02</span></li>
                <li><span>Reserved</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>03</span></li>
              </ul>
            </section>
            <section class="credits-future-card" aria-labelledby="credits-helpers-title">
              <div class="credits-reserved-icon" aria-hidden="true" data-untranslated>+</div>
              <h3 id="credits-helpers-title">Community helpers</h3>
              <ul id="credits-community-helpers" class="credits-reserved-list">
                <li><span>Pending</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>01</span></li>
                <li><span>Pending</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>02</span></li>
                <li><span>Pending</span><span class="credits-reserved-index" aria-hidden="true" data-untranslated>03</span></li>
              </ul>
            </section>
          </div>
        </section>

        <section class="credits-section credits-supporters-section" aria-labelledby="credits-supporters-title">
          <div class="credits-section-heading"><h3 id="credits-supporters-title">Early access supporters</h3><span class="credits-section-code" aria-hidden="true" data-untranslated>03 / 03</span></div>
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
    this.renderTeam(TEAM);
    this.get('retry').addEventListener('click', () => this.open({ retry: true }));
    this.get('search').addEventListener('input', () => this.filterSupporters());
    this.ui.apply(this.ui.language);
  }

  setVisible(visible) {
    this.nativeVisible = visible;
    this.panel.toggleAttribute('data-page-hidden', !visible || document.hidden);
    if (!visible || document.hidden) this.finishScroll();
  }

  onScroll() {
    if (this.panel.hidden || !this.nativeVisible || document.hidden) return;
    if (!this.scrolling) {
      this.scrolling = true;
      this.panel.setAttribute('data-scrolling', '');
    }
    clearTimeout(this.scrollEndTimer);
    this.scrollEndTimer = setTimeout(() => this.finishScroll(), 140);
  }

  finishScroll() {
    clearTimeout(this.scrollEndTimer);
    this.scrollEndTimer = null;
    this.scrolling = false;
    this.panel.removeAttribute('data-scrolling');
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
  }

  epithet(name) {
    const phrase = this.epithets.get(name.toLowerCase());
    const caption = document.createElement('span');
    caption.className = 'credits-epithet';
    caption.dataset.untranslated = '';
    caption.dir = 'ltr';
    caption.textContent = phrase ?? '';
    caption.hidden = !phrase;
    return caption;
  }

  renderTeam(team) {
    const fragment = document.createDocumentFragment();
    team.forEach((member, index) => {
      const card = document.createElement('li');
      card.className = 'credits-team-card';
      nameStyle(card, member.name);
      card.dataset.tone = String([2, 0, 3][index]);
      const identity = document.createElement('div');
      identity.className = 'credits-team-identity credits-drift';
      const role = document.createElement('span');
      role.className = 'credits-team-role';
      role.textContent = this.ui.text(member.role);
      identity.append(teamNameLight(member.name), this.epithet(member.name), role);
      card.append(identity);
      fragment.append(card);
    });
    this.replaceNames(this.get('team'), fragment);
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
        this.renderTeam(data.team);
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
