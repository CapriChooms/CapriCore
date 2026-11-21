// SPDX-License-Identifier: GPL-3.0-only
import { COMPOSER_SKILLS } from '../../../packages/skills/src/settings-catalog.mjs';
import { SETTINGS_SECTIONS, SKILL_BY_SECTION } from './settings-registry.mjs';

const sections = new Map(SETTINGS_SECTIONS.map(([id, label, panel]) => [id, { label, panel }]));
const completionKey = 'capri.settings.guides.v1';
const copy = {
  ru: {
    open: (section) => `Гайд по разделу «${section}»`,
    topic: (title) => `${title} (гайд)`,
    step: (current, total) => `Шаг ${current} из ${total}`,
    close: 'Закрыть гайд',
    back: 'Назад',
    skip: 'Пропустить шаг',
    next: 'Далее',
    done: 'Завершить',
    error: 'Не удалось открыть гайд. Попробуй ещё раз.',
  },
};

function completedSections() {
  try {
    const saved = localStorage.getItem(completionKey);
    if (saved && saved.length <= 4096) {
      const values = JSON.parse(saved);
      if (Array.isArray(values)) return new Set(values.filter((id) => sections.has(id)));
    }
  } catch {
    // A guide remains usable when browser storage is unavailable.
  }
  return new Set();
}

let catalog;
const guideLocales = new Map();
const pendingGuideLocales = new Map();
const guideLocaleRetryAfter = new Map();

async function loadGuideLocale(locale) {
  if (locale === 'en' || locale === 'ru' || guideLocales.has(locale)) return;
  if ((guideLocaleRetryAfter.get(locale) ?? 0) > Date.now()) return;
  if (!pendingGuideLocales.has(locale)) {
    const pending = fetch(`/locales/guide-${locale}.json`)
      .then((response) => {
        if (!response.ok) throw new Error('Settings guide translation unavailable');
        return response.json();
      })
      .then((messages) => guideLocales.set(locale, messages))
      .catch((error) => {
        guideLocaleRetryAfter.set(locale, Date.now() + 30_000);
        throw error;
      })
      .finally(() => pendingGuideLocales.delete(locale));
    pendingGuideLocales.set(locale, pending);
  }
  await pendingGuideLocales.get(locale);
}

export function settingsGuideSteps(section, content) {
  const steps = content[section];
  const skill = SKILL_BY_SECTION[section];
  if (!steps || !skill || section === 'microphone') return steps;
  const composer = Object.hasOwn(COMPOSER_SKILLS, skill.id);
  const shortcutStep = [
    '#skill-show-button',
    [
      'Put the shortcut where you need it',
      'The switch beside the tab name turns the skill on or off. “Show button in Capri’s toolbar” controls its shortcut at the top of the main window. Hiding the shortcut leaves the skill enabled.' +
        (composer
          ? ' Show button in the message bar independently controls the shortcut beside the field where you type.'
          : ''),
    ],
    [
      'Выбери, где показывать кнопку',
      'Тумблер рядом с названием вкладки включает и выключает навык. «Показывать кнопку в верхней панели Capri» управляет кнопкой вверху главного окна. Если скрыть кнопку, навык останется включённым.' +
        (composer
          ? ' «Показывать кнопку в строке ввода» отдельно управляет кнопкой рядом с полем сообщения.'
          : ''),
    ],
    ...(composer ? [{ help: '#skill-show-composer' }] : []),
  ];
  return [...steps, shortcutStep];
}

function loadCatalog() {
  catalog ??= Promise.all([
    import('./settings-guide-core.mjs'),
    import('./settings-guide-skills.mjs'),
    import('./settings-guide-advanced.mjs'),
  ])
    .then(([{ coreGuides }, { skillGuides }, { advancedGuides }]) => ({
      ...coreGuides,
      ...skillGuides,
      ...advancedGuides,
    }))
    .catch((error) => {
      catalog = undefined;
      throw error;
    });
  return catalog;
}

function helpAnchor(target) {
  return (
    target.labels?.[0] ??
    target.closest('label, summary') ??
    target.querySelector(':scope > summary, :scope > legend, :scope > h2, :scope > h3') ??
    target
  );
}

