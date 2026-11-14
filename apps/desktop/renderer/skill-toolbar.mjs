// SPDX-License-Identifier: GPL-3.0-only
import {
  COMPOSER_SKILLS,
  SKILL_SETTINGS,
  showComposerSkill,
} from '../../../packages/skills/src/settings-catalog.mjs';
export { showComposerSkill };

const svgNamespace = 'http://www.w3.org/2000/svg';

export function skillToolbar({ ui, openSettings, onLayout, inputMic }) {
  const toolbar = document.getElementById('quick-actions');
  const group = document.createElement('div');
  group.className = 'toolbar-group skills-toolbar';
  group.setAttribute('role', 'group');
  toolbar.prepend(group);
  let previousHeight;
  new ResizeObserver(([entry]) => {
    const unit =
      Number.parseFloat(getComputedStyle(toolbar).getPropertyValue('--toolbar-button-size')) || 26;
    const extra = Math.max(0, Math.ceil(entry.contentRect.height - unit));
    if (extra === previousHeight) return;
    previousHeight = extra;
    document.body.style.setProperty('--toolbar-extra', extra + 'px');
    onLayout();
  }).observe(toolbar);
  let state = {};
  const buttons = SKILL_SETTINGS.map((skill) => {
    const composer =
      COMPOSER_SKILLS[skill.id] && document.getElementById(COMPOSER_SKILLS[skill.id]);
    const existing = !composer && skill.buttonId && document.getElementById(skill.buttonId);
    const button = existing || document.createElement('button');
    button.type = 'button';
    if (!button.querySelector('[data-skill-icon]')) {
      const svg = document.createElementNS(svgNamespace, 'svg');
      svg.setAttribute('viewBox', '0 0 20 20');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('d', skill.icon);
      svg.append(path);
      button.replaceChildren(svg);
    }
    button.dataset.skillButton = skill.id;
    if (!existing)
      button.onclick = () => (composer ? composer.click() : openSettings(skill.section));
    let syncComposer;
    if (composer) {
      const attributes = ['disabled', 'aria-pressed', 'aria-busy', 'title', 'aria-label'];
      syncComposer = () => {
        if (!state[skill.id]?.enabled) return;
        for (const attribute of attributes) {
          const value = composer.getAttribute(attribute);
          if (value === null) button.removeAttribute(attribute);
          else button.setAttribute(attribute, value);
        }
      };
      new MutationObserver(syncComposer).observe(composer, { attributeFilter: attributes });
    }
    button.addEventListener(
      'click',
      (event) => {
        if (state[skill.id]?.enabled) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        openSettings(skill.section);
      },
      { capture: true },
    );
    group.append(button);
    return { button, composer, existing, skill, syncComposer };
  });
  function render(settings = state) {
    state = settings;
    group.setAttribute('aria-label', ui.text('Skills'));
    for (const { button, composer, existing, skill, syncComposer } of buttons) {
      const entry = settings[skill.id];
      button.hidden = !(entry?.showButton ?? skill.showButton);
      button.dataset.skillEnabled = String(entry?.enabled === true);
      if (!existing || !entry?.enabled) {
        button.title = ui.text(skill.name);
        button.setAttribute('aria-label', ui.text(skill.name));
      }
      if (composer) {
        composer.hidden = !showComposerSkill(settings, skill.id);
        if (entry?.enabled) syncComposer();
        else {
          button.disabled = false;
          button.removeAttribute('aria-pressed');
          button.removeAttribute('aria-busy');
        }
      }
    }
    inputMic.hidden = settings['capri.microphone']?.enabled !== true;
    const timer = settings['capri.timers'];
    document.body.dataset.timerSkill = String(timer?.enabled === true && timer.showButton);
    onLayout();
  }
  return { render };
}
