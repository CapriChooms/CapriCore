// SPDX-License-Identifier: GPL-3.0-only
import { guideContent } from './guide-content.mjs';

const byId = (id) => document.getElementById(id);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const entranceEase = 'cubic-bezier(.22, 1, .36, 1)';
const beginnerGuideKey = 'capri.guide.beginner.v1';

function guideFlag(storage) {
  try {
    return globalThis[storage].getItem(beginnerGuideKey) === '1';
  } catch {
    return false;
  }
}

function setGuideFlag(storage) {
  try {
    globalThis[storage].setItem(beginnerGuideKey, '1');
  } catch {
    // A restricted profile can still show and use the guide.
  }
}

const foldSearch = (text, locale) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase(locale)
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replaceAll('ё', 'е');

function setBox(element, left, top, width, height) {
  for (const [name, value] of Object.entries({ left, top, width, height })) {
    const pixels = Math.round(value) + 'px';
    if (element.style[name] !== pixels) element.style[name] = pixels;
  }
}

function visibleTarget(selectors) {
  for (const selector of selectors.filter(Boolean).flatMap((value) => value.split(', '))) {
    const element = document.querySelector(selector);
    if (element?.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      const inViewport = left < innerWidth && top < innerHeight && right > 0 && bottom > 0;
      if (width > 0 && height > 0 && (inViewport || element.closest('#inference-picker')))
        return element;
    }
  }
  return null;
}

/** Only the guide's controls are interactive while it presents the real interface. */
export class GuideOverlay {
  constructor({ language, faq, onActive, onPanel, openSettings, openLink, blocked }) {
    Object.assign(this, { language, faq, onActive, onPanel, openSettings, openLink, blocked });
    this.root = byId('capri-guide');
    this.opener = byId('guide-open');
    this.companion = byId('companion');
    this.dialog = this.root.querySelector('.guide-dialog');
    this.masks = this.root.querySelectorAll('.guide-mask');
    this.spotlight = byId('guide-spotlight');
    this.edges = this.spotlight.querySelectorAll('.guide-edge');
    this.corners = this.spotlight.querySelector('.guide-corners');
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.entrances = [];
    this.motion.addEventListener('change', () => {
      if (this.motion.matches) this.cancelEntrance();
    });
    this.title = byId('guide-title');
    this.start = byId('guide-start');
    this.back = byId('guide-back');
    this.skip = byId('guide-skip');
    this.next = byId('guide-next');
    this.closeButton = byId('guide-close');
    this.action = byId('guide-action');
    this.error = byId('guide-error');
    this.faqButton = byId('guide-faq');
    this.faqPanel = byId('guide-faq-panel');
    this.faqSearch = byId('guide-faq-search');
    this.faqBack = byId('guide-faq-back');
    this.faqResults = byId('guide-faq-results');
    this.faqEmpty = byId('guide-faq-empty');
    this.faqError = byId('guide-faq-error');
    this.faqShowing = false;
    this.faqGroups = [];
    this.index = -1;
    this.actionRevision = 0;
    this.opener.onclick = () => this.open();
    this.start.onclick = () => this.go(0);
    this.next.onclick = () => this.advance();
    this.skip.onclick = () => this.go(this.index + 1);
    this.back.onclick = () => this.go(this.index - 1);
    this.closeButton.onclick = () => this.close();
    this.action.onclick = () => void this.openSection();
    this.faqButton.onclick = () => this.showFaq(true);
    this.faqBack.onclick = () => this.showFaq(false);
    this.faqSearch.oninput = () => this.filterFaq();
    window.addEventListener('keydown', (event) => this.key(event), true);
    const resize = new ResizeObserver(() => this.scheduleLayout());
    resize.observe(this.dialog);
    resize.observe(document.body);
    this.refresh();
  }

  get active() {
    return !this.root.hidden;
  }

  get step() {
    return this.content.steps[this.index];
  }

  startOnLaunch() {
    if (this.presented || guideFlag('localStorage') || guideFlag('sessionStorage')) return;
    this.startupPending = true;
    this.maybeStart();
  }

