// SPDX-License-Identifier: GPL-3.0-only
const panel = document.querySelector('aside');
const heading = panel.querySelector('h1');
const description = panel.querySelector('p');
let requested = false;

globalThis.capriSettingsHelp = Object.freeze({
  async prepare({ title, text, colors, side }) {
    requested = false;
    panel.removeAttribute('data-open');
    for (const [name, color] of Object.entries(colors))
      document.documentElement.style.setProperty(name, color);
    panel.dataset.side = side;
    heading.textContent = title;
    description.textContent = text;
    await document.fonts.ready;
    return Math.ceil(panel.getBoundingClientRect().height + 12);
  },
  show() {
    requested = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (requested) panel.setAttribute('data-open', '');
      }),
    );
  },
  hide() {
    requested = false;
    panel.removeAttribute('data-open');
  },
});