function spotlightBounds(target) {
  const bounds = target.getBoundingClientRect();
  const control = target.matches('label') ? target.control : target;
  if (!control?.matches('input[type="checkbox"], [role="switch"]')) return bounds;

  // Checkbox labels can wrap the input or be linked from a separate element.
  const labelIds = control.getAttribute('aria-labelledby')?.match(/\S+/gu) ?? [];
  const labels = [
    control,
    ...(control.labels ?? []),
    ...labelIds.map((id) => document.getElementById(id)),
  ];
  let { left, right, top, bottom } = bounds;
  for (const label of labels) {
    if (label === target || !label?.checkVisibility({ visibilityProperty: true })) continue;
    const rect = label.getBoundingClientRect();
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { left, right, top, bottom, height: bottom - top };
}

export class SettingsGuide {
  constructor({ ui, activeSection, available, revealable, reveal, descriptions, onError }) {
    Object.assign(this, {
      ui,
      activeSection,
      available,
      revealable,
      reveal,
      descriptions,
      onError,
    });
    this.modal = document.getElementById('capri-guide');
    this.pane = document.getElementById('companion');
    this.opener = document.getElementById('settings-guide-open');
    this.card = this.modal.querySelector('.guide-dialog');
    this.spotlight = this.modal.querySelector('.guide-spotlight');
    this.caption = this.modal.querySelector('.guide-kicker');
    this.counter = this.modal.querySelector('.guide-step');
    this.title = this.modal.querySelector('.guide-title');
    this.description = this.modal.querySelector('.guide-description');
    this.progress = this.modal.querySelector('.guide-progress');
    this.closeButton = this.modal.querySelector('.guide-close');
    this.back = document.getElementById('settings-guide-back');
    this.skip = document.getElementById('settings-guide-skip');
    this.next = document.getElementById('settings-guide-next');
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.animations = [];
    this.completed = completedSections();
    this.info = new WeakMap();
    this.infoAnchors = new WeakMap();
    this.activeInfo = new Set();
    this.revealed = new Map();
    this.revision = 0;
    this.loading = false;
    this.opener.onclick = () => void this.open();
    this.closeButton.onclick = () => this.close();
    this.back.onclick = () => this.go(-1);
    this.skip.onclick = () => {
      if (!this.skip.hidden) this.go(1);
    };
    this.next.onclick = () => this.go(1);
    this.modal.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    this.modal.addEventListener('keydown', (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const forward = getComputedStyle(this.modal).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      this.go(event.key === forward ? 1 : -1);
    });
    this.pane.addEventListener('scroll', () => this.queueLayout(), { passive: true });
    const resize = new ResizeObserver(() => this.queueLayout(true));
    resize.observe(this.pane);
    resize.observe(this.card);
    this.motion.addEventListener('change', () => this.stopAnimations());
    new MutationObserver((records) => {
      const relevant = records.some(({ type, target, addedNodes, removedNodes }) =>
        type === 'attributes'
          ? !target.matches('[data-settings-info]')
          : [...addedNodes, ...removedNodes].some(
              (node) =>
                node.nodeType === Node.ELEMENT_NODE &&
                !node.matches('.settings-help-row, [data-settings-info]'),
            ),
      );
      if (!this.content || this.infoFrame || !relevant) return;
      this.infoFrame = requestAnimationFrame(() => {
        this.infoFrame = 0;
        this.attachHelp();
        if (this.active && !this.target?.isConnected) this.showStepTarget();
        this.queueLayout(true);
      });
    }).observe(this.pane, { childList: true, subtree: true, attributeFilter: ['hidden'] });
  }

  get active() {
    return this.modal.open;
  }

  get locale() {
    return this.ui.language;
  }

  guideText(english, values = {}) {
    const message = guideLocales.get(this.locale)?.[english] ?? this.ui.text(english, values);
    return message.replace(/\{(\w+)\}/gu, (token, key) => String(values[key] ?? token));
  }

  stepText(step) {
    const [, english, russian] = step;
    if (this.locale === 'ru') return { pair: russian, language: 'ru' };
    const messages = guideLocales.get(this.locale);
    if (this.locale !== 'en' && messages?.[english[0]] && messages?.[english[1]])
      return { pair: english.map((text) => messages[text]), language: this.locale };
    return { pair: english, language: 'en' };
  }

  refresh() {
    const locale = this.locale;
    if (locale !== 'en' && locale !== 'ru' && !guideLocales.has(locale)) {
      void loadGuideLocale(locale)
        .then(() => {
          if (this.locale === locale && guideLocales.has(locale)) {
            if (this.active) this.render();
            this.refresh();
          }
        })
        .catch(() => {});
    }
    const id = this.activeSection();
    const section = sections.get(id);
    const label = this.ui.text(section?.label);
    const description = label
      ? this.locale === 'ru'
        ? copy.ru.open(label)
        : this.guideText('Guide for {section}', { section: label })
      : this.guideText('Guide for this tab');
    this.opener.disabled = !section || !this.available() || this.loading;
    this.opener.toggleAttribute(
      'data-guide-pending',
      !this.opener.disabled && !this.active && !this.completed.has(id),
    );
    this.opener.setAttribute('aria-label', description);
    this.opener.title = description;
    if (this.active && this.modal.dataset.uiLocale !== this.locale) this.render();
    if (this.content) this.attachHelp();
  }

  async prepare() {
    this.content ??= await loadCatalog();
    await loadGuideLocale(this.locale).catch(() => {});
    this.attachHelp();
  }

  attachHelp() {
    const section = this.activeSection();
    const steps = settingsGuideSteps(section, this.content);
    if (!steps) return;
    const anchors = new Map();
    const descriptionAnchors = new Map();
    for (const [index, [selector, , , options]] of steps.entries()) {
      const targets = [
        ...new Set(
          [selector, options?.help]
            .filter(Boolean)
            .flatMap((query) => [...this.pane.querySelectorAll(query)]),
        ),
      ];
      const candidates = [];
      for (const target of targets) {
        if (target.closest('[data-settings-info]') || !this.canShow(target)) continue;
        const anchor = this.infoAnchors.get(target) ?? helpAnchor(target);
        this.infoAnchors.set(target, anchor);
        descriptionAnchors.set(anchor, { index, target });
        if (!anchors.has(anchor)) candidates.push({ anchor, target });
      }
      const selected =
        candidates.find(({ target }) => target.checkVisibility({ visibilityProperty: true })) ??
        candidates[0];
      if (selected) anchors.set(selected.anchor, { index, target: selected.target });
    }
    const buttons = new Set();
    for (const [anchor, { index, target }] of anchors) {
      let entry = this.info.get(anchor);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-info-button';
        button.dataset.settingsInfo = '';
        button.dataset.untranslated = '';
        button.textContent = 'i';
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', this.modal.id);
        button.setAttribute('aria-expanded', 'false');
        entry = { button };
        button.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (entry.section === this.activeSection()) void this.open(entry);
        };
        this.info.set(anchor, entry);
        if (anchor.matches('summary, legend')) {
          anchor.append(button);
        } else {
          const row = document.createElement('div');
          row.className = 'settings-help-row';
          anchor.before(row);
          row.append(anchor, button);
        }
      }
      Object.assign(entry, { index, target, section });
      const {
        pair: [title],
        language,
      } = this.stepText(steps[index]);
      entry.button.dataset.guideStep = String(index);
      entry.button.lang = language;
      entry.button.setAttribute(
        'aria-label',
        this.locale === 'ru' ? copy.ru.topic(title) : this.guideText('{title} (guide)', { title }),
      );
      entry.button.title = title;
      entry.button.hidden = false;
      buttons.add(entry.button);
    }
    for (const button of this.activeInfo) {
      if (buttons.has(button)) continue;
      const parent = button.parentElement;
      if (parent?.classList.contains('settings-help-row')) {
        const anchor = parent.firstElementChild;
        this.info.delete(anchor);
        parent.before(anchor);
        parent.remove();
      } else {
        if (parent) this.info.delete(parent);
        button.remove();
      }
    }
    this.activeInfo = buttons;
    this.descriptions(descriptionAnchors);
  }

  canShow(target) {
    for (let node = target; node && node !== this.pane; node = node.parentElement)
      if (node.hidden && !this.revealable(node)) return false;
    return true;
  }

  authoredTarget([selector, , , options]) {
    return [...this.pane.querySelectorAll(options?.spotlight ?? selector)].find((target) =>
      this.canShow(target),
    );
  }

  revealTarget(target) {
    for (let parent = target; parent && parent !== this.pane; parent = parent.parentElement) {
      if (parent.hidden && this.revealable(parent)) {
        const { key, restore } = this.reveal(parent);
        if (!this.revealed.has(key)) this.revealed.set(key, restore);
      }
    }
    for (
      let parent = target.parentElement;
      parent && parent !== this.pane;
      parent = parent.parentElement
    ) {
      if (!parent.matches('details:not([open])')) continue;
      if (parent.id === 'desktop-ai-details') return parent.querySelector(':scope > summary');
      if (!this.revealed.has(parent)) this.revealed.set(parent, () => (parent.open = false));
      parent.open = true;
    }
    return target.checkVisibility({ visibilityProperty: true }) ? target : null;
  }

  async open(entry) {
    const section = this.activeSection();
    if (this.active || this.loading || !sections.has(section) || !this.available()) return;
    this.loading = true;
    const revision = ++this.revision;
    try {
      await this.prepare();
      if (revision !== this.revision || section !== this.activeSection() || !this.available())
        return;
      const steps = settingsGuideSteps(section, this.content);
      this.steps = steps.flatMap((step, index) => {
        const target =
          index === entry?.index && !step[3]?.spotlight ? entry.target : this.authoredTarget(step);
        return target ? [{ step, target, index }] : [];
      });
      if (!this.steps.length) throw new Error('Missing Settings guide for ' + section);
      this.index = entry ? this.steps.findIndex(({ index }) => index === entry.index) : 0;
      if (this.index < 0) return;
      this.trigger = entry?.button ?? this.opener;
      this.fullTour = !entry;
      this.modal.dataset.section = section;
      this.originalScroll = this.pane.scrollTop;
      this.render();
      this.modal.showModal();
      this.pane.setAttribute('data-settings-guide-scroll', '');
      this.trigger.setAttribute('aria-expanded', 'true');
      this.showStepTarget();
      this.layout(true);
      this.playEntrance();
    } catch (error) {
      if (this.active) this.close();
      console.error(error);
      this.onError(
        this.locale === 'ru'
          ? copy.ru.error
          : this.guideText('Could not open the guide. Try again.'),
      );
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  close({ restoreFocus = true } = {}) {
    this.revision++;
    if (!this.active) return;
    this.modal.close();
    delete this.modal.dataset.section;
    delete this.modal.dataset.step;
    delete this.modal.dataset.catalogStep;
    this.stopAnimations();
    this.target?.removeAttribute('data-settings-guide-highlight');
    this.target = null;
    this.spotlight.hidden = true;
    this.pane.removeAttribute('data-settings-guide-scroll');
    this.pane.style.removeProperty('--settings-guide-room');
    for (const restore of [...this.revealed.values()].reverse()) restore();
    this.revealed.clear();
    this.pane.scrollTop = this.originalScroll;
    this.trigger.setAttribute('aria-expanded', 'false');
    const trigger = this.trigger;
    this.trigger = null;
    this.steps = null;
    this.refresh();
    if (restoreFocus) (trigger.isConnected ? trigger : this.opener).focus({ preventScroll: true });
  }

  go(direction) {
    if (!this.active) return;
    const index = this.index + direction;
    if (index < 0) return;
    if (index === this.steps.length) {
      const section = this.modal.dataset.section;
      if (this.fullTour && !this.completed.has(section)) {
        this.completed.add(section);
        try {
          localStorage.setItem(completionKey, JSON.stringify([...this.completed]));
        } catch {}
      }
      this.close();
      return;
    }
    this.index = index;
    this.stopAnimations();
    this.render();
    this.showStepTarget();
    this.layout(true);
    this.playEntrance();
    if (document.activeElement === document.body) this.next.focus({ preventScroll: true });
  }

  render() {
    const locale = this.locale;
    const { step, index } = this.steps[this.index];
    const {
      pair: [title, description],
      language,
    } = this.stepText(step);
    const { label } = sections.get(this.modal.dataset.section);
    const last = this.index === this.steps.length - 1;
    this.modal.lang = locale;
    this.modal.dataset.uiLocale = locale;
    this.modal.dataset.step = String(this.index + 1);
    this.modal.dataset.catalogStep = String(index);
    this.caption.textContent = this.ui.text(label);
    this.counter.textContent =
      locale === 'ru'
        ? copy.ru.step(this.index + 1, this.steps.length)
        : this.guideText('Step {current} of {total}', {
            current: this.index + 1,
            total: this.steps.length,
          });
    this.title.lang = language;
    this.description.lang = language;
    this.title.dir = 'auto';
    this.description.dir = 'auto';
    this.title.textContent = title;
    this.description.textContent = description;
    this.description.scrollTop = 0;
    this.progress.style.setProperty('--guide-step-width', `${100 / this.steps.length}%`);
    this.progress.style.setProperty(
      '--guide-progress',
      `${((this.index + 1) * 100) / this.steps.length}%`,
    );
    this.closeButton.setAttribute(
      'aria-label',
      locale === 'ru' ? copy.ru.close : this.guideText('Close guide'),
    );
    this.back.textContent = locale === 'ru' ? copy.ru.back : this.guideText('Back');
    this.back.disabled = this.index === 0;
    this.skip.textContent = locale === 'ru' ? copy.ru.skip : this.guideText('Skip step');
    this.skip.hidden = last;
    this.next.textContent =
      locale === 'ru'
        ? last
          ? copy.ru.done
          : copy.ru.next
        : this.guideText(last ? 'Finish' : 'Next');
  }

  queueLayout(scroll = false) {
    if (!this.active) return;
    this.scrollOnLayout ||= scroll;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const align = this.scrollOnLayout;
      this.scrollOnLayout = false;
      if (this.active) this.layout(align);
    });
  }

  showStepTarget() {
    const { target: control, step } = this.steps[this.index];
    const candidate = control.isConnected ? control : this.authoredTarget(step);
    const target = candidate && this.revealTarget(candidate);
    if (target !== this.target) {
      this.target?.removeAttribute('data-settings-guide-highlight');
      this.target = target;
      target?.setAttribute('data-settings-guide-highlight', '');
    }
  }

  layout(scroll) {
    const target = this.target;
    if (!target) {
      this.spotlight.hidden = true;
      return;
    }

    const pane = this.pane.getBoundingClientRect();
    let bottomLimit = Math.min(pane.bottom, this.card.getBoundingClientRect().top - 10);
    const topLimit = pane.top + 3;
    let bounds = spotlightBounds(target);
    const block = this.steps[this.index].step[3]?.spotlight;
    if (block && bounds.height + 12 > bottomLimit - topLimit) bottomLimit = pane.bottom - 3;
    if (bottomLimit <= topLimit) {
      this.spotlight.hidden = true;
      return;
    }
    this.pane.style.setProperty(
      '--settings-guide-room',
      `${Math.ceil(pane.bottom - bottomLimit)}px`,
    );
    bounds = spotlightBounds(target);
    if (scroll && (bounds.top < topLimit + 6 || bounds.bottom > bottomLimit - 6)) {
      const center = Math.max(6, (bottomLimit - topLimit - bounds.height) / 2);
      this.pane.scrollTop += bounds.top - topLimit - center;
      bounds = spotlightBounds(target);
    }
    const left = Math.max(pane.left + 2, bounds.left - 4);
    const right = Math.min(pane.right - 2, bounds.right + 4);
    const top = Math.max(topLimit, bounds.top - 4);
    const bottom = Math.min(bottomLimit, bounds.bottom + 4);
    if (right <= left || bottom <= top) {
      this.spotlight.hidden = true;
      return;
    }
    this.spotlight.style.left = `${left}px`;
    this.spotlight.style.top = `${top}px`;
    this.spotlight.style.width = `${right - left}px`;
    this.spotlight.style.height = `${bottom - top}px`;
    this.spotlight.hidden = false;
  }

  stopAnimations() {
    for (const animation of this.animations) animation.cancel();
    this.animations.length = 0;
  }

  playEntrance() {
    if (this.motion.matches) return;
    const animate = (element, frames, duration, delay = 0) => {
      this.animations.push(
        element.animate(frames, {
          duration,
          delay,
          easing: 'cubic-bezier(.22, 1, .36, 1)',
          fill: 'backwards',
        }),
      );
    };
    if (!this.spotlight.hidden) {
      for (const edge of this.spotlight.querySelectorAll('.guide-edge')) {
        const horizontal = ['top', 'bottom'].includes(edge.dataset.edge);
        animate(edge, [{ scale: horizontal ? '0 1' : '1 0' }, { scale: '1' }], 320);
      }
      animate(
        this.spotlight.querySelector('.guide-corners'),
        [{ opacity: 0 }, { opacity: 1 }],
        150,
        320,
      );
    }
    animate(
      this.card,
      [
        { opacity: 0, translate: '0 12px' },
        { opacity: 1, translate: '0 0' },
      ],
      270,
    );
    animate(this.description, [{ opacity: 0 }, { opacity: 1 }], 220, 100);
  }
}