  maybeStart() {
    if (this.startupPending && !document.hidden) this.open({ beginner: true });
  }

  open({ beginner = false } = {}) {
    if (this.active || this.blocked()) return;
    this.presented = true;
    this.startupPending = false;
    setGuideFlag('sessionStorage');
    if (beginner) this.index = 0;
    this.previousInert = this.companion.inert;
    this.companion.inert = true;
    this.root.hidden = false;
    this.opener.setAttribute('aria-expanded', 'true');
    this.onActive(true);
    this.pendingEntrance = 'open';
    this.refresh();
    (beginner ? this.title : this.start).focus({ preventScroll: true });
  }

  close() {
    if (!this.active) return;
    this.root.hidden = true;
    this.pendingEntrance = null;
    this.cancelEntrance();
    this.index = -1;
    this.faqShowing = false;
    this.faqSearch.value = '';
    this.faqError.hidden = true;
    this.faqResults.replaceChildren();
    this.faqGroups = [];
    this.renderedFaq = null;
    this.settingsFailed = false;
    this.actionRevision++;
    this.action.disabled = false;
    delete this.root.dataset.step;
    delete this.root.dataset.view;
    this.root.removeAttribute('aria-describedby');
    this.markTarget(null);
    this.spotlight.hidden = true;
    this.syncPanel();
    this.companion.inert = this.previousInert;
    this.opener.setAttribute('aria-expanded', 'false');
    this.onActive(false);
    if (!this.blocked()) this.opener.focus({ preventScroll: true });
  }

  advance() {
    if (!this.active || !this.step) return;
    if (this.index < this.content.steps.length - 1) return this.go(this.index + 1);
    setGuideFlag('localStorage');
    this.close();
  }

  go(index) {
    if (!this.active || index < 0 || index >= this.content.steps.length) return;
    this.actionRevision++;
    this.action.disabled = false;
    this.settingsFailed = false;
    this.scrolledTarget = null;
    this.index = index;
    this.pendingEntrance = 'step';
    this.render();
    this.dialog.scrollTop = 0;
    this.title.focus({ preventScroll: true });
  }

  refresh() {
    const locale = this.language();
    this.content = guideContent(locale);
    this.tourLanguage = /^ru(?:-|$)/i.test(locale) ? 'ru' : 'en';
    this.faqText = this.faq();
    this.opener.title = this.faqText.menuTitle;
    this.opener.setAttribute('aria-label', this.faqText.menuTitle);
    if (this.active) this.render();
  }

  render() {
    const text = this.content;
    const step = this.step;
    const faq = this.faqText;
    this.root.dataset.view = step ? 'tour' : this.faqShowing ? 'faq' : 'menu';
    this.root.lang = step ? this.tourLanguage : faq.lang;
    this.root.dir = step ? 'ltr' : faq.direction;
    if (step) this.root.dataset.step = step.id;
    this.title.textContent = step?.title ?? (this.faqShowing ? faq.title : faq.menuTitle);
    byId('guide-kicker').textContent = step ? text.kicker : 'CAPRI';
    byId('guide-step').textContent = step ? text.stepLabel(this.index + 1, text.steps.length) : '';
    byId('guide-list').hidden = Boolean(step) || this.faqShowing;
    byId('guide-body').hidden = !step;
    this.faqPanel.hidden = !this.faqShowing;
    this.start.lang = this.tourLanguage;
    byId('guide-start-title').textContent = text.beginnerTitle;
    byId('guide-start-description').textContent = text.beginnerDescription;
    byId('guide-faq-title').textContent = faq.title;
    byId('guide-faq-description').textContent = faq.description;
    const close = step ? text.close : faq.close;
    this.closeButton.setAttribute('aria-label', close);
    this.closeButton.title = close;
    if (step) {
      this.root.setAttribute('aria-describedby', 'guide-description');
      byId('guide-description').textContent = step.description;
      const progress = byId('guide-progress').style;
      progress.setProperty('--guide-step-width', `${100 / text.steps.length}%`);
      progress.setProperty('--guide-progress', `${(100 * (this.index + 1)) / text.steps.length}%`);
      this.back.textContent = text.back;
      this.back.disabled = this.index === 0;
      this.next.textContent = this.index === text.steps.length - 1 ? text.finish : text.next;
      this.skip.textContent = text.skip;
      this.skip.hidden = this.index === text.steps.length - 1;
      this.action.hidden = !step.section;
      this.action.textContent = step.actionLabel ?? '';
      this.error.hidden = !this.settingsFailed;
      this.error.textContent = this.settingsFailed ? text.statusUnavailable : '';
    }
    if (this.faqShowing) this.renderFaq();
    this.syncPanel();
    this.scheduleLayout();
  }

  showFaq(show) {
    if (show === this.faqShowing || !this.active || this.step) return;
    this.faqShowing = show;
    this.actionRevision++;
    this.faqError.hidden = true;
    this.pendingEntrance = 'panel';
    this.render();
    this.dialog.scrollTop = 0;
    (show ? this.faqSearch : this.faqButton).focus({ preventScroll: true });
  }

  renderFaq() {
    const text = this.faqText;
    byId('guide-faq-search-label').textContent = text.searchLabel;
    this.faqSearch.placeholder = text.searchLabel;
    this.faqBack.textContent = text.back;
    this.faqEmpty.textContent = text.empty;
    this.faqError.textContent = text.unavailable;
    if (this.renderedFaq === text) return;

    const expanded = new Set(
      [...this.faqResults.querySelectorAll('details[open]')].map((node) => node.dataset.faqId),
    );
    const focused = document.activeElement?.closest('details')?.dataset.faqId;
    const scrollTop = this.faqResults.scrollTop;
    const groups = text.groups.map(({ title, items }) => {
      const section = document.createElement('section');
      section.className = 'guide-faq-group';
      const heading = document.createElement('h3');
      heading.textContent = title;
      section.append(heading);
      const questions = items.map(({ id, question, answer, actions }) => {
        const details = document.createElement('details');
        details.dataset.faqId = id;
        details.open = expanded.has(id);
        const summary = document.createElement('summary');
        summary.textContent = question;
        const message = document.createElement('p');
        message.className = 'guide-faq-answer';
        message.textContent = answer;
        details.append(summary, message);
        if (actions?.length) {
          const controls = document.createElement('div');
          controls.className = 'guide-faq-actions';
          for (const action of actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'guide-faq-action';
            button.textContent = action.label;
            if (action.section) button.dataset.section = action.section;
            else button.dataset.link = action.link;
            button.onclick = () => void this.openFaqAction(button, action);
            controls.append(button);
          }
          details.append(controls);
        }
        section.append(details);
        const searchText = [title, question, answer, ...(actions ?? []).map(({ label }) => label)];
        return { details, summary, text: foldSearch(searchText.join(' '), text.lang) };
      });
      return { section, questions };
    });
    this.renderedFaq = text;
    this.faqGroups = groups;
    this.faqResults.replaceChildren(...groups.map(({ section }) => section));
    this.filterFaq();
    const current = groups
      .flatMap(({ questions }) => questions)
      .find(({ details }) => details.dataset.faqId === focused && details.checkVisibility());
    if (focused && this.active && this.faqShowing)
      (current?.summary ?? this.faqSearch).focus({ preventScroll: true });
    this.faqResults.scrollTop = scrollTop;
  }

  filterFaq() {
    const query = foldSearch(this.faqSearch.value, this.faqText.lang).trim();
    const words = query ? query.split(/\s+/u) : [];
    let any = false;
    for (const { section, questions } of this.faqGroups) {
      let visible = false;
      for (const { details, text } of questions) {
        details.hidden = !words.every((word) => text.includes(word));
        visible ||= !details.hidden;
      }
      section.hidden = !visible;
      any ||= visible;
    }
    this.faqEmpty.hidden = any;
  }

  async openFaqAction(button, { section, link }) {
    this.faqError.hidden = true;
    button.disabled = true;
    const revision = this.actionRevision;
    try {
      const result = await (section ? this.openSettings(section) : this.openLink(link));
      if (result === false) throw new Error('The FAQ action is unavailable.');
    } catch {
      if (revision === this.actionRevision && this.faqShowing) this.faqError.hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  syncPanel() {
    const panel = this.step?.panel;
    if (panel === this.panel) return;
    this.panel = panel;
    this.onPanel(panel);
  }

  async openSection() {
    const section = this.step?.section;
    if (!section || this.action.disabled) return;
    const revision = ++this.actionRevision;
    this.action.disabled = true;
    let failed;
    try {
      failed = (await this.openSettings(section)) === false;
    } catch {
      failed = true;
    } finally {
      if (revision === this.actionRevision) {
        this.settingsFailed = failed;
        this.action.disabled = false;
        this.render();
      }
    }
  }

  key(event) {
    if (!this.active || this.blocked() || event.isComposing) return;
    if (event.key === 'Escape') this.close();
    else if (this.step && event.key === 'ArrowRight') this.advance();
    else if (this.step && event.key === 'ArrowLeft') this.go(this.index - 1);
    else if (event.key === 'Tab') {
      const controls = [
        ...this.dialog.querySelectorAll('button:enabled, input:enabled, summary'),
      ].filter(
        (control) =>
          control.checkVisibility() &&
          (control.matches('summary') || !control.closest('details:not([open])')),
      );
      const current = controls.indexOf(document.activeElement);
      const last = controls.length - 1;
      if (event.shiftKey ? current > 0 : current >= 0 && current < last) return;
      controls[event.shiftKey ? last : 0]?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  scheduleLayout() {
    if (!this.active || this.layoutFrame) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      if (!this.active) return;
      const previous = this.target;
      const offset = this.layout();
      if (this.pendingEntrance) {
        this.playEntrance(offset, this.pendingEntrance === 'open');
        this.pendingEntrance = null;
      } else if (this.target && this.target !== previous) this.drawSpotlight();
    });
  }

  cancelEntrance() {
    for (const animation of this.entrances) animation.cancel();
    this.entrances.length = 0;
  }

  animate(part, frames, duration, delay = 0, id = 'guide-content') {
    if (this.motion.matches || part.hidden) return;
    const animation = part.animate(frames, {
      duration,
      delay,
      easing: entranceEase,
      fill: 'backwards',
    });
    animation.id = id;
    this.entrances.push(animation);
  }

  drawSpotlight() {
    if (this.spotlight.hidden) return;
    for (const edge of this.edges) {
      const horizontal = edge.matches('[data-edge="top"], [data-edge="bottom"]');
      this.animate(
        edge,
        [
          { scale: horizontal ? '0 1' : '1 0', opacity: 0.7 },
          { scale: '1', opacity: 1 },
        ],
        360,
        0,
        'guide-frame-line',
      );
    }
    this.animate(this.corners, [{ opacity: 0 }, { opacity: 1 }], 155, 360, 'guide-frame-corners');
  }

  playEntrance(offset = '0 12px', opening = false) {
    this.cancelEntrance();
    if (this.motion.matches) return;
    this.drawSpotlight();
    if (opening) {
      for (const mask of this.masks) this.animate(mask, [{ opacity: 0 }, { opacity: 1 }], 240);
    }
    const reveal = (part, delay, distance = '0 8px', duration = 290, id) =>
      this.animate(
        part,
        [
          { opacity: 0, translate: distance },
          { opacity: 1, translate: '0 0' },
        ],
        duration,
        delay,
        id,
      );
    reveal(this.dialog, 25, offset, 400, 'guide-dialog');
    this.animate(
      this.dialog.querySelector('.guide-avatar'),
      [
        { opacity: 0, scale: 0.86 },
        { opacity: 1, scale: 1 },
      ],
      325,
      95,
      'guide-portrait',
    );
    reveal(byId('guide-kicker'), 105);
    reveal(byId('guide-step'), 130);
    reveal(this.title, 145);
    reveal(this.closeButton, 165, '0 -5px');
    if (this.step) {
      reveal(byId('guide-description'), 185, '0 9px', 320, 'guide-description');
      this.animate(
        byId('guide-progress'),
        [
          { opacity: 0, scale: '.75 1' },
          { opacity: 1, scale: 1 },
        ],
        300,
        225,
        'guide-progress',
      );
      for (const [index, part] of [this.action, this.back, this.skip, this.next].entries()) {
        reveal(part, 225 + index * 29);
      }
    } else if (this.faqShowing) {
      reveal(this.faqPanel, 155);
    } else {
      reveal(this.start, 160);
      reveal(this.faqButton, 205);
    }
  }

  markTarget(target) {
    if (target === this.target) return;
    this.target?.removeAttribute('data-guide-highlight');
    this.target = target;
    this.target?.setAttribute('data-guide-highlight', '');
  }

  layout() {
    const step = this.step;
    const target = step && visibleTarget([step.target, step.fallbackTarget]);
    this.markTarget(target || null);
    this.spotlight.hidden = !target;
    const [topMask, rightMask, bottomMask, leftMask] = this.masks;
    if (!target) {
      setBox(topMask, 0, 0, innerWidth, innerHeight);
      for (const mask of [rightMask, bottomMask, leftMask]) setBox(mask, 0, 0, 0, 0);
      delete this.dialog.dataset.positioned;
      this.dialog.style.removeProperty('left');
      this.dialog.style.removeProperty('top');
      return;
    }
    const picker = target.closest('#inference-picker');
    let bounds = target.getBoundingClientRect();
    if (picker && picker !== target && this.scrolledTarget !== target) {
      this.scrolledTarget = target;
      const { top, bottom } = picker.getBoundingClientRect();
      if (bounds.bottom > bottom) picker.scrollTop += bounds.bottom - bottom + 2;
      else if (bounds.top < top) picker.scrollTop += bounds.top - top - 2;
      bounds = target.getBoundingClientRect();
    }
    const padding = 5;
    const left = Math.max(0, Math.floor(bounds.left - padding));
    const top = Math.max(0, Math.floor(bounds.top - padding));
    const right = Math.min(innerWidth, Math.ceil(bounds.right + padding));
    const bottom = Math.min(innerHeight, Math.ceil(bounds.bottom + padding));
    const height = bottom - top;
    setBox(topMask, 0, 0, innerWidth, top);
    setBox(rightMask, right, top, innerWidth - right, height);
    setBox(bottomMask, 0, bottom, innerWidth, innerHeight - bottom);
    setBox(leftMask, 0, top, left, height);
    setBox(this.spotlight, left, top, right - left, height);
    return this.positionDialog({ left, top, right, bottom });
  }

  positionDialog({ left, top, right, bottom }) {
    const { width, height } = this.dialog.getBoundingClientRect();
    const margin =
      Number.parseFloat(getComputedStyle(this.root).getPropertyValue('--guide-margin')) || 12;
    const gap = 14;
    const maxX = innerWidth - width - margin;
    const maxY = innerHeight - height - margin;
    const centerX = clamp((left + right - width) / 2, margin, maxX);
    const centerY = clamp((top + bottom - height) / 2, margin, maxY);
    const places = [
      { x: centerX, y: bottom + gap, space: innerHeight - bottom - height, offset: '0 -12px' },
      { x: centerX, y: top - height - gap, space: top - height, offset: '0 12px' },
      { x: right + gap, y: centerY, space: innerWidth - right - width, offset: '-12px 0' },
      { x: left - width - gap, y: centerY, space: left - width, offset: '12px 0' },
    ];
    const place =
      places.find(({ space }) => space >= gap + margin) ??
      places.reduce((best, current) => (current.space > best.space ? current : best));
    this.dialog.dataset.positioned = '';
    this.dialog.style.left = Math.round(clamp(place.x, margin, maxX)) + 'px';
    this.dialog.style.top = Math.round(clamp(place.y, margin, maxY)) + 'px';
    return place.offset;
  }
}
